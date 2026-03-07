import { useState } from "react";

const MAX_RECENT = 5;
const STORAGE_PREFIX = "codetoaster:recent-files:";

function storageKey(sessionId: string) {
  return STORAGE_PREFIX + sessionId;
}

export function removeRecentFiles(sessionId: string) {
  sessionStorage.removeItem(STORAGE_PREFIX + sessionId);
}

function readStorage(sessionId: string): string[] {
  try {
    const raw = sessionStorage.getItem(storageKey(sessionId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function useRecentFiles(sessionId: string | null) {
  const [recentFiles, setRecentFiles] = useState<string[]>(() =>
    sessionId ? readStorage(sessionId) : [],
  );

  function addRecentFile(path: string) {
    if (!sessionId) return;
    const updated = [path, ...recentFiles.filter((p) => p !== path)].slice(0, MAX_RECENT);
    setRecentFiles(updated);
    sessionStorage.setItem(storageKey(sessionId), JSON.stringify(updated));
  }

  return { recentFiles, addRecentFile };
}
