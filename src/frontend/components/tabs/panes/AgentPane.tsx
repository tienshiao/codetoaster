import { useCallback, useEffect, useRef, useState } from "react";
import { usePty } from "@/frontend/PtyContext";
import { useTasks } from "@/frontend/TaskContext";
import {
  XTerminal,
  type TerminalHandle,
  type TerminalLinkProviderFactory,
  type TerminalSize,
} from "@/frontend/Terminal";
import { Button } from "@/frontend/components/v2/Button";
import { StatusDot } from "@/frontend/components/v2/StatusDot";
import { useFocusRequest } from "@/frontend/hooks/use-focus-request";
import { useTerminalSearch } from "@/frontend/hooks/use-terminal-search";
import { cn } from "@/frontend/lib/utils";
import { TerminalSearchBar } from "./TerminalSearchBar";

/**
 * The agent tab (§7.2): one terminal, bound to one task's PTY.
 *
 * This is the tab host `pty-router` keeps referring to — the thing that decides
 * *when* to attach, because attaching needs a measured grid and only the
 * component holding the terminal has one. Registration (routing frames to this
 * grid) is `XTerminal`'s; attachment (asking the server for the stream) is
 * here.
 *
 * Most of v1's difficulty does not survive the port. `SessionContext` owned one
 * terminal for the whole client and had to repoint it at every task the user
 * visited, so it carried `currentPtyId`, an attachment latch, and a filter that
 * dropped frames belonging to the PTY it had just left. Here each terminal owns
 * exactly one PTY for as long as it is mounted: switching tasks unmounts this
 * pane and mounts another. What is left is the part that was always genuinely
 * hard — the two-phase reopen of §5.5.
 */

/** Where a reopen has got to. `live` is also the state of a task that never
 * needed one. */
type ReopenPhase = "live" | "restoring" | "failed";

export interface AgentPaneProps {
  taskId: string;
  /**
   * Whether this pane's tab is the active one in its group.
   *
   * A hidden terminal stays mounted and stays attached — it still has to
   * receive output, and tearing the grid down on every tab switch would cost a
   * full `restore` to come back — but it stops reporting its size. Negotiation
   * is smallest-wins across every attached client (§5.4), so a stale layout
   * nobody is looking at would otherwise hold the task's grid down to it.
   */
  visible: boolean;
  /** A rising number is the keyboard asking this terminal to take the caret
   * (TASK-34). Moving the layout's focus is not moving the browser's, and a
   * chord that put this pane in front but left the caret elsewhere would be
   * one the user has to finish with the mouse. */
  focusRequest?: number;
  /** A rising number is the strip or the palette asking this pane to open
   * search — the keyboard's ⌘F arrives by the other door, `onSearchOpen`
   * (TASK-58). */
  searchRequest?: number;
  onFileDrop?: (files: File[]) => void;
  /** Extra links in the grid — task ids, in a Backlog.md repository (TASK-86).
   * This is the task's own terminal, so the ids the agent writes here are the
   * first place a link is wanted. */
  linkProvider?: TerminalLinkProviderFactory;
}

