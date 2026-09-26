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
 * Where focus lands when a dialog opens, in order: the first usable field;
 * else the confirm button, when it is enabled; else the form itself, which
 * carries `tabIndex={-1}` for exactly this.
 *
 * Never nothing (TASK-115). The archive confirmation opens with its confirm
 * disabled while the cost is fetched, and `.focus()` on a disabled element is
 * a no-op, so focus stayed on the row's archive icon behind the scrim — inside
 * the row's hover card trigger. The trigger never got the blur that closes the
 * card, its open timer fired over the shade, and Tab walked the row rather
 * than the dialog. (Escape was never the problem: its listener is on
 * `document`.) Every selector excludes what cannot take focus, since a
 * disabled field would fail the same way one selector over.
 *
 * The form rather than Cancel as the last resort, on purpose: focus on the
 * panel means "nowhere yet", which is what lets the confirm take it the moment
 * it enables (below) without stealing it from a button the user has tabbed to.
 * A user who lands on Cancel by default and presses Enter has cancelled what
 * they opened the dialog to do.
 */
function firstFocusTarget(form: HTMLFormElement): HTMLElement {
  return (
    form.querySelector<HTMLElement>(
      "input:not(:disabled):not([type=hidden]), textarea:not(:disabled)",
    ) ??
    form.querySelector<HTMLElement>("button[data-confirm]:not(:disabled)") ??
    form
  );
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
    // Always take focus, so the dialog is usable without reaching for the
    // mouse (see `firstFocusTarget`) — and give it back on close. Taken and
    // not returned, focus fell to `<body>` when the portal unmounted, and the
    // next Tab started over from the top of the document rather than from the
    // control that opened the dialog. `isConnected`: the opener may itself
    // have gone — an archived row's actions unmount with the row.
    const opener = document.activeElement as HTMLElement | null;
    if (panel.current) firstFocusTarget(panel.current).focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  // The confirm takes focus when it enables, if nothing else has it yet.
  // Without this the keyboard outcome of the archive confirmation depended on
  // fetch timing: a preview that landed before the effect above put focus on
  // Archive, one that landed after left it on the panel, and Enter did
  // different things in the same dialog. The panel test is what keeps this
  // from stealing focus off a field or a button the user has moved to.
  useEffect(() => {
    if (!open || confirmDisabled || document.activeElement !== panel.current) return;
    panel.current?.querySelector<HTMLElement>("button[data-confirm]")?.focus();
  }, [open, confirmDisabled]);

  if (!open) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (confirmDisabled) return;
    onConfirm?.();
    onClose();
  };

  return createPortal(
    // One `--scrim` token behind all three modal surfaces — this, the command
    // palette and AppShell's mobile overlay — rather than three blacks that
    // have to be kept equal by hand. It is a shadow over the app, not a
    // palette colour, so it does not change with the theme.
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-scrim p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        ref={panel}
        // Focusable only by script: the last resort of `firstFocusTarget`.
        tabIndex={-1}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          // `outline-none`: the form can now take focus as the last resort, and
          // a focus ring around the whole panel would say the panel is a control.
          "flex w-full max-w-sm flex-col gap-3 rounded-lg border border-border bg-pane p-4 outline-none",
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
