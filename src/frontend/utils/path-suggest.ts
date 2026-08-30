/**
 * Path arithmetic for the repository-path field: tilde expansion, the ancestor
 * chain a browse tree has to open, and which suggestion a key lands on.
 *
 * Apart from the component that uses it so `bun test` can reach it without a
 * DOM — the same split `drag.ts` and `layout-store.ts` make.
 *
 * The server is the authority on `~`: `/api/directories` expands it and hands
 * back a `~`-relative `parent`, so what the field holds stays what the user
 * typed. These helpers exist for the *tree*, which addresses nodes absolutely
 * and has to translate at both ends.
 */

/** `~` and `~/x` against a home directory. Anything else is returned as-is. */
export function expandTilde(path: string, home: string): string {
  if (!home) return path;
  if (path === "~") return home;
  if (path.startsWith("~/")) return home + path.slice(1);
  return path;
}

/** The inverse: what the field should read once the tree has picked a node. */
export function toDisplayPath(absolute: string, home: string): string {
  if (!home) return absolute;
  if (absolute === home) return "~";
  if (absolute.startsWith(home + "/")) return "~" + absolute.slice(home.length);
  return absolute;
}

/** Joins without doubling the separator under root, where the parent is "/". */
export function childPath(parent: string, name: string): string {
  return parent === "/" ? "/" + name : parent + "/" + name;
}

/**
 * Every path from root down to `absolute`, inclusive — the nodes a tree must
 * have expanded for `absolute` to be on screen.
 */
export function ancestorsOf(absolute: string): string[] {
  const chain = ["/"];
  const parts = absolute.split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    chain.push("/" + parts.slice(0, i + 1).join("/"));
  }
  return chain;
}

/**
 * The value a suggestion writes into the field.
 *
 * `parent` comes back from the API already `~`-relative, so accepting a
 * suggestion never rewrites a `~` the user typed into an absolute path. The
 * trailing slash is what makes the next request list *inside* the accepted
 * directory rather than re-filtering its siblings.
 */
export function suggestionValue(parent: string, name: string): string {
  // Root answers with an empty `parent` (there is nothing above "/"), which
  // concatenates to the right thing here and would double the slash if it
  // didn't.
  return parent + "/" + name + "/";
}

/**
 * Where the highlight moves. Clamped rather than wrapped: a list of directories
 * has a first and a last, and rolling off either end reads as a mis-key.
 */
export function moveSelection(index: number, count: number, delta: number): number {
  if (count === 0) return 0;
  return Math.min(Math.max(index + delta, 0), count - 1);
}
