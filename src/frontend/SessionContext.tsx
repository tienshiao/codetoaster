import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useMatches } from "@tanstack/react-router";
import type { TerminalHandle, TerminalSize } from "./Terminal";
import { generateUUID } from "./utils/uuid";
import { sessionDisplayNames, type NameSource } from "../lib/xtmux/naming";
import { useWebSocket } from "./hooks/use-websocket";
import { playNotificationSound } from "./hooks/use-notification-sound";
import { removeRecentFiles } from "./hooks/use-recent-files";
import { clearViewState, retainViewStates } from "./view-state-store";
import type { ClientMessage, ProjectInfo as WireProject, ServerMessage, TaskInfo } from "../lib/xtmux/types";

// The v1 shape, kept so the sidebar, palette, tab switcher and routes need no
// change while the server moves to tasks. This whole adapter — SessionInfo,
// the two `fromTask`/`fromWireProject` mappings, and the sessionIds naming —
// goes away with TASK-20's TaskContext.
export interface SessionInfo {
  /** The task id: what the URL, the HTTP routes and every task-addressed
   * message use. */
  id: string;
  /** The terminal to attach to, or null once a task has no live process.
   * Distinct from `id`, and read rather than assumed — a resumed task will get
   * a fresh PTY while staying the same task. */
  ptyId: string | null;
  name: string;
  nameSource?: NameSource;
  title?: string;
  createdAt: number;
  size: { cols: number; rows: number };
  clientCount: number;
  exited?: boolean;
  hasNotification?: boolean;
}

function fromTask(task: TaskInfo): SessionInfo {
  return {
    id: task.id,
    ptyId: task.ptyId,
    // The task's stored label is what v1 called the session name; the live
    // terminal title is what naming.ts projects over it.
    name: task.title,
    nameSource: task.titleSource,
    title: task.terminalTitle,
    createdAt: task.createdAt,
    size: task.size,
    clientCount: task.clientCount,
    exited: task.exited,
    hasNotification: task.hasNotification,
  };
}

function fromWireProject(project: WireProject): ProjectInfo {
  const { taskIds, ...rest } = project;
  return { ...rest, sessionIds: taskIds };
}

export interface ProjectInfo {
  id: string;
  name: string;
  initialPath: string;
  sessionIds: string[];
}

interface SessionContextValue {
  sessions: SessionInfo[];
  projects: ProjectInfo[];
  currentSessionId: string | null;
  /** The terminal behind the current task — what terminal-addressed messages
   * name. Separate from currentSessionId, which names the task. */
  currentPtyId: string | null;
  mruSessionIds: string[];
  isConnected: boolean;
  sessionsLoaded: boolean;
  sessionActivity: Record<string, boolean>;
  lastActivityAt: React.RefObject<Record<string, number>>;
  terminalRef: React.RefObject<TerminalHandle | null>;
  // Labels for every session, keyed by id. Computed over the whole list so a
  // title shared by several sessions falls back to their stable names.
  sessionLabels: Map<string, string>;
  attachSession: (id: string) => void;
  createSession: (projectId?: string) => { id: string; name: string };
  closeSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  reorderSessions: (projects: Array<{ id: string; sessionIds: string[] }>) => void;
  createProject: (name: string, initialPath: string) => { id: string };
  updateProject: (id: string, name: string, initialPath: string) => void;
  deleteProject: (id: string) => void;
  handleTerminalReady: () => void;
  handleSizeChange: (size: TerminalSize) => void;
  handleSendMessage: (msg: ClientMessage) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

function generateSessionId(): string {
  return generateUUID();
}

function fireWebNotification(
  title: string,
  body: string,
  tag: string,
  sessionLabel?: string,
  sessionName?: string,
) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    // Build a metadata line like "Implementing latch naming — codetoaster · main"
    const metaParts = [...new Set([sessionLabel, sessionName].filter(Boolean))];
    const metaLine = metaParts.length > 0 ? metaParts.join(" — ") : undefined;
    const fullBody = [metaLine, body].filter(Boolean).join("\n") || undefined;

