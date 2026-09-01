import type { ServerWebSocket } from "bun";
import type { AgentState, Lifecycle, TitleSource, WorktreeState } from "../db";
import type { BranchStatus } from "../worktree/status";

/** What a project decides on behalf of the tasks started in it.
 *
 * All of it is on the wire so the composer can *show* what "Project default"
 * will resolve to before anything is submitted. The resolution itself stays
 * the server's, in `createTask`, so the HTTP API and the CLI inherit it
 * without having to ask — the client sends only what the user actually
 * overrode.
 *
 * `null` is a real value here and means unset: it hands the choice back to
 * whatever Claude Code or git would have done anyway, which is why none of
 * these carry a default. An empty string is not a way of saying it — the
 * writer turns one back into `null` — because a project storing `""` as its
 * model would put an empty `--model` on the agent's argv. */
export interface ProjectSettings {
  defaultModel: string | null;
  defaultPermissionMode: string | null;
  /** What a new worktree branches from. Null means the project's HEAD, which
   * is what `git worktree add` does when told nothing. */
  defaultBaseRef: string | null;
  /** Run after a worktree is created, in the agent's own terminal (§5.6). */
  setupCommand: string | null;
  /** Ignored-but-needed files to copy into a new worktree, one per line — the
   * `.env` that `git add -A` will not carry through a WIP snapshot. */
  worktreeCopy: string | null;
  /** Whether the composer's worktree toggle starts on. A boolean here and an
   * INTEGER in SQLite, converted at the projection rather than left for every
   * reader to remember. */
  worktreeDefault: boolean;
}

export interface ProjectInfo extends ProjectSettings {
  id: string;
  name: string;
  initialPath: string;
  /** Ordered by hand, not by recency: this is the v1 sidebar's grouping, which
   * TASK-25 replaces with the recency list §7.5 describes. */
  taskIds: string[];
}

// Client -> Server messages
//
// Terminal traffic is addressed by ptyId, the id of the pseudo-terminal it
// belongs to. One client can hold several PTYs open at once (one per terminal
// tab), and never shows the same PTY twice — so clientId stays unique within a
// PTY's client map and no separate view id is needed, which is what makes
// `${clientId}:${ptyId}` a sufficient connection address
// (docs/v2-architecture.md §5.3).
//
// A task is addressed by taskId and its terminals by ptyId: the task is the
// durable thing, and it survives the process that runs it.
// Creating and renaming a task are not here: they run git, spawn processes and
// fail in ways that want a status code and a body, so they are HTTP
// (POST /api/tasks, PATCH /api/tasks/:id — §5.3). The socket carries terminal
// traffic and the push channel.
export type ClientMessage =
  | { type: "attach"; ptyId: string; cols?: number; rows?: number }
  // Without a ptyId, detaches the client from every PTY it holds.
  | { type: "detach"; ptyId?: string }
  | { type: "input"; ptyId: string; data: string }
  // null cols/rows mean "this client is no longer measuring this PTY" — a
  // terminal in a hidden tab, which must keep receiving output without
  // constraining smallest-wins negotiation with its stale layout.
  | { type: "resize"; ptyId: string; cols: number | null; rows: number | null }
  | { type: "list" }
  // Addressed by task, not by PTY: these are things done to the work, and a
  // task owns however many terminals it has open.
  | { type: "kill"; taskId: string }
  | { type: "acknowledge"; taskId: string }
  | { type: "reorder"; projects: Array<{ id: string; taskIds: string[] }> }
  | { type: "createProject"; id: string; name: string; initialPath: string }
  | {
      type: "updateProject";
      id: string;
      name: string;
      initialPath: string;
      /** A patch, not a replacement: a field left out keeps what the project
       * has. The rename dialog sends none of these and must not silently
       * clear a setup command it never showed the user. */
      settings?: Partial<ProjectSettings>;
    }
  | { type: "deleteProject"; id: string };

