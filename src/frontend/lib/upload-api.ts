function body(files: File[]): FormData {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  return formData;
}

/** The staged paths, or the route's own sentence about why there are none:
 * every upload route answers `{ error }` on failure, and the status code alone
 * would tell the user nothing they can act on. */
async function paths(response: Response): Promise<string[]> {
  if (!response.ok) {
    const message = await response
      .json()
      .then((data: { error?: string }) => data?.error)
      .catch(() => undefined);
    throw new Error(message ?? `Upload failed (${response.status})`);
  }
  const { paths } = (await response.json()) as { paths: string[] };
  return paths;
}

/**
 * Files staged for a task that does not exist yet (TASK-93), answering with
 * the path each landed on.
 *
 * Not silent: the composer's submit turns these paths into the prompt it is
 * about to send, so a failure here has to stop the create rather than start a
 * task whose prompt names files that were never written.
 */
export async function uploadStaged(files: File[]): Promise<string[]> {
  return paths(await fetch("/api/uploads", { method: "POST", body: body(files) }));
}

/**
 * Files dropped on one of a task's terminals (TASK-96). The server stages them
 * and types their quoted paths into that PTY — the one named, which a shell
 * tab's is as readily as the agent's. Resolves to the paths for the caller
 * that wants to know where they went; rejects with the route's reason.
 */
export async function uploadToTerminal(
  taskId: string,
  ptyId: string,
  files: File[],
): Promise<string[]> {
  const url = `/api/tasks/${taskId}/upload?pty=${encodeURIComponent(ptyId)}`;
  return paths(await fetch(url, { method: "POST", body: body(files) }));
}
