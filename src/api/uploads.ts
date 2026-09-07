import { taskManager } from "../lib/tasks/manager";
import { ptyPathList, saveUploads } from "../lib/uploads";
import { guardRoute } from "./origin";

/** Files read out of a multipart body under the field name the frontend uses.
 * Shared with the task-scoped upload in server.ts, which posts the same shape. */
export async function readUploadedFiles(req: Request): Promise<File[]> {
  const formData = await req.formData();
  // `getAll` hands back strings too, for a field that was not a file part.
  return formData.getAll("files").filter((value): value is File => value instanceof File);
}

// Staging for an upload that has no task to belong to yet: the composer takes
// attachments *before* `POST /api/tasks`, so there is no id to scope them
// under. They are written under `<root>/<uuid>/` and their paths appended to
// the prompt, which is how the agent is told to look at them — and what the
// harvester's third tier later reads them back out of to decide which of
// these directories are still in use (`lib/uploads.ts`).
//
// A factory over the root rather than a constant, because the root is the
// daemon's — `uploadsDir(dbPath)`, resolved once in `startServer` — and the
// collector that deletes from it has to be handed the same one.
export function uploadRoutes(root: string) {
  return {
    "/api/uploads": {
      async POST(req: Request) {
        const files = await readUploadedFiles(req);
        if (files.length === 0) {
          return Response.json({ error: "No files" }, { status: 400 });
        }
        return Response.json({ paths: await saveUploads(files, root) });
      },
    },

    // Files dropped on one of a task's terminals: staged the same way, then
    // their paths typed into the PTY they were dropped on, quoted where they
    // have to be — a screenshot's name has spaces in it, and a raw join makes
    // one path into several words (lib/uploads.ts). The server types them, so
    // the paths arrive exactly once whatever clients are attached.
    "/api/tasks/:id/upload": guardRoute({
      async POST(req: Request & { params: { id: string } }) {
        const taskId = req.params.id;
        // The agent's terminal, unless the drop names one of the task's shells
        // (TASK-96): a shell tab's grid is as much a drop target as the
        // agent's, and a path typed into the wrong one is a path the user has
        // to carry over by hand. Looked up among *this task's* terminals rather
        // than by id alone, so a client holding another task's PTY id cannot
        // type into it from here.
        const wanted = new URL(req.url).searchParams.get("pty");
        const session =
          wanted === null
            ? taskManager.primaryPty(taskId)
            : taskManager.taskPtyList(taskId).find((pty) => pty.id === wanted);
        if (!session) {
          return Response.json(
            { error: wanted === null ? "Task has no live terminal" : "That terminal is gone" },
            { status: 404 },
          );
        }
        const files = await readUploadedFiles(req);
        if (files.length === 0) {
          return Response.json({ error: "No files" }, { status: 400 });
        }
        const paths = await saveUploads(files, root);
        // Asked again after the write, because reading a multipart body and
        // putting it on disk both take time and the terminal can die under
        // them — and `Pty.write` no-ops on an exited PTY, so answering 200 here
        // would report paths that were typed nowhere. The staged directory is
        // harmless: nothing references it, and the harvester collects it by age.
        if (session.exited) {
          return Response.json({ error: "That terminal is gone" }, { status: 404 });
        }
        // A trailing space, the way a drop into Terminal.app or iTerm leaves
        // one: it ends the token, so a second drop or the next word typed
        // starts its own rather than gluing onto the last path.
        session.write(ptyPathList(paths) + " ");
        return Response.json({ paths });
      },
    }),
  };
}