// Server -> Client messages
export type ServerMessage =
  // Carries the task as well as the terminal: it is what tells a client which
  // task it is now looking at, and a client cannot map ptyId to taskId until
  // the list arrives — which is after this.
  | { type: "attached"; ptyId: string; taskId: string }
  | { type: "restore"; ptyId: string; data: string; size: { cols: number; rows: number }; cursor: { x: number; y: number }; cursorHidden: boolean; mouseEncoding: string }
  | { type: "data"; ptyId: string; data: string }
  | { type: "resize"; ptyId: string; cols: number; rows: number }
  | { type: "exit"; ptyId: string; code: number }
  // Addressed to the PTY that provoked it wherever there is one: `attach` and
  // `input` both name a ptyId, and their refusals ("Terminal … not found",
  // "Not attached to terminal …") are the only explanation the grid that
  // asked is going to get. A client showing several terminals cannot place an
  // unaddressed one — painting it into all of them is wrong and dropping it
  // leaves a dead terminal with no reason given — so ptyId is absent only for
  // failures that really are client-wide (bad JSON, an unknown type, a task or
  // project that does not exist).
  | { type: "error"; message: string; ptyId?: string }
  // The whole list, sent on connect and whenever the shape of it changes.
  //
  // `unclaimed` rides the snapshot rather than a message of its own because it
  // changes for the same reasons the list does — the boot sweep runs, or the
  // user deletes one — and it is never large.
  //
  // Always sent, and empty means "none found so far" rather than "not looked
  // yet". The two are worth conflating here and nowhere else: before the sweep
  // has run we have no evidence of an unclaimed checkout, and a band warning
  // about work we have not found would be worse than the moment of silence.
  // Optional only so an older client is not a parse error.
  // `home` rides the snapshot as the per-server constant it is, so a client can
  // write a path the way a shell would — `~/projects/thing`, not
  // `/Users/someone/projects/thing`. Once per snapshot rather than once per
  // task, and absent from the `task` delta below for the same reason: it cannot
  // change while the daemon is up.
  | {
      type: "tasks";
      list: TaskInfo[];
      projects: ProjectInfo[];
      unclaimed?: UnclaimedInfo[];
      home?: string;
    }
  // One row changed. A delta rather than a fresh snapshot, so a busy agent
  // does not re-send every task on every state transition.
  | { type: "task"; task: TaskInfo }
  | { type: "activity"; taskId: string; active: boolean }
  | { type: "notification"; taskId: string; title: string; body: string };

/** A checkout on disk that no task accounts for (§5.6, TASK-32).
 *
 * Not a task and deliberately not shaped like one: it has no id, no lifecycle
 * and nothing to open — the only thing that can be done with one is delete it,
 * and the path is what identifies it. Sent so the sidebar can offer that,
 * because a dirty orphan is the one thing the boot sweep will not clear up on
 * its own. */
export interface UnclaimedInfo {
  path: string;
  branch: string | null;
  /** Files `git status --porcelain` reports. `null` means the sweep could not
   * establish it — a directory git did not recognise — which is *why* it was
   * left alone, and the card has to say that rather than show "0". */
  dirty: number | null;
}

/** The git facts a task's card shows about its checkout (§5.6, TASK-32).
 *
 * Optional on the wire and null until computed, which is the whole of AC #5's
 * "without blocking render": these cost a handful of git processes per task, so
 * a row draws with whatever it has and fills in when the answer arrives. A
 * client must therefore treat absent and "nothing to report" as different —
 * absent is "not measured yet". */
export interface TaskWorktreeInfo {
  branch: string | null;
  /** Uncommitted files in the checkout, `null` when not established. */
  dirty: number | null;
  /** Commits the branch would take with it: on neither the base ref nor a
   * remote. */
  unpushed: number;
  /** The branch's work is already contained in the base ref — the 'archive?'
   * nudge (§5.6).
   *
   * Narrower than git's own "is an ancestor of", which is reflexive and so is
   * true of a branch that has never moved off the commit it was cut from. A
   * task that has done nothing is not a task to archive, so a branch still
   * standing on its base answers false here. */
  merged: boolean;
}

export interface TaskInfo {
  id: string;
  /** The project the task belongs to, straight off its row. Carried on the
   * task rather than left to be looked up in `ProjectInfo.taskIds`, because the
   * list is ordered by recency across projects now (§7.5) and grouping is a
   * toggle over it — so the client needs to know a task's project without the
   * grouping being what produced the list. */
  projectId: string;
  /** The terminal to attach to, or null once the task has no live process.
   * Kept separate from `id` because a resumed task gets a fresh PTY while
   * staying the same task. */
  ptyId: string | null;
  /** The task's shell terminals (§3), in the order they were opened, and empty
   * for a task with no live process at all.
   *
   * On the wire because a tab layout outlives the processes it names: it is
   * persisted per device and restored on load, while shell PTYs die with a
   * harvest, a close or a daemon restart. This is the positive statement a
   * client reconciles a restored layout against — see `pruneShellTabs`, which
   * is careful to act on a PTY being *known* dead rather than merely absent. */
  shellPtyIds: string[];
  /** The task's stable label — what §5.1 stores as `title`. */
  title: string;
  titleSource: TitleSource;
  /** What the program inside is currently calling itself (OSC 0/2). Live, and
   * projected over `title` at render time; see naming.ts. */
  terminalTitle: string;
  agentState: AgentState;
  lifecycle: Lifecycle;
  /** Where the task's checkout stands (§5.6). `none` for a task running in the
   * project's own directory; the other three are about a worktree we made.
   *
   * On the wire because a reopen looks different depending on it: an `evicted`
   * task has a directory to rebuild before its agent can start, which is
   * seconds of work the user should be told is happening rather than left
   * wondering at. */
  worktreeState: WorktreeState;
  /** Whether this task's checkout owes the user a decision about a snapshot
   * (§5.6).
   *
   * True only for a *present* checkout that still has a WIP ref: the two
   * together mean a restore refused to apply the snapshot because the branch
   * had moved under it, and kept it rather than overwriting the newer commit.
   * An applied snapshot clears both, so the pair is the whole state — no flag
   * in memory, and it reads the same after a daemon restart. */
  wipPending: boolean;
  /** The checkout's git facts, or null until they have been measured. Only ever
   * set for a task that has a checkout of its own — a task running in the
   * project's directory has no branch of ours to report on. */
  worktree: TaskWorktreeInfo | null;
  /** Where the task's terminal actually is (§5.4).
   *
   * Straight off the row, which `refreshCwd` writes back when it notices the
   * agent has cd'd somewhere else — and which broadcasts a `task` delta when it
   * does, so this stays true without the client asking. On the wire and not
   * only bolted onto the `GET /api/tasks` response, because the socket snapshot
   * is what the UI renders from and chrome that is always on screen cannot go
   * and fetch it. */
  cwd: string;
  /** The checkout this task was given, or null for one running in the project's
   * own directory (§5.6). Remembered across an eviction, so it is where the
   * checkout *was* as much as where it is.
   *
   * On the wire so a client can tell `cwd` apart from a generated location: a
   * worktree path is `~/.codetoaster/worktrees/<project>/<uuid>`, which is not
   * information — the branch beside it says everything that path would. What is
   * worth saying is when the two disagree, because that is an agent that has
   * cd'd out of its own checkout (§5.4). */
  worktreePath: string | null;
  /** The branch the task's checkout is on, or null for a task with no checkout
   * of its own.
   *
   * Off the row, and deliberately *not* read out of `worktree` below. That is a
   * measurement, and the server only measures a checkout that is on disk — so
   * an evicted task, or one whose first measurement has not landed yet, has a
   * branch in the database and `worktree: null` on the wire. A client reading
   * the branch off the measurement conflates "no branch" with "not measured",
   * which is the one thing `TaskWorktreeInfo` says not to do. */
  branch: string | null;
  /** The last thing the agent said, from the Stop hook. The task list shows it
   * under the title, which is how a list of thirty answers "which of these
   * want me?" without opening any of them (§7.5). Null until the agent has
   * finished a turn. */
  lastMessage: string | null;
  clientCount: number;
  size: { cols: number; rows: number };
  createdAt: number;
  lastActiveAt: number;
  exited: boolean;
  hasNotification: boolean;
}