export function AgentPane({
  taskId,
  visible,
  focusRequest = 0,
  searchRequest = 0,
  onFileDrop,
  linkProvider,
}: AgentPaneProps) {
  const { tasks, resumeTask } = useTasks();
  const { attach, detach, resize, send, isConnected } = usePty();

  const task = tasks.find((t) => t.id === taskId);
  const ptyId = task?.ptyId ?? null;
  const suspended = task?.lifecycle === "suspended";
  // A task whose checkout was evicted has a directory to rebuild before its
  // agent can start — a `worktree add`, the project's setup command, a cold
  // install — which is seconds of work the user is otherwise left guessing at.
  // The wait is the same wait either way; only the sentence differs (§5.6).
  const restoringWorkspace =
    task?.worktreeState === "evicted" || task?.worktreeState === "missing";
  const hasNotification = task?.hasNotification ?? false;

  const terminalRef = useRef<TerminalHandle>(null);
  useFocusRequest(focusRequest, terminalRef);
  /** What the search bar's ⌘G listens on, so a split's two bars step their own
   * matches — see `TerminalSearchBar`. */
  const root = useRef<HTMLDivElement>(null);
  const search = useTerminalSearch(terminalRef, searchRequest);

  const [phase, setPhase] = useState<ReopenPhase>("live");
  /**
   * Why the reopen failed, when there is a why.
   *
   * The overlay is the one place a resume failure is reported — `resumeTask` is
   * asked not to toast, because a toast saying almost the same sentence beside
   * a persistent affordance is the duplication `RequestOptions` exists to
   * settle. Carrying the reason here is what makes that trade honest: the toast
   * had the cause and the overlay's fixed string did not.
   *
   * Null for the failure that has no message to carry — the ladder ran, tried
   * every rung and gave up, which arrives as a 200 whose row says
   * `could_not_resume` (§4.3) and never toasted anything either way.
   */
  const [failure, setFailure] = useState<string | null>(null);
  // Read as a guard from a fetch callback, in the same commit that writes it,
  // so the ref is the authority and the state only catches the render up.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  /** The last grid measured against a *visible* container. Never fabricated:
   * an invented 80×24 must not enter smallest-wins as this client's real
   * measurement. */
  const sizeRef = useRef<TerminalSize | null>(null);

  // Whether this pane has ever held a live PTY. Declared before the reopen
  // effect below, because effects run in declaration order and this is the fact
  // that one is conditioned on.
  //
  // It is what separates "the user opened a resting task" from "the task the
  // user is looking at was suspended out from under them" — by the harvester,
  // or by another client, or by their own close. Only the first is a reopen.
  // Auto-reopening the second would spawn `claude --resume` the instant the
  // user closed a task, which is the one thing a close must not do.
  const hadPtyRef = useRef(false);
  useEffect(() => {
    if (ptyId) hadPtyRef.current = true;
  }, [ptyId]);

  // One reopen per visit. This effect re-runs on every task delta, and those
  // never stop while any other task is busy, so a failure that retried itself
  // would retry forever. The button below is the retry; leaving the task and
  // coming back is the other one, and it needs no clearing because leaving
  // unmounts this pane.
  const reopenedRef = useRef(false);

  const reopen = useCallback(async () => {
    reopenedRef.current = true;
    setPhase("restoring");
    // The read-only phase opens before either request goes out (§5.5). The
    // ordering is the whole trick: the two race, and a resume that comes back
    // first must not have a snapshot painted over its live output afterwards —
    // so painting is conditional on the phase still standing, and the phase can
    // only still be standing if nothing live has been painted.
    terminalRef.current?.beginRestore();

    // In parallel with the resume, not after it: showing the user where they
    // left off must not wait on a process that takes seconds to come back, and
    // the agent does not exist yet to serve it over the socket anyway.
    void fetch(`/api/tasks/${taskId}/scrollback`)
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json();
        // A task with no stored screen is a normal answer (one suspended before
        // snapshots existed, or an agent that died before one ran): there is
        // nothing to repaint, and the phase goes on waiting for the live PTY.
        if (typeof body?.data !== "string") return;
        if (phaseRef.current !== "restoring") return;
        terminalRef.current?.paintSnapshot(body.data, body.size ?? null);
      })
      .catch(() => {
        // Nothing to say. The snapshot is a courtesy — the resume is what the
        // click was for, and it reports its own failures.
      });

    // The request needs a concrete grid, so this one falls back. It is the one
    // place a fabricated size is allowed, and it goes to the server rather than
    // to the router: it seeds the respawned PTY, and a task that came back at
    // 80×24 would reflow the snapshot the user returned to read.
    const size = sizeRef.current ?? terminalRef.current?.getSize() ?? { cols: 80, rows: 24 };
    const result = await resumeTask(
      taskId,
      { cols: size.cols, rows: size.rows },
      { inline: true },
    );

    // A 200 is not by itself a success: the route answers with the row whatever
    // the ladder managed, and a task that could not be reopened is a card with
    // a button on it (§4.3), not an HTTP error.
    if (result.ok && result.value.agentState !== "could_not_resume") return;

    setFailure(result.ok ? null : result.error.message);
    setPhase("failed");
    // No agent is coming, so nothing will ever swap the grid over: left
    // standing, the phase would sit on "resuming…" and refuse input for as long
    // as the tab was open. The snapshot stays painted underneath the failure —
    // it is still the last true thing this task showed.
    terminalRef.current?.endRestore();
  }, [taskId, resumeTask]);

  // Opening a suspended task is what resumes it (§6). Deliberately not keyed on
  // the task object, whose identity changes on every activity delta.
  const known = task != null;
  useEffect(() => {
    if (!known || !suspended || hadPtyRef.current || reopenedRef.current) return;
    void reopen();
  }, [known, suspended, reopen]);

  // Attaching is this host's call. Keyed on the connection as well as the PTY
  // because a reconnect clears every attachment the client held
  // (`handleConnect`) while the ptyId usually survives it — so without
  // `isConnected` here the one terminal on screen would be the one terminal
  // that never came back.
  useEffect(() => {
    if (!ptyId || !isConnected) return;
    // The grid may still be showing the PTY this one replaced — a `fresh`
    // resume swaps a live terminal outright — and until the new `attached`
    // lands there is nowhere for a keystroke to go.
    terminalRef.current?.resetAttached();
    attach(ptyId, sizeRef.current);
    return () => detach(ptyId);
  }, [ptyId, isConnected, attach, detach]);

  // Going hidden stops the reporting; coming back resumes it. Re-reported on
  // the way back rather than left to the resize observer, which only fires on
  // an actual geometry change — and a tab very often returns at exactly the
  // size it left at.
  useEffect(() => {
    if (!ptyId) return;
    if (!visible) {
      resize(ptyId, null);
    } else if (sizeRef.current) {
      resize(ptyId, sizeRef.current);
    }
  }, [ptyId, visible, resize]);

  // Acknowledging a notification means "the user has seen it", so it needs the
  // window to actually have focus. One raised while this tab sits in a
  // background window is cleared by nobody, which is the whole point of having
  // raised it.
  useEffect(() => {
    if (!visible || !hasNotification) return;
    const acknowledge = () => {
      if (document.hasFocus()) send({ type: "acknowledge", taskId });
    };
    acknowledge();
    window.addEventListener("focus", acknowledge);
    return () => window.removeEventListener("focus", acknowledge);
  }, [visible, hasNotification, taskId, send]);

  const handleSizeChange = useCallback(
    (size: TerminalSize) => {
      // Only ever called against a visible container: `fitIfVisible` returns
      // early on a hidden or zero-sized one without notifying.
      sizeRef.current = size;
      if (ptyId) resize(ptyId, size);
    },
    [ptyId, resize],
  );

  // The phase ending from inside the terminal: the resumed agent painted, so
  // the grid is live again and the affordance comes down. Guarded so it cannot
  // promote a failure back to `live` — `endRestore` above leaves the phase
  // without a swap, and a stray callback afterwards would clear the one thing
  // telling the user what happened.
  const handleRestoreEnd = useCallback(() => {
    setPhase((current) => (current === "restoring" ? "live" : current));
  }, []);

  const retry = useCallback(() => {
    reopenedRef.current = false;
    setFailure(null);
    void reopen();
  }, [reopen]);

  // Read from the ref during render, which is only safe because `open` can
  // become true no earlier than an event after mount — by then the terminal is
  // there and its addon with it.
  const searchAddon = search.open ? terminalRef.current?.getSearchAddon() : null;

  return (
    <div ref={root} className="relative h-full">
      <XTerminal
        ref={terminalRef}
        ptyId={ptyId}
        onSizeChange={handleSizeChange}
        // No `onReady`: the task snapshot is asked for by `TaskContext` on
        // connect, not by a terminal going ready — v1 asked from here, which
        // meant a route with no terminal ever got a list at all.
        sendMessage={send}
        onSearchOpen={search.openSearch}
        onFileDrop={onFileDrop}
        onRestoreEnd={handleRestoreEnd}
        linkProvider={linkProvider}
      />
      {searchAddon ? (
        <TerminalSearchBar
          searchAddon={searchAddon}
          onClose={search.closeSearch}
          activation={search.activation}
          scope={root}
        />
      ) : null}
      <Overlay
        phase={phase}
        failure={failure}
        restoringWorkspace={restoringWorkspace}
        // A suspended task with the phase already settled: it was suspended out
        // from under the view, or a reopen failed and was dismissed. Either way
        // the way back is a click, not something that happens on its own.
        resting={suspended && phase === "live"}
        onReopen={retry}
      />
    </div>
  );
}

