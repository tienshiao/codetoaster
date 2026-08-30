import type { InputHTMLAttributes } from "react";
import { cn } from "@/frontend/lib/utils";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Rendered above the field and wired to it, so the label is clickable. */
  label?: string;
  className?: string;
}

/**
 * A single-line field, for dialogs. `FilterInput` is the other input in the
 * system and is not this: it carries a search icon and a key hint because it
 * filters a list in place.
 */
export function TextInput({ label, className, id, ...rest }: TextInputProps) {
  const input = (
    <input
      id={id}
      className={cn(
        "h-control-lg w-full rounded-md border border-border bg-background px-2.5",
        "font-sans text-sm tracking-ui text-foreground outline-none",
        "placeholder:text-subtle-foreground focus:border-ring",
        className,
      )}
      {...rest}
    />
  );
  if (!label) return input;
  return (
    <label className="flex flex-col gap-1.5" htmlFor={id}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {input}
    </label>
  );
}
