import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/frontend/lib/utils";

export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Lucide component to render. */
  icon: LucideIcon;
  /** Accessible name; also the tooltip. */
  label: string;
  /** A keyboard chord, appended to the tooltip but not to the accessible name
   * — a screen reader announcing "New shell ⌘K backtick" is reading punctuation
   * aloud where a sighted user is reading a hint. */
  hint?: string;
  size?: IconButtonSize;
  /** Latched on — a toggle that is currently engaged. Reads like hover. */
  active?: boolean;
  disabled?: boolean;
  className?: string;
}

// 22 / 26 / 30 are chrome hit targets, not the row/control heights, so they have
// no spacing token of their own.
const SIZES: Record<IconButtonSize, string> = {
  sm: "size-[22px]",
  md: "size-[26px]",
  lg: "size-[30px]",
};

export function IconButton({
  icon: Icon,
  label,
  hint,
  size = "md",
  active = false,
  disabled = false,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      disabled={disabled}
      className={cn(
        "grid flex-none cursor-pointer place-items-center rounded-md",
        "transition-[background-color,color] duration-[var(--duration-instant)] ease-[var(--ease-out)]",
        "hover:bg-hover hover:text-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
        active ? "bg-hover text-foreground" : "text-muted-foreground",
        SIZES[size],
        className,
      )}
      {...rest}
    >
      <Icon size={size === "sm" ? 13 : 14} />
    </button>
  );
}
