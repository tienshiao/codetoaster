import { useMutation } from "@tanstack/react-query";

function body(files: File[]): FormData {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  return formData;
}

async function uploadFiles(taskId: string, files: File[]): Promise<void> {
  await fetch(`/api/tasks/${taskId}/upload`, {
    method: "POST",
    body: body(files),
  });
}

/**
 * Files staged for a task that does not exist yet (TASK-93), answering with
 * the path each landed on.
 *
 * Not the mutation below, and not silent like it: the composer's submit turns
 * these paths into the prompt it is about to send, so a failure here has to
 * stop the create rather than start a task whose prompt names files that were
 * never written.
 */
export async function uploadStaged(files: File[]): Promise<string[]> {
  const response = await fetch("/api/uploads", { method: "POST", body: body(files) });
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

export function useUploadFiles(taskId: string | undefined) {
  return useMutation({
    mutationFn: (files: File[]) => {
      if (!taskId) return Promise.resolve();
      return uploadFiles(taskId, files);
    },
  });
}
