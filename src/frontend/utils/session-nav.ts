import { buildSessionSlug } from "./slug";
import { getViewState, viewRef } from "../view-state-store";
import type { TabType } from "../types/tab";
import type { GitViewMode } from "../types/git";

/**
 * The route path for each tab. Exported so a caller that only wants to swap
 * the slug can name its current route explicitly: relative navigation would
 * resolve against /sessions/$slug and silently drop a /file or /git segment.
 */
export const TAB_ROUTES = {
  terminal: "/sessions/$slug",
  diff: "/sessions/$slug/diff",
  file: "/sessions/$slug/file",
  git: "/sessions/$slug/git",
} as const satisfies Record<TabType, string>;

export type SessionNavTarget =
  | { to: "/sessions/$slug"; params: { slug: string } }
  | { to: "/sessions/$slug/diff"; params: { slug: string } }
  | { to: "/sessions/$slug/file"; params: { slug: string }; search: { file?: string } }
  | {
      to: "/sessions/$slug/git";
      params: { slug: string };
      search: { commit?: string; mode?: GitViewMode; file?: string };
    };

/**
 * Navigation target for a specific tab of a session. The file tab restores
 * the session's last-viewed file from the view-state store.
 */
export function tabNavTarget(session: { id: string; name: string }, tab: TabType): SessionNavTarget {
  const slug = buildSessionSlug(session);
  if (tab === "diff") {
    return { to: "/sessions/$slug/diff", params: { slug } };
  }
  if (tab === "file") {
    return {
      to: "/sessions/$slug/file",
      params: { slug },
      search: {
        file: getViewState("files", viewRef(session.id, "files")).selectedFile ?? undefined,
      },
    };
  }
  if (tab === "git") {
    const nav = getViewState("nav", viewRef(session.id, "nav"));
    return {
      to: "/sessions/$slug/git",
      params: { slug },
      search: { commit: nav.gitCommit, mode: nav.gitMode, file: nav.gitFile },
    };
  }
  return { to: "/sessions/$slug", params: { slug } };
}

/**
 * Navigation target for switching to a session: the tab (and file) the user
 * was last on in that session. New sessions default to the terminal.
 */
export function sessionNavTarget(session: { id: string; name: string }): SessionNavTarget {
  return tabNavTarget(session, getViewState("nav", viewRef(session.id, "nav")).lastTab);
}

/**
 * Where to go after closing the current session: the first remaining session
 * that still has something behind it, or home when there is none.
 *
 * Suspended rows are skipped rather than landed on. Opening a suspended task
 * resumes it (§6), and closing one task is not the user asking to start an
 * agent in another — with the sidebar now keeping suspended rows, the first
 * remaining session is very often one, so closing a tab would silently spawn
 * `claude --resume` in some dormant task's repository. It stays in the sidebar,
 * one click away, which is where resuming it belongs.
 */
export function closeNavTarget(
  remaining: { id: string; name: string; lifecycle?: string }[],
): SessionNavTarget | { to: "/" } {
  const next = remaining.find((s) => s.lifecycle !== "suspended");
  return next ? sessionNavTarget(next) : { to: "/" };
}
