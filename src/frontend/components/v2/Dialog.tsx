import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { Button } from "./Button";
import { cn } from "@/frontend/lib/utils";

export interface DialogProps {
  open: boolean;
  title: string;
  /** A line under the title. Confirmations put the consequence here. */
  description?: ReactNode;
  /** Fields, when there are any. A confirmation has none. */
  children?: ReactNode;
  /** The affirmative button's label. */
  confirmLabel?: string;
  confirmVariant?: "primary" | "destructive";
  /** Off while the form is not yet valid — an empty name, say. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  className?: string;
}

/**
 * The v2 modal: a scrim, a panel, Escape and a footer.
 *
 * Deliberately not `components/ui/dialog` — that is Radix over shadcn over the
 * v1 token set, and the v2 surface is not allowed to grow a dependency on it
 * (CLAUDE.md). What is lost is a focus trap; what is kept is the part these
 * dialogs actually use, which is "a name and two buttons".
 *
 * `fixed`, so it renders correctly from wherever it is mounted — including
 * inside the sidebar's own scroller, which is where the per-row actions that
 * own these dialogs live.
 */
export function Dialog({
  open,
  title,
  description,
  children,
  confirmLabel = "Save",
  confirmVariant = "primary",
  confirmDisabled = false,
  onConfirm,
  onClose,
  className,
}: DialogProps) {
  const panel = useRef<HTMLFormElement>(null);

  // Read through a ref rather than depending on it. Callers pass a closure
  // literal, so `onClose` has a new identity on every render — as a dependency
  // it re-ran this effect on every keystroke, and the focus call below then
  // dragged the caret back to the *first* field. A dialog with two fields was
  // unusable in its second one.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKeyDown);
    // Focus the first field, or the confirm button when there are none, so the
    // dialog is usable without reaching for the mouse and so Escape has
    // somewhere to return from.
    panel.current?.querySelector<HTMLElement>("input, textarea, button[data-confirm]")?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (confirmDisabled) return;
    onConfirm();
    onClose();
  };

  return (
    // The scrim matches AppShell's mobile overlay rather than introducing a
    // second black — it is a shadow over the app, not a palette colour.
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[oklch(0_0_0/0.45)] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        ref={panel}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "flex w-full max-w-sm flex-col gap-3 rounded-lg border border-border bg-pane p-4",
          "font-sans text-sm leading-ui tracking-ui text-foreground shadow-overlay",
          className,
        )}
      >
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {children}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            data-confirm
            variant={confirmVariant}
            size="lg"
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
