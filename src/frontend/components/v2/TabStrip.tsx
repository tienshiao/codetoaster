import type { MouseEvent, PointerEvent, ReactNode, Ref } from "react";
import {
  Columns2,
  EllipsisVertical,
  FileDiff,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  GitCompare,
  Pin,
  Plus,
  Search,
  Sparkles,
  Terminal,
  X,
  type LucideIcon,
} from "lucide-react";
import { IconButton } from "./IconButton";
import { chordHint, searchHint } from "@/frontend/keymap";
import { cn } from "@/frontend/lib/utils";

/** The §7.2 TabDescriptor kinds. */
export type TabKind = "agent" | "shell" | "diff" | "diffAll" | "file" | "commit" | "history";

/** Tab kind is the only colour in the strip, so the map is part of the contract. */
export const TAB_KINDS: Record<TabKind, { icon: LucideIcon; color: string }> = {
  agent: { icon: Sparkles, color: "text-state-busy" },
  shell: { icon: Terminal, color: "text-chart-3" },
  diff: { icon: FileDiff, color: "text-success" },
  diffAll: { icon: GitCompare, color: "text-success" },
  file: { icon: FileText, color: "text-muted-foreground" },
  commit: { icon: GitCommitHorizontal, color: "text-chart-2" },
  history: { icon: GitBranch, color: "text-chart-2" },
};

export interface TabProps {
  kind?: TabKind;
  label: string;
  /** Trailing mono detail — a sha, a line number, a diff stat. */
  detail?: string;
  active?: boolean;
  /** VSCode's preview tab: italic, and the next single click replaces it. */
  preview?: boolean;
  closable?: boolean;
  onClick?: () => void;
  onClose?: () => void;
  /** Pins a preview tab, the VSCode gesture. */
  onDoubleClick?: () => void;
  /** Native tooltip. A basename is ambiguous across directories and the strip
   * has no room to say which one this is. */
  title?: string;
  /** The chord that closes this tab, appended to the close control's tooltip;
   * set only for the tab the chord would actually close. */
  closeHint?: string;
  className?: string;

  // ── drag ──
  // The strip is drawn from props alone, so a drag has to be expressible as
  // props: the id to hit-test against, the gesture that starts it, and the two
  // pieces of feedback it produces. `TabArea` supplies all four; a static strip
  // supplies none and renders exactly as it did before.

  /** Emitted as `data-tab-id`, which is how a drag identifies what is under
   * the pointer without a registry of refs. */
  tabId?: string;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  /** This tab is the one being dragged: dimmed, so the strip shows where it
   * came from while the indicator shows where it would land. */
  dragging?: boolean;
  /** Draw the drop indicator on this tab's leading edge. */
  dropBefore?: boolean;
  /** ...or its trailing edge, which is the only way to say "after the last
   * tab" without a phantom element to hang it on. */
  dropAfter?: boolean;
}

export function Tab({
  kind = "file",
  label,
  detail,
  active = false,
  preview = false,
  closable = true,
  onClick,
  onClose,
  onDoubleClick,
  title,
  closeHint,
  className,
  tabId,
  onPointerDown,
  dragging = false,
  dropBefore = false,
  dropAfter = false,
}: TabProps) {
  const { icon: Icon, color } = TAB_KINDS[kind];
  // The agent tab is prose; everything else names something a shell would take.
  const mono = kind !== "agent";
  const closeTab = (e: MouseEvent) => {
    e.stopPropagation();
    onClose?.();
  };
  return (
    // The close control cannot nest inside the tab's own <button>, so the tab
    // chrome is a presentational wrapper and role="tab" sits on the label half.
    <div
      role="presentation"
      data-tab-id={tabId}
      title={title}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        "relative flex h-tabstrip flex-none items-center border-r border-border pr-2",
        active ? "bg-pane text-foreground shadow-[inset_0_2px_0_var(--primary)]" : "text-muted-foreground",
        dragging && "opacity-40",
        className,
      )}
    >
      {(dropBefore || dropAfter) && (
        // A 2px rule in the primary, drawn over the tab rather than between
        // tabs: an element in the flow would shift every tab right of it by its
        // own width and make the strip twitch under the pointer.
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 w-0.5 bg-primary",
            dropBefore ? "left-0" : "right-0",
          )}
        />
      )}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onClick}
        className={cn(
          "flex h-full cursor-pointer items-center gap-[7px] pl-3 pr-1 text-left",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
        )}
      >
        <Icon size={12} className={cn("flex-none", color)} />
        <span
          className={cn(
            "max-w-[180px] truncate",
            mono ? "font-mono text-xs tracking-mono" : "font-sans text-sm tracking-ui",
            active && !mono ? "font-medium" : "font-normal",
            preview && "italic",
          )}
        >
          {label}
        </span>
        {detail ? (
          <span className="font-mono text-micro tracking-mono text-subtle-foreground">{detail}</span>
        ) : null}
      </button>
      {closable && onClose ? (
        <button
          type="button"
          data-tab-close=""
          aria-label={`Close ${label}`}
          // The chord is named only where the strip says it applies — see
          // `closeHint`. A tab that is not the one the key would close
          // advertises nothing.
          title={closeHint ? `Close ${label} (${closeHint})` : `Close ${label}`}
          onClick={closeTab}
          className="ml-0.5 flex-none cursor-pointer rounded-sm p-0.5 text-subtle-foreground hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          <X size={11} />
        </button>
      ) : closable ? (
        <X size={11} className="ml-0.5 flex-none text-subtle-foreground" />
      ) : (
        // The agent tab is pinned by definition; the glyph says so, it does not act.
        <Pin size={11} className="ml-0.5 flex-none text-subtle-foreground opacity-50" />
      )}
    </div>
  );
}

