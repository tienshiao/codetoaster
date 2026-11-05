/**
 * The address of one worktree of a task's or a project's repository, as the
 * `:id` of `/api/worktrees/:id/<subpath>` (TASK-138.2).
 *
 * A token rather than a path in the URL because the server has to know which
 * root the worktree is *of* before it will serve it: it resolves the base root
 * first, lists that repository's worktrees, and answers only for a path that is
 * one of them. So the token carries the base root's scope and id beside the
 * path, and a client cannot name a directory without naming the repository it
 * claims to belong to.
 *
 * base64url (no padding) over the UTF-8 of a small JSON object, so a path with
 * any characters at all survives a route segment, and both sides can build it
 * with `btoa`/`atob` — present in the browser and in Bun alike.
 *
 * Import-free on purpose: the frontend's `repo-root.ts` builds the same token,
 * and must not pull anything of the server's in to do it.
 */
export interface WorktreeToken {
  /** The root the worktree belongs to, as the route scopes spell it. */
  scope: "tasks" | "projects";
  id: string;
  /** The worktree's absolute path. */
  path: string;
}

export function encodeWorktreeToken({ scope, id, path }: WorktreeToken): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ scope, id, path }));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The token's contents, or null for anything that is not a token this
 * module wrote: a bad alphabet, bytes that are not UTF-8, JSON of the wrong
 * shape, or a path that is not absolute. */
export function decodeWorktreeToken(token: string): WorktreeToken | null {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object") return null;
    const { scope, id, path } = parsed as Record<string, unknown>;
    if (scope !== "tasks" && scope !== "projects") return null;
    if (typeof id !== "string" || id === "") return null;
    if (typeof path !== "string" || !path.startsWith("/")) return null;
    return { scope, id, path };
  } catch {
    return null;
  }
}
