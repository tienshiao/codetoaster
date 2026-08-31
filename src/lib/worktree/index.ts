export { createWorktree, parseCopyList, removeWorktree } from "./create";
export type { CreatedWorktree, WorktreeProject, WorktreeTask } from "./create";
export { WorktreeError } from "./errors";
export type { WorktreeErrorKind } from "./errors";
export { allocateBranch, branchSlug, BRANCH_PREFIX } from "./branch";
export { withRepoLock } from "./lock";
export { setupStampPath, worktreePathFor, worktreesRoot } from "./paths";
export { readSetupOutcome, wrapWithSetup } from "./setup";
export type { SetupOutcome } from "./setup";
