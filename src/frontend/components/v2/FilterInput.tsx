import type { ChangeEvent } from "react";
import { Search } from "lucide-react";
import { KeyHint } from "./KeyHint";
import { cn } from "@/frontend/lib/utils";

export interface FilterInputProps {
  placeholder?: string;
  value?: string;
  /** Keys shown at the trailing edge; pass null to hide. */
  shortcut?: string[] | null;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  className?: string;
}

export function FilterInput({
  placeholder = "Filter tasks",
  value = "",
  shortcut = ["⌘", "K"],
  onChange,
  className,
}: FilterInputProps) {
  return (
    <div
      className={cn(
        "flex h-group items-center gap-1.5 rounded-md border border-border bg-background pl-2 pr-1.5",
        "focus-within:border-ring",
        className,
      )}
    >
      <Search size={12} className="flex-none text-subtle-foreground" />
      <input
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        // `value` always has a default, so without a handler React would warn
        // about a controlled input with no way to change.
        readOnly={onChange === undefined}
        className="min-w-0 flex-1 border-0 bg-transparent font-sans text-xs tracking-ui text-foreground outline-none placeholder:text-subtle-foreground"
      />
      {shortcut ? <KeyHint keys={shortcut} /> : null}
    </div>
  );
}
