import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { cn } from "@/frontend/lib/utils";

export interface DialogProps {
  open: boolean;
  title: string;
  /** A line under the title. Confirmations put the consequence here. */
  description?: ReactNode;
  /** Fields, when there are any. A confirmation has none. */
  children?: ReactNode;
  /** The affirmative button's label. Defaults to "Save" for a form, "Done" for
   * a dismiss-only panel. */
  confirmLabel?: string;
  confirmVariant?: "primary" | "destructive";
  /** Off while the form is not yet valid — an empty name, say. */
  confirmDisabled?: boolean;
  /**
   * What Save does. Omit it and the dialog is dismiss-only: one button, no
   * Cancel, and submitting simply closes.
   *
   * That is not a cosmetic variant. A panel whose controls each write their own
   * change as they are touched — the settings, all `localStorage` — has nothing
   * for Save to do and nothing for Cancel to undo, and offering either says the
   * opposite: that the changes are pending, and that leaving by the other
   * button would put them back.
   */
  onConfirm?: () => void;
  onClose: () => void;
  className?: string;
}

/**
 * The v2 modal: a scrim, a panel, Escape and a footer.
 *
 * Deliberately not `components/ui/dialog` — that was Radix over shadcn over the
 * v1 token set, and the v2 surface is not allowed to grow a dependency on it
 * (CLAUDE.md); it has since been deleted, this being its last consumer's
 * replacement. What is lost is a focus trap; what is kept is the part these
 * dialogs actually use, which is "a name and two buttons".
 *
 * `fixed`, and mounted onto `document.body` through a portal. The portal is not
 * tidiness: the per-row actions that own these dialogs live inside the cluster
 * `AppShell` reveals on hover with `opacity-0` and `pointer-events-none`, and
 * both reach an entire subtree no matter what any descendant's `position` says.
 * Rendered in place, an open dialog and its full-screen scrim would vanish the
 * moment the pointer left the row — click the dialog's own title, which takes no
 * focus, and it does — and lose every hit target in the panel with it: a modal
 * that neither draws nor answers, over an app its scrim no longer shields.
 */
export function Dialog({
  open,
  title,
  description,
  children,
  confirmLabel,
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
    onConfirm?.();
    onClose();
  };

  return createPortal(
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
          {/* No Cancel without a Save to cancel: see `onConfirm`. */}
          {onConfirm ? (
            <Button type="button" variant="outline" size="lg" onClick={onClose}>
              Cancel
            </Button>
          ) : null}
          <Button
            type="submit"
            data-confirm
            variant={confirmVariant}
            size="lg"
            disabled={confirmDisabled}
          >
            {confirmLabel ?? (onConfirm ? "Save" : "Done")}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
