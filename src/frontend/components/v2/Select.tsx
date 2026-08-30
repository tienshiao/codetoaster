import type { SelectHTMLAttributes } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/frontend/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

export type SelectSize = "sm" | "md";

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" | "children"> {
  /** Sits inline before the value, in muted foreground — "project", "model".
   * Also the control's accessible name, since the value alone does not say
   * what it is a value of. */
  label?: string;
  options: SelectOption[];
  /** Lucide component drawn at the leading edge. */
  icon?: LucideIcon;
  /** sm 24px · md 28px (chrome default). */
  size?: SelectSize;
  className?: string;
}

/**
 * A one-of-several choice, worn as a chip: label, value, chevron.
 *
 * The design system draws this as a button over its own DropdownMenu; this is a
 * native `<select>` wearing that chrome instead. Typeahead, arrow keys, the
 * platform's own picker on a phone and the whole of the accessibility tree come
 * with the element, and none of it would have survived being reimplemented —
 * so the only thing borrowed from the mock is the paint. `appearance-none`
 * takes the UA's own arrow off, since the design supplies one.
 */
export function Select({
  label,
  options,
  icon: Icon,
  size = "md",
  disabled = false,
  className,
  ...rest
}: SelectProps) {
  return (
    // A wrapping label, so the words before the value are part of the hit area
    // the way they look like they are.
    <label
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-input bg-pane pl-2 pr-1.5",
        "cursor-pointer focus-within:border-ring",
        size === "sm" ? "h-control-sm text-xs" : "h-control text-sm",
        disabled && "cursor-default opacity-50",
        className,
      )}
    >
      {Icon ? <Icon size={13} className="flex-none text-muted-foreground" /> : null}
      {label ? <span className="flex-none text-muted-foreground">{label}</span> : null}
      <select
        aria-label={label}
        disabled={disabled}
        className={cn(
          "cursor-pointer appearance-none border-0 bg-transparent pr-0.5 disabled:cursor-default",
          "font-sans tracking-ui text-foreground outline-none",
          size === "sm" ? "text-xs" : "text-sm",
        )}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="flex-none text-subtle-foreground" />
    </label>
  );
}
