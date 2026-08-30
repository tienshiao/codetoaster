import type { MouseEvent, ReactNode } from "react";
import {
  Columns2,
  EllipsisVertical,
  FileDiff,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  GitCompare,
  Pin,
  Sparkles,
  Terminal,
  X,
  type LucideIcon,
} from "lucide-react";
import { IconButton } from "./IconButton";
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
  className?: string;
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
  className,
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
      className={cn(
        "flex h-tabstrip flex-none items-center border-r border-border pr-2",
        active ? "bg-pane text-foreground shadow-[inset_0_2px_0_var(--primary)]" : "text-muted-foreground",
        className,
      )}
    >
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
          aria-label={`Close ${label}`}
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
  onTabActions?: () => void;
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
  onTabActions,
  leading,
  trailing,
  className,
}: TabStripProps) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex h-tabstrip flex-none items-stretch overflow-hidden border-b border-border bg-chrome",
        className,
      )}
    >
      {leading ? (
        <div role="presentation" className="flex flex-none items-center pl-1.5 pr-1">
          {leading}
        </div>
      ) : null}
      {tabs.map((t, i) => (
        <Tab key={i} {...t} />
      ))}
      {actions || trailing ? (
        <div role="presentation" className="ml-auto flex flex-none items-center gap-0.5 px-2">
          {actions ? (
            <>
              <IconButton icon={Columns2} label="Split right" size="sm" onClick={onSplit} />
              <IconButton icon={EllipsisVertical} label="Tab actions" size="sm" onClick={onTabActions} />
            </>
          ) : null}
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
