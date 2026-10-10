import type { QueryKey } from "@tanstack/react-query";
import { gitKeys, taskKeys } from "./query-keys";
import { isUnder, parentDir, type ListedIgnored } from "./utils/ignored-files";
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
 * Every key comes from `query-keys.ts`, which the owning hooks build theirs
 * from as well: a key spelled out twice is a key one rename can silently
 * detach, and a detached invalidation fails as silence rather than as an error.
 *
 * `rootIds` names every cache the change reaches, as root ids (`rootId` in
 * `repo-root.ts`). By default only the task the frame names; the caller adds
 * the task's project root (`project:<id>`) when the task runs in the project's
 * own directory rather than a worktree, because then the composer's Explorer
 * is browsing the very tree that moved (TASK-106). Each id gets the same set.
 *
 * `listedIgnored` is the one thing asked of the caller's cache, and only for a
 * frame that names ignored paths (TASK-130): the ignored entries the root's
 * file listing already holds, or undefined when it holds no listing. Passed in
 * rather than read here so this stays a function of its arguments.
 */
export function invalidationsFor(
  message: Extract<ServerMessage, { type: "changed" }>,
  rootIds: readonly string[] = [message.taskId],
  listedIgnored: (rootId: string) => ListedIgnored | undefined = () => undefined,
): QueryKey[] {
  return rootIds.flatMap((id) => keysFor(message, id, listedIgnored));
}

function keysFor(
  message: Extract<ServerMessage, { type: "changed" }>,
  id: string,
  listedIgnored: (rootId: string) => ListedIgnored | undefined,
): QueryKey[] {
  const keys: QueryKey[] = [];

  const { files, history } = message;
  // `null` is the watcher's "too many to list" — a checkout, an install — and
  // means everything under the checkout may have moved. An empty array is the
  // opposite and says nothing did, which is what a history-only batch carries.
  const filesMoved = files === null || files.length > 0;

  if (filesMoved) {
    keys.push(taskKeys.files(id));
    // A prefix: the real key ends in the query string, and every search over
    // this task's files is now answering from a stale index.
    keys.push(taskKeys.fileSearchPrefix(id));
    if (files === null) {
      // Same trick, one level up: invalidate every open file at once rather
      // than a list we do not have.
      keys.push(taskKeys.filePrefix(id));
      // And every ignored directory open in the tree: an overflow is not
      // filtered, so what moved may as well have been under one.
      keys.push(taskKeys.dirChildrenPrefix(id));
    } else {
      for (const file of files) keys.push(taskKeys.file(id, file));
    }
    // The symbol index is revalidated by mtime on the server, so what is stale
    // after a write is only the client's copy of the answer.
    keys.push(taskKeys.symbolPrefix(id));
    keys.push(taskKeys.symbolSearchPrefix(id));
    // Backlog reads `backlog/` inside the checkout, and otherwise waits out a
    // 3s poll that only runs while the section is open.
    keys.push(taskKeys.backlog(id));
  }

  // Paths the repository ignores (TASK-130). Two things show one: a tab open
  // on the file, and the tree where the directory holding it has been opened.
  // The diff, the symbols and the backlog never do, which is why the server
  // names these apart and why nothing below reaches for those keys.
  const ignored = message.ignored ?? [];
  if (ignored.length > 0) {
    for (const file of ignored) keys.push(taskKeys.file(id, file));
    for (const dir of new Set(ignored.map(parentDir))) {
      if (dir !== "") keys.push(taskKeys.dirChildren(id, dir));
    }
    // The listing holds an ignored directory as one entry, so a write inside
    // one it already lists changes nothing it shows — and that is a build,
    // once a second for as long as it runs, against a listing every visible
    // terminal observes for its links. The same goes for a write to an ignored
    // file it lists: a log a dev server appends to. What that leaves stale is
    // the size beside the file, until something else refetches the listing.
    //
    // Anything else may be an entry arriving or going: `.env` created, a
    // listed file the server says is `gone`, `dist/` on its first build or its
    // removal. Without a listing to consult there is nothing cached to refetch,
    // or nothing known about what is, and either way staling it is right.
    // When ordinary files moved as well, both are already named above.
    if (!filesMoved) {
      const listed = listedIgnored(id);
      const gone = new Set(message.gone);
      const covered = (file: string) =>
        listed !== undefined &&
        (isUnder(file, listed.dirs) || (listed.files.has(file) && !gone.has(file)));
      if (!ignored.every(covered)) {
        keys.push(taskKeys.files(id));
        keys.push(taskKeys.fileSearchPrefix(id));
      }
    }
  }

  if (history) {
    // The refs, and deliberately *not* the log. `use-git-history` already
    // resets the log whenever the refs payload hash changes, and any commit
    // changes `head.sha` in that payload — so invalidating the log as well
    // would have react-query refetch every loaded page in sequence, re-deriving
    // each page param through `getNextPageParam` (which turns a `fetchUntil`
    // page back into a 200-row one), and then the refs-driven reset would throw
    // all of it away. Letting the refs do it is a single page-one fetch.
    //
    // That leaves one consumer of the log this does not reach: the command
    // palette's `useGitLog`, which is enabled only while its search is open and
    // is mounted fresh each time, so it has no stale window to correct.
    keys.push(gitKeys.refs(id));
  }

  // Once, for either reason: files were written, or HEAD moved and took the
  // base the working-tree diff is taken against with it — a commit changes the
  // diff even when not one file was.
  if (filesMoved || history) keys.push(taskKeys.diff(id));

  // Deliberately untouched: `git-tree`, `git-file` and `git-commit` are keyed
  // by a commit sha, and a sha's content cannot change. Invalidating them on
  // every commit would re-fetch immutable data for a view that is still
  // showing exactly what it should.
  return keys;
}
