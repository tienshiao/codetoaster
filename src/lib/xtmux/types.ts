import type { ServerWebSocket } from "bun";
import type { AgentState, Lifecycle, TitleSource } from "../db";

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
  | { type: "tasks"; list: TaskInfo[]; projects: ProjectInfo[] }
  // One row changed. A delta rather than a fresh snapshot, so a busy agent
  // does not re-send every task on every state transition.
  | { type: "task"; task: TaskInfo }
  | { type: "activity"; taskId: string; active: boolean }
  | { type: "notification"; taskId: string; title: string; body: string };

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
