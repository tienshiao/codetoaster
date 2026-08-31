import type { ServerWebSocket } from "bun";
import type { Database } from "bun:sqlite";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { Pty } from "../xtmux/pty";
import { PtyManager } from "../xtmux/pty-manager";
import type {
  ProjectInfo,
  ProjectSettings,
  ServerMessage,
  TaskInfo,
  TaskWorktreeInfo,
  WebSocketData,
} from "../xtmux/types";
import { uniqueName } from "../xtmux/naming";
import * as db from "../db";
import type { ProjectRow, TaskRow } from "../db";
import { TaskStore } from "./store";
import { buildAgentCommand, removeTaskDir, taskDir, taskEnv, type AgentMode } from "../agent/spawn";
import {
  canResumeSessionId,
  continueIsSafe,
  findResumableTranscript,
  runsInOwnWorktree,
  sessionIdFromTranscript,
  transcriptExists,
} from "../agent/transcripts";
import { writeTaskSettings } from "../agent/settings";
import {
  compactTriggerOf,
  endsCompaction,
  startsCompaction,
  transitionFor,
  type CompactTrigger,
  type HookPayload,
} from "../agent/hook-state";
import { deriveTitle, resolveRepoRoot, titleFromPrompt } from "./derive";
import { removeSnapshot, writeSnapshot } from "./snapshot";
import {
  applyWip,
  branchIsExpendable,
  branchStatus,
  createWorktree,
  deleteBranch,
  dropWip,
  evictWorktree,
  isWithinWorktreesRoot,
  readSetupOutcome,
  reconcileWorktrees,
  removeWorktree,
  repoRootOf,
  restoreWorktree,
  setupStampPath,
  snapshotWip,
  worktreePathFor,
  wrapWithSetup,
  WorktreeError,
  type BranchStatus,
  type CreatedWorktree,
  type ReconcileReport,
  type RestoredWorktree,
  type UnclaimedWorktree,
  type WipSnapshot,
} from "../worktree";

/** Whether two measurements say the same thing. Field by field rather than by
 * serialising: this is asked once per Stop hook per task, and the point of it
 * is to avoid a broadcast, not to be clever. */
function sameWorktreeStatus(a: TaskWorktreeInfo, b: TaskWorktreeInfo): boolean {
  return a.branch === b.branch && a.dirty === b.dirty
    && a.unpushed === b.unpushed && a.merged === b.merged;
}

function expandTilde(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return os.homedir() + filepath.slice(1);
  }
  return filepath;
}

const DEFAULT_SIZE = { cols: 80, rows: 24 };

/** The project every task without one falls into. Minted per call rather than
 * shared: the caller pushes it into a list whose `taskIds` it then mutates. */
function generalProject(): ProjectInfo {
  return {
    id: "general",
    name: "General",
    initialPath: "",
    taskIds: [],
    ...UNSET_PROJECT_SETTINGS,
  };
}

/** A project that decides nothing on its tasks' behalf. Every field here is
 * "ask someone else": the agent's own default for the model and mode, the
 * repository's HEAD for the base ref, and no setup at all. Spelled once so a
 * project minted in memory — General, and a freshly created one — cannot
 * drift from the shape `loadProjects` reads off a row. */
const UNSET_PROJECT_SETTINGS: ProjectSettings = {
  defaultModel: null,
  defaultPermissionMode: null,
  defaultBaseRef: null,
  setupCommand: null,
  worktreeCopy: null,
  worktreeDefault: false,
};

/** A project row's settings, in the shape the client reads them. The one
 * conversion is `worktree_default`: SQLite has no boolean, and doing it here
 * means no reader downstream has to remember that 0 is a number. */
function projectSettingsOf(row: ProjectRow): ProjectSettings {
  return {
    defaultModel: row.default_model,
    defaultPermissionMode: row.default_permission_mode,
    defaultBaseRef: row.default_base_ref,
    setupCommand: row.setup_command,
    worktreeCopy: row.worktree_copy,
    worktreeDefault: row.worktree_default !== 0,
  };
}

/** A settings patch with `""` resolved to "unset", which is the one thing a
 * text field cannot say for itself. A cleared input sends an empty string, and
 * a project storing one would put an empty `--model` on the agent's argv or
 * branch a worktree from a ref called nothing — so blank becomes `null`, which
 * is how unset is spelled everywhere else.
 *
 * Normalized once, before either the database or the in-memory projection sees
 * it, so the client is told back what was actually stored rather than what it
 * sent. A client echoing its own `""` would show a value the next reload
 * contradicts.
 *
 * Absence is `undefined`, not a missing key. A patch assembled from a form —
 * `{ setupCommand: form.setup }` where that field was not on this dialog —
 * carries the key with nothing behind it, and reading that as "unset it" would
 * clear a setting the caller never mentioned. Everywhere else a patch is
 * written here (`TaskStore.update`, `db.updateProject`) `undefined` already
 * means "leave alone"; this agrees with them. `null` is still a value, and is
 * how a setting is deliberately cleared. */
function normalizeSettingsPatch(patch: Partial<ProjectSettings>): Partial<ProjectSettings> {
  const next: Partial<ProjectSettings> = {};
  // `unknown` in, because this arrives off the socket with nothing between it
  // and here: a client sending a number for `defaultModel` must get it
  // rejected as unset, not throw `.trim is not a function` out of the message
  // handler and take the frame with it.
  const text = (value: unknown) => (typeof value === "string" ? value.trim() || null : null);
  if (patch.defaultModel !== undefined) next.defaultModel = text(patch.defaultModel);
  if (patch.defaultPermissionMode !== undefined) {
    next.defaultPermissionMode = text(patch.defaultPermissionMode);
  }
  if (patch.defaultBaseRef !== undefined) next.defaultBaseRef = text(patch.defaultBaseRef);
  if (patch.setupCommand !== undefined) next.setupCommand = text(patch.setupCommand);
  // Blank-as-a-whole is unset here too, but the entries inside are left alone:
  // this is a list, one path per line, and trimming each is `parseCopyList`'s
  // job at the point of use.
  if (patch.worktreeCopy !== undefined) next.worktreeCopy = text(patch.worktreeCopy);
  if (patch.worktreeDefault !== undefined) next.worktreeDefault = patch.worktreeDefault === true;
  return next;
}

/** The columns a normalized patch writes. */
function settingsColumns(patch: Partial<ProjectSettings>): Partial<ProjectRow> {
  const columns: Partial<ProjectRow> = {};
  if ("defaultModel" in patch) columns.default_model = patch.defaultModel;
  if ("defaultPermissionMode" in patch) {
    columns.default_permission_mode = patch.defaultPermissionMode;
  }
  if ("defaultBaseRef" in patch) columns.default_base_ref = patch.defaultBaseRef;
  if ("setupCommand" in patch) columns.setup_command = patch.setupCommand;
  if ("worktreeCopy" in patch) columns.worktree_copy = patch.worktreeCopy;
  if ("worktreeDefault" in patch) columns.worktree_default = patch.worktreeDefault ? 1 : 0;
  return columns;
}

/** Why a branch outlived the task it belonged to, for the dialog to print.
 *
 * Reached only when the branch was *not* expendable, so both halves are always
 * false and the sentence is about what is still on it. The count is the point:
 * "kept" on its own reads as an apology for not cleaning up, while "kept — 3
 * commits are on it and nowhere else" reads as the reason it was kept, and
 * tells the user what to do next. */
function keptReason(branch: string, baseRef: string | null, status: BranchStatus): string {
  const base = baseRef ? ` into ${baseRef}` : "";
  const kept = `${branch} was kept: it is not merged${base} and not on any remote`;
  // The count is dropped rather than printed as zero. `branchStatus` answers 0
  // when the count itself failed, and "0 commits would have gone with it" reads
  // as a reason the branch should have been deleted — the opposite of the
  // sentence it is in. The two facts that decided this both fail closed and are
  // already stated above; the number is the detail, not the argument.
  if (status.unpushed === 0) return kept;
  const commits = status.unpushed === 1 ? "1 commit" : `${status.unpushed} commits`;
  return `${kept}, so ${commits} would have gone with it`;
}

/** §5.6's retention: how long an archived task keeps the snapshot that makes
 * archiving recoverable. Long, because the whole promise of the confirmation
 * dialog is that the user is choosing something they can come back from — and
 * a ref costs a commit object, which is the cheapest thing in the design. */
export const WIP_RETENTION_MS = 30 * 24 * 60 * 60_000;

/** What an archive found, and what it did about it (§5.6).
 *
 * Read *before* anything was destroyed, which is the point: the confirmation
 * quotes these numbers from a preview taken moments earlier, and a user who
 * came back to their laptop an hour later deserves to be told what was actually
 * true when the button took effect rather than when it was drawn. */
export interface ArchiveOutcome {
  /** Null for a task that never had a checkout of its own — it ran in the
   * project's directory, where nothing is ours to describe or to delete. */
  status: BranchStatus | null;
  branch: string | null;
  branchDeleted: boolean;
  /** Why the branch is still there, in a sentence the dialog can print. Null
   * when there was no branch, or when it was deleted. */
  branchKept: string | null;
  /** Where the work went, kept for `WIP_RETENTION_MS`. */
  wipRef: string | null;
}

/** What a hard delete did about the branch. The rest of a delete has nothing to
 * report — the row, the checkout and the files are simply gone — but a branch
 * kept back is a thing left on the user's disk that they did not ask for and
 * would not otherwise hear about, and `codetoaster kill` is a command whose
 * whole output is one line. */
export interface DeleteOutcome {
  branch: string | null;
  branchDeleted: boolean;
  branchKept: string | null;
}

/** The same questions, asked without answering them: what archiving this task
 * would cost, for the confirmation to state before it is confirmed. */
export interface ArchivePreview {
  status: BranchStatus | null;
  branch: string | null;
  /** Whether the branch would be deleted, on what is true right now. */
  branchWouldBeDeleted: boolean;
}

export interface CreateTaskOptions {
  id: string;
  title?: string;
  prompt?: string;
  projectId?: string;
  /** Inherit the cwd of this task's terminal, and sit next to it in the list. */
  afterTaskId?: string;
  cols?: number;
  rows?: number;
  /** Recorded on the row, and passed through to the agent's argv. */
  model?: string;
  permissionMode?: string;
  /** Give the task a checkout of its own (§5.6). Absent means the project's
   * `worktree_default`, resolved here rather than in the client so the HTTP
   * API and the CLI answer the same as the composer. */
  worktree?: boolean;
  /** What that checkout branches from. Absent means the project's
   * `default_base_ref`, and absent again means `HEAD`. */
  baseRef?: string;
  /** Overrides what the task's first terminal runs. A task runs its agent by
   * default — that is what a task *is* (§3) — so this is for the callers that
   * want something else in front of a task: tests, and the extra shell tabs
   * TASK-27 opens. */
  command?: string[];
  /** The id to give that terminal. Minted when omitted — a task and its
   * terminals are separate things with separate lifetimes, and a resumed task
   * (TASK-13) keeps its id while getting a new PTY. Clients read
   * TaskInfo.ptyId rather than assuming any relationship. */
  ptyId?: string;
}

// The policy layer (docs/v2-architecture.md §5.2), and the only place that
// knows a task can exist without a process. It holds the rows through
// TaskStore, the processes through PtyManager, and the association between
// them — which is the whole point of the split, since a task outlives its
// terminals and eventually has more than one.
export class TaskManager {
  private ptys = new PtyManager();
  private database?: Database;
  // Both directions. taskPtys because a task's terminals must all die with it;
  // ptyToTask because everything a PTY reports — output, a title, a
  // notification — has to be readdressed to the task before it goes out.
  private ptyToTask: Map<string, string> = new Map();

  // Set by a PreCompact, read and dropped by the SessionStart that ends the
  // same compaction. In memory rather than on the row because it is only ever
  // live for the seconds between the two, and a daemon that restarts across
  // that gap has killed the agent that would have sent the second half.
  private compactTriggers: Map<string, CompactTrigger> = new Map();
  private taskPtys: Map<string, Set<string>> = new Map();
  // Which of a task's terminals is the agent's (§3). Held apart from the set
  // above rather than inferred from it, because the set is unordered in every
  // way that matters: `resumeTask` on a *live* task — an agent that exited, or
  // a `fresh: true` — discards the old agent and adopts the new one after
  // whatever shell tabs are open, so "the first live PTY the task holds" would
  // answer with a shell. Everything that means *the agent* reads through here:
  // `taskInfo.ptyId` (what a client attaches its agent tab to), `snapshot`,
  // `refreshCwd`, and resume's own already-running test.
  private agentPtys: Map<string, string> = new Map();
  private projects: ProjectInfo[] = [generalProject()];
  private connectedClients: Map<string, ServerWebSocket<WebSocketData>> = new Map();
  // Which tasks have ever reported a hook, and the timers waiting to find out
  // (§9, risk 4). Both in memory on purpose: what they guard is a running
  // PTY's output activity, which is per-process by definition. A task with no
  // live PTY has no heuristic to fall back to, so a flag that does not survive
  // a restart is not missing anything — and a resumed task genuinely is
  // unknown again until its agent reports in.
  private hookSeen: Set<string> = new Set();
  /** When each task's agent was last spawned, for turning the setup wrapper's
   * stamp into a duration. Not `created_at`: a restore (TASK-39) runs setup
   * again years after the row was written, and dating the reinstall from the
   * task's birth would say the checkout took a fortnight to build. In memory
   * because it is only read once, by the first hook of the process it dates —
   * a daemon that restarted in between killed that process anyway. */
  private spawnedAt: Map<string, number> = new Map();
  private hookGraceTimers: Map<string, Timer> = new Map();
  /** The checkouts the boot sweep found and refused to delete (§5.6, TASK-32).
   *
   * In memory and not in the database, because they belong to no task and a row
   * is the one thing they are defined by not having. They are also only as true
   * as the last sweep — the user can delete one by hand at any moment — so
   * persisting them would mean carrying a claim about the disk across restarts
   * that nothing re-checks. A boot re-runs the sweep and re-derives this. */
  private unclaimedWorktrees: UnclaimedWorktree[] = [];
  /** What git last said about each task's checkout, for its card (§5.6, AC #5).
   *
   * A cache and not a column, because every one of these facts is about the
   * working tree and the ref store rather than about the task: a commit made in
   * a shell tab, a push from another terminal, a `git restore` — none of them
   * come past us, so a persisted copy would be a claim about the disk that
   * nothing re-checks and that survives a restart looking authoritative. In
   * memory it is at worst missing, which is the one state the wire can express
   * honestly. */
  private worktreeStatus: Map<string, TaskWorktreeInfo> = new Map();
  /** When each entry above was measured, so a refresh can be skipped rather
   * than deduplicated after the fact. Separate from the map because an entry
   * being *absent* and being *stale* want different answers: absent is
   * measured-never and always worth doing. */
  private worktreeStatusAt: Map<string, number> = new Map();
  /** Tasks with a measurement in flight. `branchStatus` is five git processes
   * and the triggers overlap freely — a Stop hook can land while the restore
   * that provoked the last one is still running — so without this a busy agent
   * would have several identical sweeps of its own repository outstanding. */
  private measuring: Set<string> = new Set();
  // When each task's directory was last checked against its live terminal.
  // The data routes ask on every request; this is what keeps that from being a
  // process spawn every time (TASK-41).
  private cwdCheckedAt: Map<string, number> = new Map();
  private cwdRefreshWindowMs = 3_000;
  private hookGraceMs = 10_000;
  private startTimeoutMs = 4_000;
  // The resume in flight for a task, if any. Resuming is what a client does on
  // the way to opening a task, so two of them can easily overlap — and the
  // whole ladder is awaited, so the "is it already running?" check below is
  // separated from the spawn by several awaits. Without this, two concurrent
  // resumes both see no PTY and both start an agent on the same conversation
  // in the same directory, one of which is unreachable and never killed.
  private resuming: Map<string, Promise<TaskRow | undefined>> = new Map();
  // The mirror of `resuming`, and it has to exist for the same reason. Suspend
  // is not synchronous either: it awaits `snapshot`, which is a multi-hundred-KB
  // screen written to disk, and only *after* that does it kill the task's PTYs
  // and write `suspended`. A resume arriving inside that window saw a live,
  // unexited PTY and answered 200 with the ptyId of a terminal about to be
  // killed — or, where the agent had already exited, spawned a fresh one that
  // the suspend then killed along with the rest, leaving the user's close
  // silently undone by the ladder walking on.
  //
  // Each side registers its entry only *after* waiting on the other's, so the
  // two can never wait on each other — and each starts over once that wait is
  // done rather than carrying on, since the promise it waited on may have
  // handed straight to another one of the other kind.
  private suspending: Map<string, Promise<boolean>> = new Map();
  // The third of the same family, and it exists because `suspended` is not a
  // quiet state. An eviction takes a snapshot and then runs `git worktree
  // remove --force`, and a resume leaves the row `suspended` for its *whole*
  // run — the ladder only writes `live` on the rung that works — so a
  // lifecycle check alone lets the evict tier take the checkout out from under
  // a task somebody is in the middle of reopening: the directory the restore
  // just rebuilt and the agent was just spawned into. Registered before the
  // first await on the evict side and waited on before the ladder starts on
  // the resume side, so whichever gets there first is the one that runs.
  private evicting: Map<string, Promise<boolean>> = new Map();
  // The fourth of the family, and the one the task does not come back from
  // (§5.6). Archive is every other operation in sequence — it suspends, it
  // snapshots, it removes the checkout, it may delete the branch — so it needs
  // an entry of its own rather than borrowing one: two archives of a task would
  // both read `branchStatus` before either had destroyed anything, and the
  // second would then be describing, and acting on, a repository the first had
  // already emptied. Evict and resume wait on this for the reason they wait on
  // each other, and archive waits on an eviction in flight before registering,
  // so the two can never be waiting on one another.
  private archiving: Map<string, Promise<ArchiveOutcome | null>> = new Map();
  // What `codetoaster hook` has to POST back to (§4.2), handed over by
  // startServer. Undefined until then: a manager with no server in front of it
  // — a test — has no port to name, and an agent spawned from one simply
  // reports nowhere.
  private port?: number;
  // And where it answers, when that is not loopback. A `--host` bind makes
  // `http://localhost:<port>` refuse the connection, so the reporter cannot
  // assemble its own URL from the port alone.
  private origin?: string;

