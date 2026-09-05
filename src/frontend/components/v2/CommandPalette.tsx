import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Command, defaultFilter } from "cmdk";
import { Search, type LucideIcon } from "lucide-react";
import { KeyHint } from "./KeyHint";
import { StatusDot, type TaskState } from "./StatusDot";
import { cn } from "@/frontend/lib/utils";

/** One row. Presentational only — what it *does* is the host's business, which
 * is why nothing here carries a callback. */
export interface PaletteItem {
  /** Unique across every group; what cmdk keys on and what `onSelect` hands back. */
  id: string;
  label: string;
  /** Lucide glyph; ignored when `state` is set. */
  icon?: LucideIcon;
  /** The agent-state dot, for task rows. */
  state?: TaskState;
  /** Mono tail: a path, a sha, a project. */
  detail?: string;
  /** Chord caps, drawn with KeyHint. */
  keys?: string[];
  /** Extra words the filter matches beyond the label (a task's last message, a full path). */
  keywords?: string[];
  /** Drawn regardless of the query — rows a server search already narrowed. */
  forceMount?: boolean;
  /** Replaces the plain label when set, e.g. a path with matched characters emphasised. */
  labelNode?: ReactNode;
}

export interface PaletteGroup {
  id: string;
  /**
   * The section heading. Unique across the groups of one palette: cmdk derives
   * a group's own sort key from its heading text, so two sections called the
   * same thing are one section as far as re-ordering is concerned.
   */
  label: string;
  items: PaletteItem[];
}

export interface CommandPaletteProps {
  open: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  placeholder?: string;
  groups: PaletteGroup[];
  onSelect: (item: PaletteItem) => void;
  /** Escape or the scrim. A selection does not call this — the host decides what follows a selection. */
  onDismiss: () => void;
  /** Shown as the empty state; default "No matches." */
  emptyLabel?: string;
  /** A trailing note under the list (e.g. "Searching files…"). */
  footer?: ReactNode;
}

/**
 * The scoring haystack for one row.
 *
 * cmdk matches against an item's `value`, and `value` here is an id — a uuid
 * behind a `task:` prefix, which is text no user types and which would make
 * every task row match the query "task". So the id is kept for identity and
 * the filter below is pointed at this instead: the words that are actually on
 * the row, plus whatever the builder added.
 */
function haystack(item: PaletteItem): string[] {
  return [item.label, item.detail, ...(item.keywords ?? [])].filter(
    (word): word is string => !!word,
  );
}

/** Ignore the id and score the words. `keywords` is never empty for a row built
 * by `palette-items.ts` — the fallback is for a hand-built one. */
function filterByKeywords(value: string, search: string, keywords?: string[]): number {
  return defaultFilter(keywords?.length ? keywords.join(" ") : value, search);
}

/**
 * The v2 command palette: a scrim, a query, and grouped rows over `cmdk`.
 *
 * Presentational. It knows nothing about tasks, tabs or commands — the host
 * builds `groups` (see `palette-items.ts`) and decides what a selection means.
 *
 * The overlay is ours rather than `Command.Dialog`'s, for the reason `Dialog`
 * gives at length: `Command.Dialog` is Radix Dialog, and the v2 surface does
 * not grow a dependency on it. What is borrowed from `Dialog` is the shape of
 * the thing — a portal to `document.body`, a scrim that dismisses on its own
 * mousedown, and Escape read off the document through a ref. It sits near the
 * top of the window rather than centred, because the list grows downwards and a
 * centred panel would walk up the screen as results arrive.
 */
