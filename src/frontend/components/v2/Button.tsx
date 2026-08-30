import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/frontend/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** sm 24px · md 28px (chrome default) · lg 32px (dialog footers, composer). */
  size?: ButtonSize;
  /** Lucide component rendered before the label. */
  icon?: LucideIcon;
  /** Lucide component rendered after the label (chevrons, external-link). */
  iconEnd?: LucideIcon;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}

// Hover is a fill change and nothing else — no scale, no translate, no shadow.
// The destructive step is the one place a raw palette step is named directly;
// the design system has no `--destructive-hover` and reaches for it too.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "bg-secondary text-secondary-foreground hover:bg-muted",
  outline: "border-border text-foreground hover:bg-hover hover:border-border-strong",
  ghost: "text-muted-foreground hover:bg-hover hover:text-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:bg-[var(--ct-red-500)]",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-control-sm px-2 text-xs",
  md: "h-control px-2.5 text-sm",
  lg: "h-control-lg px-3.5 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  iconEnd: IconEnd,
  disabled = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  const iconSize = size === "sm" ? 12 : 14;
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        // The transparent border is on every variant, not just `outline`, so a
        // filled button sitting beside an outlined one is the same height.
        "inline-flex flex-none items-center justify-center gap-1.5 whitespace-nowrap",
        "rounded-md border border-transparent font-sans font-medium tracking-ui",
        "cursor-pointer transition-[background-color,border-color,color] duration-[var(--duration-instant)] ease-[var(--ease-out)]",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        "disabled:cursor-default disabled:opacity-50",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon size={iconSize} className="flex-none" /> : null}
      {children}
      {IconEnd ? <IconEnd size={iconSize} className="flex-none" /> : null}
    </button>
  );
}