  /** Takes the database to work against; defaults to the process-wide one.
   * Tasks and projects both come from it, so a caller cannot end up reading
   * one out of one database and the other out of another. */
  constructor(database?: Database) {
    this.database = database;
  }

  // Resolved on first use, not in the constructor: the module-level manager is
  // built at import time, and the database is only opened once the daemon
  // knows which file it is running against.
  private get db(): Database {
    return this.database ?? db.getDatabase();
  }

  private cachedStore?: TaskStore;
  private cachedStoreDb?: Database;
  private get store(): TaskStore {
    // Re-made when the handle underneath changes: initDatabase closes and
    // replaces the process-wide one, and a store pinned to the old handle
    // would fail every read against a closed database.
    const database = this.db;
    if (!this.cachedStore || this.cachedStoreDb !== database) {
      this.cachedStore = new TaskStore(database);
      this.cachedStoreDb = database;
    }
    return this.cachedStore;
  }

  // ---------------------------------------------------------------- startup

  /** The port the daemon ended up on, which every task's environment carries
   * so its hooks can reach us. Set once, at startup, before any task exists. */
  setPort(port: number, origin?: string): void {
    this.port = port;
    this.origin = origin;
  }

  /** How long a new task has to report its first hook before it is called
   * `unknown`. Long enough that a slow start is not mistaken for a hookless
   * one; short enough that a task never sits on `starting` for good. */
  setHookGrace(ms: number): void {
    this.hookGraceMs = ms;
  }

  /** How long a resume waits to see whether the agent came up before deciding
   * it did (§4.3). Only the cap — a hook or an exit settles it sooner. */
  setStartTimeout(ms: number): void {
    this.startTimeoutMs = ms;
  }

  /** How long a task's directory is trusted before the terminal is asked
   * again. Zero asks every time, which is what a test wants and what nothing
   * else does. */
  setCwdRefreshWindow(ms: number): void {
    this.cwdRefreshWindowMs = ms;
  }

  loadProjects(): void {
    const rows = db.getAllProjects(this.db);
    this.projects = rows.map((row) => ({
      id: row.id,
      name: row.name,
      initialPath: row.initial_path,
      taskIds: [],
      ...projectSettingsOf(row),
    }));
    // Ensure General always exists
    if (!this.projects.some((p) => p.id === "general")) {
      this.projects.unshift(generalProject());
    }
  }

  /** Every `live` row is a lie at boot: closing the PTY masters took every
   * session shell and its children down with the daemon, so nothing survived
   * to be live (§5.5). Marking them suspended is the whole of what a restart
   * needs — the rows are still there to resume from.
   *
   * "There" now means in the list, which is why the adoption below is part of
   * the same pass. `loadProjects` starts every project's `taskIds` empty, since
   * the ordering is the only thing the rows do not record, and `listTasks`
   * walks that grouping rather than the rows — so without this a restart leaves
   * every task of the previous run present in the database, suspended, correct
   * in every column, and invisible. From the user's side that is
   * indistinguishable from the "restart nukes everything" this replaces.
   *
   * By last-active order, oldest first, so the sidebar reads the way it did
   * before the restart rather than in whatever order SQLite hands rows back. */
  reconcileOnBoot(): number {
    const stale = this.store.list({ lifecycle: "live" });
    for (const task of stale) {
      this.store.update(task.id, { lifecycle: "suspended", agent_state: "unknown" });
    }
    for (const task of this.store.list({ lifecycle: ["live", "suspended"] }).reverse()) {
      this.ensureInProject(task.id);
    }
    return stale.length;
  }

  /** The other half of the boot reconciliation (§5.6, Risk 5): the checkouts on
   * disk against the rows that claim them, in both directions.
   *
   * Separate from `reconcileOnBoot` and asynchronous, because the two are
   * different kinds of work with different urgency. That one is four SQLite
   * writes and the daemon cannot serve a correct task list until it has run;
   * this one shells out to git once per repository and can take as long as it
   * likes, so the boot path fires it and moves on.
   *
   * Direction (b) is here rather than in `reconcile.ts` because it is a row
   * update with no git in it: a task that says `present` while its directory is
   * gone is one somebody removed by hand between two runs, and `missing` is the
   * state that makes the next open rebuild it — `restoreTaskWorktree` already
   * treats anything but "present and on disk" as something to restore, and
   * already throws `branch-missing` when the branch went with the directory,
   * which the route turns into a card with buttons.
   *
   * Direction (a) is `reconcileWorktrees`, and what comes back from it is not
   * only a log: the checkouts it refused to delete are the unclaimed cards
   * (AC #2), held here because they belong to no task and so have nowhere else
   * to live.
   *
   * Never throws, like everything else on the boot path. */
  async reconcileWorktreesOnBoot(): Promise<ReconcileReport> {
    // Direction (b), first, so a row whose directory has gone is already
    // `missing` before the sweep decides what the directories mean.
    const rows = this.store.list({ lifecycle: ["live", "suspended"] });
    for (const row of rows) {
      if (row.worktree_state !== "present" || !row.worktree_path) continue;
      if (fs.existsSync(row.worktree_path)) continue;
      this.store.update(row.id, { worktree_state: "missing" });
      this.broadcastTask(row.id);
    }

    // What a checkout has to be named by to be spared. Archived rows are left
    // out on purpose: archive removes the checkout and keeps the branch and the
    // snapshot (TASK-31), so a directory still standing for one is a removal
    // that did not finish.
    const claimed = new Set(
      rows.filter((row) => row.worktree_path).map((row) => path.resolve(row.worktree_path!)),
    );

    // Every repository anything here knows about. Tasks first — a task carries
    // its own repository precisely so it can outlive the project (TASK-64) —
    // and the projects' own roots after, for a project whose tasks all went.
    const repoRoots = new Set<string>();
    for (const row of this.store.list()) {
      if (row.worktree_repo) repoRoots.add(row.worktree_repo);
    }
    for (const project of this.projects) {
      if (!project.initialPath) continue;
      const root = await repoRootOf(expandTilde(project.initialPath)).catch(() => null);
      if (root) repoRoots.add(root);
    }

    // A database with no tasks at all is not evidence that every checkout on
    // disk is an orphan — it is far likelier to be a daemon pointed at the
    // wrong `--db`, or a fresh one, and in both cases the rows that would have
    // claimed those directories exist somewhere else. Deleting on that reading
    // is the worst thing this method could do, and refusing costs only a sweep
    // that had, by its own account, nothing to reconcile against.
    //
    // Deleting a task already removes its checkout (TASK-31), so a genuinely
    // empty install with directories left under the root is a state something
    // else went wrong to produce, and handing it to the user is the right
    // answer there too.
    if (this.store.list().length === 0) return { removed: [], unclaimed: [] };

    let report: ReconcileReport;
    try {
      report = await reconcileWorktrees({ repoRoots: [...repoRoots], claimed });
    } catch (e) {
      console.warn("Could not reconcile worktrees:", e);
      return { removed: [], unclaimed: [] };
    }
    this.unclaimedWorktrees = report.unclaimed;
    if (report.unclaimed.length > 0) this.broadcastTasks();
    // After the sweep and not before it, so nothing is measured against a
    // `worktree_state` the pass above is about to correct. Awaited here because
    // the whole method is already fired-and-forgotten from the boot path — the
    // cards fill in as it goes.
    await this.refreshStaleWorktreeStatuses();
    return report;
  }

  /** How long a measurement stands before a backstop sweep will redo it.
   *
   * Long, because the events below are the real freshness mechanism and this
   * only catches what happens outside them — a commit made in a shell tab, a
   * push from the user's own terminal. Short enough that a card is never wrong
   * for a whole sitting. */
  private worktreeStatusTtlMs = 5 * 60_000;

  /** Exposed for the tests, which are about *when* a measurement is retaken
   * rather than about any one duration. */
  setWorktreeStatusTtl(ms: number): void {
    this.worktreeStatusTtlMs = ms;
  }

  /** Re-measure a task's checkout, if it has one and the answer has gone stale.
   *
   * `branchStatus` already computes precisely what the card wants, and its
   * failure semantics are the ones a card needs: every question fails closed,
   * so a git that could not answer reads as "not established" rather than as
   * good news. The two fields the card does not use — `exists` and `pushed` —
   * are archive's, and asking for them costs nothing extra beyond what is
   * already being spawned.
   *
   * Only a `present` checkout is ever measured. An evicted one has no working
   * tree to count dirt in, and a task with no checkout of its own has no branch
   * of ours to report on — for both, `null` on the wire is the true answer and
   * not a missing one.
   *
   * Never throws: every caller is a side effect of something else — a hook
   * arriving, a restore finishing — and none of them is a worse operation for
   * failing to update a count. */
  async refreshWorktreeStatus(taskId: string, options: { force?: boolean } = {}): Promise<void> {
    const row = this.store.get(taskId);
    if (!row || row.worktree_state !== "present" || !row.branch || !row.worktree_path) {
      // Anything that used to have one and no longer does must lose its entry,
      // or an evicted task keeps showing the dirt count of a directory that is
      // not there any more.
      if (this.worktreeStatus.delete(taskId)) {
        this.worktreeStatusAt.delete(taskId);
        this.broadcastTask(taskId);
      }
      return;
    }
    if (this.measuring.has(taskId)) return;
    const measuredAt = this.worktreeStatusAt.get(taskId);
    if (!options.force && measuredAt !== undefined
        && Date.now() - measuredAt < this.worktreeStatusTtlMs) {
      return;
    }

    this.measuring.add(taskId);
    try {
      const repoRoot = await this.repoRootFor(row);
      if (!repoRoot) return;
      const status = await branchStatus(repoRoot, {
        branch: row.branch,
        baseRef: row.base_ref,
        worktreePath: row.worktree_path,
      });
      // Re-read rather than trusting `row`: five git processes is long enough
      // for the task to have been archived or deleted, and writing an entry for
      // a row that is gone leaves a card's worth of state nothing ever clears.
      if (!this.store.get(taskId)) return;
      const next: TaskWorktreeInfo = {
        branch: row.branch,
        dirty: status.dirty,
        unpushed: status.unpushed,
        // `atBase` is what keeps the 'archive?' nudge from firing on every
        // task the moment it is made: `merge-base --is-ancestor` is reflexive,
        // so a branch still standing on the commit it was cut from is
        // "merged" to git from the second `worktree add -b` returns. The card
        // is about work that has landed, and a branch nothing has happened on
        // has not landed anything. Archive still reads `status.merged` — a
        // branch with no commits of its own is precisely the one that is safe
        // to delete.
        merged: status.merged && !status.atBase,
      };
      const previous = this.worktreeStatus.get(taskId);
      this.worktreeStatus.set(taskId, next);
      this.worktreeStatusAt.set(taskId, Date.now());
      // Only when something moved. This runs on every Stop hook, and a task
      // whose agent is answering questions without touching the tree would
      // otherwise push an identical row to every client once a turn.
      if (!previous || !sameWorktreeStatus(previous, next)) this.broadcastTask(taskId);
    } catch (e) {
      console.warn(`Could not read the checkout status of task ${taskId}:`, e);
    } finally {
      this.measuring.delete(taskId);
    }
  }

  /** The backstop (§5.6): re-measure whatever the events below have not.
   *
   * Called from the harvester's tick, which is the only thing already running
   * on a timer. It is not the mechanism — a checkout is measured when something
   * happened to it, and this only catches what happened outside the daemon —
   * so it does no work at all for a task measured inside its TTL.
   *
   * Sequential rather than `Promise.all`: this is five git processes per task
   * and there is nothing waiting on the answer, so a burst is all cost and no
   * benefit. */
  async refreshStaleWorktreeStatuses(): Promise<void> {
    const eligible = new Set<string>();
    for (const row of this.store.list({ lifecycle: ["live", "suspended"] })) {
      if (row.worktree_state !== "present") continue;
      eligible.add(row.id);
      await this.refreshWorktreeStatus(row.id);
    }
    // Everything that used to qualify and no longer does — archived, evicted,
    // hard-deleted. Purged here rather than at each of those call sites because
    // it is the same question in every one of them ("does this row still have a
    // checkout?"), and a site that forgot to ask would leave a card reporting
    // the dirt of a directory that is gone. `taskInfo` reads this map, so an
    // entry outliving its row is not merely stale, it is wrong.
    for (const taskId of [...this.worktreeStatus.keys()]) {
      if (eligible.has(taskId)) continue;
      this.worktreeStatus.delete(taskId);
      this.worktreeStatusAt.delete(taskId);
      if (this.store.get(taskId)) this.broadcastTask(taskId);
    }
  }

  /** The checkouts the sweep found and would not delete. Empty until the boot
   * sweep has run, which is the honest answer: "we have not looked yet" and
   * "there are none" are the same thing to a client, and the sweep is fired
   * rather than awaited. */
  getUnclaimedWorktrees(): UnclaimedWorktree[] {
    return this.unclaimedWorktrees;
  }

  /** Delete one of them, by the user's own decision.
   *
   * The path is re-checked against the worktrees root here and not only in
   * `reconcileWorktrees`, because this one arrives from a client: the list it
   * came from is ours, but the request is a string on the wire and nothing
   * about being answered earlier makes it safe now. Refusing a path that is not
   * in the current list is the actual guard — it is a closed set we produced —
   * and the root check backs it up.
   *
   * Answers false rather than throwing when the path is not one of ours, so a
   * stale client clicking a card the sweep has since forgotten gets a plain
   * "not there" instead of a 500. */
  async deleteUnclaimedWorktree(worktreePath: string): Promise<boolean> {
    const resolved = path.resolve(worktreePath);
    const found = this.unclaimedWorktrees.find((w) => w.path === resolved);
    if (!found) return false;
    if (!isWithinWorktreesRoot(resolved)) return false;
    if (found.repoRoot) {
      await evictWorktree(found.repoRoot, resolved);
    } else {
      // No repository to ask, so there is no registration to clean up either —
      // this is the directory git did not recognise. The user has looked at the
      // card and asked for it gone.
      await fsp.rm(resolved, { recursive: true, force: true });
    }
    this.unclaimedWorktrees = this.unclaimedWorktrees.filter((w) => w.path !== resolved);
    this.broadcastTasks();
    return true;
  }

  // ----------------------------------------------------------------- clients

  registerClient(clientId: string, ws: ServerWebSocket<WebSocketData>): void {
    this.connectedClients.set(clientId, ws);
  }

  unregisterClient(clientId: string): void {
    this.connectedClients.delete(clientId);
  }

  broadcastToAll(message: object): void {
    const data = JSON.stringify(message);
    for (const ws of this.connectedClients.values()) {
      ws.send(data);
    }
  }

  /** The whole list, as one message. Shared with the `list` request so a
   * client that asks for the snapshot and one that is pushed it cannot drift. */
  tasksSnapshot(): ServerMessage {
    return {
      type: "tasks",
      list: this.listTasks(),
      projects: this.getProjects(),
      // Rides the snapshot because it changes for the snapshot's reasons: the
      // boot sweep finishes, or the user deletes one. Both of those already
      // call `broadcastTasks`.
      unclaimed: this.unclaimedWorktrees.map(({ path, branch, dirty }) => ({
        path, branch, dirty,
      })),
    };
  }

  /** The whole list — for a connect, or any change to which tasks exist. */
  broadcastTasks(): void {
    this.broadcastToAll(this.tasksSnapshot());
  }

  /** One row changed. Cheaper than a snapshot, and the reason the protocol has
   * both: an agent transitioning state must not re-send every task. */
  broadcastTask(taskId: string): void {
    const info = this.taskInfo(taskId);
    if (info) this.broadcastToAll({ type: "task", task: info });
  }

  // ------------------------------------------------------------------ tasks

