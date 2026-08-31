// Serializing the git that touches a repository's worktree list
// (docs/v2-architecture.md §5.6).

/** The newest operation in flight for a repository, so the next one queues
 * behind it. Keyed by `repo_root`, because that is the scope git itself
 * contends on: worktrees of one repository share `.git/worktrees` and the
 * repository's ref store, and two `git worktree add` runs there take the same
 * locks. Two *different* repositories have nothing to serialize.
 *
 * The lock is not really about git's own locking, though — git would fail one
 * of the two with a lock error rather than corrupt anything. It is about the
 * step before it. Choosing a branch name means listing the branches that exist
 * and picking the first free suffix, and two creates that both read the list
 * before either writes to it both pick the same name: one `worktree add`
 * succeeds, the other fails on a branch that existed by the time it looked
 * again. Read-then-write is the critical section, and the read is the half
 * that has to be inside it. */
const inFlight = new Map<string, Promise<unknown>>();

/** Run `operation` with no other locked operation running for `repoRoot`.
 *
 * The chain is joined whichever way the operation before it went: a create
 * that failed is not a reason to refuse the next one, and swallowing its
 * rejection here would also make it an unhandled one. The caller still sees
 * its own result — `operation`'s promise is what is returned, not the chain's.
 *
 * In-process only, and deliberately: it guards this daemon's own concurrency,
 * which is where the suffix race lives, and there is exactly one daemon per
 * machine (`~/.codetoaster/` holds its PID file). A second codetoaster against
 * the same repository would need a file lock, and would have larger problems
 * than branch naming. */
export function withRepoLock<T>(repoRoot: string, operation: () => Promise<T>): Promise<T> {
  const previous = inFlight.get(repoRoot);
  const result = previous ? previous.then(operation, operation) : operation();
  // Tracked separately from `result` so the map holds a promise that never
  // rejects: the next caller chains onto this one, and a rejection travelling
  // down the chain would be reported once per waiter.
  const tracked: Promise<void> = result.then(
    () => { if (inFlight.get(repoRoot) === tracked) inFlight.delete(repoRoot); },
    () => { if (inFlight.get(repoRoot) === tracked) inFlight.delete(repoRoot); },
  );
  // Only when it is still the newest: a third caller arriving while this one
  // runs replaces the entry, and deleting unconditionally on settle would drop
  // the chain that caller is queued behind and let a fourth run alongside it.
  inFlight.set(repoRoot, tracked);
  return result;
}
