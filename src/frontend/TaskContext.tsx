import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { sessionDisplayNames } from "../lib/xtmux/naming";
import { playNotificationSound } from "./hooks/use-notification-sound";
import { usePty } from "./PtyContext";
import { retainLayouts } from "./layout-store";
import { retainTaskViewStates } from "./view-state-store";
import { generateUUID } from "./utils/uuid";
import type { TaskState } from "./components/v2/StatusDot";
import type { ProjectInfo, ProjectSettings, TaskInfo } from "../lib/xtmux/types";

/**
 * The task store (§7.4): the list, the projects, and per-task liveness, fed by
 * the socket and mutated over HTTP.
 *
 * The split is the point. Anything that creates a task runs git, spawns a
 * process and fails in ways that want a status code and a body, so it is HTTP;
 * the socket carries the push channel that says what changed. This context is
 * the client half of both.
 *
 * It is also where the socket's side effects live — the notification sound, the
 * desktop notification, the `acknowledge` that answers one. They were held out
 * of here while v1's `SessionContext` adapter subscribed to the same socket, as
 * each would have fired twice, once per subscriber. With the adapter gone there
 * is one subscriber again, and this is the only thing that sees every frame — which is what a notification needs, since the tasks worth ringing
 * about are precisely the ones with no pane mounted.
 */

export interface TaskMutationError {
  status: number;
  message: string;
}

/** Mutations answer rather than throw: every caller would otherwise need a
 * try/catch to do the thing it was going to do anyway. */
export type TaskResult<T> = { ok: true; value: T } | { ok: false; error: TaskMutationError };

export interface CreateTaskOptions {
  prompt?: string;
  projectId?: string;
  cwd?: string;
  model?: string;
  permissionMode?: string;
  /** Give the task a checkout of its own (§5.6). Left out to mean "whatever
   * the project says", the same way an absent model does — the server owns
   * that resolution so the HTTP API and the CLI inherit it. */
  worktree?: boolean;
  /** What that checkout branches from. Left out for the project's default. */
  baseRef?: string;
  cols?: number;
  rows?: number;
}

export interface ResumeTaskOptions {
  /** Start a new conversation rather than reopening the stored one (§4.3). */
  fresh?: boolean;
  /** The grid the reopened agent should be spawned at. Sent because the PTY is
   * minted before any client has attached to it, so this is the only size the
   * server has to go on — and a task that comes back at 80×24 and reflows on
   * the first attach reflows the snapshot the user came back to read. */
  cols?: number;
  rows?: number;
}

export interface TaskContextValue {
  tasks: TaskInfo[];
  projects: ProjectInfo[];
  /** False before the first snapshot and again after a drop, so the UI can
   * tell "no tasks" from "not told yet" — they look identical and mean
   * opposite things. */
  loaded: boolean;
  isConnected: boolean;
  /** Debounced liveness per task id, straight from the socket's `activity`. */
  activity: Record<string, boolean>;
  taskById: (id: string) => TaskInfo | undefined;
  /** `request` reports the failure as a toast unless the caller passes
   * `{ inline: true }` to say it is showing the message itself. */
  createTask: (
    options?: CreateTaskOptions,
    reporting?: RequestOptions,
  ) => Promise<TaskResult<TaskInfo>>;
  renameTask: (id: string, title: string) => Promise<TaskResult<TaskInfo>>;
  closeTask: (id: string) => Promise<TaskResult<TaskInfo>>;
  /** Takes `{ inline: true }` for the same reason `createTask` does: the reopen
   * overlay renders the reason itself. */
  resumeTask: (
    id: string,
    options?: ResumeTaskOptions,
    reporting?: RequestOptions,
  ) => Promise<TaskResult<TaskInfo>>;
  /** Open a plain shell inside a task, as a sibling of its agent (§3). Answers
   * with the new PTY's id and the task it now belongs to — the task because it
   * carries `shellPtyIds`, so the caller has the tab and the proof that its PTY
   * is live from the same reply rather than from two transports. */
  openShell: (id: string) => Promise<TaskResult<{ ptyId: string; task: TaskInfo }>>;
  /** Kill one of a task's shells — what closing a shell tab means. Never the
   * agent's terminal, which the server refuses. */
  closeShell: (id: string, ptyId: string) => Promise<TaskResult<{ task: TaskInfo }>>;
  /** Tell the store which task is on screen, so a notification for it is
   * acknowledged rather than rung. Null when no task is selected. */
  setViewedTask: (id: string | null) => void;
  /**
   * Projects are the exception to the HTTP rule above: they touch a table and
   * nothing else — no git, no processes — so they stay on the socket, where
   * they already are (`ClientMessage`). Neither answers, because the server
   * re-broadcasts the whole list when either lands; `createProject` returns the
   * id it minted so the caller can select what it just made.
   */
  createProject: (name: string, initialPath: string) => string;
  /** `settings` is a patch — an absent field keeps what the project has. */
  updateProject: (
    id: string,
    name: string,
    initialPath: string,
    settings?: Partial<ProjectSettings>,
  ) => void;
  deleteProject: (id: string) => void;
}

