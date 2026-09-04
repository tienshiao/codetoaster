import { useEffect, useRef } from "react";
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
export function useShellKeymap(options: ShellKeymapOptions): void {
  // Read through a ref rather than named in the effect's deps: the handlers
  // change on every render, and rebinding a window listener that often is both
  // wasteful and a way to lose an armed leader to a re-run.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** When the leader was pressed, or null. Held across renders and never
   * rendered from, so a ref rather than state — nothing on screen changes
   * between the two presses of a chord. */
  const armedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const run = (command: ShellCommand) => {
      const { layout: read, onLayoutChange, onNewShell, onCloseTab } = optionsRef.current;

      // The one command that is not a reduction over the layout: it spawns,
      // and opens its own tab when the spawn answers.
      if (command.command === "new-shell") {
        onNewShell?.();
        return;
      }
      const layout = read();
      if (!layout) return;

      switch (command.command) {
        case "next-tab":
          return onLayoutChange(cycleTab(layout, 1));
        case "prev-tab":
          return onLayoutChange(cycleTab(layout, -1));
        case "jump-tab":
          return command.index ? onLayoutChange(focusTabAt(layout, command.index)) : undefined;
        case "focus-group-left":
          return onLayoutChange(focusGroup(layout, -1));
        case "focus-group-right":
          return onLayoutChange(focusGroup(layout, 1));
        case "focus-agent": {
          const agent = findAgentTab(layout);
          return agent ? onLayoutChange(focusTab(layout, agent.id)) : undefined;
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
    };

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
  }, []);
}