export interface TabStripProps {
  tabs?: TabProps[];
  /** The trailing split / overflow cluster. */
  actions?: boolean;
  onSplit?: () => void;
  /** Terminal tabs are never splittable (§7.2), so the command greys out
   * rather than disappearing — a control that vanishes reads as a bug. */
  splitDisabled?: boolean;
  /** Open search in this strip's active tab — the mouse's way into the
   * terminal search bar (TASK-58). Absent on a strip with nothing behind it to
   * answer, where the button would be chrome that does nothing. */
  onSearch?: () => void;
  /** Only a terminal has a grid to search, so the magnifier greys out in front
   * of a diff or a file rather than disappearing — the same reason Split does,
   * and the same rule: a control that vanishes reads as a bug. */
  searchDisabled?: boolean;
  /** This strip's group is the one the leader chords act on — the layout's
   * active group. Defaults to true, for a lone strip. Only the chord hints read
   * it: a strip that is not focused still closes and splits by click, it just
   * does not name a key that would act on a different group. */
  focused?: boolean;
  onTabActions?: () => void;
  /** Open a plain shell in this task as a new tab (§3). Absent on a strip that
   * has no task behind it — a design-system preview, say — where the button
   * would be chrome that does nothing. */
  onNewShell?: () => void;
  /** Emitted as `data-tab-group`: what a drag hit-tests to find the strip it is
   * over, and what tells `TabArea` which group a drop belongs to. */
  groupId?: string;
  /** Focus the group. A click anywhere in the strip — including the empty
   * stretch past the last tab — is a click on this group. */
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  ref?: Ref<HTMLDivElement>;
  /** Chrome pinned before the first tab — the shell hangs its left-sidebar
   * toggle here, where it stays put as tabs come and go. */
  leading?: ReactNode;
  /** Chrome pinned after the action cluster, at the strip's trailing edge. */
  trailing?: ReactNode;
  className?: string;
}

export function TabStrip({
  tabs = [],
  actions = true,
  onSplit,
  splitDisabled = false,
  onSearch,
  searchDisabled = false,
  focused = true,
  onTabActions,
  onNewShell,
  groupId,
  onPointerDown,
  ref,
  leading,
  trailing,
  className,
}: TabStripProps) {
  return (
    <div
      ref={ref}
      role="tablist"
      data-tab-group={groupId}
      onPointerDown={onPointerDown}
      className={cn(
        // `select-none`: a press in the strip is a click or the start of a tab
        // drag, never the start of a selection. `body[data-dragging]` suppresses
        // selection once a drag is live, but only from the threshold on — the
        // first few pixels would otherwise have already anchored one here and be
        // painting the panes the drag crosses.
        "flex h-tabstrip flex-none select-none items-stretch overflow-hidden border-b border-border bg-chrome",
        className,
      )}
    >
      {leading ? (
        <div role="presentation" className="flex flex-none items-center pl-1.5 pr-1">
          {leading}
        </div>
      ) : null}
      {/* The tabs scroll; the action cluster does not. A group narrowed by a
          split fills its strip long before it runs out of tabs, and a Split
          button that has been pushed off the end of the strip is a command the
          user can no longer reach. The scrollbar itself is hidden: 36px of
          chrome has no room for one, and the strip is dragged, not scrolled. */}
      <div
        role="presentation"
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t, i) => (
          <Tab
            key={t.tabId ?? i}
            {...t}
            // The chord closes what is in front of the *focused* group, so only
            // that group's front tab may name it. Otherwise the hint would point
            // at a key that closes a tab in the group beside it.
            closeHint={focused && t.active ? chordHint("close-tab") : undefined}
          />
        ))}
      </div>
      {actions || trailing ? (
        <div role="presentation" className="flex flex-none items-center gap-0.5 px-2">
          {actions ? (
            <>
              {onNewShell ? (
                <IconButton
                  icon={Plus}
                  label="New shell"
                  // Where the shortcuts are found by someone who has not been
                  // told there are any (TASK-34): on the control that does the
                  // same thing.
                  hint={chordHint("new-shell")}
                  size="sm"
                  onClick={onNewShell}
                />
              ) : null}
              {onSearch !== undefined ? (
                <IconButton
                  icon={Search}
                  label={searchDisabled ? "Find (terminal tabs only)" : "Find in terminal"}
                  // Not on the disabled one, and not on an unfocused group's:
                  // ⌘F is answered by whichever terminal has the caret, so a
                  // hint beside a control that will not act — or that would
                  // search the group beside it — is a chord that appears
                  // broken.
                  hint={searchDisabled || !focused ? undefined : searchHint()}
                  size="sm"
                  disabled={searchDisabled}
                  onClick={onSearch}
                />
              ) : null}
              <IconButton
                icon={Columns2}
                label={splitDisabled ? "Split right (not available for terminals)" : "Split right"}
                // Not on the disabled one, and not on an unfocused group's: a
                // chord advertised beside a control that will not act — or that
                // would split the other group's tab — is a chord that appears
                // broken.
                hint={splitDisabled || !focused ? undefined : chordHint("split")}
                size="sm"
                disabled={splitDisabled}
                onClick={onSplit}
              />
              <IconButton icon={EllipsisVertical} label="Tab actions" size="sm" onClick={onTabActions} />
            </>
          ) : null}
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
