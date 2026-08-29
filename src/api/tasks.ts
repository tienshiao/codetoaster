import { taskManager } from "../lib/tasks/manager";
import type { CreateTaskOptions } from "../lib/tasks/manager";
import { readSnapshot } from "../lib/tasks/snapshot";

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A field that must be a string if it is there at all. `undefined` means
 * absent, `null` means the caller sent something that is not a string. */
function optionalString(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : null;
}

function optionalSize(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Task CRUD lives here rather than on the socket (§5.3): creating a task
// resolves a directory, runs git and spawns a process, and every one of those
// can fail in a way the caller needs to hear about. A fire-and-forget message
// answered by an `error` frame with no request to correlate it to cannot say
// which create failed, or why, or with what status.
export const taskRoutes = {
  "/api/tasks": {
    async GET() {
      const tasks = taskManager.listTasks();
      // The one place a live PTY is still asked anything: listing is when we
      // happen to have the processes to hand, so it is where an agent that has
      // cd'd elsewhere gets noticed and written back (§5.4).
      return Response.json(await Promise.all(
        tasks.map(async (task) => ({
          ...task,
          cwd: (await taskManager.refreshCwd(task.id)) ?? null,
        }))
      ));
    },

    async POST(req: Request) {
      const body = await readJsonBody(req);
      if (!body) return badRequest("Expected a JSON object body");

      const fields = {
        projectId: optionalString(body.projectId),
        // Optional until the composer exists (TASK-24). The row's
        // initial_prompt is NOT NULL, so an absent one is recorded as empty
        // rather than refused — a v1 "New Session" has nothing to say yet.
        prompt: optionalString(body.prompt),
        title: optionalString(body.title),
        model: optionalString(body.model),
        permissionMode: optionalString(body.permissionMode),
        afterTaskId: optionalString(body.afterTaskId),
      };
      for (const [name, value] of Object.entries(fields)) {
        if (value === null) return badRequest(`"${name}" must be a string`);
      }
      // Same bar as PATCH: a title is either a deliberate choice or absent, and
      // a blank one is neither — it would be stored verbatim, leaving a row
      // with nothing to show and a slug with nothing in front of its uuid.
      // Trimmed for the same reason the blank check exists: the surrounding
      // space is not part of anyone's choice, and it reaches the row, the
      // uniqueness check and the URL slug.
      if (typeof fields.title === "string") {
        if (!fields.title.trim()) return badRequest(`"title" cannot be blank`);
        fields.title = fields.title.trim();
      }
      const cols = optionalSize(body.cols);
      const rows = optionalSize(body.rows);
      if (cols === null || rows === null) return badRequest(`"cols" and "rows" must be numbers`);

      if (fields.projectId && !taskManager.hasProject(fields.projectId)) {
        return badRequest(`Unknown project "${fields.projectId}"`);
      }
      if (fields.afterTaskId && !taskManager.getTask(fields.afterTaskId)) {
        return Response.json(
          { error: `Unknown task "${fields.afterTaskId}"` },
          { status: 404 },
        );
      }

      let task;
      try {
        task = await taskManager.createTask({
          id: crypto.randomUUID(),
          ...(fields as Omit<CreateTaskOptions, "id">),
          cols: cols ?? undefined,
          rows: rows ?? undefined,
        });
      } catch (e: any) {
        // Spawning is the interesting failure: a $SHELL that is no longer on
        // PATH throws out of Bun.spawn, and the caller deserves to know that
        // rather than watching a session never appear.
        return Response.json(
          { error: e?.message ?? "Could not create the task" },
          { status: 500 },
        );
      }

      taskManager.broadcastTasks();
      return Response.json(taskManager.taskInfo(task.id), { status: 201 });
    },
  },

  "/api/tasks/:id/resume": {
    // Reopening a suspended task (§4.3). HTTP rather than a socket message for
    // the same reason create is: it spawns a process, walks a fallback ladder,
    // and can end in a state the caller has to act on — all of which want a
    // status code and a body.
    async POST(req: Request & { params: { id: string } }) {
      const body = (await readJsonBody(req)) ?? {};
      const fresh = body.fresh;
      if (fresh !== undefined && typeof fresh !== "boolean") {
        return badRequest(`"fresh" must be a boolean`);
      }
      const cols = optionalSize(body.cols);
      const rows = optionalSize(body.rows);
      if (cols === null || rows === null) return badRequest(`"cols" and "rows" must be numbers`);

      const existing = taskManager.getTask(req.params.id);
      if (!existing) {
        return Response.json({ error: `Unknown task "${req.params.id}"` }, { status: 404 });
      }
      // An archived task has had its worktree removed and its files cleaned up
      // (TASK-31). Reopening one is a restore, not a resume.
      if (existing.lifecycle === "archived") {
        return Response.json({ error: "Task is archived" }, { status: 409 });
      }

      try {
        await taskManager.resumeTask(req.params.id, {
          fresh: fresh === true,
          cols: cols ?? undefined,
          rows: rows ?? undefined,
        });
      } catch (e: any) {
        return Response.json(
          { error: e?.message ?? "Could not resume the task" },
          { status: 500 },
        );
      }

      taskManager.broadcastTasks();
      // The ladder awaits a spawn and up to `startTimeoutMs` per rung, and
      // `closeTask` is one synchronous DELETE away — `runResumeLadder` checks
      // for the row twice for exactly that reason. So the task can be gone by
      // the time there is an answer to send, and `Response.json(undefined)`
      // throws rather than serializing, turning a race into a 500 with an
      // internal error in it.
      const info = taskManager.taskInfo(req.params.id);
      if (!info) {
        return Response.json({ error: `Unknown task "${req.params.id}"` }, { status: 404 });
      }
      // 200 otherwise, including the could-not-resume landing: the task is
      // there, and its agent_state says what happened. A failed resume is a
      // state the user can act on, not an HTTP error.
      return Response.json(info);
    },
  },

  "/api/tasks/:id/scrollback": {
    // The first half of the two-phase reopen (§5.5): the screen the task was
    // last showing, fetched so the user sees where they left off within one
    // round-trip — before the resumed agent exists, let alone paints.
    //
    // HTTP rather than a `restore` frame, and not because of §5.4's rule alone:
    // a `restore` is addressed by ptyId, and the whole point of this phase is
    // that there is no PTY yet to name it with.
    async GET(req: Request & { params: { id: string } }) {
      const row = taskManager.getTask(req.params.id);
      if (!row) {
        return Response.json({ error: `Unknown task "${req.params.id}"` }, { status: 404 });
      }
      // A task with no stored screen is a normal answer, not a failure: one
      // suspended before snapshots existed, or an agent that died before a
      // snapshot ever ran, has nothing to repaint and the client simply waits
      // for the live PTY. Kept distinguishable from the 404 above, which means
      // something else entirely — there is no such task to resume at all.
      const data = await readSnapshot(req.params.id);
      const { last_size_cols: cols, last_size_rows: rows } = row;
      return Response.json({
        data: data ?? null,
        // Both or neither: a snapshot repainted into a grid it was not taken at
        // reflows into nonsense, and half a size is no better than none — the
        // client's own measured grid is a better guess than a fabricated
        // dimension paired with a real one.
        size: typeof cols === "number" && typeof rows === "number" ? { cols, rows } : null,
      });
    },
  },

  "/api/tasks/:id/close": {
    // The close button, and a suspend rather than a delete (§6): chat products
    // have no "close", so this is the escape hatch that puts a task down
    // without ending it. None of §5.5's guards apply — a user closing a task
    // has said what the guards exist to infer, so a busy agent mid-turn closes
    // as readily as an idle one.
    async POST(req: Request & { params: { id: string } }) {
      if (!taskManager.getTask(req.params.id)) {
        return Response.json({ error: `Unknown task "${req.params.id}"` }, { status: 404 });
      }
      // The answer is not checked: `closeTask` reports false for a task that
      // was already suspended, and closing something that is already closed is
      // not a failure to tell the caller about. The row below says what is true
      // either way.
      await taskManager.closeTask(req.params.id);
      // Same race as resume, and the same guard: closing snapshots the screen
      // first, which is an await, and a DELETE landing in that window leaves
      // nothing to describe — `Response.json(undefined)` throws rather than
      // serializing, turning the race into a 500.
      const info = taskManager.taskInfo(req.params.id);
      if (!info) {
        return Response.json({ error: `Unknown task "${req.params.id}"` }, { status: 404 });
      }
      return Response.json(info);
    },
  },

  "/api/tasks/:id": {
    async PATCH(req: Request & { params: { id: string } }) {
      const body = await readJsonBody(req);
      if (!body) return badRequest("Expected a JSON object body");

      const title = optionalString(body.title);
      if (title === null) return badRequest(`"title" must be a string`);
      if (title === undefined) return badRequest(`"title" is required`);
      if (!title.trim()) return badRequest(`"title" cannot be blank`);

      if (!taskManager.renameTask(req.params.id, title.trim())) {
        return Response.json({ error: "Task not found" }, { status: 404 });
      }
      const info = taskManager.taskInfo(req.params.id);
      if (!info) {
        return Response.json({ error: "Task not found" }, { status: 404 });
      }
      return Response.json(info);
    },

    // The interim archive (§6): the row, the terminals and the scrollback go
    // for good. It is the destructive door, kept off the browser's paths on
    // purpose — the only caller is `codetoaster kill`, which meant "delete" in
    // v1 and has no other route to mean it by. TASK-31 gives this worktree
    // cleanup and the confirmation an archive deserves.
    DELETE(req: Request & { params: { id: string } }) {
      if (taskManager.deleteTask(req.params.id)) {
        taskManager.broadcastTasks();
        return Response.json({ success: true });
      }
      return Response.json({ error: "Task not found" }, { status: 404 });
    },
  },
};
