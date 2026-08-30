import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";

export type BadgeTone = "neutral" | "accent" | "solid" | "success" | "warning" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Badges carry machine values by default, so mono is the default face. */
  mono?: boolean;
  className?: string;
  children?: ReactNode;
}

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  accent: "bg-[color-mix(in_oklab,var(--primary)_15%,transparent)] text-primary",
  solid: "bg-primary text-primary-foreground",
  success: "bg-[color-mix(in_oklab,var(--success)_15%,transparent)] text-success",
  warning: "bg-[color-mix(in_oklab,var(--warning)_15%,transparent)] text-warning",
  danger: "bg-[color-mix(in_oklab,var(--destructive)_15%,transparent)] text-destructive",
};

export function Badge({ tone = "neutral", mono = true, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-px text-micro font-medium",
        mono ? "font-mono tracking-mono" : "font-sans tracking-ui",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