const TaskContext = createContext<TaskContextValue | null>(null);

/**
 * The dot a task shows in the list.
 *
 * The server's `AgentState` is finer-grained than the dot deliberately: the
 * design gives colour exactly five meanings, so `starting` and `compacting`
 * both read as working, and `unknown` — no hook has ever reported — reads as
 * idle rather than as a fault, because it usually is one. `could_not_resume`
 * is the exception worth its own colour: it is the one state with an action
 * attached (§4.3).
 *
 * Lifecycle wins over agent state. A suspended task's agent state is whatever
 * it was when the process was harvested, and showing that would make a resting
 * task look busy.
 */
export function taskStateOf(task: Pick<TaskInfo, "agentState" | "lifecycle">): TaskState {
  if (task.lifecycle === "suspended") return "suspended";
  switch (task.agentState) {
    case "starting":
    case "busy":
    case "compacting":
      return "busy";
    case "needs_attention":
      return "attention";
    case "exited":
      return "exited";
    case "could_not_resume":
      return "error";
    case "idle":
    case "unknown":
      return "idle";
  }
}

/**
 * The label every task shows, keyed by id — an explicit rename, else the live
 * terminal title when it carries real content *and is unique*, else the stable
 * `<dir> · <branch>` name (naming.ts).
 *
 * The adapter of the two shapes, and the reason it is one function rather than
 * a `.map` at each call site: the projection is over the *whole list*, because
 * a title several tasks share is no help to any of them. Getting the mapping
 * subtly different in two places would mean two different answers to "what is
 * this task called" on one screen.
 */
export function taskDisplayNames(tasks: readonly TaskInfo[]): Map<string, string> {
  return sessionDisplayNames(
    tasks.map((task) => ({
      id: task.id,
      name: task.title,
      nameSource: task.titleSource,
      title: task.terminalTitle,
    })),
  );
}

/**
 * The desktop notification, for the case the sound cannot cover: the window is
 * in the background, so there is nothing on screen to look at.
 *
 * Silent about a browser that has no `Notification` at all, and about a user
 * who has said no — asking again on every notification is how a permission
 * prompt becomes a nuisance. Anything else, and the first one asks.
 */
function fireWebNotification(
  title: string,
  body: string,
  tag: string,
  taskLabel?: string,
  taskName?: string,
) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    // "Implementing the latch — codetoaster · main": the projected label and
    // the stable name, deduplicated, since they are often the same string.
    const metaParts = [...new Set([taskLabel, taskName].filter(Boolean))];
    const metaLine = metaParts.length > 0 ? metaParts.join(" — ") : undefined;
    const fullBody = [metaLine, body].filter(Boolean).join("\n") || undefined;

    const n = new Notification(title || "Terminal notification", { body: fullBody, tag });
    setTimeout(() => n.close(), 5000);
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission();
  }
}

/**
 * How a mutation's failure reaches the user.
 *
 * The rule, in one place so it is not re-decided at each call site: **every
 * failure is toasted unless the caller says it is showing the message itself.**
 * Toasting by default is what keeps a fire-and-forget mutation — `void
 * renameTask(...)`, the sidebar's close — from failing in silence, and those
 * are most of them; a component with nowhere to put an error has to be able to
 * not think about this.
 *
 * `inline` is the opt-out, and it is a property of the *call*, not of the
 * mutation: `createTask` is reached from the composer, which has a slot under
 * its textarea, and from the sidebar's New task button, which has none. Only
 * the component knows which it is.
 */
export interface RequestOptions {
  /** The caller renders this failure itself, so the toast would be the second
   * copy of it. */
  inline?: boolean;
}