    const n = new Notification(title || "Terminal notification", {
      body: fullBody,
      tag,
    });
    setTimeout(() => n.close(), 5000);
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission();
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentPtyId, setCurrentPtyId] = useState<string | null>(null);
  const [mruSessionIds, setMruSessionIds] = useState<string[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionActivity, setSessionActivity] = useState<Record<string, boolean>>({});
  const lastActivityAt = useRef<Record<string, number>>({});
  const terminalRef = useRef<TerminalHandle | null>(null);
  const terminalReadyRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);
  // The terminal this client is currently showing. Terminal traffic is
  // filtered against it, and it is set from the server's `attached` rather
  // than assumed from the task id — the two are separate ids.
  const attachedPtyRef = useRef<string | null>(null);
  const sessionsRef = useRef<SessionInfo[]>([]);
  const projectsRef = useRef<ProjectInfo[]>([]);
  const messageQueueRef = useRef<any[]>([]);
  const sendRef = useRef<(msg: ClientMessage) => void>(() => {});

  // Derive whether the user is viewing the terminal (not the diff tab)
  const matches = useMatches();
  const isDiff = matches.some(m => m.routeId === "/sessions/$slug/diff");
  const isViewingTerminalRef = useRef(!isDiff);
  useEffect(() => {
    isViewingTerminalRef.current = !isDiff;
  }, [isDiff]);

  // Keep refs in sync with state
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const onMessage = useCallback((message: ServerMessage) => {
    if (message.type === "tasks") {
      setSessions(message.list.map(fromTask));
      if (message.projects) {
        setProjects(message.projects.map(fromWireProject));
      }
      setSessionsLoaded(true);
      return;
    }

    // One row changed. Upsert rather than replace: a delta arrives for a task
    // the list may not carry yet (the optimistic row from create), and dropping
    // it would lose the server's resolved title and ptyId.
    if (message.type === "task") {
      const next = fromTask(message.task);
      setSessions((prev) => {
        const i = prev.findIndex((s) => s.id === next.id);
        if (i === -1) return [...prev, next];
        const copy = [...prev];
        copy[i] = next;
        return copy;
      });
      return;
    }

    if (message.type === "attached") {
      // `create` resolves asynchronously on the server (it resolves a cwd and
      // shells out to git for the branch label), so this can arrive for a task
      // the user has already switched away from. Adopting it would point the
      // UI at a task whose `restore` the filter below just dropped — the grid
      // would still be showing the other one, and keystrokes would go
      // somewhere the user cannot see. Hand the attachment back instead, so
      // the abandoned terminal stops constraining size negotiation and
      // counting us as a viewer.
      //
      // Judged on taskId, which is why the message carries it: the client
      // tracks which task it is showing, and cannot map a ptyId onto one until
      // the list arrives — which is after this.
      if (message.taskId !== currentSessionIdRef.current) {
        sendRef.current({ type: "detach", ptyId: message.ptyId });
        return;
      }
      attachedPtyRef.current = message.ptyId;
      setCurrentPtyId(message.ptyId);
      setCurrentSessionId(message.taskId);
    }

    if (message.type === "activity") {
      const { taskId } = message;
      setSessionActivity(prev => ({ ...prev, [taskId]: message.active }));
      if (message.active) {
        lastActivityAt.current[taskId] = Date.now();
      }
      return;
    }

    if (message.type === "notification") {
      const { taskId } = message;
      const isViewingThisSession =
        taskId === currentSessionIdRef.current
        && document.hasFocus()
        && isViewingTerminalRef.current;

      if (isViewingThisSession) {
        sendRef.current({ type: "acknowledge", taskId });
      } else {
        playNotificationSound();
      }
      if (!document.hasFocus()) {
        const session = sessionsRef.current.find((s) => s.id === taskId);
        fireWebNotification(
          message.title,
          message.body,
          `codetoaster-${taskId}`,
          sessionDisplayNames(sessionsRef.current).get(taskId),
          session?.name,
        );
      }
      return;
    }

    // Terminal messages name the PTY they belong to. Drop the ones for a
    // terminal this client is no longer showing — output from the task we just
    // switched away from is still in flight, and painting it into the new
    // task's grid is exactly the corruption the addressing exists to avoid.
    if (
      (message.type === "data" ||
        message.type === "restore" ||
        message.type === "resize" ||
        message.type === "exit") &&
      message.ptyId !== attachedPtyRef.current
    ) {
      return;
    }

    // Forward terminal-related messages to terminal
    if (terminalRef.current) {
      terminalRef.current.handleMessage(message);
    } else {
      messageQueueRef.current.push(message);
    }
  }, []);

  const { send, isConnected } = useWebSocket({
    onMessage,
    onConnect: () => {
      if (terminalReadyRef.current) {
        send({ type: "list" });

        // Re-attach to the session that was active before disconnect. Omit the
        // size when the terminal has never been visibly measured (e.g. the
        // page loaded on the diff tab) so it doesn't constrain negotiation.
        const taskId = currentSessionIdRef.current;
        const ptyId = sessionsRef.current.find((s) => s.id === taskId)?.ptyId;
        if (ptyId) {
          const size = terminalRef.current?.getSize();
          send({ type: "attach", ptyId, ...(size ?? {}) });
        }
      }
    },
    onDisconnect: () => {
      setSessionsLoaded(false);
    },
  });
  sendRef.current = send;

  const handleTerminalReady = useCallback(() => {
    terminalReadyRef.current = true;

    if (terminalRef.current && messageQueueRef.current.length > 0) {
      for (const msg of messageQueueRef.current) {
        terminalRef.current.handleMessage(msg);
      }
      messageQueueRef.current = [];
    }

    send({ type: "list" });
  }, [send]);

  const handleSizeChange = useCallback(
    (size: TerminalSize) => {
      const ptyId = attachedPtyRef.current;
      if (ptyId) {
        send({ type: "resize", ptyId, cols: size.cols, rows: size.rows });
      }
    },
    [send],
  );

  const handleSendMessage = useCallback(
    (msg: ClientMessage) => {
      send(msg);
    },
    [send],
  );

  // Clean up stale MRU entries and view state when sessions change, so entries
  // for sessions removed by the server or another client don't linger/leak.
  useEffect(() => {
    const ids = new Set(sessions.map((s) => s.id));
    setMruSessionIds((prev) => {
      const filtered = prev.filter((id) => ids.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
    if (sessionsLoaded) retainViewStates(ids);
  }, [sessions, sessionsLoaded]);

  // When the window regains focus, ack any pending notification for the current session
  useEffect(() => {
    const handleFocus = () => {
      if (!isViewingTerminalRef.current) return;
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) return;
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (session?.hasNotification) {
        sendRef.current({ type: "acknowledge", taskId: sessionId });
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  // Acknowledge pending notifications when switching from diff → terminal
  useEffect(() => {
    if (!isDiff) {
      const sessionId = currentSessionIdRef.current;
      if (sessionId) {
        const session = sessionsRef.current.find(s => s.id === sessionId);
        if (session?.hasNotification) {
          sendRef.current({ type: "acknowledge", taskId: sessionId });
        }
      }
    }
  }, [isDiff]);

  const pushMru = useCallback((id: string) => {
    setMruSessionIds((prev) => [id, ...prev.filter((x) => x !== id)]);
  }, []);

  const attachSession = useCallback(
    (id: string) => {
      if (id === currentSessionIdRef.current) {
        if (isViewingTerminalRef.current) {
          send({ type: "acknowledge", taskId: id });
        }
        return;
      }

      // The route only attaches once the list has loaded, so the task's
      // terminal is known by the time we get here.
      const ptyId = sessionsRef.current.find((s) => s.id === id)?.ptyId;
      if (!ptyId) return;

      terminalRef.current?.resetAttached();

      if (attachedPtyRef.current) {
        send({ type: "detach", ptyId: attachedPtyRef.current });
      }

      // Written synchronously, not left to the syncing effect: `attached` for
      // the new task can arrive before React re-renders, and the handler above
      // would hand the attachment straight back as belonging to someone else.
      currentSessionIdRef.current = id;
      const size = terminalRef.current?.getSize();
      send({ type: "attach", ptyId, ...(size ?? {}) });
      if (isViewingTerminalRef.current) {
        send({ type: "acknowledge", taskId: id });
      }
      setCurrentSessionId(id);
      pushMru(id);
    },
    [send, pushMru],
  );

  const createSession = useCallback((projectId?: string): { id: string; name: string } => {
    terminalRef.current?.resetAttached();

    // Only inherit position/cwd when no explicit project is targeted (e.g. Cmd+T)
    const afterSessionId = projectId ? undefined : (currentSessionIdRef.current || undefined);

    if (attachedPtyRef.current) {
      send({ type: "detach", ptyId: attachedPtyRef.current });
      attachedPtyRef.current = null;
      setCurrentPtyId(null);
    }

    const sessionId = generateSessionId();
    currentSessionIdRef.current = sessionId;
    // The server names the session: it is the side that knows the resolved cwd
    // and branch, and it owns the terminal title the name later latches onto.
    // This placeholder only labels the optimistic row until that list arrives.
    const name = "New Session";
    const size = terminalRef.current?.getSize() || { cols: 80, rows: 24 };

    // Derive project from current session if not explicitly provided
    let resolvedProjectId = projectId;
    if (!resolvedProjectId && afterSessionId) {
      const currentProject = projectsRef.current.find((p) => p.sessionIds.includes(afterSessionId));
      if (currentProject) resolvedProjectId = currentProject.id;
    }

    send({ type: "create", taskId: sessionId, cols: size.cols, rows: size.rows, projectId: resolvedProjectId, afterTaskId: afterSessionId });
    setCurrentSessionId(sessionId);
    pushMru(sessionId);
    setSessions((prev) => [
      ...prev,
      {
        id: sessionId,
        // Unknown until the server answers: it is the side that spawns the
        // terminal. The `task` delta fills it in.
        ptyId: null,
        name,
        createdAt: Date.now(),
        size: { cols: size.cols, rows: size.rows },
        clientCount: 1,
      },
    ]);
    // Optimistically add to project at correct position
    const targetProjectId = resolvedProjectId || "general";
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== targetProjectId) return p;
        const newSessionIds = [...p.sessionIds];
        if (afterSessionId && (!projectId || projectId === p.id)) {
          const afterIndex = newSessionIds.indexOf(afterSessionId);
          if (afterIndex >= 0) {
            newSessionIds.splice(afterIndex + 1, 0, sessionId);
            return { ...p, sessionIds: newSessionIds };
          }
        }
        newSessionIds.push(sessionId);
        return { ...p, sessionIds: newSessionIds };
      })
    );
    return { id: sessionId, name };
  }, [send]);

  const renameSession = useCallback(
    (id: string, name: string) => {
      send({ type: "rename", taskId: id, title: name });
      // nameSource moves with the name: without it the optimistic row still
      // reads as "derived", so the label keeps projecting the terminal title
      // over the name just chosen until the server echoes the list back — and
      // for as long as the socket is down, since the send is only queued.
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, name, nameSource: "manual" } : s))
      );
    },
    [send],
  );

  const reorderSessions = useCallback(
    (orderedProjects: Array<{ id: string; sessionIds: string[] }>) => {
      // Optimistically update projects
      setProjects((prev) => {
        const projectMap = new Map(prev.map((p) => [p.id, p]));
        const result: ProjectInfo[] = [];
        const seen = new Set<string>();
        for (const { id, sessionIds } of orderedProjects) {
          const existing = projectMap.get(id);
          if (existing && !seen.has(id)) {
            result.push({ ...existing, sessionIds });
            seen.add(id);
          }
        }
        // Append missing projects
        for (const p of prev) {
          if (!seen.has(p.id)) result.push(p);
        }
        return result;
      });
      // Optimistically reorder sessions to match project order
      setSessions((prev) => {
        const map = new Map(prev.map((s) => [s.id, s]));
        const reordered: SessionInfo[] = [];
        const seen = new Set<string>();
        for (const { sessionIds } of orderedProjects) {
          for (const id of sessionIds) {
            const s = map.get(id);
            if (s && !seen.has(id)) {
              reordered.push(s);
              seen.add(id);
            }
          }
        }
        for (const s of prev) {
          if (!seen.has(s.id)) reordered.push(s);
        }
        return reordered;
      });
      send({
        type: "reorder",
        projects: orderedProjects.map(({ id, sessionIds }) => ({ id, taskIds: sessionIds })),
      });
    },
    [send],
  );

  const createProject = useCallback((name: string, initialPath: string): { id: string } => {
    const id = generateUUID();
    setProjects((prev) => [...prev, { id, name, initialPath, sessionIds: [] }]);
    send({ type: "createProject", id, name, initialPath });
    return { id };
  }, [send]);

  const updateProject = useCallback(
    (id: string, name: string, initialPath: string) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name, initialPath } : p))
      );
      send({ type: "updateProject", id, name, initialPath });
    },
    [send],
  );

  const deleteProject = useCallback(
    (id: string) => {
      setProjects((prev) => {
        const project = prev.find((p) => p.id === id);
        if (!project || id === "general") return prev;
        return prev
          .filter((p) => p.id !== id)
          .map((p) =>
            p.id === "general"
              ? { ...p, sessionIds: [...p.sessionIds, ...project.sessionIds] }
              : p
          );
      });
      send({ type: "deleteProject", id });
    },
    [send],
  );

  const closeSession = useCallback(
    (id: string) => {
      removeRecentFiles(id);
      clearViewState(id);
      send({ type: "kill", taskId: id });

      if (id === currentSessionIdRef.current) {
        terminalRef.current?.resetAttached();
        // The terminal went with the task: leaving these set would keep the
        // killed PTY's `exit` past the message filter and address the next
        // resize at a process that no longer exists.
        attachedPtyRef.current = null;
        setCurrentPtyId(null);
        setCurrentSessionId(null);
      }

      setSessions((prev) => prev.filter((s) => s.id !== id));
    },
    [send],
  );

  const sessionLabels = useMemo(() => sessionDisplayNames(sessions), [sessions]);

  return (
    <SessionContext.Provider
      value={{
        sessions,
        projects,
        currentSessionId,
        currentPtyId,
        mruSessionIds,
        isConnected,
        sessionsLoaded,
        sessionActivity,
        lastActivityAt,
        sessionLabels,
        terminalRef,
        attachSession,
        createSession,
        closeSession,
        renameSession,
        reorderSessions,
        createProject,
        updateProject,
        deleteProject,
        handleTerminalReady,
        handleSizeChange,
        handleSendMessage,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