  async createTask(options: CreateTaskOptions): Promise<TaskRow> {
    const { id } = options;
    if (this.store.get(id)) {
      throw new Error(`Task "${id}" already exists`);
    }

    // Resolved before anything reads it, rather than at the row. The worktree
    // path is keyed on the project's id and its base ref comes off the
    // project's column, so both are needed while there is still no row — and
    // `resolveProjectId` keys off `afterTaskId` still being in some project's
    // `taskIds`, which a delete landing mid-create would change under us.
    const projectId = this.resolveProjectId(options);
    const project = this.projects.find((p) => p.id === projectId);

    // Inherit cwd from afterTaskId's terminal, or from the project's initialPath
    let cwd: string | undefined;
    if (options.afterTaskId) {
      // The live terminal first — it knows where the agent actually is — but a
      // task with no process still has a directory on its row, and inheriting
      // that beats silently falling back to the daemon's own cwd.
      cwd = (await this.primaryPty(options.afterTaskId)?.getCwd())
        ?? this.store.get(options.afterTaskId)?.cwd;
    }
    if (!cwd && options.projectId && project?.initialPath) {
      cwd = expandTilde(project.initialPath);
    }
    // Spelled out rather than left undefined: the PTY inherits this directory
    // either way, but a derived title can only describe a cwd it knows.
    if (!cwd) cwd = process.cwd();

    // Three sources, in order of how much they know about what this task is
    // *for* (§7.5). A caller-supplied title is a deliberate choice and outranks
    // everything, including the terminal title, for good. Failing that the
    // opening line of the prompt, which is nearly always the ask — and which is
    // the whole reason a list of thirty tasks in one checkout is readable.
    // Failing that the "<dir> · <branch>" label, which at least says where.
    //
    // Only the first is `manual`. The other two are guesses, and a live
    // terminal title — the agent's own account of what it is doing — is
    // allowed to display over either (naming.ts).
    //
    // `||`, not `??`: an empty title is no title at all, and `title_source`
    // below judges it on truthiness — the two must not disagree, or a task
    // ends up labelled "" and recorded as having derived that.
    //
    // One expression, so each `||` still short-circuits the one after it:
    // `deriveTitle` shells out to git (two calls on a detached HEAD, 2s of
    // timeout budget), and a create that already knows its title — or can read
    // one off the prompt — must not block on a lookup whose answer it throws
    // away. Hoisting the derived label to its own `const` is what would cost
    // that.
    const title = options.title
      || uniqueName(titleFromPrompt(options.prompt) || (await deriveTitle(cwd)), this.taskTitles());

    // The checkout, if this task is getting one (§5.6) — and before the row,
    // which is what makes a failed create leave nothing behind. `createWorktree`
    // already backs its own partial state out, so a throw here means no
    // directory, no branch, and now no row either.
    //
    // After the title, because the branch is named from it, and the title is
    // derived against the *project's* checkout rather than the worktree that
    // does not exist yet. That is the honest reading anyway: the fallback
    // label is "<dir> · <branch>", and the directory a task was started from
    // is what it describes. Every path through the composer has a prompt, so
    // the derived label loses to `titleFromPrompt` there regardless.
    let worktree: CreatedWorktree | undefined;
    // Resolved once and reused by the row below, so what the checkout was
    // branched from and what `base_ref` records cannot disagree.
    let baseRef: string | undefined;
    // Kept for the rollback: the two failure paths below have to undo the
    // checkout, and they need the same directory `createWorktree` was given.
    let projectPath: string | undefined;
    if (options.worktree ?? project?.worktreeDefault ?? false) {
      if (!project?.initialPath) {
        // A `WorktreeError`, and `not-a-repo` specifically, because the route
        // grades the failure off the kind and this one is the caller's: the
        // composer disables the toggle for a project with no directory, so
        // only the HTTP API and the CLI can ask for this, and answering them
        // with a 500 tells them to retry something that will never work.
        throw new WorktreeError(
          "not-a-repo",
          `Project "${project?.name ?? projectId}" has no directory to add a worktree to`,
        );
      }
      projectPath = expandTilde(project.initialPath);
      baseRef = options.baseRef ?? project.defaultBaseRef ?? "HEAD";
      worktree = await createWorktree(
        { id: projectId, initial_path: projectPath, worktree_copy: project.worktreeCopy },
        { id, title },
        baseRef,
      );
      // The whole point: the agent runs *in* its checkout, so everything that
      // reads the task's directory — the git routes, the file tree, the next
      // resume — lands there rather than in the project's own tree.
      cwd = worktree.worktreePath;
    }

    // Guarded like the two steps after it, and for the same reason: from the
    // moment `createWorktree` returns, *everything* left in this function has
    // to take the checkout with it if it throws. The insert is the one step
    // that is easy to read as infallible and is not — a constraint, a locked
    // or full database — and a throw here would leave a registered worktree
    // and a branch named off the title behind for a task that never existed.
    let row: TaskRow;
    try {
      row = this.store.create({
        id,
        project_id: projectId,
        // Allocated here, before anything starts: passing `--session-id` is how
        // we know what to resume without asking the agent afterwards (§4.1).
        // A used id cannot be reused, so this is minted per task and only ever
        // replaced — by a `/clear` reported through SessionStart (TASK-11), or
        // by a start-fresh fallback (TASK-13).
        agent_session_id: crypto.randomUUID(),
        title,
        title_source: options.title ? "manual" : "derived",
        // Trimmed, because `buildAgentCommand` judges this on truthiness and
        // `titleFromPrompt` above judges it on having a non-blank line: the two
        // must agree, or a whitespace-only prompt gets the directory label as
        // though it said nothing while still travelling in argv to submit a blank
        // opening turn. `POST /api/tasks` refuses a blank prompt outright, so
        // this is what keeps the invariant true for a caller reaching the manager
        // directly rather than a second line of defence against the route.
        initial_prompt: options.prompt?.trim() ?? "",
        // Resolved once and stored, so the data routes never have to ask a
        // process where they are (§5.4). `undefined` (the lookup never ran) is
        // recorded as "no repository" here, since there is no earlier value to
        // keep — refreshCwd is where the distinction matters.
        repo_root: (await resolveRepoRoot(cwd)) ?? null,
        cwd,
        // The project's column is what an absent option means. The composer
        // sends only what the user actually overrode — "Project default" is no
        // field at all — so resolving here rather than in the client is what
        // gives the API and the CLI the same answer for free.
        //
        // Read off `projectId`, the project the task actually joins, and not off
        // `options.projectId`, the one the caller happened to name. A create that
        // names no project still lands in "general", so keying this off the
        // option meant `POST /api/tasks {prompt}` — the API and CLI shape, the
        // very callers this is resolved server-side for — inherited nothing at
        // all while the row sat in a project with defaults set.
        model: options.model ?? project?.defaultModel ?? null,
        permission_mode: options.permissionMode ?? project?.defaultPermissionMode ?? null,
        // What the task owns in git, and what boot reconciliation (TASK-32) and
        // the evict tier (TASK-39) read to know there is anything to reconcile.
        // `worktree_state` stays "none" for a task running in the project's own
        // checkout, which is the difference between "we made this" and "we found
        // the user already working here".
        ...(worktree
          ? {
              worktree_path: worktree.worktreePath,
              // The task's own handle on its repository, so nothing downstream
              // has to ask the project where the checkout lives — a project the
              // task may outlive (TASK-64).
              worktree_repo: worktree.repoRoot,
              branch: worktree.branch,
              base_ref: baseRef,
              worktree_state: "present" as const,
            }
          : {}),
      });
    } catch (e) {
      await this.undoWorktree(worktree, projectPath);
      throw e;
    }

    // The row is only worth keeping if something is running behind it: Bun.spawn
    // throws outright when the command is missing from PATH, and a row left
    // over from that is in no project, absent from every list, and blocks its
    // own id from ever being used again.
    // Before the spawn, because `--settings` names it: the agent reads the file
    // at startup, and a task whose hooks were written afterwards would run its
    // first session reporting nothing (§4.2). Skipped when the caller brought
    // its own command — a plain shell has no hooks to install.
    let settingsPath: string | undefined;
    if (!options.command) {
      try {
        settingsPath = await writeTaskSettings(id);
      } catch (e) {
        this.store.delete(id);
        // Bun.write creates the task directory before it writes the file, so a
        // failure part-way through leaves one behind exactly as a failed spawn
        // does — and with the row gone, nothing will ever read it again.
        fs.rmSync(taskDir(id), { recursive: true, force: true });
        await this.undoWorktree(worktree, projectPath);
        throw e;
      }
    }

    // Setup runs in the agent's own terminal, not before it (§5.6), and only
    // for a checkout this create just made: a task running in the project's
    // own tree is in a directory the user already set up, and re-running
    // `bun install` over it would be presumptuous at best. `options.command`
    // is left alone for the same reason it skips the settings write — a shell
    // tab is not the agent.
    const command = options.command
      ?? wrapWithSetup(
        buildAgentCommand(row, { settingsPath }),
        worktree ? project?.setupCommand : null,
        setupStampPath(id),
      );

    let pty: Pty;
    try {
      pty = this.ptys.spawn(command, {
        id: options.ptyId,
        cols: options.cols,
        rows: options.rows,
        cwd,
        // Every PTY of a task, not just the agent's: an extra shell tab
        // (TASK-27) wants the same task id to report under, and the same
        // scrub — a shell that ran `claude` by hand would otherwise hit the
        // inherited-marker problem the scrub exists for.
        env: taskEnv(process.env, { taskId: id, port: this.port, origin: this.origin }),
      });
    } catch (e) {
      this.store.delete(id);
      // The settings we just wrote go with the row. Nothing will ever read
      // that directory again — its task does not exist, and its id can never
      // be issued a second time — so leaving it behind leaks a directory per
      // failed create.
      if (settingsPath) fs.rmSync(taskDir(id), { recursive: true, force: true });
      await this.undoWorktree(worktree, projectPath);
      throw e;
    }
    this.spawnedAt.set(id, Date.now());
    this.adopt(pty, id);
    this.armHookGrace(id);
    this.placeInProject(id, projectId, options);
    // A new checkout is clean and its branch is at the base ref, so this
    // measures almost nothing — except the branch name, which is the one fact
    // the card can show before the agent has done anything at all. Not awaited:
    // the caller is a create that has already spawned an agent, and it must not
    // wait on git to answer.
    if (worktree) void this.refreshWorktreeStatus(id, { force: true });
    return row;
  }

  /** Take back a checkout this create made, for a create that failed after it.
   *
   * `createWorktree` backs its own partial state out, but the create keeps
   * going afterwards — the settings file, the spawn — and both of those throw
   * on things the user does hit: a `$SHELL` or an agent binary that is no
   * longer on PATH. Without this, that leaves a checkout and a branch on disk
   * for a task whose row was just deleted, and no code path will ever look at
   * them again. The branch is the worse half: it is named from the title, so
   * the next attempt at the same task would silently get a `-2`.
   *
   * Best effort. The create is already failing and the caller is owed the
   * original reason for that, not a cleanup error on top of it. */
  private async undoWorktree(
    worktree: CreatedWorktree | undefined,
    projectPath: string | undefined,
  ): Promise<void> {
    if (!worktree || !projectPath) return;
    await removeWorktree(projectPath, worktree.worktreePath, worktree.branch).catch(() => {});
  }

  /** How long the checkout took to become usable, off the setup wrapper's
   * stamp (§5.6, `lib/worktree/setup.ts`).
   *
   * Read exactly once, when the task's first hook arrives, and that timing is
   * the whole design: the wrapper only `exec`s the agent after setup exits
   * zero, so a hook — which only an agent that loaded our settings can send —
   * is proof the stamp is already on disk. Nothing polls, and nothing waits.
   *
   * Fire-and-forget from `applyHook`, which is synchronous and answers a live
   * HTTP request. Nothing downstream needs this to have landed: the only
   * consumer is the eviction grace scale, days later.
   *
   * A task with no setup command records nothing, which is correct — there was
   * no cost to remember. So does one whose setup aborted before the stamp was
   * written, and so does a non-zero exit: the agent never started, so what was
   * measured is the cost of failing, not the cost of a restore. */
  private async recordSetupOutcome(taskId: string): Promise<void> {
    const spawnedAt = this.spawnedAt.get(taskId);
    // Spent on the first read, which is also what keeps a *resumed* task from
    // overwriting a real duration with a meaningless one. `spawnAgent` clears
    // `hookSeen`, so every resume presents a fresh edge to `applyHook` and
    // arrives back here — and the stamp still on disk belongs to the create,
    // not to this spawn. Only the run that wrote a stamp gets to date it, and
    // when a restore re-runs setup (TASK-39) it will record its own moment.
    this.spawnedAt.delete(taskId);
    if (spawnedAt === undefined) return;
    const outcome = await readSetupOutcome(setupStampPath(taskId), spawnedAt);
    if (!outcome || outcome.exitCode !== 0) return;
    // Checked again on the far side of the await: a task deleted while this
    // was reading would otherwise be resurrected as a row holding one column.
    if (!this.store.get(taskId)) return;
    this.store.update(taskId, { setup_duration_ms: outcome.durationMs });
    this.broadcastTask(taskId);
  }

  /**
   * Wire a PTY to a task: the association, plus the callbacks that readdress
   * what the PTY reports to the task that owns it.
   *
   * `agent` is what separates the two kinds of terminal a task can hold (§3),
   * and it decides far more than which map an id goes in. Everything below the
   * ownership lines is the task speaking about *its agent* — that the
   * conversation exited, what the agent is calling itself, whether it is
   * working — and a shell tab has no standing to say any of it. Left
   * undifferentiated, typing `exit` in a shell would record the task's agent as
   * dead, a shell's OSC title would become the task's label, and a build
   * running in a shell would drive the busy/idle inference that stands in for
   * the agent's own hooks in degraded mode. `openShell` passes false; every
   * other caller is spawning the agent.
   */
  private adopt(pty: Pty, taskId: string, agent = true): void {
    this.ptyToTask.set(pty.id, taskId);
    let held = this.taskPtys.get(taskId);
    if (!held) {
      held = new Set();
      this.taskPtys.set(taskId, held);
    }
    held.add(pty.id);

    if (!agent) {
      this.adoptShell(pty, taskId);
      return;
    }
    this.agentPtys.set(taskId, pty.id);

    pty.onExit((code) => {
      // Only if this is still the task's terminal. A rung of the resume ladder
      // that did not work out is killed on the way to the next one, and its
      // exit callback lands afterwards — asynchronously, and therefore after
      // the successful rung has already written `starting`. Without this, a
      // task that resumed perfectly well on the second attempt advertises the
      // first attempt's death for the rest of its life.
      if (this.ptyToTask.get(pty.id) !== taskId) return;
      this.store.update(taskId, { agent_state: "exited", exit_code: code });
      this.broadcastTask(taskId);
    });
    // The terminal title is part of every task's info, and clients project it
    // over the stored title at render time — so a change only has to be sent.
    pty.onTitleChange(() => {
      this.broadcastTask(taskId);
    });
    pty.onActivityChange((_ptyId, active) => {
      // Recency is what the task list is ordered by, so it is worth a write —
      // but not a row broadcast, which is what the activity message is for.
      if (active) this.store.update(taskId, { last_active_at: Date.now() });
      // Degraded mode (§9, risk 4). An agent run with hooks disabled, or one
      // whose payloads a future version has changed, reports nothing — and a
      // task list that says `starting` forever is worse than v1's guess. So
      // for a task that has never reported a hook, output activity stands in
      // for busy/idle, exactly as v1 inferred it. The moment any hook arrives
      // this goes back to being about recency alone, and never fights the
      // agent's own account of itself.
      if (!this.hookSeen.has(taskId)) this.inferState(taskId, active);
      this.broadcastToAll({ type: "activity", taskId, active });
    });
    pty.onNotification((_ptyId, title, body) => {
      this.broadcastToAll({ type: "notification", taskId, title, body });
      this.broadcastTask(taskId);
    });
  }

  /**
   * The much smaller half of `adopt`: what a shell tab is allowed to report.
   *
   * A shell is a process in the task's directory, not a voice for the task. So
   * it moves the task up the recency list — a user running a build in a shell
   * tab is working on that task, and a list ordered by recency that says
   * otherwise is wrong — and it tells clients when it dies, because a tab bound
   * to a PTY that is gone has to stop being drawn (§5.5, and `pruneShellTabs`).
   * It does not touch `agent_state`, does not become the task's
   * `terminalTitle`, does not feed the degraded-mode inference, and raises no
   * notifications: those are all claims about the conversation.
   *
   * No `activity` message either, for a reason worth stating: activity is
   * addressed to the *task*, and the sidebar's dot is edge-triggered off it. A
   * shell and an agent both emitting would have each one's falling edge clear
   * the other's dot, so a build finishing would put out the light on an agent
   * still mid-turn.
   */
  private adoptShell(pty: Pty, taskId: string): void {
    pty.onExit(() => {
      // Only if the task still holds it: `discardPty` and `doSuspend` both kill
      // shells on their way past, and an exit callback landing after the task
      // has been deleted would broadcast a row that is no longer there.
      if (this.ptyToTask.get(pty.id) !== taskId) return;
      this.broadcastTask(taskId);
    });
    pty.onActivityChange((_ptyId, active) => {
      if (active) this.store.update(taskId, { last_active_at: Date.now() });
    });
  }

  /** The heuristic's answer, for a task that has no better one. Confined to
   * the states the heuristic is entitled to speak about: a task that has
   * exited, or that is waiting on the user, is not idle just because its
   * terminal went quiet. */
  private inferState(taskId: string, active: boolean): void {
    const current = this.store.get(taskId)?.agent_state;
    if (current !== "starting" && current !== "unknown" && current !== "busy" && current !== "idle") {
      return;
    }
    const next = active ? "busy" : "idle";
    if (current === next) return;
    // `idle_since` is stamped here too, and not only by the hook path: it is
    // what the idle harvester counts from (TASK-15), and nothing else writes
    // it for a task running in degraded mode. Left alone, an agent that
    // reports no hooks inherits whatever the column held from its previous
    // life — a `Stop` from hours ago, or the value a restart left behind — so
    // the first time output activity infers `idle` the task is already past
    // `harvest_after` and is suspended out from under a user who has only just
    // reopened it. Same restamp, and the same reason, as the `/clear` and
    // resume case in `transitionFor`.
    this.store.update(taskId, {
      agent_state: next,
      ...(next === "idle" ? { idle_since: Date.now() } : {}),
    });
    this.broadcastTask(taskId);
  }

  /** Start the clock on a task's first hook. If none arrives, the task stops
   * claiming to be `starting` and admits it does not know. */
  private armHookGrace(taskId: string): void {
    this.disarmHookGrace(taskId);
    const timer = setTimeout(() => {
      this.hookGraceTimers.delete(taskId);
      if (this.hookSeen.has(taskId)) return;
      // Only from `starting`. If output activity has already said busy or
      // idle, that is a better answer than `unknown` and replacing it would
      // be a downgrade.
      if (this.store.get(taskId)?.agent_state !== "starting") return;
      this.store.update(taskId, { agent_state: "unknown" });
      this.broadcastTask(taskId);
    }, this.hookGraceMs);
    // Nothing should be held open waiting to relabel a task.
    timer.unref?.();
    this.hookGraceTimers.set(taskId, timer);
  }