export function CommandPalette({
  open,
  query,
  onQueryChange,
  placeholder = "Search tasks, tabs, files, actions…",
  groups,
  onSelect,
  onDismiss,
  emptyLabel = "No matches.",
  footer,
}: CommandPaletteProps) {
  const input = useRef<HTMLInputElement>(null);

  // Through a ref, not a dependency: callers pass a closure literal, so
  // `onDismiss` has a new identity every render and depending on it would
  // rebind the listener — and re-run the focus below — on every keystroke,
  // dragging the caret back to the start of the query. Same reasoning as
  // `Dialog`, same bug.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss.current();
    };
    document.addEventListener("keydown", onKeyDown);
    // `autoFocus` on the input already does this on mount; the explicit call is
    // for the case where the palette is reopened into a tree React kept alive.
    input.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  const shown = groups.filter((g) => g.items.length > 0);

  // A force-mounted row bypasses the filter, and bypasses the store that counts
  // matches with it — so cmdk reports "nothing matched" while server-filtered
  // file rows are on screen. Suppress the empty state whenever any such row
  // exists rather than trusting a count that cannot see them.
  const hasForceMounted = shown.some((g) => g.items.some((i) => i.forceMount));

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-start justify-items-center bg-[oklch(0_0_0/0.45)] p-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <Command
        role="dialog"
        aria-label="Command palette"
        // Names the input, which is a combobox and would otherwise have none.
        // cmdk renders it as a visually hidden <label>.
        label="Command palette"
        loop
        filter={filterByKeywords}
        className={cn(
          "flex w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-border",
          "bg-popover font-sans text-sm leading-ui tracking-ui text-popover-foreground shadow-overlay",
        )}
      >
        <div className="flex h-10 flex-none items-center gap-2 border-b border-border px-3">
          <Search size={14} className="flex-none text-subtle-foreground" />
          <Command.Input
            ref={input}
            autoFocus
            value={query}
            onValueChange={onQueryChange}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-subtle-foreground"
          />
          <KeyHint keys={["esc"]} />
        </div>

        <Command.List className="flex max-h-[320px] flex-col gap-px overflow-y-auto px-1 py-1.5">
          {hasForceMounted ? null : (
            <Command.Empty className="px-2.5 py-2 text-muted-foreground">{emptyLabel}</Command.Empty>
          )}
          {shown.map((group) => (
            <Command.Group
              key={group.id}
              heading={group.label}
              // cmdk hides a group during a search unless one of its *registered*
              // items matched, and a force-mounted item registers nothing — so a
              // section the server filtered would vanish the moment anything was
              // typed. Force-mounting the group is what keeps it on screen, and
              // it force-mounts its items in turn: a group is therefore either
              // wholly server-filtered or wholly locally filtered, never mixed.
              forceMount={group.items.some((i) => i.forceMount)}
              className={cn(
                "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:pt-1.5",
                "[&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-semibold",
                "[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-label",
                "[&_[cmdk-group-heading]]:text-subtle-foreground",
                "[&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-col [&_[cmdk-group-items]]:gap-px",
              )}
            >
              {group.items.map((item) => (
                <Row key={item.id} item={item} onSelect={onSelect} />
              ))}
            </Command.Group>
          ))}
        </Command.List>

        {footer ? (
          <div className="flex-none border-t border-border px-3 py-1.5 text-micro text-subtle-foreground">
            {footer}
          </div>
        ) : null}
      </Command>
    </div>,
    document.body,
  );
}

function Row({ item, onSelect }: { item: PaletteItem; onSelect: (item: PaletteItem) => void }) {
  const Icon = item.icon;
  return (
    <Command.Item
      value={item.id}
      keywords={haystack(item)}
      forceMount={item.forceMount}
      // The item, not the value cmdk hands back: the closure already has the
      // row, and nothing then depends on cmdk's normalisation of `value`.
      onSelect={() => onSelect(item)}
      className={cn(
        "flex h-control-lg cursor-pointer items-center gap-[9px] rounded-md px-2.5 text-foreground",
        "data-[selected=true]:bg-selected data-[selected=true]:text-selected-foreground",
      )}
    >
      {item.state ? (
        <StatusDot state={item.state} size={6} />
      ) : Icon ? (
        <Icon size={13} className="flex-none text-muted-foreground" />
      ) : (
        // A row with neither still holds the column, so labels line up down the
        // list instead of stepping left wherever a glyph is missing.
        <span aria-hidden className="w-[13px] flex-none" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{item.labelNode ?? item.label}</span>
      {item.detail ? (
        <span className="flex-none font-mono text-micro tracking-mono text-subtle-foreground">
          {item.detail}
        </span>
      ) : null}
      {item.keys?.length ? <KeyHint keys={item.keys} /> : null}
    </Command.Item>
  );
}
