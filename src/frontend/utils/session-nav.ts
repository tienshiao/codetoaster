import { buildSessionSlug } from "./slug";
import { getViewState } from "../view-state-store";
import type { TabType } from "../types/tab";

export type SessionNavTarget =
  | { to: "/sessions/$slug"; params: { slug: string } }
  | { to: "/sessions/$slug/diff"; params: { slug: string } }
  | { to: "/sessions/$slug/file"; params: { slug: string }; search: { file?: string } }
  | { to: "/sessions/$slug/git"; params: { slug: string }; search: { commit?: string } };

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
      search: { file: getViewState(session.id).fileView.selectedFile ?? undefined },
    };
  }
  if (tab === "git") {
    return {
      to: "/sessions/$slug/git",
      params: { slug },
      search: { commit: getViewState(session.id).gitView.commit ?? undefined },
    };
  }
  return { to: "/sessions/$slug", params: { slug } };
}

/**
 * Navigation target for switching to a session: the tab (and file) the user
 * was last on in that session. New sessions default to the terminal.
 */
export function sessionNavTarget(session: { id: string; name: string }): SessionNavTarget {
  return tabNavTarget(session, getViewState(session.id).lastTab);
}

/**
 * Where to go after closing the current session: the first remaining
 * session's last-viewed tab, or home when none are left.
 */
export function closeNavTarget(
  remaining: { id: string; name: string }[],
): SessionNavTarget | { to: "/" } {
  const next = remaining[0];
  return next ? sessionNavTarget(next) : { to: "/" };
}
