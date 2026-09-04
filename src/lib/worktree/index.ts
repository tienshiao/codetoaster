export { createWorktree, removeWorktree } from "./create";
export type { CreatedWorktree, WorktreeTask } from "./create";
export { parseCopyList } from "./copy";
export type { WorktreeProject } from "./copy";
export { WorktreeError } from "./errors";
export { discardCheckout, evictWorktree } from "./evict";
export type { WorktreeErrorKind } from "./errors";
export { allocateBranch, branchSlug, deleteBranch, BRANCH_PREFIX } from "./branch";
export { withRepoLock } from "./lock";
export { lockKeyFor, repoRootOf } from "./repo";
export { restoreWorktree } from "./restore";
export type { RestoredWorktree, WipDisposition } from "./restore";
export {
  isWithinWorktreesRoot,
  setupStampPath,
  worktreeCwd,
  worktreePathFor,
  worktreesRoot,
} from "./paths";
export { reconcileWorktrees } from "./reconcile";
export type { ReconcileReport, UnclaimedWorktree } from "./reconcile";
export { branchIsExpendable, branchStatus } from "./status";
export type { BranchStatus } from "./status";
export { readSetupOutcome, wrapWithSetup } from "./setup";
export type { SetupOutcome } from "./setup";
export { applyWip, dropWip, readWip, snapshotWip, wipRefFor } from "./wip";
export type { WipCommit, WipSnapshot } from "./wip";
