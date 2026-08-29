import { taskManager } from "../lib/tasks/manager";
import type { CreateTaskOptions } from "../lib/tasks/manager";

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
      return Response.json(taskManager.taskInfo(req.params.id));
    },

    DELETE(req: Request & { params: { id: string } }) {
      if (taskManager.closeTask(req.params.id)) {
        taskManager.broadcastTasks();
        return Response.json({ success: true });
      }
      return Response.json({ error: "Task not found" }, { status: 404 });
    },
  },
};
