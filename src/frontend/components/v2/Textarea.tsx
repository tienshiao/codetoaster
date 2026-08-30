import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/frontend/lib/utils";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Code face rather than the UI one, for anything the agent will read back
   * verbatim. Sans by default: a prompt is prose. */
  mono?: boolean;
  className?: string;
}

/**
 * The multi-line field, for the composer. Fixed height by design — `resize` is
 * off because a hand-dragged corner would fight the layout it sits in — so the
 * row count is the caller's to choose.
 *
 * The design system's mock draws its focus ring from a `focused` prop, which is
 * how a static card fakes one. Here it is the real `:focus`, and shown the way
 * every other field in the system shows it: the border becomes the ring colour.
 */
export function Textarea({ mono = false, rows = 4, className, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(
        "w-full resize-none rounded-md border border-input bg-pane px-2.5 py-2",
        "text-base text-foreground outline-none",
        "placeholder:text-subtle-foreground focus:border-ring",
        "disabled:cursor-default disabled:opacity-50",
        mono ? "font-mono leading-code tracking-mono" : "font-sans leading-ui tracking-ui",
        className,
      )}
      {...rest}
    />
  );
}