/**
 * What the reopen looks like, said out loud (§5.5).
 *
 * An overlay rather than a line written into the grid: the swap resets the
 * terminal, which would wipe anything written there, and until it does the grid
 * is holding the snapshot — a banner typed into it would corrupt the one thing
 * the user came back to see. Sized to stay out of the way for the same reason,
 * and click-through except for the button that is there to be clicked.
 *
 * **Not a `Notice`, and the reason is the same snapshot** (TASK-70). A Notice
 * sits in the flow and pushes the pane down, which for this pane means giving
 * the terminal a different height: that renegotiates the grid and reflows the
 * restored scrollback — rewrapping the screen the user came back to read, at
 * the exact moment they came back to read it. Notice's own comment draws the
 * line at transient-versus-state and puts this on the transient side, which is
 * only half right — `Suspended` waits for an answer and is a state — but it
 * lands in the right place for the better reason.
 *
 * What it is not allowed to be is *off the system*, which it was: the only
 * `rounded-full` chrome in the app, over a `bg-pane/95` and a raw `shadow-lg`,
 * with a hand-set button height and a status dot rolled by hand. It floats;
 * it still uses the same radius, surface, shadow, control sizes and dot as
 * everything else.
 */
function Overlay({
  phase,
  failure,
  resting,
  restoringWorkspace,
  onReopen,
}: {
  phase: ReopenPhase;
  /** What went wrong, when the server said. */
  failure: string | null;
  resting: boolean;
  /** Whether this reopen has a checkout to rebuild before the agent starts. */
  restoringWorkspace: boolean;
  onReopen: () => void;
}) {
  if (phase === "live" && !resting) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-3 rounded-md border border-border",
          "bg-pane py-1.5 pl-3 pr-1.5 text-sm text-muted-foreground shadow-overlay",
        )}
      >
        {phase === "restoring" ? (
          <>
            <StatusDot state="busy" />
            <span className="pr-2.5">
              {restoringWorkspace ? "Restoring workspace…" : "Suspended — resuming…"}
            </span>
          </>
        ) : (
          <>
            <span>
              {phase === "failed" ? "Could not resume this task" : "Suspended"}
              {failure ? (
                // The cause, where the toast used to carry it. Truncated by the
                // card rather than by us: a network error can be a paragraph,
                // and the sentence in front of it is the part that must stay
                // readable.
                <span className="ml-2 max-w-[28ch] truncate align-bottom text-subtle-foreground">
                  {failure}
                </span>
              ) : null}
            </span>
            <Button variant="outline" size="sm" onClick={onReopen}>
              {phase === "failed" ? "Try again" : "Reopen"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
