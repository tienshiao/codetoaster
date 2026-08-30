import { useState } from "react";

const MAX_RECENT = 5;
const STORAGE_PREFIX = "codetoaster:recent-files:";

function storageKey(taskId: string) {
  return STORAGE_PREFIX + taskId;
}

export function removeRecentFiles(taskId: string) {
  sessionStorage.removeItem(STORAGE_PREFIX + taskId);
}

function readStorage(taskId: string): string[] {
  try {
    const raw = sessionStorage.getItem(storageKey(taskId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function useRecentFiles(taskId: string | null) {
  const [recentFiles, setRecentFiles] = useState<string[]>(() =>
    taskId ? readStorage(taskId) : [],
  );

  function addRecentFile(path: string) {
    if (!taskId) return;
    const updated = [path, ...recentFiles.filter((p) => p !== path)].slice(0, MAX_RECENT);
    setRecentFiles(updated);
    sessionStorage.setItem(storageKey(taskId), JSON.stringify(updated));
  }

  return { recentFiles, addRecentFile };
}
