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
import { toast } from "sonner";
import type { TerminalHandle, TerminalSize } from "./Terminal";
import { generateUUID } from "./utils/uuid";
import { sessionDisplayNames, type NameSource } from "../lib/xtmux/naming";
import { usePty, type PtyContextValue } from "./PtyContext";
import { playNotificationSound } from "./hooks/use-notification-sound";
import type { ClientMessage, ProjectInfo as WireProject, ServerMessage, TaskInfo } from "../lib/xtmux/types";
import type { Lifecycle } from "../lib/db";

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
  /** Whether there is anything running behind the task (§6). A suspended one is
   * not a task that went away — it is one click from being live again — so the
   * sidebar renders it dormant rather than dropping it, and clicking it resumes
   * rather than attaching. */
  lifecycle: Lifecycle;
  createdAt: number;
  size: { cols: number; rows: number };
  clientCount: number;
  exited?: boolean;
  hasNotification?: boolean;
}

// A refused create has to reach the user, not just the console. Every caller
// answers `null` by quietly doing nothing — no navigation, no new tab — so a
// $SHELL that has left PATH, or a project whose initialPath was deleted, made
// "New Session" a button that visibly does nothing at all. Under the v1 socket
// `create`, the server's refusal came back as an `error` frame the terminal
// painted into the grid, so the failure was at least visible.
function reportCreateFailure(reason: string): void {
  console.error("Could not create the task:", reason);
  toast.error("Could not create the session", { description: reason });
}

