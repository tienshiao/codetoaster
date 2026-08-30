import type { LucideIcon } from "lucide-react";
import { cn } from "@/frontend/lib/utils";

export interface ExplorerRailItem {
  /** Doubles as the section's identity and its tooltip. */
  label: string;
  icon: LucideIcon;
  /** Drawn as a chip over the glyph, so it reads with the panel shut. */
  count?: number;
}

export interface ExplorerRailProps {
  items?: ExplorerRailItem[];
  /** The section on screen, or null when the Explorer is collapsed — nothing
   * is marked active while nothing is showing. */
  value?: string | null;
  /** Fires for every click, including one on the active section; the shell
   * reads that as "close", the way a rail is expected to behave. */
  onSelect?: (label: string) => void;
  className?: string;
}

/**
 * The Explorer's tab bar, rotated onto the window edge — and its only toggle.
 * A rail earns its width over a collapse button twice: the section a click
 * will open is named up front, and a count still reads with the panel shut.
 *
 * 36px wide to meet the tab strip's height at the corner, with 28px rows and
 * 14px glyphs so it keeps the chrome's density rather than VSCode's roomier
 * activity bar.
 */
export function ExplorerRail({ items = [], value, onSelect, className }: ExplorerRailProps) {
  return (
    <nav
      aria-label="Explorer"
      className={cn(
        "flex w-9 flex-none flex-col items-stretch border-l border-sidebar-border bg-sidebar py-1",
        className,
      )}
    >
      {items.map(({ label, icon: Icon, count }) => {
        const active = label === value;
        return (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-current={active ? "true" : undefined}
            title={label}
            onClick={() => onSelect?.(label)}
            className={cn(
              "relative grid h-row w-full flex-none cursor-pointer place-items-center",
              "transition-[background-color,color] duration-[var(--duration-instant)] ease-[var(--ease-out)]",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
              // The system's active-tab bar, on the edge facing the content —
              // the same 2px of --primary the tab strip puts on top.
              active
                ? "bg-selected text-foreground shadow-[inset_2px_0_0_var(--primary)]"
                : "text-muted-foreground hover:bg-hover hover:text-foreground",
            )}
          >
            <Icon size={14} />
            {count != null && count > 0 && (
              <span
                className={cn(
                  "absolute top-0.5 right-0.5 min-w-[13px] rounded-sm px-[3px] text-center",
                  "bg-primary font-mono text-micro leading-[13px] tracking-mono text-primary-foreground",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
