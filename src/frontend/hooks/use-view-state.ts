import { useState, useCallback, type Dispatch, type SetStateAction } from "react";
import {
  getViewState,
  gitDetailState,
  peekGitDetailState,
  type SessionViewState,
  type GitDetailViewState,
} from "../view-state-store";

type Section = "fileView" | "diffView" | "gitView";

/**
 * useState backed by the per-session view-state store: hydrates from the store
 * on mount and writes through on every set. Components using this hook must
 * remount when the session changes (the diff/file routes key their views by
 * session id), so `sessionId` is stable for the lifetime of a hook instance.
 */
export function useViewState<S extends Section, K extends keyof SessionViewState[S]>(
  sessionId: string,
  section: S,
  key: K,
): [SessionViewState[S][K], Dispatch<SetStateAction<SessionViewState[S][K]>>] {
  type V = SessionViewState[S][K];
  const [value, setValue] = useState<V>(() => getViewState(sessionId)[section][key]);
  const set = useCallback<Dispatch<SetStateAction<V>>>(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: V) => V)(prev) : next;
        getViewState(sessionId)[section][key] = resolved;
        return resolved;
      });
    },
    [sessionId, section, key],
  );
  return [value, set];
}

/**
 * useState backed by the per-session git detail cache for a single sha. Mirrors
 * useViewState: hydrates from `gitDetailState(sessionId, sha)` on mount and
 * writes through on every set. Sound only when the consuming component remounts
 * as the commit changes — CommitDetail keys its sub-mode components by the full
 * hash, so `sha` is stable for a hook instance's lifetime.
 */
export function useGitDetailState<K extends keyof GitDetailViewState>(
  sessionId: string,
  sha: string,
  key: K,
): [GitDetailViewState[K], Dispatch<SetStateAction<GitDetailViewState[K]>>] {
  type V = GitDetailViewState[K];
  const [value, setValue] = useState<V>(() => gitDetailState(sessionId, sha)[key]);
  const set = useCallback<Dispatch<SetStateAction<V>>>(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: V) => V)(prev) : next;
        // Guarded write: if the slot has moved to another commit (a stale
        // caller violating the remount-per-sha contract), skip rather than
        // destructively re-seeding the slot for the old sha.
        const slot = peekGitDetailState(sessionId, sha);
        if (slot) slot[key] = resolved;
        return resolved;
      });
    },
    [sessionId, sha, key],
  );
  return [value, set];
}
