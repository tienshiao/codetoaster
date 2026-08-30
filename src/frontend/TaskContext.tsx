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
import { usePty } from "./PtyContext";
import { retainLayouts } from "./layout-store";
import { retainTaskViewStates } from "./view-state-store";
import { generateUUID } from "./utils/uuid";
import type { TaskState } from "./components/v2/StatusDot";
import type { ProjectInfo, TaskInfo } from "../lib/xtmux/types";

/**
 * The task store (§7.4): the list, the projects, and per-task liveness, fed by
 * the socket and mutated over HTTP.
 *
 * The split is the point. Anything that creates a task runs git, spawns a
 * process and fails in ways that want a status code and a body, so it is HTTP;
 * the socket carries the push channel that says what changed. This context is
 * the client half of both.
 *
 * It deliberately holds no side effects. While `SessionContext` is still live
 * (until TASK-28) two subscribers see every frame, so a notification sound or
 * an `acknowledge` here would fire twice — once each. Sound, web notifications
 * and acknowledgement stay in `SessionContext` and move across when it goes.
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
  createTask: (options?: CreateTaskOptions) => Promise<TaskResult<TaskInfo>>;
  renameTask: (id: string, title: string) => Promise<TaskResult<TaskInfo>>;
  closeTask: (id: string) => Promise<TaskResult<TaskInfo>>;
  resumeTask: (id: string, options?: ResumeTaskOptions) => Promise<TaskResult<TaskInfo>>;
  /**
   * Projects are the exception to the HTTP rule above: they touch a table and
   * nothing else — no git, no processes — so they stay on the socket, where
   * they already are (`ClientMessage`). Neither answers, because the server
   * re-broadcasts the whole list when either lands; `createProject` returns the
   * id it minted so the caller can select what it just made.
   */
  createProject: (name: string, initialPath: string) => string;
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

async function request<T>(
  input: string,
  init: RequestInit,
  failure: string,
): Promise<TaskResult<T>> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (cause) {
    // A fetch that never reached the daemon: it is down, or the browser is
    // offline. Worth saying plainly rather than as a status code.
    const error = { status: 0, message: cause instanceof Error ? cause.message : "Network error" };
    toast.error(failure, { description: error.message });
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
    toast.error(failure, { description: message });
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
  // The one exception to this context holding no side effects, and it earns it:
  // the rule exists because `SessionContext` is still subscribed to the same
  // socket, so a notification or an `acknowledge` here would fire twice. A
  // retain sweep is idempotent — running it twice removes nothing the first run
  // did not — and it lives here rather than in the adapter precisely so it
  // survives TASK-28.
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

  const createTask = useCallback(
    (options: CreateTaskOptions = {}) =>
      request<TaskInfo>(
        "/api/tasks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
        },
        "Could not start the task",
      ),
    [],
  );

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
    (id: string, options: ResumeTaskOptions = {}) =>
      request<TaskInfo>(
        `/api/tasks/${id}/resume`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
        },
        "Could not resume the task",
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
      createProject,
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
      createProject,
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
