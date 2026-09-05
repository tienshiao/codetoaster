import { useCallback, useEffect, useRef } from "react";
import { stepKeymap, type ShellCommand } from "@/frontend/keymap";
import {
  activeTab,
  canSplit,
  closeTab,
  cycleTab,
  findAgentTab,
  focusGroup,
  focusTab,
  focusTabAt,
  splitTab,
  type TabState,
  type TaskLayout,
} from "@/frontend/layout-store";

export interface ShellKeymapOptions {
  /**
   * The layout *as of the moment a chord fires*, which is not the same as the
   * one the last render saw. Two chords inside one commit — `⌘K ] ⌘K ]`, typed
   * at speed — would otherwise both reduce over the first render's layout, and
   * the second would undo rather than continue the first.
   *
   * A getter rather than the value, because the caller already holds a ref
   * that its own writes keep current: `TaskShell` maintains one for exactly
   * this reason, and the hazard it documents there is this one.
   *
   * Null at the composer, where there is no task and so no tabs to move.
   */
  layout: () => TaskLayout | null;
  onLayoutChange: (next: TaskLayout) => void;
  /** Spawns a shell and opens its tab — the same door as the strip's `+`. */
  onNewShell?: () => void;
  /** The side effect the strip's X runs beside the layout change: closing a
   * shell tab is what kills its shell. */
  onCloseTab?: (tab: TabState) => void;
  /**
   * Asks whatever pane is now in front to take the caret.
   *
   * Moving the *layout's* focus and moving the browser's are two different
   * things, and only the first is a reduction: `⌘K A` that put the agent tab
   * in front but left the caret in a file tree would be a shortcut the user
   * has to finish with the mouse.
   *
   * Raised only for the commands that navigate, and only by the keyboard —
   * clicking a tab goes on doing what it has always done. A pulse rather than
   * a target, because the pane that should take it is the one the layout says
   * is in front, and the layout has just been told.
   */
  onFocusPane?: () => void;
  /**
   * Opens or closes the command palette.
   *
   * The one command that is not about the layout at all, so it fires with or
   * without a task — at the composer, where there are no tabs to move, the
   * palette is the more useful of the two, not the less.
   */
  onTogglePalette?: () => void;
}

/** What the hook hands back: the dispatcher, for callers that raise a command
 * from something other than the keyboard. */
export interface ShellKeymap {
  run: (command: ShellCommand) => void;
}

/**
 * Binds the leader map (TASK-34, `keymap.ts`) to the layout.
 *
 * ## Capture, and why it has to be
 *
 * The listener is on `window` in the *capture* phase, so it runs before the
 * handler xterm has on its own textarea. Consuming there — `preventDefault`
 * and `stopPropagation` together — means the key never reaches the terminal at
 * all, and no `keypress` or `input` follows it either. The alternative, a
 * bubble-phase listener, arrives after the agent has already been sent the
 * keystroke, which for a chord's second press is a stray character in whatever
 * the agent was reading.
 *
 * ## Why nothing here checks what is focused
 *
 * A global keydown listener normally has to stand down while the user is in a
 * text field. This one does not, because the leader is ⌘K / ⌃⇧K: not a chord
 * any input treats as text, and not one any input binds. Everything else the
 * map claims is only reachable *after* that press, and a keystroke that lands
 * mid-chord belonging to the chord rather than to the field is what a chord
 * is.
 */
export function useShellKeymap(options: ShellKeymapOptions): ShellKeymap {
  // Read through a ref rather than named in the effect's deps: the handlers
  // change on every render, and rebinding a window listener that often is both
  // wasteful and a way to lose an armed leader to a re-run.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** When the leader was pressed, or null. Held across renders and never
   * rendered from, so a ref rather than state — nothing on screen changes
   * between the two presses of a chord. */
  const armedAtRef = useRef<number | null>(null);

  /**
   * Dispatch one command, whatever raised it.
   *
   * Returned as well as bound to the keyboard because the palette lists these
   * same rows and has to run them through these same handlers. A second copy of
   * this switch is a copy that drifts — a command gains a guard or a side effect
   * on one path and not the other, and the chord and its palette entry stop
   * meaning the same thing.
   *
   * Stable, and safe to be: everything it touches it reads off `optionsRef` at
   * call time, so a caller can put it in a dependency array without rebinding
   * on every render.
   */
  const run = useCallback((command: ShellCommand) => {
    const {
      layout: read,
      onLayoutChange,
      onNewShell,
      onCloseTab,
      onTogglePalette,
    } = optionsRef.current;

    // The one command that is not a reduction over the layout: it spawns,
    // and opens its own tab when the spawn answers.
    if (command.command === "new-shell") {
      onNewShell?.();
      return;
    }
    // Not a reduction either, and unlike every other row it does not need a
    // layout to act on — so it is answered above the null check, not below it.
    if (command.command === "palette") {
      onTogglePalette?.();
      return;
    }
    const layout = read();
    if (!layout) return;

    /** A navigation: apply it, and send the caret after it. Skipped when the
     * reduction changed nothing, so a clamped `⌘K ←` at the leftmost group
     * does not yank focus out of whatever the user was typing in. */
    const navigate = (next: TaskLayout) => {
      if (next === layout) return;
      onLayoutChange(next);
      optionsRef.current.onFocusPane?.();
    };

    switch (command.command) {
      case "next-tab":
        return navigate(cycleTab(layout, 1));
      case "prev-tab":
        return navigate(cycleTab(layout, -1));
      case "jump-tab":
        return command.index ? navigate(focusTabAt(layout, command.index)) : undefined;
      case "focus-group-left":
        return navigate(focusGroup(layout, -1));
      case "focus-group-right":
        return navigate(focusGroup(layout, 1));
      case "focus-agent": {
        const agent = findAgentTab(layout);
        // Not through `navigate`: the agent tab can already be in front and
        // merely not have the caret — the user clicked into the file tree
        // and wants to get back — and that is the case the chord is most
        // used for.
        if (!agent) return;
        onLayoutChange(focusTab(layout, agent.id));
        return optionsRef.current.onFocusPane?.();
      }
      case "split": {
        // Asked rather than assumed: a terminal tab is never splittable, so
        // on the agent tab — where the user spends most of their time — this
        // chord does nothing, exactly as the strip's split control is absent
        // there.
        const tab = activeTab(layout);
        return tab && canSplit(layout, tab.id)
          ? onLayoutChange(splitTab(layout, tab.id))
          : undefined;
      }
      case "close-tab": {
        const tab = activeTab(layout);
        // The agent tab is the task: closing it would mean killing the task,
        // which is the task list's action. `closeTab` refuses it too, but
        // the guard belongs here as well so the side effect below does not
        // run for a close that will not happen.
        if (!tab || tab.descriptor.kind === "agent") return;
        onCloseTab?.(tab);
        return onLayoutChange(closeTab(layout, tab.id));
      }
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const step = stepKeymap(armedAtRef.current, ev, Date.now());
      armedAtRef.current = step.armedAt;
      if (step.result.kind === "idle") return;

      // Armed, cancelled and command all consume. A leader that let its own
      // press through would type a `k` into the agent before the chord had
      // even begun, and an unbound second press that fell through would be the
      // stray keystroke the map exists to prevent.
      ev.preventDefault();
      ev.stopPropagation();
      if (step.result.kind === "command") run(step.result.command);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // `run` is stable, so naming it changes nothing about when this rebinds —
    // it is here because the listener closes over it.
  }, [run]);

  return { run };
}
