import { useMutation } from "@tanstack/react-query";

async function uploadFiles(taskId: string, files: File[]): Promise<void> {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  await fetch(`/api/tasks/${taskId}/upload`, {
    method: "POST",
    body: formData,
  });
}

export function useUploadFiles(taskId: string | undefined) {
  return useMutation({
    mutationFn: (files: File[]) => {
      if (!taskId) return Promise.resolve();
      return uploadFiles(taskId, files);
    },
  });
}