async function request<T>(
  input: string,
  init: RequestInit,
  failure: string,
  { inline = false }: RequestOptions = {},
): Promise<TaskResult<T>> {
  const report = (description: string) => {
    if (!inline) toast.error(failure, { description });
  };
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (cause) {
    // A fetch that never reached the daemon: it is down, or the browser is
    // offline. Worth saying plainly rather than as a status code.
    const error = { status: 0, message: cause instanceof Error ? cause.message : "Network error" };
    report(error.message);
    return { ok: false, error };
  }

  if (!response.ok) {
    // The routes answer `{ error }` on failure; a body that is not JSON at all
    // means something upstream of them, so fall back to the status line.
    let message = response.statusText || `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // Keep the status line.
    }
    const error = { status: response.status, message };
    report(message);
    return { ok: false, error };
  }

  return { ok: true, value: (await response.json()) as T };
}

export function TaskProvider({ children }: { children: ReactNode }) {
  const { subscribe, send, isConnected } = usePty();
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activity, setActivity] = useState<Record<string, boolean>>({});
  const tasksRef = useRef<TaskInfo[]>([]);
  tasksRef.current = tasks;
  // Whether the snapshot has already been asked for on the connection that is
  // open now. Two things ask — the socket's own `onConnect` and the mount
  // effect below — and exactly one of them should get to.
  const askedRef = useRef(false);
  /**
   * Which task the shell is showing (§7.3), written by `TaskShell`.
   *
   * A ref rather than state, because nothing renders it: it is read once, from
   * inside the socket handler, to decide whether a notification is about
   * something the user is already looking at. Held here rather than in a pane
   * because the tasks that need to ring are precisely the ones with no pane
   * mounted — the whole point of a notification is that you are elsewhere.
   */
  const viewedTaskIdRef = useRef<string | null>(null);
  const setViewedTask = useCallback((id: string | null) => {
    viewedTaskIdRef.current = id;
  }, []);

  useEffect(
    () =>
      subscribe({
        onMessage: (message) => {
          if (message.type === "tasks") {
            setTasks(message.list);
            setProjects(message.projects ?? []);
            setLoaded(true);
            return;
          }

          if (message.type === "task") {
            // Upsert, not replace. A delta can arrive for a task this list does
            // not carry yet — the row a create is still resolving — and
            // dropping it would lose the server's resolved title and ptyId.
            setTasks((prev) => {
              const i = prev.findIndex((t) => t.id === message.task.id);
              if (i === -1) return [...prev, message.task];
              const next = [...prev];
              next[i] = message.task;
              return next;
            });
            return;
          }

          if (message.type === "activity") {
            setActivity((prev) => ({ ...prev, [message.taskId]: message.active }));
            return;
          }

          if (message.type === "notification") {
            const { taskId } = message;
            // Already being looked at, and the user is here: `AgentPane` is
            // showing whatever provoked this, so ringing would be telling them
            // about something on their screen.
            if (taskId === viewedTaskIdRef.current && document.hasFocus()) {
              send({ type: "acknowledge", taskId });
            } else {
              playNotificationSound();
            }
            // Separate test, not an `else`: a notification for the viewed task
            // raised while the window is in the background is still one the
            // user cannot see, and the desktop is the only place left to put
            // it. The sound above stays suppressed for it either way.
            if (!document.hasFocus()) {
              const task = tasksRef.current.find((t) => t.id === taskId);
              fireWebNotification(
                message.title,
                message.body,
                `codetoaster-${taskId}`,
                // The projected label and the stable name, which read as
                // "Implementing the latch — codetoaster · main". Projected over
                // the whole list, because a title several tasks share is no
                // help in a notification either (naming.ts).
                taskDisplayNames(tasksRef.current).get(taskId),
                task?.title,
              );
            }
            return;
          }

          // Only the client-wide ones get here: an error the server could
          // address to a PTY goes to that terminal's grid instead (§7.4). This
          // is bad JSON, an unknown message type, a task or project that is
          // gone — nothing a terminal could sensibly display, and there may be
          // several on screen anyway.
          if (message.type === "error") {
            console.error("Socket error:", message.message);
            toast.error("The server refused a request", { description: message.message });
          }
        },
        onConnect: () => {
          // The server sends the snapshot only when asked. v1 asked from
          // `handleTerminalReady`, which meant the list arrived because a
          // *terminal* had mounted — so a route with no terminal never got
          // one. Asking here is the store's own business, and it is also what
          // makes a reconnect recover: the ptyIds we are holding stopped being
          // true the moment the socket dropped.
          askedRef.current = true;
          send({ type: "list" });
        },
        onDisconnect: () => {
          // The list we hold is from before the drop, and a reconnect is
          // exactly when its ptyIds stop being true. Saying "not loaded" is
          // what stops the UI acting on it until the fresh snapshot lands.
          askedRef.current = false;
          setLoaded(false);
        },
      }),
    [subscribe, send],
  );

  // The socket may already be open when this mounts — a remount inside a live
  // page, or React running effects in an order that puts the connection first.
  // `onConnect` only ever fires on a transition, so without this the store
  // would sit empty until the next reconnect.
  //
  // Latched against `onConnect`, which runs in the socket's open handler and so
  // has already fired by the time this effect sees `isConnected` go true.
  // Without the latch every connect asks twice, and each ask costs a full task
  // snapshot serialized and sent to this client.
  useEffect(() => {
    if (!isConnected || askedRef.current) return;
    askedRef.current = true;
    send({ type: "list" });
  }, [isConnected, send]);

  // What this client is still allowed to keep on disk.
  //
  // Both stores are keyed by task id and neither is swept by anything else, so
  // a task removed here — archived, deleted, or closed from another client —
  // otherwise leaves its layout and its view state in `localStorage` for good.
  //
  // Guarded on `loaded` for the reason the store keeps that flag at all: before
  // the first snapshot, and after a drop, "no tasks" and "not told yet" look
  // identical — and sweeping against a list we have not been given would wipe
  // every layout on the page.
  useEffect(() => {
    if (!loaded) return;
    const ids = new Set(tasks.map((t) => t.id));
    retainTaskViewStates(ids);
    retainLayouts(ids);
  }, [tasks, loaded]);

  const createTask = useCallback(async (options: CreateTaskOptions = {}, reporting?: RequestOptions) => {
    const result = await request<TaskInfo>(
      "/api/tasks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      },
      "Could not start the task",
      reporting,
    );
    // Seeded from the answer, the same upsert the socket's `task` delta does.
    // The two are separate transports racing each other, and a caller that
    // navigates to what it just created — the composer does — would otherwise
    // land on `/t/$slug` in the frame before the broadcast, where the route's
    // missing-task guard reads "loaded, and no such task" and bounces it
    // straight back to `/`, taking the typed prompt with it. The next
    // broadcast overwrites this row either way.
    if (result.ok) {
      const created = result.value;
      setTasks((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
    }
    return result;
  }, []);

  const renameTask = useCallback(
    (id: string, title: string) =>
      request<TaskInfo>(
        `/api/tasks/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
        "Could not rename the task",
      ),
    [],
  );

  const closeTask = useCallback(
    (id: string) =>
      request<TaskInfo>(`/api/tasks/${id}/close`, { method: "POST" }, "Could not close the task"),
    [],
  );

  const resumeTask = useCallback(
    (id: string, options: ResumeTaskOptions = {}, reporting?: RequestOptions) =>
      request<TaskInfo>(
        `/api/tasks/${id}/resume`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
        },
        "Could not resume the task",
        reporting,
      ),
    [],
  );

  const openShell = useCallback(
    (id: string) =>
      request<{ ptyId: string; task: TaskInfo }>(
        `/api/tasks/${id}/shell`,
        { method: "POST" },
        "Could not open a shell",
      ),
    [],
  );

  const closeShell = useCallback(
    (id: string, ptyId: string) =>
      request<{ task: TaskInfo }>(
        `/api/tasks/${id}/shell/${ptyId}`,
        { method: "DELETE" },
        "Could not close the shell",
      ),
    [],
  );

  // The id is the client's to mint: the socket has no reply channel, so a
  // server-assigned one would only come back with the next broadcast and the
  // caller could not tell which project in it was the one it just asked for.
  const createProject = useCallback(
    (name: string, initialPath: string) => {
      const id = generateUUID();
      send({ type: "createProject", id, name, initialPath });
      return id;
    },
    [send],
  );

  /** Rename a project, move it, and set what it decides for its tasks.
   *
   * `settings` is a patch: a field left out keeps what the project has, so the
   * rename dialog can send none of them without clearing a setup command it
   * never showed. There is no reply to wait for — the server re-broadcasts the
   * whole list, the same as create and delete. */
  const updateProject = useCallback(
    (id: string, name: string, initialPath: string, settings?: Partial<ProjectSettings>) =>
      send({ type: "updateProject", id, name, initialPath, settings }),
    [send],
  );

  const deleteProject = useCallback(
    (id: string) => send({ type: "deleteProject", id }),
    [send],
  );

  const taskById = useCallback((id: string) => tasksRef.current.find((t) => t.id === id), []);

  const value = useMemo<TaskContextValue>(
    () => ({
      tasks,
      projects,
      loaded,
      isConnected,
      activity,
      taskById,
      createTask,
      renameTask,
      closeTask,
      resumeTask,
      openShell,
      closeShell,
      setViewedTask,
      createProject,
      updateProject,
      deleteProject,
    }),
    [
      tasks,
      projects,
      loaded,
      isConnected,
      activity,
      taskById,
      createTask,
      renameTask,
      closeTask,
      resumeTask,
      openShell,
      closeShell,
      setViewedTask,
      createProject,
      updateProject,
      deleteProject,
    ],
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTasks(): TaskContextValue {
  const value = useContext(TaskContext);
  if (!value) throw new Error("useTasks must be used within a TaskProvider");
  return value;
}
