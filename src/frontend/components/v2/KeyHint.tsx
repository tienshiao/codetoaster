import { Fragment } from "react";
import { cn } from "@/frontend/lib/utils";

export interface KeyHintProps {
  /** Either the caps themselves, or a `"⌘+K"`-style string to split on `+`. */
  keys: string[] | string;
  /** Glyph drawn between caps; empty (the default) sets them flush. */
  joiner?: string;
  muted?: boolean;
  className?: string;
}

export function KeyHint({ keys, joiner = "", muted = true, className }: KeyHintProps) {
  const list = Array.isArray(keys) ? keys : String(keys).split("+");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-mono text-micro tracking-mono",
        muted ? "text-subtle-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {list.map((k, i) => (
        <Fragment key={i}>
          {i > 0 && joiner ? <span className="opacity-60">{joiner}</span> : null}
          {/* The face is restated rather than inherited: a bare <kbd> picks up the
              UA's monospace family, and with it the monospace font-size quirk. */}
          <kbd className="min-w-[15px] rounded-sm border border-border bg-muted px-1 py-px text-center font-mono text-micro tracking-mono">
            {k}
          </kbd>
        </Fragment>
      ))}
    </span>
  );
}
