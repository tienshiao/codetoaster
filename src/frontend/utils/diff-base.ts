import type { GitRefsResponse } from "../types/git";

// What a commit's Changes diff can be relative to (TASK-128).
//
// The choice is stored as the ref's *name* and resolved here against the
// current `/git/refs`, every render. That is what makes the diff follow a
// branch that moves, and what makes a ref that was deleted an ordinary state
// rather than an error: it resolves to nothing, and the view falls back to the
// commit's own parent.

export type DiffBaseKind = "branch" | "remote" | "tag";

export interface DiffBaseOption {
  /** The stored form, `<kind>:<name>`. The kind is part of it because a local
   * branch may be called `origin/foo`, which is also a remote's name. */
  value: string;
  kind: DiffBaseKind;
  name: string;
  sha: string;
}

export function diffBaseValue(kind: DiffBaseKind, name: string): string {
  return `${kind}:${name}`;
}

/** Every ref a diff can be taken against: local branches, then remotes, then
 * tags, each in the order the server listed them. */
export function diffBaseOptions(refs: GitRefsResponse | undefined): DiffBaseOption[] {
  if (!refs) return [];
  const of = (kind: DiffBaseKind, list: GitRefsResponse["branches"]) =>
    list.map(({ name, sha }) => ({ value: diffBaseValue(kind, name), kind, name, sha }));
  return [...of("branch", refs.branches), ...of("remote", refs.remotes), ...of("tag", refs.tags)];
}

/** The option a stored choice names, or null when nothing is chosen or the ref
 * it named is gone. */
export function resolveDiffBase(
  options: readonly DiffBaseOption[],
  value: string | null,
): DiffBaseOption | null {
  if (value === null) return null;
  return options.find((option) => option.value === value) ?? null;
}
