import { cn } from "@/frontend/lib/utils";

export interface ExplorerTabItem {
  label: string;
  count?: number;
}

export interface ExplorerTabsProps {
  /** A bare string is a label with no count. */
  tabs?: (string | ExplorerTabItem)[];
  /** The active tab's label — the labels are the identity here, not indices. */
  value?: string;
  onChange?: (label: string) => void;
  className?: string;
}

export function ExplorerTabs({ tabs = [], value, onChange, className }: ExplorerTabsProps) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex h-titlebar flex-none items-stretch gap-0.5 border-b border-sidebar-border px-1",
        className,
      )}
    >
      {tabs.map((t) => {
        const label = typeof t === "string" ? t : t.label;
        const count = typeof t === "string" ? undefined : t.count;
        const active = label === value;
        return (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(label)}
            className={cn(
              "flex cursor-pointer items-center gap-[5px] px-2 text-left text-xs",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
              active
                ? "font-medium text-foreground shadow-[inset_0_-2px_0_var(--primary)]"
                : "font-normal text-subtle-foreground hover:text-foreground",
            )}
          >
            {label}
            {count != null ? (
              <span className="font-mono text-micro tracking-mono text-subtle-foreground">
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
