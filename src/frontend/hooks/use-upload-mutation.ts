import { useMutation } from "@tanstack/react-query";

async function uploadFiles(sessionId: string, files: File[]): Promise<void> {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  await fetch(`/api/sessions/${sessionId}/upload`, {
    method: "POST",
    body: formData,
  });
}

export function useUploadFiles(sessionId: string | undefined) {
  return useMutation({
    mutationFn: (files: File[]) => {
      if (!sessionId) return Promise.resolve();
      return uploadFiles(sessionId, files);
    },
  });
}
