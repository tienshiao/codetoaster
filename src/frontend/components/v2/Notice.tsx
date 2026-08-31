import type { ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";

export type NoticeTone = "info" | "warning";

export interface NoticeProps {
  tone?: NoticeTone;
  /** The sentence. One line, and the shorter the better: this sits above the
   * work rather than beside it, and everything it takes is height the user
   * came for. */
  children: ReactNode;
  /** Buttons, right-aligned. */
  actions?: ReactNode;
  className?: string;
}

// A full-width bar rather than a floating pill, and that is the distinction it
// is for. `AgentPane`'s overlay is transient and click-through — it says what
// is happening this second and leaves. A Notice is a *state*: it stays until
// somebody answers it, so it takes real space and pushes the content down
// rather than sitting on top of something the user is trying to read.
// Tone is carried by a solid rule and a dot, not by a tinted background. A
// wash here would be the obvious thing and is the one thing that cannot be
// written as `bg-state-attention/10`: Tailwind emits an opacity modifier over a
// `var()` as a `color-mix` inside a nested `@supports`, and Bun's CSS bundler
// drops the nested block — leaving the opaque fallback, so the bar comes out
// solid amber. The palette exposes `-ch` channel triplets for exactly this and
// amber is not one of them (see the comment above the palette in `index.css`),
// and a notice does not need a sixth one to be legible.
const TONES: Record<NoticeTone, string> = {
  info: "border-border bg-chrome text-muted-foreground",
  warning: "border-state-attention bg-chrome text-foreground",
};

const DOTS: Record<NoticeTone, string> = {
  info: "bg-muted-foreground",
  warning: "bg-state-attention",
};

export function Notice({ tone = "info", children, actions, className }: NoticeProps) {
  return (
    <div
      // `role="status"` and not `alert`: this is a condition the user can take
      // their time over, and an alert interrupts a screen reader mid-sentence
      // for something that has been true since the task was reopened.
      role="status"
      className={cn(
        "flex h-row flex-none items-center gap-3 border-b px-3 text-xs tracking-ui",
        TONES[tone],
        className,
      )}
    >
      <span className={cn("size-1.5 flex-none rounded-full", DOTS[tone])} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {actions && <span className="flex flex-none items-center gap-1.5">{actions}</span>}
    </div>
  );
}