  private disarmHookGrace(taskId: string): void {
    const timer = this.hookGraceTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.hookGraceTimers.delete(taskId);
    }
  }

  // ----------------------------------------------------------------- resume

  /** Spawn an agent for a task that already has a row, wire it up, and start
   * its hook clock. Shared by the create path and every rung of the resume
   * ladder, so a resumed agent gets the same settings file, the same scrubbed
   * environment and the same task-id plumbing as a fresh one. */
  private async spawnAgent(
    row: TaskRow,
    options: {
      mode: AgentMode;
      sessionId?: string;
      cols?: number;
      rows?: number;
      /** The project's setup command, when this spawn is following a restore
       * (§5.6). Null every other time, and that distinction is the point: a
       * resume that changed no directory is running in a checkout that was
       * already set up, and re-running `bun install` over it on every reopen
       * would make suspending a task expensive.
       *
       * Wrapped around the agent rather than awaited before it, exactly as
       * `createTask` does, so a cold `bun install` is visible output in the
       * agent tab instead of a blank pane for forty seconds. */
      setupCommand?: string | null;
    },
  ): Promise<Pty> {
    // The question both users of this flag ask is "has the agent that is
    // running now reported?", not "has anything ever reported for this task".
    // A task resumed inside a daemon that already saw its hooks would
    // otherwise start out as if the new process had already checked in:
    // awaitAgentStart would return true before the process had drawn a
    // character, and the very first rung of the ladder would be declared a
    // success however dead it was.
    //
    // Cleared on the far side of the settings write, not before it. `codetoaster
    // hook` is a separate process that `Bun.spawn().kill()` does not signal, so
    // a hook POSTed by the rung the ladder just discarded can land during that
    // await — and a flag set then would make `awaitAgentStart` return true
    // instantly for the *next* rung, declaring it a success however dead it is.
    const settingsPath = await writeTaskSettings(row.id);
    this.hookSeen.delete(row.id);
    this.compactTriggers.delete(row.id);
    const pty = this.ptys.spawn(
      wrapWithSetup(
        buildAgentCommand(row, { mode: options.mode, sessionId: options.sessionId, settingsPath }),
        options.setupCommand,
        setupStampPath(row.id),
      ),
      {
        cols: options.cols,
        rows: options.rows,
        cwd: row.cwd,
        env: taskEnv(process.env, { taskId: row.id, port: this.port, origin: this.origin }),
      },
    );
    this.adopt(pty, row.id);
    this.armHookGrace(row.id);
    return pty;
  }

  /** Whether the agent actually came up.
   *
   * Decided by the hook, not by a timer: any hook at all means the process got
   * far enough to load our settings and run one, which is a far sharper signal
   * than "it has not exited yet". A PTY that exits first is the failure — a
   * `--resume` on an id with no conversation prints one line and exits 1
   * (verified). The cap resolves as success on purpose: an agent running with
   * hooks disabled reports nothing however well it is doing, and killing a
   * working terminal because it was quiet would be the worse mistake. */
  private awaitAgentStart(taskId: string, pty: Pty): Promise<boolean> {
    const capMs = this.startTimeoutMs;
    if (this.hookSeen.has(taskId)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (started: boolean) => {
        clearInterval(poll);
        clearTimeout(cap);
        resolve(started);
      };
      const poll = setInterval(() => {
        if (this.hookSeen.has(taskId)) finish(true);
        else if (pty.exited) finish(false);
      }, 25);
      // `!pty.exited`, not a bare `true`: the cap means "quiet, but still up",
      // and a process that has already died is neither. The poll would catch it
      // 25ms later anyway — this only stops the timer winning that race and
      // declaring a corpse a working agent.
      const cap = setTimeout(() => finish(!pty.exited), capMs);
    });
  }

  /** Take back a PTY that did not work out, so the next rung starts clean. */
  private discardPty(pty: Pty, taskId: string): void {
    this.ptys.kill(pty.id);
    this.ptyToTask.delete(pty.id);
    this.taskPtys.get(taskId)?.delete(pty.id);
    // Only if it was the one: this is reached with the agent's terminal, and
    // clearing the slot unconditionally would be right today and wrong the
    // moment anything discards a shell through here.
    if (this.agentPtys.get(taskId) === pty.id) this.agentPtys.delete(taskId);
    this.hookSeen.delete(taskId);
    this.compactTriggers.delete(taskId);
    this.disarmHookGrace(taskId);
  }

  /** Reopen a suspended task (§4.3). Undefined when there is no such task.
   *
   * The whole ladder is walked before this returns, because the answer carries
   * the ptyId a client attaches to: falling back after someone attached would
   * leave them holding a terminal that is being killed. */
  async resumeTask(
    taskId: string,
    options: { fresh?: boolean; cols?: number; rows?: number } = {},
  ): Promise<TaskRow | undefined> {
    const row = this.store.get(taskId);
    if (!row) return undefined;
    // An archived task is not resumable, and this is the guard that says so.
    // Nothing routes here — `listTasks` leaves archived rows out, so no client
    // can name one — but the row is still in the database with a `branch` and a
    // `worktree_path` on it, and `restoreTaskWorktree` would happily rebuild a
    // checkout from a branch archive may have deleted. The one operation with
    // no way back needs the guard that makes it stay that way.
    if (row.lifecycle === "archived") return undefined;
    // An archive already in flight settles first, and then this starts over
    // against the row it left — which will be archived, and refused above. It
    // is removing the checkout the ladder would restore and spawn into, and it
    // does not wait for resumes: it suspends the task, which waits for them.
    const archiveInFlight = this.archiving.get(taskId);
    if (archiveInFlight) {
      await archiveInFlight.catch(() => undefined);
      return this.resumeTask(taskId, options);
    }
    // A close already in flight settles first, and then this starts over
    // against the row it left. Suspend awaits a snapshot write before it kills
    // anything, so without this the checks below inspect a task whose PTYs are
    // moments from being killed: the "already running" arm hands back a ptyId
    // the close is about to kill, and the ladder arm spawns an agent the close
    // then kills along with the rest — undoing the user's close, or leaving
    // them attached to a corpse. Waiting means the resume is judged against the
    // task the close produced, which is the task as it now is.
    const suspendInFlight = this.suspending.get(taskId);
    if (suspendInFlight) {
      await suspendInFlight.catch(() => undefined);
      return this.resumeTask(taskId, options);
    }
    // An eviction already in flight settles first, for the same reason and with
    // more at stake: it is about to run `git worktree remove --force` on the
    // very directory the ladder would restore and spawn into. Waiting means the
    // resume is judged against the task the eviction produced — an evicted one,
    // which `restoreTaskWorktree` then rebuilds — rather than racing it for the
    // checkout. `evictTask` refuses in the other direction, so the two can
    // never wait on each other.
    const evictInFlight = this.evicting.get(taskId);
    if (evictInFlight) {
      await evictInFlight.catch(() => undefined);
      return this.resumeTask(taskId, options);
    }
    // Joined to a resume already in flight *before* anything is inspected. The
    // ladder adopts each rung's PTY before awaiting `awaitAgentStart`, so for
    // most of its run there is a live terminal on this task that belongs to a
    // rung still being judged — and the "already running" test below would read
    // it as success, answering a second caller with the ptyId of a terminal the
    // first caller is about to discard. That client attaches to a corpse and
    // nothing retries. Checked after the ladder too, since it may have finished
    // between the two.
    //
    // A fresh start does not join it, though: it is a request for a *new*
    // conversation, and handing back the in-flight resume answers 200 having
    // minted nothing — the same silent no-op the `fresh` test below exists to
    // prevent, just reached down the concurrent path. It waits for the ladder
    // in flight to settle instead (two of them on one task would have two
    // agents in one directory) and then starts over, by which point the
    // ordinary "already running" arm below discards whatever that resume left.
    const alreadyResuming = this.resuming.get(taskId);
    if (alreadyResuming) {
      if (options.fresh !== true) return alreadyResuming;
      await alreadyResuming.catch(() => undefined);
      return this.resumeTask(taskId, options);
    }
    // Already running. Resuming is what a client does on the way to opening a
    // task, so it has to be safe to ask for twice.
    //
    // "Running" has to mean the process is alive, not merely that we still
    // hold a handle to it: PtyManager only forgets a PTY when something kills
    // it, so one that exited on its own stays registered and `primaryPty` goes
    // on answering with the corpse. Testing the handle alone made this a
    // permanent no-op for the case resume most obviously exists to serve — an
    // agent that exited while the daemon stayed up. The route returned 200
    // with the dead terminal's ptyId, having spawned nothing, and only a
    // daemon restart (where reconcileOnBoot suspends the row) ever cleared it.
    const existing = this.primaryPty(taskId);
    // `fresh` is not a question about whether a conversation is already open —
    // it is a request for a new one, and the ladder it builds is a single
    // `--start` on a freshly minted id. Answering it with "already running"
    // returns 200 having minted nothing and spawned nothing, and the body
    // describes the old session, so the caller cannot tell. The live terminal
    // goes the way a dead one does; leaving it would have two agents on one
    // task.
    if (existing && options.fresh !== true && !existing.exited) return row;
    // Nothing is going to attach to a dead terminal again, and leaving it
    // associated would have the new agent's task still pointing at it.
    if (existing) this.discardPty(existing, taskId);

    const attempt = this.runResumeLadder(taskId, row, options).finally(() => {
      this.resuming.delete(taskId);
    });
    this.resuming.set(taskId, attempt);
    return attempt;
  }

  private async runResumeLadder(
    taskId: string,
    initial: TaskRow,
    options: { fresh?: boolean; cols?: number; rows?: number },
  ): Promise<TaskRow | undefined> {
    let row = initial;

    // The checkout comes back before the conversation does (§5.6). Eviction is
    // not a lifecycle state of its own — it is `worktree_state` on a suspended
    // task — so opening one is an ordinary resume that happens to have a
    // directory to rebuild first, and putting it here rather than behind an
    // endpoint of its own means every door that reopens a task restores
    // without having to know it should: the pane, the CLI, the API.
    //
    // Inside the promise `resuming` holds, so it inherits the serialization
    // `resumeTask` already does against in-flight suspends and resumes. Two
    // concurrent restores of one task would be two `worktree add`s racing for
    // one path.
    //
    // A throw travels out to the route, which turns it into a status code the
    // client can act on. That is the point: a branch deleted while the task was
    // evicted is not a resume that failed, it is a workspace that needs a
    // decision, and walking the ladder against a directory that does not exist
    // would spawn agents in the daemon's own cwd.
    const restored = await this.restoreTaskWorktree(taskId);
    let setupCommand: string | null = null;
    if (restored) {
      // The checkout is new on disk, so whatever the card was showing is about
      // a directory that no longer exists in that form — and a restore that
      // applied a WIP snapshot has just changed the dirt count outright.
      void this.refreshWorktreeStatus(taskId, { force: true });
      // The row moved underneath us: `restoreTaskWorktree` writes `cwd`, and
      // `spawnAgent` reads it off the row it is handed. Without this the agent
      // is spawned in the directory the task had before the restore, which for
      // an evicted task is one that does not exist.
      row = this.store.get(taskId) ?? row;
      setupCommand = this.projects.find((p) => p.id === row.project_id)?.setupCommand ?? null;
      // What `recordSetupOutcome` dates the stamp against, so a restore
      // measures its own cost rather than inheriting the create's. That is what
      // makes the eviction grace self-correcting: the number it scales by is
      // the last restore's, not a guess made when the task was new.
      this.spawnedAt.set(taskId, Date.now());
    }

    const size = {
      // The grid the task had when it was suspended, so its output does not
      // reflow on the way back (§5.3).
      cols: options.cols ?? row.last_size_cols ?? DEFAULT_SIZE.cols,
      rows: options.rows ?? row.last_size_rows ?? DEFAULT_SIZE.rows,
    };

    for (const attempt of this.resumeLadder(row, options.fresh === true)) {
      // The task can be closed while the ladder is running: it awaits a spawn
      // and up to `startTimeoutMs` per rung, and deleteTask is one synchronous
      // DELETE away. Everything below assumes the row is still there — the
      // mint rung dereferences it outright, and the success arm hands the PTY
      // to `adopt`, which would re-register a terminal under a task that no
      // longer exists. Nothing kills that PTY afterwards (deleteTask already
      // walked the list it is being added back to) and nothing ever shows it,
      // so the agent runs on invisibly for the life of the daemon.
      if (!this.store.get(taskId)) return undefined;
      if (attempt.mint) {
        // A used id cannot be reused — `--session-id` on one that already has
        // a transcript fails with "already in use", so starting fresh on the
        // stored id would fail a second time and strand the task in a retry
        // loop (§4.3). The new id goes on the row before the spawn, so a
        // crash between the two leaves something resumable rather than a row
        // pointing at a conversation that was never opened.
        this.store.update(taskId, { agent_session_id: crypto.randomUUID() });
        row = this.store.get(taskId)!;
      }

      // The row is carrying the last process's verdict on itself: `exited`
      // with an exit code from the agent that went away, `could_not_resume`
      // from a resume that already failed, or `exited` from the rung before
      // this one. None of those survive a spawn, and none of them are states
      // anything else revisits — `inferState` only speaks about
      // starting/unknown/busy/idle, and the hook grace timer only downgrades
      // `starting`. Left alone, a resumed task whose agent reports no hooks
      // would read as dead for the rest of its life.
      row = this.store.update(taskId, { agent_state: "starting", exit_code: null }) ?? row;

      let pty: Pty;
      try {
        pty = await this.spawnAgent(row, { ...attempt, ...size, setupCommand });
      } catch {
        // The binary is missing or unrunnable: no rung will do better.
        break;
      }
      // Spent on the first rung. Setup is idempotent in principle and slow in
      // practice — a cold `bun install` is tens of seconds — and a ladder that
      // re-ran it per rung would turn one failed resume into four installs.
      const ranSetup = setupCommand !== null;
      setupCommand = null;

      const started = await this.awaitAgentStart(taskId, pty);
      // Checked again on the far side of the wait, which is where the window
      // actually is: a rung takes up to `startTimeoutMs` to settle, and a task
      // closed in the meantime must not end up owning the terminal we just
      // started for it.
      if (!this.store.get(taskId)) {
        this.discardPty(pty, taskId);
        return undefined;
      }
      if (started) {
        this.store.update(taskId, { lifecycle: "live", last_active_at: Date.now() });
        // The in-memory grouping only ever held the tasks *this* run created,
        // and a task worth resuming is by definition one it did not. Without
        // this the task is live and has a terminal, but `listTasks` — which
        // walks projects, not rows — cannot see it, so the very next
        // `broadcastTasks` sends every client a snapshot with the task they
        // just resumed missing from it.
        this.ensureInProject(taskId);
        this.broadcastTask(taskId);
        return this.store.get(taskId);
      }
      this.discardPty(pty, taskId);
      // A rung that failed with setup wrapped around it is usually setup's
      // failure, not the conversation's — the wrapper `exit`s rather than
      // `exec`ing the agent — and no other rung will do better against a
      // checkout that is not set up. Walking on would spawn a bare agent into
      // a half-built workspace and report it as a success.
      //
      // Only when the stamp says so. A setup still running is the common case
      // and not a failure at all: `awaitAgentStart` caps its wait at a few
      // seconds and answers on whether the process is still up, so a long
      // install is a *successful* rung whose output the user watches in the
      // tab. `readSetupOutcome` answers nothing while it is still going.
      if (ranSetup && (await this.setupFailed(taskId))) break;
    }

    // Nothing worked. The task is not a dead terminal and not a lie about
    // being live — it is a card with a button on it (§4.3).
    //
    // Which means the lifecycle has to be written and not merely left alone: a
    // row that was already `live` when the ladder started — an agent that
    // exited on its own, with the user then pressing the retry overlay's
    // button — would keep saying `live` with `ptyId: null`, which is the lie.
    // Nothing recovers it either, because everything that would reopen the task
    // asks for one of the two states this is between: `AgentPane` only reopens
    // a `suspended` task, and the harvester only
    // takes an `idle` one. Left `live` the card sits in the sidebar dead for the
    // life of the daemon; left `suspended` it is what it looks like, and the
    // next click walks the ladder again.
    this.store.update(taskId, { lifecycle: "suspended", agent_state: "could_not_resume" });
    this.broadcastTask(taskId);
    return this.store.get(taskId);
  }

  /** Whether the setup wrapper has recorded a failure for this task.
   *
   * Distinct from "setup did not finish", which is what a task still
   * installing looks like and is not a reason to stop trying. */
  private async setupFailed(taskId: string): Promise<boolean> {
    const spawnedAt = this.spawnedAt.get(taskId);
    if (spawnedAt === undefined) return false;
    const outcome = await readSetupOutcome(setupStampPath(taskId), spawnedAt);
    return outcome !== undefined && outcome.exitCode !== 0;
  }

  /** The rungs to try, in order (§4.3). A fresh start is not a rung — it is
   * the user choosing to stop trying. */
  private resumeLadder(
    row: TaskRow,
    fresh: boolean,
  ): Array<{ mode: AgentMode; sessionId?: string; mint?: boolean }> {
    if (fresh) return [{ mode: "start", mint: true }];

    const ladder: Array<{ mode: AgentMode; sessionId?: string; mint?: boolean }> = [];
    // Offered only when a transcript for that id is actually there. This has
    // to be decided up front rather than discovered: a `--resume` on an id
    // with no conversation exits 1 down a pipe, but in a PTY it prints the
    // error and keeps running, so a doomed rung is indistinguishable from a
    // healthy one once it has started.
    if (row.agent_session_id && canResumeSessionId(row, row.agent_session_id)) {
      ladder.push({ mode: "resume", sessionId: row.agent_session_id });
    }
    // The conversation the task itself last reported, when that is not the one
    // the row names. The row's id can go stale — a `/clear` we missed, a
    // hand-edited database — while `transcript_path` came from the agent's own
    // SessionStart and names its file directly. Resuming by id from that
    // filename is both precise and cheap, and it is the rung that recovers a
    // task whose stored id no longer means anything.
    const reported = sessionIdFromTranscript(row.transcript_path);
    if (reported && reported !== row.agent_session_id && transcriptExists(row.transcript_path)) {
      ladder.push({ mode: "resume", sessionId: reported });
    }
    // "The most recent conversation in this directory" — but only when that is
    // demonstrably this task's. §4.3 calls `--continue` unambiguous on the
    // strength of worktree-per-task, and until worktrees land (m-4) a
    // directory can hold several conversations: another task's, or the one
    // belonging to whoever is running an agent there by hand. Verified the
    // hard way — a resume in this repo picked up the conversation of the
    // session doing the work. Opening someone else's conversation is worse
    // than not resuming at all.
    //
    // "Demonstrably" is the whole of it, and it excludes the row that can
    // demonstrate nothing (TASK-43). Reaching here means the rungs above
    // declined or failed the minted id — so a row that never reported a
    // transcript has no conversation of its own in that directory, and the
    // most recent one there is by elimination somebody else's. The guard used
    // to wave that case through on the grounds that it could not tell.
    if (continueIsSafe(row)) ladder.push({ mode: "continue" });
    // §4.3's last rung: scan the directory for a conversation nobody ever told
    // us about. Offered only in a checkout we made for this task, and that
    // gate is the whole of TASK-60.
    //
    // Why it needs one. Follow what the scan can return in a directory the
    // user chose, given `--continue` above is gated on "the newest transcript
    // is demonstrably ours". If that gate passed, the newest *is* ours and the
    // rungs above have already offered it by id and by `--continue`, so the
    // scan can only reach past it to something older, which nothing has shown
    // to be this task's. If the gate failed, the scan has to be refused for
    // the reason the gate was: declining `--continue` because the newest
    // conversation belongs to a stranger, and then opening that very file by
    // id one rung later, would make the guard theatre. Either way it yields a
    // conversation we never started or nothing at all — which is why TASK-43
    // took the rung off rather than gating it, and why it stays off for a task
    // running where the user pointed it.
    //
    // A worktree removes the stranger from both halves. `worktreePathFor`
    // derives the directory from the task's id, we created it, and nothing
    // else runs there — so every conversation in it, inside the task's
    // lifetime, is this task's whether or not anything ever named it. Which
    // makes both of the scan's outcomes worth having, where in a shared
    // directory neither was: the newest conversation when nothing named it —
    // §4.3's case, and the one TASK-43 could not keep, a degraded task (hooks
    // never arrived, so no SessionStart set `transcript_path`) whose agent then
    // ran `/clear` — and the one *behind* the newest when the newest will not
    // open, which is what "transcript pruned, version skew" leaves to fall back
    // on. An older conversation of this task's is a poor resume and a much
    // better answer than a card saying nothing could be opened.
    //
    // Note this is strictly sharper than `--continue`, not a second helping of
    // it: it resumes the found conversation *by id*, so it says which one it
    // opened, and the rung above stays gated as it is rather than being
    // loosened in a worktree.
    if (runsInOwnWorktree(row)) {
      const found = findResumableTranscript(row, {
        // Every id the ladder can name, offered or not. An id with no
        // transcript is skipped above and would find nothing here either, and
        // one that *was* offered must not come back a second time — most of
        // all through `--continue`, which opens the newest file in the
        // directory, which is exactly what the scan would hand back next.
        notThese: [row.agent_session_id, reported],
      });
      // No `canResumeSessionId` here: the scan found the file, so the rung it
      // builds cannot be the doomed `--resume` that check exists to keep off.
      if (found) ladder.push({ mode: "resume", sessionId: found.sessionId });
    }
    return ladder;
  }

  /** Apply one hook payload to a task (§4.2). False when there is no such
   * task or the payload moves nothing — both of which the caller answers 2xx,
   * since a hook that reports a problem reports it into the agent's own
   * transcript. */
  applyHook(taskId: string, payload: HookPayload): boolean {
    if (!this.store.get(taskId)) return false;
    // Recorded before the mapping runs, and for any payload at all: what this
    // says is "the hooks are wired up", which a payload we do not map answers
    // just as well as one we do. From here the heuristic stays out of the way.
    //
    // The *first* one is also the moment the setup wrapper's stamp is known to
    // be on disk, because the wrapper only execs the agent once setup has
    // exited zero and only an agent that loaded our settings sends a hook. So
    // the reading is hung here rather than on a timer, and only on the edge —
    // a task reports hundreds of these.
    if (!this.hookSeen.has(taskId)) {
      this.hookSeen.add(taskId);
      // Caught for the same reason every other fire-and-forget here is:
      // `applyHook` is synchronous and answers a live HTTP request, so a
      // rejection travelling out of this has no caller left to reach and
      // becomes an unhandled one. Nothing downstream needs the reading — its
      // only consumer is the eviction grace scale, days later.
      void this.recordSetupOutcome(taskId).catch(() => {});
    }
    this.disarmHookGrace(taskId);
    // A compaction is two hooks: PreCompact names the trigger, and the
    // SessionStart that ends it is the one that has to decide what the agent
    // comes back as. Nothing in the second payload says which kind it was, so
    // the trigger is held here between them and spent on arrival.
    // Held per compaction, not per task: every PreCompact replaces what was
    // there, including one that names no trigger. A compaction whose first half
    // said nothing is unknowable, and the previous compaction's answer — from
    // one that was cancelled, or whose SessionStart never arrived — is a guess
    // dressed as a fact, which is the one thing the `undefined` road exists to
    // avoid.
    const trigger = compactTriggerOf(payload);
    if (startsCompaction(payload)) {
      if (trigger) this.compactTriggers.set(taskId, trigger);
      else this.compactTriggers.delete(taskId);
    }
    const ending = endsCompaction(payload);
    const update = transitionFor(
      payload,
      Date.now(),
      ending ? this.compactTriggers.get(taskId) : undefined,
    );
    if (ending) this.compactTriggers.delete(taskId);
    if (!update) return false;
    // `SessionStart` claims the task is live, and for a task with a terminal it
    // is. But `codetoaster hook` outlives the agent that spawned it — killing
    // the PTY does not signal it — so one can land just after `suspendTask`
    // killed everything, and taking its word would leave a row marked `live`
    // with `ptyId: null`: a task the sidebar shows as running that nothing is
    // behind, and whose freshly stamped `idle_since` keeps the harvester off it
    // for a full `harvestAfterMs`. The rest of the transition still applies —
    // it is only the claim about liveness that needs a process to back it.
    if (update.lifecycle === "live" && !this.primaryPty(taskId)) {
      delete update.lifecycle;
    }
    if (!this.store.update(taskId, update)) return false;
    this.broadcastTask(taskId);
    // A finished turn is the moment the working tree can have moved: the agent
    // has stopped editing, and what it did is exactly what the card is
    // reporting. This is the primary freshness mechanism and the reason the
    // backstop's TTL can be minutes — measuring on a timer would be both later
    // and more often than measuring here.
    //
    // Not awaited. The hook route answers a running agent, and five git
    // processes must not sit on that reply; `refreshWorktreeStatus` broadcasts
    // for itself when the answer differs from the last one.
    if (update.agent_state === "idle") void this.refreshWorktreeStatus(taskId, { force: true });
    return true;
  }

  getTask(taskId: string): TaskRow | undefined {
    return this.store.get(taskId);
  }

  taskIdForPty(ptyId: string): string | undefined {
    return this.ptyToTask.get(ptyId);
  }

  /** The task's agent terminal — the one its agent tab opens onto, the one a
   * snapshot is taken of, and the one asked where the task is. A task holds
   * shell tabs beside it (§3); none of them is ever this. */
  primaryPty(taskId: string): Pty | undefined {
    const ptyId = this.agentPtys.get(taskId);
    return ptyId === undefined ? undefined : this.ptys.get(ptyId);
  }

  /** The task's shell terminals, in the order they were opened. What
   * `TaskInfo.shellPtyIds` carries, and so what a client reconciles a restored
   * tab layout against. */
  shellPtys(taskId: string): Pty[] {
    const agentPtyId = this.agentPtys.get(taskId);
    const shells: Pty[] = [];
    for (const ptyId of this.taskPtys.get(taskId) ?? []) {
      if (ptyId === agentPtyId) continue;
      const pty = this.ptys.get(ptyId);
      if (pty) shells.push(pty);
    }
    return shells;
  }

  /**
   * Open a plain shell as a sibling of the task's agent (§3, §5.5).
   *
   * Undefined when the task is not live: a shell belongs to a task's running
   * state, and spawning one against a suspended row would resurrect half a task
   * — a process in the working directory of a conversation nobody has resumed,
   * which the next harvest would not even find, since the harvester only walks
   * live rows.
   *
   * Same environment as the agent, deliberately. A user who types `claude` in a
   * shell tab is otherwise running inside the task's inherited marker, and the
   * hooks that agent fires would be filed against this task's conversation.
   *
   * Spawned at the task's own grid rather than at `PtyManager`'s 80×24 fallback
   * when the caller names no size. The route that opens a shell has no terminal
   * yet — the tab is drawn from its answer — so nobody is in a position to
   * measure one, and left to the fallback the shell paints its first prompt
   * laid out for 80 columns and reflows the moment the tab attaches. The agent
   * is spawned at a real grid for the same reason.
   */
  openShell(taskId: string, options: { cols?: number; rows?: number } = {}): Pty | undefined {
    const row = this.store.get(taskId);
    if (!row || row.lifecycle !== "live") return undefined;
    // The agent's live grid, else the one the task was last seen at. Both are
    // what `taskInfo.size` reports, which is the size every client showing this
    // task has already negotiated down to.
    const taskSize = this.primaryPty(taskId)?.getSize() ?? {
      cols: row.last_size_cols ?? DEFAULT_SIZE.cols,
      rows: row.last_size_rows ?? DEFAULT_SIZE.rows,
    };
    const pty = this.ptys.spawn([process.env.SHELL || "/bin/sh"], {
      cols: options.cols ?? taskSize.cols,
      rows: options.rows ?? taskSize.rows,
      cwd: row.cwd,
      env: taskEnv(process.env, { taskId, port: this.port, origin: this.origin }),
    });
    this.adopt(pty, taskId, false);
    this.broadcastTask(taskId);
    return pty;
  }

  /**
   * Close one of a task's shells. False when the task does not hold that PTY,
   * which includes the case worth being explicit about: the agent's own
   * terminal is not closable through this door. Killing it here would leave the
   * row saying `live` with no conversation behind it and no snapshot taken —
   * `closeTask` is how a task is put down (§6).
   */
  closeShell(taskId: string, ptyId: string): boolean {
    if (this.ptyToTask.get(ptyId) !== taskId) return false;
    if (this.agentPtys.get(taskId) === ptyId) return false;
    this.ptys.kill(ptyId);
    this.ptyToTask.delete(ptyId);
    this.taskPtys.get(taskId)?.delete(ptyId);
    this.broadcastTask(taskId);
    return true;
  }

  /** Every terminal a task is holding: the agent's, and any shell tabs opened
   * beside it (§3). What the harvester counts attached views over and asks
   * what is running, and what `suspendTask` kills. */
  taskPtyList(taskId: string): Pty[] {
    const held: Pty[] = [];
    for (const ptyId of this.taskPtys.get(taskId) ?? []) {
      const pty = this.ptys.get(ptyId);
      if (pty) held.push(pty);
    }
    return held;
  }

  /** The rows the idle harvester walks (§5.5). Rows rather than `TaskInfo`,
   * because what the guards ask about — `idle_since`, `agent_state` — is column
   * data that the rendered shape has no place for, and rows rather than
   * `listTasks`, which only sees the in-memory project grouping and so cannot
   * see a task the daemon adopted rather than created. */
  liveTasks(): TaskRow[] {
    return this.store.list({ lifecycle: "live" });
  }

  /** A live PTY by id, for the routes that serialize or write to one. */
  getPty(ptyId: string): Pty | undefined {
    return this.ptys.get(ptyId);
  }

  /** refreshCwd, but at most once every `maxAgeMs` for a given task.
   *
   * This is what lets the data routes ask on every request. They have to ask
   * somewhere: §5.4 moved them off "run git per request" and onto the stored
   * row, and the row then needs something to notice when the agent has moved.
   * Attach was doing that job, but a client only re-attaches when it changes
   * task — so a user moving between one task's own Changes, Files and History
   * tabs never triggered it, and a single-task user never triggered it at all.
   *
   * Affordable only because getCwd stopped blocking the event loop (TASK-40);
   * before that this would have put a synchronous ps and lsof in front of
   * every diff request. */
  async refreshCwdIfStale(taskId: string, maxAgeMs = this.cwdRefreshWindowMs): Promise<string | undefined> {
    // Nothing to throttle, and nothing to remember. The data routes call this
    // with whatever id is in the URL, so recording a timestamp before knowing
    // the task exists would grow this map by one entry per bad request and
    // never free them — suspending or deleting the task is the only thing that
    // prunes it.
    if (!this.store.get(taskId)) return undefined;
    const last = this.cwdCheckedAt.get(taskId);
    if (last !== undefined && Date.now() - last < maxAgeMs) {
      return this.store.get(taskId)?.cwd;
    }
    this.cwdCheckedAt.set(taskId, Date.now());
    return this.refreshCwd(taskId);
  }

  /** The one thing a live PTY is still better at than the row: noticing the
   * agent has cd'd somewhere unexpected (§5.4). Opportunistic — callers ask
   * when they happen to be listing tasks anyway, and a suspended task simply
   * has nothing to report. Re-resolves repo_root when the directory moved, or
   * when the row is still carrying a null root, since that is a git call. */
  async refreshCwd(taskId: string): Promise<string | undefined> {
    const task = this.store.get(taskId);
    if (!task) return undefined;
    const live = await this.primaryPty(taskId)?.getCwd();
    const moved = !!live && live !== task.cwd;
    // A null root is the one value worth re-asking about even when nothing
    // moved, because this is the only thing that ever revisits it. createTask
    // has to record "the lookup could not run" (git contending on index.lock,
    // a stalled mount) as "no repository" — there is no earlier value for it
    // to keep — and `git init` inside a task's own directory is a repository
    // appearing under a cwd that never changes. Either way the task's diff,
    // file and git routes would 400 for the rest of its life. Re-asking costs
    // one `rev-parse` that exits 128 immediately when the answer really is no.
    if (!moved && task.repo_root !== null) return task.cwd;

    // undefined means the lookup could not be performed (git unavailable, or
    // slow enough to hit the timeout). Keeping the root we already had is the
    // only safe answer: writing null on an absent answer would 400 the task's
    // data routes until something moves.
    const resolved = await resolveRepoRoot(live ?? task.cwd);
    const repoRoot = resolved === undefined || resolved === task.repo_root ? undefined : resolved;
    if (!moved && repoRoot === undefined) return task.cwd;
    this.store.update(taskId, {
      ...(moved ? { cwd: live } : {}),
      ...(repoRoot === undefined ? {} : { repo_root: repoRoot }),
    });
    this.broadcastTask(taskId);
    return live ?? task.cwd;
  }

  renameTask(taskId: string, title: string): boolean {
    // An explicit rename opts the task out of derivation for good.
    if (!this.store.update(taskId, { title, title_source: "manual" })) return false;
    this.broadcastTask(taskId);
    return true;
  }

  /** Write the task's screen to disk and record the grid it was at (§5.1).
   * False when there was nothing to write.
   *
   * What TASK-15's harvester calls before it kills an idle agent's terminal,
   * and what TASK-17's restore reads back. The size goes on the row in the same
   * breath because the two are one fact: a snapshot repainted into a grid it
   * was not taken at reflows into nonsense, and `runResumeLadder` already reads
   * `last_size_*` to size the terminal it spawns.
   *
   * A task with no live terminal keeps whatever snapshot it already has rather
   * than having it cleared. The file is only stale in the sense that the
   * process behind it is gone, which is precisely when a user wants to see it;
   * reconciling rows whose PTYs died with the daemon is `reconcileOnBoot`'s
   * job.
   *
   * It never throws. The harvester runs this across every live task on a timer,
   * so one task whose directory has been deleted under it must not take the
   * rest of the tick down with it. */
  async snapshot(taskId: string): Promise<boolean> {
    if (!this.store.get(taskId)) return false;
    const pty = this.primaryPty(taskId);
    if (!pty) return false;
    // The screen and the grid it was taken at, read together, because they are
    // one fact: a snapshot repainted into a grid it was not taken at reflows
    // into nonsense. Reading the size after the write would let them disagree —
    // the write is queued behind any earlier one for this task, and in that
    // window a client detaching or resizing re-runs smallest-wins and changes
    // the PTY's grid under us. The row would then claim the new size for a
    // screen serialized at the old one.
    const screen = pty.serialize();
    const size = pty.getSize();
    // A screen with nothing on it is nothing to write, not an empty screen.
    // `serialize` answers "" once the terminal is disposed, so that a stray call
    // cannot throw out of the harvester's tick — and a live terminal that has
    // painted nothing answers exactly the same, which is a second or two of
    // every resume: close the task between the spawn of `claude` and the agent's
    // first paint and this runs against a terminal with an empty buffer.
    // Persisting either "" would overwrite the last screen the task ever
    // painted, which is the opposite of what the no-PTY branch above is careful
    // to preserve — so both stop here, before the write and before the row is
    // told a size, since a `last_size_*` recorded for a screen that was never
    // written describes the screen that is still on disk.
    if (!screen) return false;
    try {
      await writeSnapshot(taskId, screen);
    } catch (e) {
      console.warn(`Could not write scrollback snapshot for task ${taskId}:`, e);
      return false;
    }
    // The task can be deleted while the write is in flight, and `deleteTask`
    // fires its own removal without awaiting it — so the removal can run first
    // and this write lands after it, recreating the directory and leaving a
    // multi-hundred-KB file for a row that no longer exists and an id that can
    // never be reissued. Exactly the leak the removal exists to prevent.
    if (!this.store.get(taskId)) {
      void removeSnapshot(taskId).catch(() => {});
      return false;
    }
    this.store.update(taskId, { last_size_cols: size.cols, last_size_rows: size.rows });
    return true;
  }

  /** Harvest a task: put the screen on disk, kill everything running behind
   * it, and leave the row saying so (§5.5). False for a task that is not there
   * or is not live — a suspended task has nothing left to take away, and
   * asking twice is something both the harvester's tick and a user's click can
   * do.
   *
   * This is the whole of what harvesting *does*; whether a given task should be
   * harvested is the caller's question. The idle harvester answers it with §5.5's
   * guards and `closeTask` answers it with a click, and neither one belongs in
   * here.
   *
   * The snapshot comes first, and the order is load-bearing: `Pty.kill`
   * disposes the headless terminal, `serialize` answers "" from then on, and
   * `snapshot` refuses to persist that — so a snapshot taken after the kill
   * would silently leave the task with whatever screen it had before this one,
   * which is exactly the screen the user is about to be shown when they reopen
   * it (§5.5, phase 1).
   *
   * The row and `~/.codetoaster/tasks/<id>/` both stay. Suspension is the
   * reversible level of gone (§5.6): the settings file is what the resumed
   * agent is started with, and the scrollback we just wrote is what the user
   * sees while it comes back. */
  async suspendTask(taskId: string): Promise<boolean> {
    // A resume in flight has to settle first. The ladder leaves the row
    // `suspended` for its whole run and only writes `live` on the rung that
    // works, so a close arriving mid-resume read "not live", answered false and
    // did nothing at all — and seconds later the ladder finished, wrote `live`
    // and handed the user back the agent they had just closed. The route
    // reported success either way, so there was nothing to say it had happened.
    // Waiting means the click lands on the task the resume produced, which is
    // the task the user was looking at when they clicked.
    const inFlight = this.resuming.get(taskId);
    if (inFlight) {
      await inFlight.catch(() => undefined);
      // Started over rather than fallen through, because settling that resume
      // is not the same as there being no resume. A `fresh` caller parks on the
      // very same promise and registers a *new* ladder the instant it settles —
      // and it registered its continuation before this one, so by the time we
      // get here the second ladder is already in `resuming`. Falling through
      // would run `doSuspend` alongside it: it reads a row still marked `live`,
      // takes no snapshot and kills nothing (the fresh start discarded the
      // PTYs), writes `suspended` and reports success — and then the ladder
      // writes `live` again, leaving an agent running on a task the user
      // closed. Asking again is the whole fix: the click lands on the task the
      // *last* resume produced.
      return this.suspendTask(taskId);
    }
    // Registered only now, on the far side of that wait, so a resume waiting on
    // us and a suspend waiting on it can never be waiting on each other. A
    // second close joins the first rather than snapshotting the task twice.
    const alreadySuspending = this.suspending.get(taskId);
    if (alreadySuspending) return alreadySuspending;
    const attempt = this.doSuspend(taskId).finally(() => {
      this.suspending.delete(taskId);
    });
    this.suspending.set(taskId, attempt);
    return attempt;
  }

  private async doSuspend(taskId: string): Promise<boolean> {
    const row = this.store.get(taskId);
    if (!row || row.lifecycle !== "live") return false;
    await this.snapshot(taskId);
    for (const ptyId of [...(this.taskPtys.get(taskId) ?? [])]) {
      // Every terminal the task holds, not just the agent's: a shell tab
      // (TASK-27) is a process in the task's directory like any other, and §5.5
      // harvests the task, not one of its processes.
      this.ptys.kill(ptyId);
      this.ptyToTask.delete(ptyId);
    }
    this.taskPtys.delete(taskId);
    this.agentPtys.delete(taskId);
    // What a task without a process cannot have: a clock waiting for an agent's
    // first hook, which would wake up and relabel a task that is deliberately
    // quiet; a record that the agent now gone had reported, which is a claim
    // about a process, not about a task (`spawnAgent` clears it for the same
    // reason on the way back); and a throttle timestamp for a cwd check that
    // was performed against a terminal that no longer exists, which would
    // otherwise suppress the first check after the task is resumed.
    this.disarmHookGrace(taskId);
    this.hookSeen.delete(taskId);
    this.compactTriggers.delete(taskId);
    this.cwdCheckedAt.delete(taskId);
    // Only the lifecycle. `agent_state` stays `idle`: that is what was true of
    // the agent when it was harvested and what the card should go on saying.
    // `reconcileOnBoot`'s `unknown` is the other case — a daemon that never
    // witnessed its agents die and cannot speak for what they were doing.
    this.store.update(taskId, { lifecycle: "suspended" });
    this.broadcastTask(taskId);
    return true;
  }

  /** Closing a task. Chat products have no "close", and neither does this one:
   * §6 makes the close button a suspend, and archive (TASK-31) the only way a
   * task truly leaves.
   *
   * It is `suspendTask` and nothing else on purpose. Manual close is the
   * harvest path minus the guards — §5.5's own wording — so the two must not be
   * able to drift: whatever harvesting learns to preserve, a user's click
   * preserves too. The guards are the entire difference, and they live with the
   * caller that has a reason to ask: the harvester answers "should this be
   * harvested?" with §5.5, and a click answers it by being a click. */
  closeTask(taskId: string): Promise<boolean> {
    return this.suspendTask(taskId);
  }

  /** The repository a task's checkout belongs to.
   *
   * Off the row, and the row is the point (TASK-64): every worktree operation
   * used to find the repository through the *project*, and deleting a project
   * reassigns its tasks to General — whose path is empty — leaving a task that
   * could neither be reopened nor evicted, its branch and its snapshot sitting
   * in a repository nothing could name.
   *
   * A null heals rather than failing: a task created before the column existed
   * still has a project to ask, so the answer is resolved once and written
   * back. Only a task that has *already* lost its project can end with nothing,
   * and that is the one case with no recovery — the path it was branched from
   * was never recorded and the project that knew it is gone. */
  private async repoRootFor(row: TaskRow): Promise<string | null> {
    const root = await this.resolveRepoRoot(row);
    if (root && !row.worktree_repo && this.store.get(row.id)) {
      this.store.update(row.id, { worktree_repo: root });
    }
    return root;
  }

  /** The same answer, without healing the row with it.
   *
   * Hard delete needs this: it removes the row first, deliberately and
   * synchronously, and only then goes looking for the checkout and the branch
   * to clean up — so by the time it asks, the write-back above would either
   * silently do nothing or, worse, resurrect a task that has just been deleted.
   * Splitting the two makes "which repository is this?" a question that can be
   * asked about a row nobody holds any more. */
  private async resolveRepoRoot(row: TaskRow): Promise<string | null> {
    if (row.worktree_repo) return row.worktree_repo;
    const project = this.projects.find((p) => p.id === row.project_id);
    if (!project?.initialPath) return null;
    return await repoRootOf(expandTilde(project.initialPath)).catch(() => null);
  }

  /** What a task's outstanding snapshot decision is, or null when it owes none.
   *
   * The pair of columns, resolved once: a *present* checkout that still has a
   * WIP ref is a snapshot `restoreWorktree` refused to apply because the branch
   * had moved under it. Both actions below need exactly this, and both have to
   * refuse the same states — an evicted task's ref is how it is stored, not a
   * decision, and a checkout that is not on disk has nothing to apply into. */
  private pendingWip(taskId: string): { ref: string; worktreePath: string } | null {
    // Not while an eviction is running. `doEvict` writes the ref through
    // `snapshotTaskWip` and only *then* removes the checkout, so for the whole
    // of `git worktree remove` the row reads exactly like a refused snapshot —
    // `present`, with a `wip_ref` — and a discard landing in that window drops
    // the one commit the eviction is relying on. The checkout and the snapshot
    // would both be gone, which is the single way this design can lose work.
    // Refused rather than queued: the eviction finishes in a moment and clears
    // the state that made the question look outstanding.
    if (this.evicting.has(taskId)) return null;
    // Nor while an archive is running, which is the same window seen from the
    // other end: `doArchive` snapshots through `snapshotTaskWip` and only then
    // removes the checkout, so for the whole of that removal the row reads
    // `present` with a `wip_ref` too — and a discard landing there drops the
    // commit the archive's whole recoverability rests on, moments before the
    // directory holding the other copy goes.
    if (this.archiving.has(taskId)) return null;
    const row = this.store.get(taskId);
    if (!row?.wip_ref || !row.worktree_path) return null;
    if (row.worktree_state !== "present") return null;
    if (!fs.existsSync(row.worktree_path)) return null;
    return { ref: row.wip_ref, worktreePath: row.worktree_path };
  }

  /** Take the user up on a snapshot the restore refused (§5.6).
   *
   * This is the destructive arm of the three, and deliberately so: the checkout
   * has been sitting there since the restore, possibly worked in, and applying
   * writes the snapshot's version of every file it holds over what is there
   * now. The confirmation belongs to the caller — the server cannot know
   * whether the user has read what they are about to lose — but the *decision*
   * is theirs to make, so nothing here second-guesses it once it has been made.
   *
   * The ref is dropped afterwards rather than kept as a spare copy, for the
   * reason an applied restore drops it: `wip_ref` on a present checkout is what
   * "owes a decision" is spelled as, and one that survived the decision would
   * ask the question again forever. */
  async applyTaskWip(taskId: string): Promise<boolean> {
    const pending = this.pendingWip(taskId);
    if (!pending) return false;
    await applyWip(pending.worktreePath, pending.ref);
    await dropWip(pending.worktreePath, taskId);
    if (!this.store.get(taskId)) return true;
    this.store.update(taskId, { wip_ref: null, wip_at: null });
    this.broadcastTask(taskId);
    return true;
  }

  /** Throw the snapshot away, and stop asking.
   *
   * The one genuinely irreversible thing in the worktree module: nothing else
   * points at the commit, and `refs/codetoaster/*` gets no reflog, so the
   * objects are collectable the moment the ref is gone. It is still the right
   * default to offer — the alternative is a card that cannot be dismissed —
   * and the third choice, keeping the ref and answering later, costs nothing
   * and is what a user who is unsure should take. */
  async discardTaskWip(taskId: string): Promise<boolean> {
    // Its own guard rather than `pendingWip`, and the difference is the
    // checkout. Applying writes files into a directory and so needs one on
    // disk; dropping a ref needs only the repository, which the row can name
    // by itself now. Without this, a task whose checkout was removed by hand
    // shows a notice neither button can clear — and its ref would go on
    // keeping it from ever being evicted again.
    //
    // Still only for a *present* checkout: an evicted task's ref is how its
    // work is stored rather than a decision, and discarding that destroys it.
    if (this.evicting.has(taskId)) return false;
    // Nor mid-archive, and this is the arm that pair of guards exists for.
    // `pendingWip` withholding the question stops the *notice* being drawn, but
    // a discard is a POST that can already be in flight when the archive
    // starts — and unlike apply it does not go through `pendingWip`, because
    // dropping a ref needs only the repository. So without this it lands on the
    // one commit the archive's recoverability rests on, moments before the
    // checkout holding the other copy goes, and there is no third copy.
    if (this.archiving.has(taskId)) return false;
    const row = this.store.get(taskId);
    if (!row?.wip_ref || row.worktree_state !== "present") return false;
    const repoRoot = await this.repoRootFor(row);
    if (!repoRoot) return false;
    await dropWip(repoRoot, taskId);
    if (!this.store.get(taskId)) return true;
    this.store.update(taskId, { wip_ref: null, wip_at: null });
    this.broadcastTask(taskId);
    return true;
  }

  /** Take a suspended task's checkout off disk, keeping everything that makes
   * it rebuildable (§5.6).
   *
   * The second tier of harvesting. Suspending gives back the processes; this
   * gives back the disk, and it is safe to do to a dirty tree because the
   * snapshot goes first and the branch is never touched. What is left is a row,
   * a branch and a WIP ref — enough for `restoreTaskWorktree` to put the task
   * back exactly as it was.
   *
   * **Only on a suspended task**, and that is the guard that discharges every
   * other one. A live task has processes in that directory: an agent mid-turn,
   * a build in a shell tab, an editor with unsaved work. Removing the checkout
   * under them is not recoverable in the way this otherwise is, and the
   * harvester's own is-anything-running guards have already been passed by
   * anything that reached `suspended`. A manual evict is refused for the same
   * reason rather than being allowed to override it: the caller should close
   * the task first, which is one click and has its own snapshot.
   *
   * **Never without a snapshot.** `snapshotTaskWip` answering null is always a
   * reason to keep the directory — there is nothing recorded to restore from,
   * or there is a snapshot already waiting on the user's decision that a new
   * one would overwrite. Eviction is only ever as safe as the snapshot that
   * preceded it, so no snapshot means no eviction.
   *
   * **Never against a resume in flight.** `suspended` is not a quiet state: the
   * ladder leaves the row saying it for its entire run and only writes `live`
   * on the rung that works, so the lifecycle guard above passes for a task
   * somebody is in the middle of reopening — and what would then be removed is
   * the directory the restore just rebuilt, with the agent already spawned into
   * it. Refused rather than queued behind it: the next sweep is thirty seconds
   * away, and by then the resume has either landed (live, so not evictable) or
   * failed (suspended again, and evictable on its own merits).
   *
   * Whether a task *should* be evicted — grace, pins — is the harvester's, the
   * same way `suspendTask` knows nothing about idle timeouts. */
  evictTask(taskId: string): Promise<boolean> {
    if (this.resuming.has(taskId)) return Promise.resolve(false);
    // And not against an archive either, for a sharper version of the same
    // reason: archive is already removing this checkout and is between reading
    // the branch status and acting on it. A second remover would either lose
    // the race harmlessly or win it and leave archive's `branchStatus` — taken
    // moments ago, and about to decide whether a branch is deleted — describing
    // a repository that has changed underneath it.
    if (this.archiving.has(taskId)) return Promise.resolve(false);
    // A second caller joins the first rather than snapshotting and removing the
    // same checkout twice — the manual route and the evict tier can easily
    // arrive together.
    const already = this.evicting.get(taskId);
    if (already) return already;
    // Registered before the first await, so a resume that checks this map
    // cannot slip past between the guard above and the work below.
    const attempt = this.doEvict(taskId).finally(() => {
      this.evicting.delete(taskId);
    });
    this.evicting.set(taskId, attempt);
    return attempt;
  }

  private async doEvict(taskId: string): Promise<boolean> {
    const row = this.store.get(taskId);
    if (!row?.worktree_path || row.worktree_state !== "present") return false;
    if (row.lifecycle !== "suspended") return false;

    const repoRoot = await this.repoRootFor(row);
    // Nothing to evict *into* a repository we cannot name. Refusing keeps the
    // directory, which is the safe half — the task is broken either way, and
    // TASK-64's failure message on the reopen path is where it gets explained.
    if (!repoRoot) return false;

    const snapshot = await this.snapshotTaskWip(taskId);
    if (!snapshot) return false;

    await evictWorktree(repoRoot, row.worktree_path);
    // `discardCheckout` is best-effort by design — it falls back to an `rm` git
    // refused and swallows that too — so a removal can resolve having removed
    // nothing. The row must not then say `evicted`: the restore stops at
    // `assertPathFree` *before* it prunes, and the path is fixed by the task's
    // id and cannot be moved away from, so a directory that survived would make
    // the task unreopenable for good. Left `present`, which is what is true.
    if (fs.existsSync(row.worktree_path)) {
      console.warn(`Could not remove the checkout of task ${taskId}; it stays present`);
      return false;
    }
    // Re-read rather than trusted: the snapshot and the removal are two awaits,
    // and a task deleted across them must not be written back as a row holding
    // one column.
    if (!this.store.get(taskId)) return true;
    // `worktree_path` is deliberately kept. It is derived from the task's id
    // and is where the restore will rebuild — forgetting it would make an
    // evicted task indistinguishable from one that never had a checkout.
    this.store.update(taskId, { worktree_state: "evicted" });
    this.broadcastTask(taskId);
    return true;
  }

  /** Evict every suspended task of a project, and answer how many went.
   *
   * Sequential rather than parallel: every eviction in one repository takes the
   * same per-repo lock, so a `Promise.all` would queue on it anyway while
   * making a single failure harder to attribute. One that throws does not stop
   * the rest — a project reclaimed except for the one checkout git refused is
   * the useful outcome. */
  async evictProject(projectId: string): Promise<number> {
    let evicted = 0;
    for (const row of this.store.list({ lifecycle: "suspended" })) {
      if (row.project_id !== projectId) continue;
      try {
        if (await this.evictTask(row.id)) evicted++;
      } catch (e) {
        console.warn(`Could not evict task ${row.id}:`, e);
      }
    }
    return evicted;
  }

  /** What archiving this task would cost, before it is confirmed (§5.6).
   *
   * The read half of `archiveTask`, run on the same row by the same code, so
   * the dialog cannot state one thing and the button do another for any reason
   * except time passing between them. Null for a task that is not there.
   *
   * Cheap enough to call on a click: four gits against refs, one `status` in
   * the checkout. It is deliberately not cached — a preview that is a minute
   * old is exactly the preview that misleads.
   */
  async archivePreview(taskId: string): Promise<ArchivePreview | null> {
    const row = this.store.get(taskId);
    if (!row) return null;
    // The repository is only asked for when there is a branch to ask about:
    // `repoRootFor` writes its answer back onto the row, and `worktree_repo` is
    // documented as null for a task with no checkout of its own — a preview
    // should not be what changes that.
    const repoRoot = row.branch ? await this.repoRootFor(row) : null;
    const status = await this.branchStatusOf(row, repoRoot);
    return {
      status,
      branch: row.branch,
      branchWouldBeDeleted: status !== null && status.exists && branchIsExpendable(status),
    };
  }

  /** The git facts about a task's own branch, or null when it has none.
   *
   * `worktreePath` is passed only for a checkout that is genuinely on disk, so
   * an evicted task answers `dirty: null` — "there is no working tree to be
   * dirty" — rather than the `0` a missing directory would otherwise read as.
   * The two are not the same claim, and this is the number a confirmation
   * dialog prints. */
  private async branchStatusOf(row: TaskRow, repoRoot: string | null): Promise<BranchStatus | null> {
    if (!row.branch || !repoRoot) return null;
    const onDisk = row.worktree_state === "present"
      && !!row.worktree_path
      && fs.existsSync(row.worktree_path);
    return await branchStatus(repoRoot, {
      branch: row.branch,
      baseRef: row.base_ref,
      worktreePath: onDisk ? row.worktree_path : null,
    });
  }

  /** Archive a task: the only way one truly leaves (§5.6, §6).
   *
   * Everything below the snapshot is destruction, and the snapshot is the whole
   * of what makes it recoverable — so the order is the design, not a
   * convenience:
   *
   * 1. **Suspend first**, and through the ordinary door. A live task has an
   *    agent in the directory about to be removed, and `suspendTask` is what
   *    knows how to put one down — writing the screen, killing every terminal
   *    the task holds, disarming the clocks. Reimplementing that here would be
   *    a second harvester free to drift from the one §5.5 describes.
   * 2. **Read the status while there is still something to read.** `dirty` is a
   *    `git status` in a checkout that step 4 deletes, so the outcome has to be
   *    taken now or not at all — and it is what tells the user what they spent.
   * 3. **Snapshot unconditionally**, clean tree or not. A ref written only for a
   *    dirty tree would collapse "there was nothing to save" and "we never got
   *    to it" into one answer, and the confirmation promises a recoverable
   *    action rather than a bet. A snapshot that fails aborts the archive: the
   *    checkout is still there, and nothing has been lost by stopping.
   * 4. Remove the checkout, keeping the branch — `evictWorktree`, not
   *    `removeWorktree`, which exists to undo a failed create and takes the
   *    branch with it.
   * 5. **Delete the branch only if its commits survive it** — merged into
   *    `base_ref`, or contained in some remote. The default leans towards
   *    keeping, because a ref costs nothing next to losing commits, and the
   *    outcome says in words why one was kept so the user is not left guessing
   *    at a branch they did not expect to still have.
   * 6. Take `~/.codetoaster/tasks/<id>/` with it. `closeTask` leaves that
   *    standing on purpose — the settings are what the resumed agent starts
   *    with and the scrollback is what the user sees while it comes back — and
   *    an archived task is resumed by nothing.
   *
   * The row is kept, behind `lifecycle = archived`: `listTasks` shows live and
   * suspended, so the task leaves the sidebar without leaving the database, and
   * §7.5's archived toggle has something to show. Null for a task that is not
   * there or has already been archived — asking twice is what two browsers
   * showing the same dialog do.
   */
  async archiveTask(taskId: string): Promise<ArchiveOutcome | null> {
    // A resume in flight settles first, for the reason `evictTask` refuses
    // against one: the ladder leaves the row `suspended` for its entire run and
    // only writes `live` on the rung that works, so "is this task live?" — the
    // question step 1 asks to decide whether to suspend — answers *no* for a
    // task somebody is in the middle of reopening. Without this wait the
    // archive skips the suspend entirely and removes the directory the restore
    // has just rebuilt, with the agent already spawned into it; and the ladder,
    // still running, then writes `lifecycle: live` back over the `archived`
    // this wrote, putting a task with no checkout and no settings directory
    // back in the sidebar. Waited on *before* registering below, so the resume
    // side's wait on `archiving` and this one can never be waiting on each
    // other. Started over rather than fallen through, because settling that
    // resume is not the same as there being no resume — a `fresh` caller
    // registers a new ladder the instant the first settles.
    const resumeInFlight = this.resuming.get(taskId);
    if (resumeInFlight) {
      await resumeInFlight.catch(() => undefined);
      return this.archiveTask(taskId);
    }
    // An eviction in flight settles first, and then this starts over against
    // the row it left. It is about to remove the very checkout step 3 wants to
    // snapshot, and `snapshotTaskWip` refuses mid-eviction anyway — so racing
    // it would abort the archive for a reason that resolves itself in a moment.
    // Waited on *before* registering below, so the eviction side's refusal and
    // this wait can never be waiting on each other.
    const evictInFlight = this.evicting.get(taskId);
    if (evictInFlight) {
      await evictInFlight.catch(() => undefined);
      return this.archiveTask(taskId);
    }
    const already = this.archiving.get(taskId);
    if (already) return already;
    const attempt = this.doArchive(taskId).finally(() => {
      this.archiving.delete(taskId);
    });
    this.archiving.set(taskId, attempt);
    return attempt;
  }

  private async doArchive(taskId: string): Promise<ArchiveOutcome | null> {
    const opening = this.store.get(taskId);
    if (!opening) return null;
    if (opening.lifecycle === "archived") return null;
    if (opening.lifecycle === "live") await this.suspendTask(taskId);

    // Re-read on the far side of the suspend, which writes the row and can take
    // as long as a multi-hundred-KB screen takes to reach the disk.
    const row = this.store.get(taskId);
    if (!row) return null;

    // Resolved once and handed down, rather than asked for by each step: a task
    // whose `worktree_repo` was never written resolves it by running git
    // against the project, and doing that three times over one archive is three
    // chances for the answer to change mid-operation.
    const repoRoot = row.worktree_state === "none" ? null : await this.repoRootFor(row);
    const status = await this.branchStatusOf(row, repoRoot);

    let wipRef = row.wip_ref;
    const onDisk = row.worktree_state === "present"
      && !!row.worktree_path
      && fs.existsSync(row.worktree_path);
    // A ref already on the row is a snapshot the restore refused to apply, and
    // it is the user's outstanding apply/keep/discard — but it is also, and
    // more importantly here, a commit holding work. Taking a fresh one would
    // move the ref off it and answer their question by destroying the thing
    // they were being asked about, so the refused snapshot *is* the archive's
    // snapshot and the decision travels with it into the retention window.
    if (onDisk && !row.wip_ref) {
      const taken = await this.snapshotTaskWip(taskId);
      if (!taken) {
        throw new WorktreeError(
          "snapshot-failed",
          `Could not snapshot "${row.title}" before archiving it, so nothing was removed`,
        );
      }
      wipRef = taken.ref;
    }

    if (repoRoot && row.worktree_path) {
      // For a `missing` checkout too, not only a present one: the directory is
      // gone but git's registration of it under `.git/worktrees` is not, and
      // `discardCheckout` prunes on its way past. Leaving that behind is what
      // makes a repository accumulate worktrees nothing will ever name again.
      await evictWorktree(repoRoot, row.worktree_path);
    }

    // After the checkout is gone, and that order is not stylistic: git refuses
    // to delete a branch that is checked out in one of its worktrees, so a
    // branch deletion attempted first would fail on exactly the tasks this is
    // for.
    let branchDeleted = false;
    let branchKept: string | null = null;
    if (row.branch && repoRoot && status?.exists) {
      if (branchIsExpendable(status)) {
        branchDeleted = await deleteBranch(repoRoot, row.branch);
        // Git refused after we had established it was safe — a worktree that
        // would not go, most likely. Reported rather than thrown: the archive
        // has already done everything else, and a branch that is still there is
        // the harmless half of the two ways this can end.
        if (!branchDeleted) branchKept = `git would not delete ${row.branch}`;
      } else {
        branchKept = keptReason(row.branch, row.base_ref, status);
      }
    }

    await removeTaskDir(taskId);
    // The stamp it dated went with that directory, and an archived task never
    // spawns again — so the entry would sit in the map for the life of the
    // daemon. `deleteTask` clears it for the same reason.
    this.spawnedAt.delete(taskId);

    const outcome: ArchiveOutcome = {
      status,
      branch: row.branch,
      branchDeleted,
      branchKept,
      wipRef,
    };
    // Deleted while git was working: nothing to write back, and the ref is left
    // for the retention sweep rather than resurrected as a row holding one
    // column — the same rule every other write here follows.
    if (!this.store.get(taskId)) return outcome;
    this.store.update(taskId, {
      lifecycle: "archived",
      // The directory is gone and the path is remembered, which is exactly what
      // `evicted` says. Not `none`: that means a task that runs in the
      // project's own directory and never had a checkout, and an archived task
      // reading that way would be indistinguishable from one there was never
      // anything to clean up for.
      ...(row.worktree_state === "none" ? {} : { worktree_state: "evicted" }),
      // Restamped, even for a ref that was already there. Retention is measured
      // from the archive, because that is when the user was told they had N
      // days — a refused snapshot taken three weeks ago would otherwise expire
      // in the week after they archived it.
      ...(wipRef ? { wip_at: Date.now() } : {}),
    });
    // The whole list, not the row: an archived task leaves `listTasks`, and a
    // `task` delta for a row that is no longer in the snapshot would leave every
    // attached client holding it.
    this.broadcastTasks();
    return outcome;
  }

  /** Drop the snapshots of archived tasks whose retention has run out (§5.6).
   * Run once at boot, which is the sweep §5.6 asks for: the window is measured
   * in weeks, so a daemon that is up for one has nothing to do in the meantime.
   *
   * **Archived tasks only.** A suspended task's `wip_ref` is not a grace
   * period, it is where its work is *stored* — expiring one would delete a
   * user's uncommitted changes on a timer, which is the one thing this design
   * exists never to do.
   *
   * `retentionMs` at or below zero keeps every ref forever, matching the way
   * the harvester's two tiers are turned off.
   *
   * Never throws: it runs on the boot path with nothing to hand a rejection to,
   * and a repository that has moved out from under one archived task is no
   * reason to leave the other twenty holding refs. */
  async expireArchivedWip(
    retentionMs = WIP_RETENTION_MS,
    now = Date.now(),
  ): Promise<number> {
    if (retentionMs <= 0) return 0;
    let archived: TaskRow[];
    try {
      archived = this.store.list({ lifecycle: "archived" });
    } catch (e) {
      // The listing itself, outside the per-task guard below, because the
      // caller fires this and never looks at the promise — the same shape the
      // harvester's sweeps use, and for the same reason.
      console.warn("Could not list archived tasks to expire their snapshots:", e);
      return 0;
    }
    let expired = 0;
    for (const row of archived) {
      if (!row.wip_ref || row.wip_at === null) continue;
      if (now - row.wip_at <= retentionMs) continue;
      try {
        const repoRoot = await this.repoRootFor(row);
        // Without a repository there is no ref store to delete from. The row
        // keeps saying what it says, which is the honest state: the snapshot
        // may well still exist somewhere nothing can name.
        if (!repoRoot) continue;
        await dropWip(repoRoot, row.id);
        if (this.store.get(row.id)) {
          this.store.update(row.id, { wip_ref: null, wip_at: null });
        }
        expired++;
      } catch (e) {
        console.warn(`Could not expire the WIP snapshot of archived task ${row.id}:`, e);
      }
    }
    return expired;
  }

  /** The rows the evict tier walks (§5.6). Suspended rather than live, which is
   * the whole difference between the two tiers: one reclaims processes from
   * tasks nobody is using, the other reclaims disk from tasks that already have
   * no processes. */
  suspendedTasks(): TaskRow[] {
    return this.store.list({ lifecycle: "suspended" });
  }

  /** Commit a task's working state to its WIP ref, and record it on the row
   * (§5.6).
   *
   * The half of eviction that has to be safe. Removing the checkout is trivial
   * and reversible; what makes it reversible is that this ran first and
   * succeeded, so the evict tier calls it and only proceeds on a snapshot it
   * got back. Nothing here decides *whether* to evict — the grace period, the
   * pin, the manual trigger are all the caller's (TASK-39).
   *
   * Answers `null` when there is nothing to snapshot, or nothing that may
   * safely be overwritten: a task with no checkout of its own runs in the
   * project's directory, where the working state is the user's and not ours to
   * commit; a task whose checkout is already gone has only what a previous
   * snapshot saved; and a task still holding a refused snapshot owes the user a
   * decision that a second snapshot would answer for them. None is a failure,
   * and all are states the caller would otherwise have to test for itself.
   *
   * A git failure throws. The live tree is untouched either way — the snapshot
   * works through a throwaway index — so a caller that treats a throw as "do
   * not evict this one" loses nothing but a turn. */
  async snapshotTaskWip(taskId: string): Promise<WipSnapshot | null> {
    const row = this.store.get(taskId);
    if (!row?.worktree_path || row.worktree_state !== "present") return null;
    // `present` is a claim about a directory, and the directory can be gone —
    // the same distrust `restoreTaskWorktree` reads the column with. Without
    // this the snapshot throws `snapshot-failed` on a task there is nothing to
    // snapshot for, and a caller that reads a throw as "do not evict this one"
    // would keep retrying a checkout that is already off the disk.
    if (!fs.existsSync(row.worktree_path)) return null;
    // A ref already on the row of a *present* checkout is the needs-decision
    // state and nothing else: a snapshot `restoreWorktree` refused to apply,
    // still waiting on apply / keep / discard. A task has one WIP ref, and
    // `snapshotWip` moves it — so snapshotting now would leave the refused
    // commit unreachable and take the user's choice away on their behalf, in
    // the middle of an eviction they never asked for. Null keeps the checkout,
    // since the caller only evicts on a snapshot it got back.
    if (row.wip_ref) return null;

    const snapshot = await snapshotWip({ id: taskId, worktreePath: row.worktree_path });
    // Checked on the far side of the await, like every other write here: a task
    // deleted while git was working would otherwise be resurrected as a row
    // holding two columns. The ref outlives it, which archive's retention sweep
    // is the right place to notice — not a write that recreates the task.
    if (!this.store.get(taskId)) return snapshot;
    this.store.update(taskId, { wip_ref: snapshot.ref, wip_at: snapshot.at });
    this.broadcastTask(taskId);
    return snapshot;
  }

  /** Rebuild a checkout that was evicted or removed behind our back, and put
   * the task's work back in it (§5.6).
   *
   * What opening an evicted task runs before the agent is resumed. Answers
   * `null` when there is nothing to restore — a task that never had a checkout,
   * or one whose checkout is still on disk — so the open path can call it
   * unconditionally rather than reading `worktree_state` itself.
   *
   * **`wip_ref` surviving a restore is what "needs a decision" is spelled as.**
   * On a clean round trip the snapshot is applied and the columns are cleared:
   * the work is on disk, and the next eviction will write a fresh ref anyway.
   * When the branch moved while the task was evicted, `restoreWorktree` refuses
   * to apply it and the columns stay — so `worktree_state = present` with a
   * `wip_ref` still set is, durably and without a new column, the task whose
   * card owes the user an apply / keep / discard. It survives a daemon restart
   * for the same reason, which a flag held in memory would not. */
  async restoreTaskWorktree(taskId: string): Promise<RestoredWorktree | null> {
    const row = this.store.get(taskId);
    if (!row?.branch || row.worktree_state === "none") return null;
    // `present` is a claim about a directory, and a directory can be removed by
    // someone who never told us. Trusting the column would answer "nothing to
    // do" for exactly the task whose terminal is about to open on a path that
    // is not there.
    if (row.worktree_state === "present" && row.worktree_path
        && fs.existsSync(row.worktree_path)) {
      return null;
    }

    const repoRoot = await this.repoRootFor(row);
    if (!repoRoot) {
      // The task was branched from a repository nobody recorded, and the
      // project that knew which one is gone. Its own kind rather than
      // `not-a-repo`, because the two ask for different things: `not-a-repo`
      // means "that directory is not a repository", which the user can fix by
      // pointing at one, while this means "we have lost track of yours" — and
      // the message has to say that the work is not lost with it.
      throw new WorktreeError(
        "repo-unknown",
        `Task "${row.title}" was branched from a repository this task can no longer name — `
          + `its project was removed. Its work is still on branch ${row.branch}.`,
      );
    }
    const project = this.projects.find((p) => p.id === row.project_id);
    const restored = await restoreWorktree(
      {
        root: repoRoot,
        // Read now rather than remembered from the create: a project's copy
        // list is editable, and a restore should produce the checkout the
        // project asks for today. Null once the project is gone, which is
        // right — there is no list to honour.
        worktreeCopy: project?.worktreeCopy ?? null,
      },
      {
        id: taskId,
        branch: row.branch,
        // From the row. A task reassigned to another project would have the
        // id-derived path answer with a different directory from the one it was
        // evicted from, and the restore would rebuild beside the work.
        worktreePath: row.worktree_path ?? worktreePathFor(row.project_id, taskId),
      },
    );
    // Dropped along with the columns that record it, and not left as a spare
    // copy. The work is on disk now, so the ref holds nothing the checkout does
    // not — but it outlives the row's account of it, and `restoreWorktree`
    // reads git rather than the row: the *next* restore of this task, after a
    // directory removed by hand or a daemon that died mid-restore, would find
    // the old ref and apply work the row says was consumed. That undoes, among
    // other things, a `git restore .` the user ran deliberately once the last
    // restore handed it back to them.
    if (restored.wip === "applied") await dropWip(restored.worktreePath, taskId);
    if (!this.store.get(taskId)) return restored;
    this.store.update(taskId, {
      worktree_state: "present",
      worktree_path: restored.worktreePath,
      // The agent runs in its checkout, and a task restored after a `missing`
      // may have been left pointing at a path that no longer existed.
      cwd: restored.worktreePath,
      // Only `stale` keeps them, because only `stale` is a decision anybody
      // owes. `applied` consumed the snapshot; `none` means git had no such ref
      // to begin with — a row still naming one there is a leftover, and leaving
      // it is not harmless: `wip_ref` on a `present` checkout *is* how "owes a
      // decision" is spelled, so the task would show the refused-snapshot
      // notice for a snapshot that does not exist (Apply then failing on the
      // missing ref), and `snapshotTaskWip` refuses a row that already has one
      // — so it could never be evicted again either.
      ...(restored.wip === "stale" ? {} : { wip_ref: null, wip_at: null }),
    });
    this.broadcastTask(taskId);
    return restored;
  }

  /** Hard delete: the row, the terminals, the checkout, the snapshot and the
   * task's directory go for good, and the id can never be reissued. The one
   * irreversible operation in the design (§5.6).
   *
   * The difference from archive is what is *not* kept. Archive keeps the row
   * behind `lifecycle = archived` and keeps the WIP ref for its retention
   * window, so the work is recoverable; this drops both. It is reached from
   * `DELETE /api/tasks/:id` — the CLI's `codetoaster kill`, which meant delete
   * in v1 and has no other route to mean it by — and from the browser only
   * through a confirmation of its own.
   *
   * The branch is the exception, and follows archive's rule rather than this
   * one's: it is deleted only when its commits survive the deletion — merged
   * into `base_ref`, or on a remote. "The user asked to forget this task" is
   * not the same statement as "the user asked to lose these commits", and a ref
   * left behind under `codetoaster/` costs nothing and is one refspec to
   * remove.
   *
   * The row goes **synchronously**, before any of the git. Several writes
   * elsewhere re-read the store on the far side of an await specifically to
   * notice a task deleted underneath them, and doing the cleanup first would
   * widen that window from nothing to however long `git worktree remove` takes.
   * The promise this answers with covers the cleanup, so a caller that cares —
   * a test tearing down a real checkout — can wait for it, and one that does
   * not can drop it: nothing below the row removal is allowed to throw.
   *
   * Null means there was no such task. An outcome means it is gone, and says
   * what became of its branch. */
  async deleteTask(taskId: string): Promise<DeleteOutcome | null> {
    const row = this.store.get(taskId);
    if (!row) return null;
    // Fired rather than awaited: an unlink that fails — a directory already
    // removed by hand, a read-only home — must not be allowed to fail the
    // removal of a task that is otherwise gone. `purge` takes the whole
    // directory below, and this is the one file worth not waiting for.
    void removeSnapshot(taskId).catch(() => {});
    // Before the row goes: a timer that outlived its task would wake up to
    // relabel something that is no longer there.
    this.disarmHookGrace(taskId);
    this.hookSeen.delete(taskId);
    this.compactTriggers.delete(taskId);
    this.cwdCheckedAt.delete(taskId);
    // Normally spent by the first hook. A task deleted before its agent ever
    // reported one never spends it, and without this the map keeps an entry
    // per such task for the life of the daemon.
    this.spawnedAt.delete(taskId);
    for (const ptyId of [...(this.taskPtys.get(taskId) ?? [])]) {
      this.ptys.kill(ptyId);
      this.ptyToTask.delete(ptyId);
    }
    this.taskPtys.delete(taskId);
    this.agentPtys.delete(taskId);
    this.store.delete(taskId);
    for (const project of this.projects) {
      const idx = project.taskIds.indexOf(taskId);
      if (idx !== -1) {
        project.taskIds.splice(idx, 1);
        break;
      }
    }
    return await this.purge(row);
  }

  /** Everything a deleted task leaves on disk, taken with it (TASK-64): the
   * checkout under `~/.codetoaster/worktrees/`, git's registration of it, the
   * `codetoaster/<slug>` branch when its commits survive elsewhere, the WIP ref,
   * and `~/.codetoaster/tasks/<id>/`. Without this, `codetoaster kill` on a task
   * with a worktree stranded all five, and nothing would ever name them again.
   *
   * Takes the row it was handed rather than reading one, because the row is
   * already gone by the time this runs — which is also why it resolves the
   * repository through `resolveRepoRoot`, the variant that does not write its
   * answer back.
   *
   * Never throws. It runs after the task has been removed from every list a
   * caller can see, so there is nobody left to report a failure to and nothing
   * a failure could be retried against; what is left is a warning and some
   * files. */
  private async purge(row: TaskRow): Promise<DeleteOutcome> {
    const outcome: DeleteOutcome = { branch: row.branch, branchDeleted: false, branchKept: null };
    try {
      const repoRoot = row.worktree_state === "none" ? null : await this.resolveRepoRoot(row);
      if (repoRoot) {
        if (row.worktree_path) await evictWorktree(repoRoot, row.worktree_path);
        if (row.branch) {
          const status = await branchStatus(repoRoot, {
            branch: row.branch,
            baseRef: row.base_ref,
            // The checkout is gone by now, and `dirty` is not a question this
            // path asks: nothing here is shown to a user, and the only thing
            // being decided is whether the branch's commits exist elsewhere.
            worktreePath: null,
          });
          if (!status.exists) {
            outcome.branch = null;
          } else if (branchIsExpendable(status)) {
            outcome.branchDeleted = await deleteBranch(repoRoot, row.branch);
            if (!outcome.branchDeleted) outcome.branchKept = `git would not delete ${row.branch}`;
          } else {
            outcome.branchKept = keptReason(row.branch, row.base_ref, status);
          }
        }
        // After the branch, not before: the ref is the last thing keeping the
        // snapshot's objects reachable, and a delete that failed part-way is
        // better off having kept it.
        if (row.wip_ref) await dropWip(repoRoot, row.id);
      }
    } catch (e) {
      console.warn(`Could not clean up after deleting task ${row.id}:`, e);
    }
    await removeTaskDir(row.id);
    return outcome;
  }

  acknowledgeTask(taskId: string): void {
    let acknowledged = false;
    for (const ptyId of this.taskPtys.get(taskId) ?? []) {
      const pty = this.ptys.get(ptyId);
      if (pty?.hasNotification) {
        pty.acknowledge();
        acknowledged = true;
      }
    }
    if (acknowledged) this.broadcastTask(taskId);
  }

  // ------------------------------------------------------------- attachment

  attachClient(
    ptyId: string,
    clientId: string,
    ws: ServerWebSocket<WebSocketData>,
    cols?: number,
    rows?: number,
  ): Pty | undefined {
    if (!this.ptys.has(ptyId)) return undefined;
    // Sent *before* the attach, and therefore before the PTY's `restore`: it
    // is what tells the client which terminal the traffic that follows belongs
    // to. A client filters terminal messages against the PTY it is showing, so
    // learning the pairing afterwards would mean dropping its own restore. The
    // task id has to come from here — a Pty has no notion of one.
    const taskId = this.ptyToTask.get(ptyId);
    ws.send(JSON.stringify({ type: "attached", ptyId, taskId: taskId ?? ptyId }));

    // Opening a task's terminal is the moment before its Changes, Files and
    // History tabs get used, and it is the only such moment the browser
    // reaches — GET /api/tasks is CLI-only. Without this, a task created in a
    // directory the agent then cd'd out of would keep answering those tabs
    // from the root it had at creation, or 400 them forever if it had none.
    // Fire-and-forget: it broadcasts a delta if anything moved, and a failure
    // to notice is not a reason to refuse the attach.
    if (taskId) void this.refreshCwdIfStale(taskId).catch(() => {});

    const pty = this.ptys.attach(ptyId, clientId, ws, cols, rows);
    // Who else is looking at this task, and at what size, both ride on
    // TaskInfo and both change here — but nothing else about the task does, so
    // without this the count only reaches other clients when an unrelated
    // delta happens to come along. Multi-client is the point of the product
    // (§5.4); a stale audience is worse than none shown.
    if (pty && taskId) this.broadcastTask(taskId);
    return pty;
  }

  /** Detach one terminal, or every one the client holds when omitted (the
   * socket closed). */
  detachClient(clientId: string, ptyId?: string): void {
    // Same reasoning as attachClient, over however many terminals went at
    // once. Deduped by task: a client holding a task's agent tab and two of
    // its shells is one row's worth of change, not three.
    const detached = this.ptys.detach(clientId, ptyId);
    const taskIds = new Set<string>();
    for (const id of detached) {
      const taskId = this.ptyToTask.get(id);
      if (taskId) taskIds.add(taskId);
    }
    for (const taskId of taskIds) this.broadcastTask(taskId);
  }

  /** False when the client is not attached to the terminal it named —
   * attachment is the authorization, so the caller can report it rather than
   * dropping the keystroke silently. */
  writeToPty(clientId: string, ptyId: string, data: string): boolean {
    return this.ptys.write(clientId, ptyId, data);
  }

  /** False on the same unattached-client check as writeToPty. A stale resize
   * is not worth an error reply — a client that just detached will re-measure
   * on its next attach — but the answer is the layer below's to give, not this
   * one's to swallow. */
  resizePty(clientId: string, ptyId: string, cols: number | null, rows: number | null): boolean {
    const before = this.ptys.get(ptyId)?.getSize();
    if (!this.ptys.resize(clientId, ptyId, cols, rows)) return false;
    // The other half of what attachClient broadcasts. Smallest-wins means one
    // client's window is every client's grid, and the grid rides on TaskInfo —
    // so without this the status bar of every *other* viewer goes on naming a
    // size their terminal has already stopped being.
    //
    // Narrow on purpose: only the terminal TaskInfo actually reports (a shell
    // tab's grid is not the task's), and only when the negotiated size moved.
    // A drag is a burst of resize messages and almost none of them renegotiate
    // anything.
    const after = this.ptys.get(ptyId)?.getSize();
    const taskId = this.ptyToTask.get(ptyId);
    if (
      taskId &&
      before &&
      after &&
      (before.cols !== after.cols || before.rows !== after.rows) &&
      this.primaryPty(taskId)?.id === ptyId
    ) {
      this.broadcastTask(taskId);
    }
    return true;
  }

  getClientPtyIds(clientId: string): string[] {
    return this.ptys.clientPtyIds(clientId);
  }

  getConnections(): Array<{ clientId: string; ptyIds: string[] }> {
    return [...this.connectedClients.keys()].map((clientId) => ({
      clientId,
      ptyIds: this.getClientPtyIds(clientId),
    }));
  }

  // -------------------------------------------------------------- rendering

  taskInfo(taskId: string): TaskInfo | undefined {
    const row = this.store.get(taskId);
    if (!row) return undefined;
    const pty = this.primaryPty(taskId);
    return {
      id: row.id,
      projectId: row.project_id,
      ptyId: pty?.id ?? null,
      shellPtyIds: this.shellPtys(taskId).map((shell) => shell.id),
      title: row.title,
      titleSource: row.title_source,
      terminalTitle: pty?.title ?? "",
      agentState: row.agent_state,
      lifecycle: row.lifecycle,
      worktreeState: row.worktree_state,
      // Null until measured, which a client must not read as "nothing to
      // report" — see `TaskWorktreeInfo`. The map is only ever written for a
      // task that has a checkout, so a task running in the project's own
      // directory answers null forever, correctly.
      worktree: this.worktreeStatus.get(taskId) ?? null,
      // The two columns are the state; there is no third thing to consult.
      // `worktree_state` alone would be true of an *evicted* task, whose ref is
      // the ordinary way it is stored rather than a decision anyone owes.
      //
      // Except mid-eviction, and mid-archive. `doEvict` and `doArchive` both
      // write the ref and broadcast before they remove the checkout, so for the
      // length of a `worktree remove` the row reads exactly like a refused
      // snapshot — and every attached client would draw a notice for a question
      // nobody is being asked, whose buttons `pendingWip` then refuses. Held
      // back rather than answered, so the two agree about what is outstanding.
      wipPending:
        row.worktree_state === "present"
        && row.wip_ref !== null
        && !this.evicting.has(row.id)
        && !this.archiving.has(row.id),
      lastMessage: row.last_message,
      clientCount: pty?.getClientCount() ?? 0,
      // A suspended task remembers the grid it had, so resuming it does not
      // reflow the agent's output (§5.3).
      size: pty?.getSize() ?? {
        cols: row.last_size_cols ?? DEFAULT_SIZE.cols,
        rows: row.last_size_rows ?? DEFAULT_SIZE.rows,
      },
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
      exited: pty?.exited ?? false,
      hasNotification: pty?.hasNotification ?? false,
    };
  }

  /**
   * Everything a user can still get back to, most recently active first: live
   * and suspended. A suspended task is not gone (§6) — it is one click from
   * being live again — so leaving it out would be the sidebar telling the user
   * their work had been deleted, which is the one thing suspension exists not
   * to do. Archived tasks stay out: those really have left (TASK-31).
   *
   * From the rows, not from `projects[].taskIds`. The in-memory grouping only
   * ever holds what it has been told to hold, so every path that makes a task
   * listable had to remember to call `ensureInProject` first — boot adoption
   * and the resume ladder both carry a comment explaining that they are doing
   * it for this reason, and a fourth such path would simply have been invisible
   * with nothing to say it was. The rows are the tasks; the grouping is one
   * view of them, and §7.5 demotes it to a toggle over a recency list anyway.
   *
   * That recency ordering is `store.list`'s own `last_active_at DESC`, which is
   * the order the sidebar wants and the order project grouping never gave it.
   */
  listTasks(): TaskInfo[] {
    const result: TaskInfo[] = [];
    for (const row of this.store.list({ lifecycle: ["live", "suspended"] })) {
      const info = this.taskInfo(row.id);
      if (info) result.push(info);
    }
    return result;
  }

  /** The titles a new task's derived name has to be unique against. Suspended
   * ones count: two tasks in the same directory derive the same "<dir> ·
   * <branch>" label, and a user who cannot tell the new one from the one they
   * suspended an hour ago is no better off than if both were live. */
  private taskTitles(): string[] {
    return this.listTasks().map((task) => task.title);
  }

  // --------------------------------------------------------------- projects

  hasProject(projectId: string): boolean {
    return this.projects.some((p) => p.id === projectId);
  }

  getProjects(): ProjectInfo[] {
    return this.projects.map((p) => ({ ...p, taskIds: [...p.taskIds] }));
  }

  private resolveProjectId(options: CreateTaskOptions): string {
    if (options.afterTaskId) {
      const after = this.projects.find((p) => p.taskIds.includes(options.afterTaskId!));
      if (after && (!options.projectId || options.projectId === after.id)) return after.id;
    }
    if (options.projectId && this.projects.some((p) => p.id === options.projectId)) {
      return options.projectId;
    }
    return "general";
  }

  /** Put a task into the sidebar grouping if it is not there already, by the
   * project its row names. What a task created by a previous daemon needs
   * before it can appear in `listTasks` at all — `loadProjects` starts every
   * project empty, since the ordering is the only thing the rows do not
   * record. */
  private ensureInProject(taskId: string): void {
    if (this.projects.some((p) => p.taskIds.includes(taskId))) return;
    const projectId = this.store.get(taskId)?.project_id;
    const project =
      this.projects.find((p) => p.id === projectId) ??
      this.projects.find((p) => p.id === "general");
    project?.taskIds.push(taskId);
  }

  /** `projectId` is the one already written to the row, not a fresh
   * resolution: the two must not be able to disagree. Falls back to General if
   * the project was deleted while the create was awaiting, which is the same
   * place `deleteProject` would have moved the task to anyway. */
  private placeInProject(taskId: string, projectId: string, options: CreateTaskOptions): void {
    const project =
      this.projects.find((p) => p.id === projectId) ??
      this.projects.find((p) => p.id === "general");
    if (!project) return;
    const afterIndex = options.afterTaskId ? project.taskIds.indexOf(options.afterTaskId) : -1;
    if (afterIndex >= 0) {
      project.taskIds.splice(afterIndex + 1, 0, taskId);
    } else {
      project.taskIds.push(taskId);
    }
  }

  createProject(id: string, name: string, initialPath: string): void {
    if (this.projects.some((p) => p.id === id)) {
      throw new Error(`Project "${id}" already exists`);
    }
    db.createProject({ id, name, initial_path: initialPath, sort_order: this.projects.length }, this.db);
    // No defaults yet: `createProject` writes the identity columns only, so a
    // fresh project resolves to whatever the caller asks for until something
    // sets them.
    this.projects.push({ id, name, initialPath, taskIds: [], ...UNSET_PROJECT_SETTINGS });
    this.broadcastTasks();
  }

  /** Rename a project, move it, and set what it decides for its tasks.
   *
   * `settings` is a patch and an absent field keeps what the project has —
   * the rename dialog sends none of them, and must not clear a setup command
   * it never showed the user. An explicit `null` (or a cleared text field,
   * which normalizes to one) is how a setting is unset. */
  updateProject(
    id: string,
    name: string,
    initialPath: string,
    settings?: Partial<ProjectSettings>,
  ): boolean {
    const project = this.projects.find((p) => p.id === id);
    if (!project) return false;
    const patch = settings ? normalizeSettingsPatch(settings) : {};
    db.updateProject(
      id,
      { name, initial_path: initialPath, ...settingsColumns(patch) },
      this.db,
    );
    project.name = name;
    project.initialPath = initialPath;
    Object.assign(project, patch);
    this.broadcastTasks();
    return true;
  }

  deleteProject(id: string): boolean {
    if (id === "general") return false;
    const index = this.projects.findIndex((p) => p.id === id);
    if (index === -1) return false;
    const project = this.projects[index]!;
    const general = this.projects.find((p) => p.id === "general")!;
    // Every checkout of this project gets told where its repository is, before
    // the project that knows stops existing (TASK-64). This is the moment a
    // task is stranded: the reassignment below moves it to General, whose path
    // is empty, and from then on nothing can name the repository its branch and
    // its snapshot live in — so it can neither be reopened nor evicted, and the
    // directory is pinned on disk forever.
    //
    // The project's own directory rather than a resolved toplevel, which is
    // what lets this stay synchronous: the column is documented as *a*
    // directory inside the repository, and `git -C` asks for no more than that.
    // Only rows that have none are touched, so a task that recorded its own at
    // create keeps it — that one is the truth about where the worktree was
    // actually added, and this is a fallback.
    const projectPath = project.initialPath ? expandTilde(project.initialPath) : null;
    if (projectPath) {
      for (const task of this.store.list()) {
        if (task.project_id !== id || task.worktree_repo || task.worktree_state === "none") continue;
        this.store.update(task.id, { worktree_repo: projectPath });
      }
    }
    // The tasks outlive the grouping: they move to General rather than being
    // destroyed with it. By column, not by `project.taskIds` — that list only
    // holds the tasks this run started, so a task suspended by a previous
    // daemon would keep a project_id pointing at a project that no longer
    // exists, and nothing else ever revisits the column.
    this.store.reassignProject(id, "general");
    general.taskIds.push(...project.taskIds);
    this.projects.splice(index, 1);
    db.deleteProject(id, this.db);
    this.broadcastTasks();
    return true;
  }

  reorderProjects(orderedProjects: Array<{ id: string; taskIds: string[] }>): void {
    const validTaskIds = new Set(this.projects.flatMap((p) => p.taskIds));
    const existing = new Map(this.projects.map((p) => [p.id, p]));
    const seenProjects = new Set<string>();
    const seenTasks = new Set<string>();
    const next: ProjectInfo[] = [];

    for (const { id, taskIds } of orderedProjects) {
      const project = existing.get(id);
      if (!project || seenProjects.has(id)) continue;
      seenProjects.add(id);

      const kept: string[] = [];
      for (const taskId of taskIds) {
        if (validTaskIds.has(taskId) && !seenTasks.has(taskId)) {
          kept.push(taskId);
          seenTasks.add(taskId);
        }
      }
      next.push({ ...project, taskIds: kept });
    }

    // Append projects the client did not mention, keeping whatever they held.
    for (const project of this.projects) {
      if (seenProjects.has(project.id)) continue;
      const kept = project.taskIds.filter((id) => validTaskIds.has(id) && !seenTasks.has(id));
      for (const id of kept) seenTasks.add(id);
      next.push({ ...project, taskIds: kept });
      seenProjects.add(project.id);
    }

    // Anything the reorder dropped on the floor lands in General rather than
    // vanishing from the sidebar while its process keeps running.
    const general = next.find((p) => p.id === "general")!;
    for (const taskId of validTaskIds) {
      if (!seenTasks.has(taskId)) general.taskIds.push(taskId);
    }

    this.projects = next;
    // The in-memory order is the v1 sidebar's, but which project a task
    // belongs to is durable — so rows that actually moved get written, and
    // the ones that only shifted position do not.
    for (const project of next) {
      for (const taskId of project.taskIds) {
        if (this.store.get(taskId)?.project_id !== project.id) {
          this.store.update(taskId, { project_id: project.id });
        }
      }
    }
    db.updateProjectOrder(next.map((p, i) => ({ id: p.id, sort_order: i })), this.db);
    this.broadcastTasks();
  }
}

export const taskManager = new TaskManager();
