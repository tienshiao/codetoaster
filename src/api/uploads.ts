import { saveUploads } from "../lib/uploads";

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
  };
}
