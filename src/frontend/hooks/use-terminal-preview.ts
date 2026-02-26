import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "../SessionContext";

interface CacheEntry {
  html: string;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Set<string>();

export function useTerminalPreview(
  sessions: SessionInfo[],
  theme: object | undefined,
  themeName: string,
  lastActivityAt: React.RefObject<Record<string, number>>,
) {
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const themeRef = useRef(theme);

  themeRef.current = theme;

  // Invalidate all cached entries when theme changes (compare by themeName)
  const prevThemeNameRef = useRef(themeName);
  useEffect(() => {
    if (prevThemeNameRef.current !== themeName) {
      cache.clear();
      prevThemeNameRef.current = themeName;
    }
  }, [themeName]);

  // Clean up cache for removed sessions
  useEffect(() => {
    const activeIds = new Set(sessions.map((s) => s.id));
    for (const id of cache.keys()) {
      if (!activeIds.has(id)) {
        cache.delete(id);
      }
    }
  }, [sessions]);

  const fetchPreview = useCallback((sessionId: string) => {
    const entry = cache.get(sessionId);
    const lastActivity = lastActivityAt.current[sessionId] ?? 0;
    if (entry && entry.fetchedAt >= lastActivity) return;
    if (inFlight.has(sessionId)) return;

    inFlight.add(sessionId);
    const themeParam = themeRef.current
      ? `?theme=${encodeURIComponent(JSON.stringify(themeRef.current))}`
      : "";
    fetch(`/api/sessions/${sessionId}/preview${themeParam}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch preview");
        return res.text();
      })
      .then((html) => {
        cache.set(sessionId, { html, fetchedAt: Date.now() });
        rerender();
      })
      .catch(() => {
        // silently ignore
      })
      .finally(() => {
        inFlight.delete(sessionId);
      });
  }, [lastActivityAt]);

  const getPreview = useCallback((sessionId: string): string | null => {
    return cache.get(sessionId)?.html ?? null;
  }, []);

  return { fetchPreview, getPreview };
}
