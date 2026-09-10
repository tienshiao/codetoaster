import type { QueryKey } from "@tanstack/react-query";
import type { ServerMessage } from "../lib/xtmux/types";

/**
 * What a `changed` frame stales (TASK-103).
 *
 * The division of labour is deliberate: the server says *what moved* — some
 * files, or history — and knows nothing about queries; the client decides what
 * that makes stale, because only the client knows how its data is keyed. So
 * this is a pure function from one message to a list of query keys, and the
 * whole of the client half's behaviour can be tested without a socket, a
 * `QueryClient` or a rendered tree.
 *
 * Invalidating is not fetching. `invalidateQueries` defaults to
 * `refetchType: "active"`, so a key nothing has mounted is only marked stale
 * and refetches if and when something mounts it. That is what makes it safe to
 * name every key a change could possibly touch, and it is what AC #6 asks for:
 * a burst of edits to a task whose Files tab nobody has open costs one message
 * and a few map lookups.
 *
 * Every key below is written out here rather than imported, because the hooks
 * build theirs inline; the comment beside each names the hook it must match, so
 * a rename that misses one is at least findable by grepping this file.
 */
export function invalidationsFor(
  message: Extract<ServerMessage, { type: "changed" }>,
): QueryKey[] {
  const id = message.taskId;
  const keys: QueryKey[] = [];
  // Keyed by a string so "the diff, once" survives both halves naming it.
  const seen = new Set<string>();
  const add = (key: QueryKey) => {
    const tag = JSON.stringify(key);
    if (seen.has(tag)) return;
    seen.add(tag);
    keys.push(key);
  };

  const { files, history } = message;
  // `null` is the watcher's "too many to list" — a checkout, an install — and
  // means everything under the checkout may have moved. An empty array is the
  // opposite and says nothing did, which is what a history-only batch carries.
  if (files === null || files.length > 0) {
    add(["tasks", id, "files"]); // use-task-files.ts (the tree)
    add(["tasks", id, "diff"]); // use-task-diff.ts (the working-tree diff)
    // A prefix: the real key ends in the query string, and every search over
    // this task's files is now answering from a stale index.
    add(["tasks", id, "files-search"]); // use-file-search.ts
    if (files === null) {
      // Same trick, one level up: invalidate every open file at once rather
      // than a list we do not have.
      add(["tasks", id, "file"]); // use-task-files.ts (one file's content)
    } else {
      for (const file of files) add(["tasks", id, "file", file]);
    }
  }

  if (history) {
    add(["git-log", id]); // use-git-log.ts
    add(["git-refs", id]); // use-git-refs.ts
    // HEAD moved, so the base the working-tree diff is taken against moved
    // with it, even when not one file was written.
    add(["tasks", id, "diff"]); // use-task-diff.ts
  }

  // Deliberately untouched: `git-tree`, `git-file` and `git-commit` are keyed
  // by a commit sha, and a sha's content cannot change. Invalidating them on
  // every commit would re-fetch immutable data for a view that is still
  // showing exactly what it should.
  return keys;
}