// A resume that fails has to reach the user for the same reason: the row goes
// on sitting there suspended, and without this the only sign that anything
// happened is that clicking it did nothing.
function reportResumeFailure(reason: string, retry: () => void): void {
  console.error("Could not resume the task:", reason);
  toast.error("Could not resume the session", {
    description: reason,
    // The only way back: a failed resume is not retried on its own, or the
    // route's attach effect would spawn an agent on every list update.
    action: { label: "Try again", onClick: retry },
  });
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
    lifecycle: task.lifecycle,
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
  /** The suspended tasks with a resume in flight, so the sidebar can say the
   * click landed while the agent is coming back. */
  resumingSessionIds: Set<string>;
  /** The task whose stored screen is on the grid, read-only, waiting for the
   * resumed agent's first paint (§5.5). Outlives `resumingSessionIds`: the
   * resume request answers as soon as the ladder has a process, which is before
   * that process has drawn anything. */
  restoringSessionId: string | null;
  /** Tasks whose resume failed and were not retried. The terminal is left
   * showing the snapshot rather than a blank grid, so the overlay is the only
   * thing that can say the agent is not coming. */
  resumeFailedSessionIds: Set<string>;
  /** Try a failed resume again. Failures are never retried on their own — the
   * route's attach effect re-runs on every `sessions` delta — so this is the
   * only way back. */
  retryResume: (id: string) => void;
  lastActivityAt: React.RefObject<Record<string, number>>;
  terminalRef: React.RefObject<TerminalHandle | null>;
  // Labels for every session, keyed by id. Computed over the whole list so a
  // title shared by several sessions falls back to their stable names.
  sessionLabels: Map<string, string>;
  /** False when the task has no terminal to attach to yet. */
  attachSession: (id: string) => boolean;
  /** Null when the server refused: creating a task can fail on git or on the
   * spawn, and the caller should not navigate to something that isn't there. */
  createSession: (projectId?: string) => Promise<{ id: string; name: string } | null>;
  closeSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  reorderSessions: (projects: Array<{ id: string; sessionIds: string[] }>) => void;
  createProject: (name: string, initialPath: string) => { id: string };
  updateProject: (id: string, name: string, initialPath: string) => void;
  deleteProject: (id: string) => void;
  handleTerminalReady: () => void;
  handleSizeChange: (size: TerminalSize) => void;
  handleSendMessage: (msg: ClientMessage) => void;
  /** The terminal saying the swap happened: the resumed agent painted, and the
   * snapshot is gone. */
  handleRestoreEnd: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
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
  // Which suspended tasks have a resume in flight. A ref as well as state
  // because it is read as a lock, not rendered: the route's attach effect runs
  // again on every `sessions` delta, and those arrive constantly while a resume
  // is spawning — a second request would put a second agent on the ladder for
  // one click.
  const resumingRef = useRef<Set<string>>(new Set());
  const [resumingSessionIds, setResumingSessionIds] = useState<Set<string>>(new Set());
  // Tasks whose resume failed, which must not be retried on their own. Opening
  // a suspended task is driven by the route's attach effect, and that effect
  // re-runs on every `sessions` delta — including the one the failure itself
  // broadcasts. Without this the failing task would spawn an agent, fail,
  // broadcast, and spawn another, for as long as the tab was open.
  const resumeFailedRef = useRef<Set<string>>(new Set());
  const [resumeFailedSessionIds, setResumeFailedSessionIds] = useState<Set<string>>(new Set());
  // The task the terminal is holding a snapshot for. A ref as well as state for
  // the same reason `resumingRef` is one: it is read as a guard by callbacks
  // that run in the same commit that set it — the scrollback fetch resolving,
  // and the attach effect deciding whether an attach belongs to the reopen in
  // flight or is the user having moved on.
  const restoringTaskIdRef = useRef<string | null>(null);
  const [restoringSessionId, setRestoringSessionId] = useState<string | null>(null);
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
  const sendRef = useRef<(msg: ClientMessage) => void>(() => {});
  // `onMessage` is stable by design, so it reaches the router the same way it
  // already reaches `send`: through a ref rather than a dependency.
  const ptyRef = useRef<PtyContextValue>(null as unknown as PtyContextValue);

  // Derive whether the user is viewing the terminal (not the diff tab)
  const matches = useMatches();
  const isDiff = matches.some(m => m.routeId === "/sessions/$slug/diff");
  const isViewingTerminalRef = useRef(!isDiff);
  useEffect(() => {
    isViewingTerminalRef.current = !isDiff;
  }, [isDiff]);

  // The ref is written here, with the state, and never by an effect syncing it
  // afterwards. That sync was a bug the moment `attached` started handing back
  // any attachment for a task it is not showing: effects run child-first, so
  // the route's attach effect could set the ref to the task it was opening,
  // and the provider's sync effect would then run in the same commit and put
  // the *previous* render's value back. An `attached` frame arriving in that
  // window is judged against a task the user already left, so the client
  // detaches the terminal it just asked for and nothing retries.
  const setCurrentSession = useCallback((id: string | null) => {
    currentSessionIdRef.current = id;
    setCurrentSessionId(id);
  }, []);

  // Assigned during render, not from an effect, for the same reason
  // `sendRef` is below. Effects run child-first, so a route's attach effect
  // reads these in the same commit that produced them — and a version behind
  // is exactly wrong on the commit that matters: the one where a reconnect has
  // just delivered a fresh list because every ptyId in the old one is dead.
  // Attaching to the remembered id then draws `Terminal "…" not found` into
  // the grid, and nothing tries again.
  sessionsRef.current = sessions;
  projectsRef.current = projects;

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
      // Not ours to judge, and not ours to give back: another attacher on this
      // socket asked for it.
      if (!ownedPtysRef.current.has(message.ptyId)) return;
      if (message.taskId !== currentSessionIdRef.current) {
        ownedPtysRef.current.delete(message.ptyId);
        ptyRef.current.detach(message.ptyId);
        return;
      }
      attachedPtyRef.current = message.ptyId;
      setCurrentPtyId(message.ptyId);
      setCurrentSession(message.taskId);
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

    // Only the unaddressed errors reach here. `Terminal "…" not found` and
    // `Not attached to terminal "…"` name the PTY that provoked them, so the
    // router puts them in that terminal's grid, which is where the explanation
    // belongs. What is left is client-wide — bad JSON, an unknown message
    // type, a task or project that is gone — and belongs in no grid at all:
    // painting it into whichever terminal happens to be on screen told the
    // user that *that* terminal had failed, and, mid-reopen, told the restore
    // phase the agent was never coming (§5.5).
    if (message.type === "error") {
      console.error("Socket error:", message.message);
      toast.error("The server refused a request", { description: message.message });
      return;
    }

    // Other terminal frames are not handled here any more. `PtyContext` routes
    // them to the one terminal bound to their ptyId and queues anything that
    // arrives before it mounts, so this context is left with task traffic —
    // which is all it was ever really about.
  }, []);

  const pty = usePty();
  // Destructured, and it is these — not `pty` — that the callbacks below
  // depend on. The router's methods outlive every reconnect; the context value
  // wrapping them does not, and keying a callback on the value alone churns it
  // (and everything downstream) each time the socket flaps.
  const {
    send,
    isConnected,
    subscribe,
    attach: attachRouterPty,
    detach: detachRouterPty,
    resize: resizePty,
  } = pty;

  // The PTYs this context asked for.
  //
  // `attached` is fanned out to every socket subscriber, and there are two
  // attachers now: this adapter, and the v2 `AgentPane` that will replace it.
  // The handler below hands back any attachment for a task it is not showing —
  // which was right while one attacher existed and is exactly wrong now. At
  // `/shell` this context is showing no task at all, so it answered every
  // `attached` the agent tab asked for by detaching it, and the terminal the
  // user had just opened was given away before it had drawn anything.
  //
  // So this context gives back only what it took. It disappears with the rest
  // of the adapter at TASK-28.
  const ownedPtysRef = useRef<Set<string>>(new Set());
  const attachPty = useCallback(
    (ptyId: string, size: TerminalSize | null) => {
      ownedPtysRef.current.add(ptyId);
      attachRouterPty(ptyId, size);
    },
    [attachRouterPty],
  );
  const detachPty = useCallback(
    (ptyId: string) => {
      ownedPtysRef.current.delete(ptyId);
      detachRouterPty(ptyId);
    },
    [detachRouterPty],
  );
  const onConnect = useCallback(() => {
    if (terminalReadyRef.current) {
      // Ask, and re-attach off the answer rather than from here. The list we
      // are holding is the one from before the socket dropped, and a
      // reconnect is exactly when its ptyIds stop being true: a daemon
      // restart (or `bun run dev` reloading one) keeps every task row but
      // gives them all new terminals, or none at all until they are resumed.
      // Attaching to a remembered ptyId then draws `Terminal "…" not found`
      // into the user's grid — an `error` frame is not addressed to a PTY, so
      // the router cannot drop it — and nothing tries again. The route
      // effect re-attaches when the fresh list lands, which is the only
      // moment a ptyId is known to be real.
      send({ type: "list" });
    }
    // Whatever we held, we no longer hold: the server forgot this client
    // when the socket closed. Said out loud so `attachSession` can tell a
    // live attachment from a remembered one.
    attachedPtyRef.current = null;
    setCurrentPtyId(null);
  }, [send]);
  const onDisconnect = useCallback(() => {
    setSessionsLoaded(false);
  }, []);

  useEffect(
    () => subscribe({ onMessage, onConnect, onDisconnect }),
    [subscribe, onMessage, onConnect, onDisconnect],
  );
  sendRef.current = send;
  ptyRef.current = pty;

  const handleTerminalReady = useCallback(() => {
    terminalReadyRef.current = true;

    send({ type: "list" });
  }, [send]);

  const handleSizeChange = useCallback(
    (size: TerminalSize) => {
      const ptyId = attachedPtyRef.current;
      if (ptyId) {
        resizePty(ptyId, size);
      }
    },
    [resizePty],
  );

  const handleSendMessage = useCallback(
    (msg: ClientMessage) => {
      send(msg);
    },
    [send],
  );

  // Stale MRU entries, when the server or another client removes a session.
  // The persistent-storage sweeps that used to live here are `TaskContext`'s
  // now — this adapter is deleted at TASK-28, and a sweep that vanished with it
  // would silently reintroduce the leak it was added to fix.
  useEffect(() => {
    const ids = new Set(sessions.map((s) => s.id));
    setMruSessionIds((prev) => {
      const filtered = prev.filter((id) => ids.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [sessions]);

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

  const markResuming = useCallback((id: string, resuming: boolean) => {
    if (resuming) resumingRef.current.add(id);
    else resumingRef.current.delete(id);
    setResumingSessionIds(new Set(resumingRef.current));
  }, []);

  // Mirror the failure latch into state so the overlay can render it. The ref
  // stays the authority — it is read as a lock, from callbacks, in the commit
  // that writes it — and this only catches the render up. Unchanged sets are
  // handed back untouched: `attachSession` prunes the latch on every call, and
  // a fresh Set each time would re-render the whole tree off an effect that
  // runs on every `sessions` delta.
  const syncResumeFailed = useCallback(() => {
    setResumeFailedSessionIds((prev) => {
      const next = resumeFailedRef.current;
      if (prev.size === next.size && [...next].every((id) => prev.has(id))) return prev;
      return new Set(next);
    });
  }, []);

  // Leave the read-only phase without a swap. The grid keeps whatever it is
  // showing: after a failed resume that is the snapshot, which is the last true
  // thing the user saw and still the most useful thing on screen.
  const endRestorePhase = useCallback(() => {
    if (restoringTaskIdRef.current === null) return;
    restoringTaskIdRef.current = null;
    setRestoringSessionId(null);
    terminalRef.current?.endRestore();
  }, []);

  // The swap landed: the resumed agent painted and the terminal is live again.
  const handleRestoreEnd = useCallback(() => {
    restoringTaskIdRef.current = null;
    setRestoringSessionId(null);
  }, []);

  // Put the terminal on the task being reopened and open the read-only phase
  // (§5.5). Separate from the request below because it is what the *view* has
  // to do, and the view has to do it whether or not this is the call that
  // starts the agent: a resume already in flight is still the task the user is
  // looking at.
  const beginReopen = useCallback(
    (id: string) => {
      // Let go of the terminal we were showing before the request, not after.
      // The user has already navigated to the task being resumed, so leaving
      // the old PTY attached leaves them looking at another task's output for
      // as long as the ladder takes — and typing into it, since input is
      // addressed at whatever `currentPtyId` still names.
      terminalRef.current?.resetAttached();
      if (attachedPtyRef.current) {
        ownedPtysRef.current.delete(attachedPtyRef.current);
        ptyRef.current.detach(attachedPtyRef.current);
        attachedPtyRef.current = null;
        setCurrentPtyId(null);
      }
      setCurrentSession(id);
      pushMru(id);

      // The read-only phase opens here, before either request goes out (§5.5).
      // The ordering is the whole trick: the two requests race, and a resume
      // that comes back first must not have a snapshot painted over its live
      // output afterwards — so painting is conditional on the phase still
      // standing, and the phase can only still be standing if nothing has been
      // painted live yet.
      restoringTaskIdRef.current = id;
      setRestoringSessionId(id);
      terminalRef.current?.beginRestore();

      // In parallel with the resume, not after it: showing the user where they
      // left off must not wait on a process that takes seconds to come back,
      // and the agent does not exist yet to serve it over the socket anyway.
      fetch(`/api/tasks/${id}/scrollback`)
        .then(async (response) => {
          if (!response.ok) return;
          const body = await response.json();
          // A task with no stored screen is a normal answer (a task suspended
          // before snapshots existed, or an agent that died before one ran):
          // there is simply nothing to repaint, and the phase goes on waiting
          // for the live PTY.
          if (typeof body?.data !== "string") return;
          // Guarded on the task as well as on the phase: the user can open a
          // second suspended task while this is in flight, and that one's
          // restore is standing by the time this answers.
          if (restoringTaskIdRef.current !== id) return;
          terminalRef.current?.paintSnapshot(body.data, body.size ?? null);
        })
        .catch(() => {
          // Nothing to say. The snapshot is a courtesy — the resume is what the
          // click was for, and it reports its own failures.
        });
    },
    [pushMru, setCurrentSession],
  );

  // Bring a suspended task back (§6): the agent is respawned on the stored
  // conversation and the task gets a fresh terminal, which the attach effect
  // picks up when the server broadcasts the row. Nothing is attached from here
  // — this only starts the process and reports it failing.
  const resumeSession = useCallback(
    (id: string, retry = false) => {
      if (resumingRef.current.has(id)) {
        // The request is already out, so nothing more is sent — but this may
        // still be the user *opening* the task: they clicked it, left while the
        // ladder was walking, and came back. Returning outright left
        // `currentSessionId` and the attachment on the task they came from, so
        // the URL named one task while the grid showed another and every
        // keystroke went to its terminal until the resume happened to land.
        if (currentSessionIdRef.current !== id) beginReopen(id);
        return;
      }
      if (resumeFailedRef.current.has(id) && !retry) return;
      resumeFailedRef.current.delete(id);
      syncResumeFailed();
      markResuming(id, true);

      beginReopen(id);

      // Same distinction as create: the request needs a concrete grid, so it
      // falls back, but a fabricated 80x24 must not reach the attach and enter
      // smallest-wins negotiation as this client's real measurement.
      const size = terminalRef.current?.getSize() ?? { cols: 80, rows: 24 };
      fetch(`/api/tasks/${id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cols: size.cols, rows: size.rows }),
      })
        .then(async (response) => {
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error ?? response.statusText);
          // A 200 is not by itself a success: the route answers with the row
          // whatever the ladder managed, and a task that could not be resumed
          // is a card with a button on it (§4.3), not an HTTP error.
          if (body.agentState === "could_not_resume") {
            throw new Error("The agent's conversation could not be reopened.");
          }
          // Upsert rather than wait for the broadcast that is already on its
          // way: the attach effect fires off `sessions`, so the ptyId reaching
          // the list is what actually reattaches the terminal, and racing the
          // socket for it costs nothing.
          const session = fromTask(body as TaskInfo);
          setSessions((prev) => {
            const i = prev.findIndex((s) => s.id === session.id);
            if (i === -1) return [...prev, session];
            const copy = [...prev];
            copy[i] = session;
            return copy;
          });
        })
        .catch((e) => {
          // Latched before the toast, so the button the toast offers is the
          // only thing that tries again.
          resumeFailedRef.current.add(id);
          syncResumeFailed();
          // No agent is coming, so nothing will ever swap the grid over: left
          // standing, the phase would sit on "resuming…" and refuse input for
          // as long as the tab was open. The snapshot stays painted underneath
          // the failure — it is still the last true thing this task showed.
          if (restoringTaskIdRef.current === id) endRestorePhase();
          reportResumeFailure(e instanceof Error ? e.message : String(e), () =>
            resumeSessionRef.current(id, true),
          );
        })
        .finally(() => {
          markResuming(id, false);
        });
    },
    [beginReopen, markResuming, syncResumeFailed, endRestorePhase],
  );

  // The retry the toast offers calls back into the callback that created it, so
  // it is reached through a ref rather than by making `resumeSession` recursive
  // on itself.
  const resumeSessionRef = useRef(resumeSession);
  resumeSessionRef.current = resumeSession;

  // The same retry the toast offers, for the overlay to put on the failed
  // task's own screen — where the user is actually looking when a reopen
  // fails, and where a dismissed toast leaves nothing at all.
  const retryResume = useCallback((id: string) => {
    resumeSessionRef.current(id, true);
  }, []);

  // Returns false when there is nothing to attach to yet — the task's terminal
  // is minted by the server, so a row can exist a beat before its ptyId does,
  // and a suspended one has none at all until it has been resumed. Callers that
  // remember "this slug is handled" must not latch on a false, or the effect
  // that would retry when the ptyId lands will short-circuit and the terminal
  // stays dark.
  const attachSession = useCallback(
    (id: string): boolean => {
      const session = sessionsRef.current.find((s) => s.id === id);
      const ptyId = session?.ptyId;

      // A resume latch only outlives the task the user is looking at. The
      // latch exists so a failure is not retried on its own — the attach
      // effect re-runs on every `sessions` delta, and those never stop — but
      // it must not outlive the visit: without this, one failed resume made
      // the task permanently un-openable, silently, since every later click
      // came back through here, hit the latch and returned with no toast and
      // nothing on screen. Leaving the task and coming back is the retry
      // gesture, so leaving it is what clears the latch.
      for (const failed of [...resumeFailedRef.current]) {
        if (failed !== id) resumeFailedRef.current.delete(failed);
      }
      syncResumeFailed();

      // A reopen belongs to the task that started it. Attaching that same task
      // is the reopen proceeding — the resumed agent's fresh ptyId landing in
      // the list is exactly what this effect is waiting for — so the phase has
      // to survive it, or the snapshot would be wiped by the `restore` for a
      // PTY that has not printed anything yet. Attaching anything else is the
      // user having moved on, and the phase goes with them.
      if (restoringTaskIdRef.current !== null && restoringTaskIdRef.current !== id) {
        endRestorePhase();
      }

      // Nothing to do only when this really is the terminal we are holding.
      // Being on the same task is not enough: after a reconnect the attachment
      // is gone and the task's ptyId is usually a new one, and a check on the
      // task id alone answered "already attached" to the one call that could
      // have recovered it — leaving the only task the user was looking at as
      // the one task with no way back.
      if (id === currentSessionIdRef.current && ptyId && attachedPtyRef.current === ptyId) {
        if (isViewingTerminalRef.current) {
          send({ type: "acknowledge", taskId: id });
        }
        return true;
      }

      if (!ptyId) {
        // A suspended task is *precisely* a task with no PTY (§6), so this is
        // where opening one has to start the process rather than give up. The
        // false below is still right: there is nothing to attach to yet, and
        // the caller's retry when the resumed ptyId lands is what attaches it.
        if (session?.lifecycle === "suspended") resumeSession(id);
        return false;
      }

      // Whatever went wrong last time did not stop the task coming back, so
      // the next suspension gets a clean attempt rather than inheriting a
      // latch from a resume that is now history.
      resumeFailedRef.current.delete(id);
      syncResumeFailed();

      terminalRef.current?.resetAttached();

      if (attachedPtyRef.current) {
        detachPty(attachedPtyRef.current);
      }
      // Let go of it here rather than waiting for `attached` to name the new
      // one. Output the server dispatched before it processed that detach is
      // still on the wire, and it carries the old ptyId — which, while this
      // still pointed at it, passed the filter below and painted the terminal
      // we just left into the grid being prepared for this one.
      attachedPtyRef.current = null;
      setCurrentPtyId(null);

      // Written synchronously: `attached` for the new task can arrive before
      // React re-renders, and the handler above would hand the attachment
      // straight back as belonging to someone else.
      const size = terminalRef.current?.getSize();
      setCurrentSession(id);
      attachPty(ptyId, size ?? null);
      if (isViewingTerminalRef.current) {
        send({ type: "acknowledge", taskId: id });
      }
      pushMru(id);
      return true;
    },
    [
      send,
      attachPty,
      detachPty,
      pushMru,
      setCurrentSession,
      resumeSession,
      syncResumeFailed,
      endRestorePhase,
    ],
  );

  // Creating a task is a request now, not a message: it resolves a directory,
  // runs git and spawns a process, and the caller needs to hear about any of
  // those failing. The server broadcasts the new list before it answers, so
  // there is nothing to add optimistically — only a terminal to attach to.
  const createSession = useCallback(
    async (projectId?: string): Promise<{ id: string; name: string } | null> => {
      // Only inherit position/cwd when no explicit project is targeted (e.g. Cmd+T).
      // Checked against the list rather than trusted: the server 404s an
      // afterTaskId it cannot find, which fails the whole create over what is
      // only a positioning hint — and the ref outlives the task whenever
      // another client (or `codetoaster kill`) closes the one we are showing.
      const current = currentSessionIdRef.current;
      const afterTaskId =
        !projectId && current && sessionsRef.current.some((s) => s.id === current)
          ? current
          : undefined;

      // Derive project from current session if not explicitly provided
      let resolvedProjectId = projectId;
      if (!resolvedProjectId && afterTaskId) {
        const currentProject = projectsRef.current.find((p) => p.sessionIds.includes(afterTaskId));
        if (currentProject) resolvedProjectId = currentProject.id;
      }

      // Null when the terminal has never been visibly measured (e.g. the page
      // loaded on the diff tab). The PTY still needs a concrete initial grid,
      // so the create falls back — but the attach below must not, or a
      // fabricated 80x24 enters smallest-wins negotiation as this client's
      // real measurement and clamps every other viewer of the new task.
      const measured = terminalRef.current?.getSize() ?? null;
      const size = measured ?? { cols: 80, rows: 24 };
      let task: TaskInfo;
      try {
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: resolvedProjectId,
            afterTaskId,
            cols: size.cols,
            rows: size.rows,
          }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          reportCreateFailure(body.error ?? response.statusText);
          return null;
        }
        task = await response.json();
      } catch (e) {
        reportCreateFailure(e instanceof Error ? e.message : String(e));
        return null;
      }

      // A new task is the user having moved on from whatever reopen was in
      // flight, and its terminal must not have the old task's snapshot held
      // over it or its own first output swallowed as a swap.
      endRestorePhase();

      // Only now let go of the terminal we were showing. Detaching up front
      // meant a refused create left the user staring at a dead grid: nothing
      // re-attaches it, since the route's slug latch has already fired and
      // attachSession short-circuits on the task it thinks is current.
      terminalRef.current?.resetAttached();
      if (attachedPtyRef.current) {
        detachPty(attachedPtyRef.current);
        attachedPtyRef.current = null;
        setCurrentPtyId(null);
      }

      const session = fromTask(task);
      setSessions((prev) =>
        prev.some((s) => s.id === session.id) ? prev : [...prev, session],
      );
      // Written before the attach: `attached` comes back naming this task, and
      // the handler hands back any attachment for a task it is not showing.
      setCurrentSession(task.id);
      pushMru(task.id);
      if (task.ptyId) {
        attachPty(task.ptyId, measured);
        // Recorded here rather than left to the `attached` frame that confirms
        // it, because the caller navigates to the new task immediately and the
        // route's attach effect runs in that same commit — long before the
        // round trip. With this still null, `attachSession` cannot recognise
        // the attachment just sent and sends a second one, and the server
        // answers every attach with a fresh `restore`: the whole scrollback
        // re-serialized and repainted (RIS and all) on every new task. Handing
        // it back if the user switches away in the meantime still works — the
        // `attached` handler detaches a task it is not showing, and
        // `attachSession` now has the ptyId to detach from.
        attachedPtyRef.current = task.ptyId;
        setCurrentPtyId(task.ptyId);
      }
      return { id: task.id, name: session.name };
    },
    [attachPty, detachPty, pushMru, setCurrentSession, endRestorePhase],
  );

  const renameSession = useCallback(
    (id: string, name: string) => {
      const previous = sessionsRef.current.find((s) => s.id === id);
      // nameSource moves with the name: without it the optimistic row still
      // reads as "derived", so the label keeps projecting the terminal title
      // over the name just chosen until the server echoes the row back.
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, name, nameSource: "manual" } : s))
      );
      fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name }),
      })
        .then(async (res) => {
          if (res.ok) return;
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? res.statusText);
        })
        .catch((e) => {
          console.error("Could not rename the task:", e);
          // A refusal is not just a network failure: the full `tasks` snapshot
          // only comes back on reconnect or when the set of tasks changes, so
          // without this the row would read as renamed — and drive the URL
          // slug — for as long as the session lasts. Guarded on the name still
          // being the one we wrote, so a rename that landed since is kept.
          if (!previous) return;
          setSessions((prev) =>
            prev.map((s) =>
              s.id === id && s.name === name
                ? { ...s, name: previous.name, nameSource: previous.nameSource }
                : s
            )
          );
        });
    },
    [],
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

  // Closing suspends (§6). The task keeps its row, its directory and its place
  // in the sidebar; what goes away is the process behind it. So the row is not
  // dropped from the list, and the recent files and view state this used to
  // clear are kept: they describe the task, not its process, and a close the
  // user undoes with a click should come back to the tab and file they left
  // open. `retainTaskViewStates` still collects them when the task really does go.
  const closeSession = useCallback(
    (id: string) => {
      resumeFailedRef.current.delete(id);
      syncResumeFailed();
      // Closing the task a reopen was for ends the reopen: there is nothing
      // left to swap to, and the phase would otherwise go on refusing input to
      // whatever the user opens next.
      if (restoringTaskIdRef.current === id) endRestorePhase();
      fetch(`/api/tasks/${id}/close`, { method: "POST" })
        .then(async (res) => {
          if (res.ok) return;
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? res.statusText);
        })
        .catch((e) => {
          console.error("Could not close the task:", e);
          toast.error("Could not close the session", {
            description: e instanceof Error ? e.message : String(e),
          });
        });

      if (id === currentSessionIdRef.current) {
        terminalRef.current?.resetAttached();
        // Handed back rather than only forgotten. Closing is a request now, and
        // a request can fail — a 404, a dropped connection — in which case the
        // terminal is still alive and the server still counts this client as
        // one of its viewers: it clamps smallest-wins size negotiation for
        // everyone else, and `clientCount` never reaching zero means the idle
        // harvester can never take that task (§5.5). On the success path the
        // server has already killed the PTY and the detach is a no-op.
        if (attachedPtyRef.current) {
          ownedPtysRef.current.delete(attachedPtyRef.current);
        ptyRef.current.detach(attachedPtyRef.current);
        }
        // The terminal went with the suspend: leaving these set would keep the
        // killed PTY's `exit` past the message filter and address the next
        // resize at a process that no longer exists.
        attachedPtyRef.current = null;
        setCurrentPtyId(null);
        setCurrentSession(null);
      }
    },
    [setCurrentSession, syncResumeFailed, endRestorePhase],
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
        resumingSessionIds,
        restoringSessionId,
        resumeFailedSessionIds,
        retryResume,
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
        handleRestoreEnd,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
