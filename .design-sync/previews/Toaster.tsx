// WHY THIS PREVIEW DRAWS ITS OWN TOASTS
//
// `Toaster` is a headless host: it renders nothing until `toast(...)` fires,
// and a preview capture is a single static render with no interaction. Driving
// a real toast is not possible from here either — `toast` is not part of the
// shipped surface (`ds-entry.ts` re-exports only `Toaster` from sonner.tsx), so
// a preview that does `import { toast } from "sonner"` gets esbuild's OWN
// bundled copy of sonner while `<Toaster />` comes from `_ds_bundle.js`. Two
// module instances, two stores: verified empirically in wave 3 — the toast
// never appears. (Fix, if wanted: add `export { toast } from "sonner";` to
// .design-sync/ds-entry.ts.)
//
// So the cards below reproduce the toast surface from the exact recipe
// `sonner.tsx` configures — `bg-background text-foreground border-border
// shadow-lg` on the toast, `text-muted-foreground` on the description — at
// sonner's own geometry (356px wide, 16px padding, 8px radius). What you see
// is what a fired toast looks like, drawn statically.
//
// SIZING: ds-bundle's Tailwind CSS is compiled by package-build, which
// subagents may not run, so utilities this repo does not already use have no
// rule. Non-standard dimensions are inline styles.
import { Toaster } from "codetoaster";
import { CircleAlert, CircleCheck, Info, LoaderCircle, X } from "lucide-react";

const TOAST = "flex items-start gap-3 border border-border bg-background text-foreground shadow-lg";
const toastStyle = { width: 356, padding: 16, borderRadius: 8 } as const;

function Toast({
  icon,
  title,
  description,
  action,
  dismissible,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: string;
  dismissible?: boolean;
}) {
  return (
    <div className={TOAST} style={toastStyle}>
      {icon && <span className="shrink-0" style={{ marginTop: 1 }}>{icon}</span>}
      <div className="flex flex-1 flex-col gap-1">
        <div className="font-medium" style={{ fontSize: 13, lineHeight: "18px" }}>
          {title}
        </div>
        {description && (
          <div className="text-muted-foreground" style={{ fontSize: 13, lineHeight: "18px" }}>
            {description}
          </div>
        )}
      </div>
      {action && (
        <span
          className="shrink-0 rounded-md bg-primary font-medium text-primary-foreground"
          style={{ fontSize: 12, padding: "4px 8px" }}
        >
          {action}
        </span>
      )}
      {dismissible && (
        <X className="size-4 shrink-0 text-muted-foreground" style={{ marginTop: 1 }} />
      )}
    </div>
  );
}

/**
 * The bottom-right stack as the app actually produces it: the sticky
 * "Reconnecting…" toast from App.tsx, a review notice from DiffView, and a
 * git-history notice from GitView. The real `<Toaster />` host is mounted
 * alongside — it is what these would portal into at runtime.
 */
export const ToastStack = () => (
  <div
    className="flex flex-col gap-3 rounded-lg bg-muted p-4"
    style={{ width: 420, alignItems: "flex-end" }}
  >
    <Toast
      icon={<LoaderCircle className="size-4 text-muted-foreground" />}
      title="Reconnecting…"
    />
    <Toast
      icon={<Info className="size-4 text-muted-foreground" />}
      title="3 review comments removed — no longer in diff"
    />
    <Toast
      icon={<Info className="size-4 text-muted-foreground" />}
      title="History changed — reloading"
    />
    <Toaster />
  </div>
);

/**
 * `toast.error(...)` with a description — the shape every refused action uses
 * (create, resume, close). Title carries the verdict, description the reason.
 */
export const ErrorToast = () => (
  <div className="flex flex-col gap-3">
    <Toast
      icon={<CircleAlert className="size-4 text-destructive" />}
      title="Could not create the session"
      description="spawn /opt/homebrew/bin/fish — $SHELL is no longer on PATH."
      dismissible
    />
    <Toast
      icon={<CircleAlert className="size-4 text-destructive" />}
      title="Could not resume the session"
      description="~/Projects/api-gateway no longer exists."
      dismissible
    />
  </div>
);

/**
 * A toast with an action, and the success shape a completed review returns.
 */
export const WithAction = () => (
  <div className="flex flex-col gap-3">
    <Toast
      icon={<Info className="size-4 text-muted-foreground" />}
      title="Tip: ⌘-click any symbol to find its definition"
      action="Got it"
    />
    <Toast
      icon={<CircleCheck className="size-4 text-green-500" />}
      title="Review sent"
      description="4 comments on 3 files in codetoaster · v2."
    />
  </div>
);