/** What archiving a task would cost, asked without answering it (§5.6).
 *
 * Its own request — `GET /api/tasks/:id/archive` — and not a field on the task
 * list, because it runs git against a working tree: paying for that on every
 * row in the sidebar to answer a question about the one under the pointer is
 * not a trade the list can make. The confirmation reads it so it can state what
 * will be lost rather than hedge.
 *
 * Every field of `status` is separately unknowable and every one of them fails
 * closed — a git that did not exit 0 answers "we could not establish this",
 * never "it is safe" — so a dialog drawing these must draw only what is known,
 * the same rule `TaskWorktreeInfo` puts on the row.
 */
export interface ArchivePreview {
  /** Null for a task that never had a checkout of its own — it ran in the
   * project's directory, where nothing is ours to describe or to delete. */
  status: BranchStatus | null;
  branch: string | null;
  /** Whether the branch would be deleted, on what is true right now. */
  branchWouldBeDeleted: boolean;
  /** How long the snapshot archiving writes will be kept, in whole days.
   *
   * Sent rather than known: the confirmation's promise is that this is
   * recoverable *for a while*, and a client printing its own idea of how long
   * would go on printing it after the server's retention changed. The number
   * has to come from whatever will actually do the expiring. */
  wipRetentionDays: number;
}

/** What an archive found, and what it did about it (§5.6).
 *
 * Read *before* anything was destroyed, which is the point: the confirmation
 * quotes these numbers from a preview taken moments earlier, and a user who
 * came back to their laptop an hour later deserves to be told what was actually
 * true when the button took effect rather than when it was drawn. */
export interface ArchiveOutcome {
  status: BranchStatus | null;
  branch: string | null;
  branchDeleted: boolean;
  /** Why the branch is still there, in a sentence the dialog can print. Null
   * when there was no branch, or when it was deleted. */
  branchKept: string | null;
  /** Where the work went, kept for the retention window. */
  wipRef: string | null;
}

/** `POST /api/tasks/:id/archive`'s answer.
 *
 * The outcome is spread in only when there was one: `archived: false` is a
 * second click on a dialog two browsers were both showing, and inventing an
 * outcome for it would report a branch deletion this request did not make. So
 * every field of `ArchiveOutcome` is optional here, and `archived` is what says
 * whether to read them. */
export interface ArchiveResponse extends Partial<ArchiveOutcome> {
  archived: boolean;
  /** Absent only if the row went between the archive and the render of it. */
  task?: TaskInfo;
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

/** `POST /api/tasks/:id/delete`'s answer. Unlike archive there is no "already
 * done" case to distinguish: an unknown id is a 404, so a 200 means this
 * request is the one that deleted it. */
export interface DeleteResponse extends DeleteOutcome {
  deleted: true;
}

export interface ClientInfo {
  id: string;
  ws: ServerWebSocket<WebSocketData>;
  // null until the client has measured its terminal against a visible
  // container; sizeless clients don't constrain smallest-wins negotiation
  size: { cols: number; rows: number } | null;
}

export interface WebSocketData {
  clientId: string;
}
