import { Button, Textarea } from "codetoaster";

// The inline review comment editor from the diff view (components/diff/CommentInput).
export const CommentDraft = () => (
  <div style={{ width: 520 }} className="rounded-md border border-border bg-card p-3">
    <div className="mb-2 text-xs text-muted-foreground">
      src/lib/xtmux/pty.ts <span className="text-foreground/60">·</span> line 142
    </div>
    <Textarea
      className="min-h-[72px] resize-y text-sm"
      rows={3}
      defaultValue={
        "The smallest-wins resize runs before the client is registered, so the first attach can shrink the PTY to 0 cols. Clamp to the existing size until the client reports one."
      }
      placeholder="Leave a comment..."
    />
    <div className="mt-2 flex justify-end gap-2">
      <Button variant="ghost" size="sm">
        Cancel
      </Button>
      <Button size="sm">Add comment</Button>
    </div>
  </div>
);

export const States = () => (
  <div style={{ width: 520 }} className="flex flex-col gap-4">
    <div className="flex flex-col gap-1.5">
      <label htmlFor="ta-empty" className="text-sm font-medium text-foreground">
        Empty
      </label>
      <Textarea id="ta-empty" rows={3} placeholder="Leave a comment on this file..." />
    </div>
    <div className="flex flex-col gap-1.5">
      <label htmlFor="ta-disabled" className="text-sm font-medium text-foreground">
        Disabled
      </label>
      <Textarea
        id="ta-disabled"
        rows={3}
        disabled
        defaultValue="Review already submitted — reopen it to keep editing."
      />
      <p className="text-xs text-muted-foreground">This review was submitted 4 minutes ago</p>
    </div>
    <div className="flex flex-col gap-1.5">
      <label htmlFor="ta-invalid" className="text-sm font-medium text-foreground">
        Invalid
      </label>
      <Textarea id="ta-invalid" rows={3} aria-invalid defaultValue="   " />
      <p className="text-xs text-destructive">A comment cannot be empty</p>
    </div>
  </div>
);

export const Sizing = () => (
  <div style={{ width: 520 }} className="flex flex-col gap-4">
    <div className="flex flex-col gap-1.5">
      <label htmlFor="ta-default" className="text-sm font-medium text-foreground">
        Default height
      </label>
      <Textarea id="ta-default" placeholder="Leave a comment..." />
      <p className="text-xs text-muted-foreground">min-h-16, the component's own floor</p>
    </div>
    <div className="flex flex-col gap-1.5">
      <label htmlFor="ta-grow" className="text-sm font-medium text-foreground">
        Grows with its content
      </label>
      <Textarea
        id="ta-grow"
        defaultValue={
          "Two things before this lands:\n\n1. harvester.ts idles a session whose agent is still writing — guard on last_size as well as the activity clock.\n2. snapshot.ts writes the scrollback before the PTY drains, so the tail is lost on a fast exit."
        }
      />
      <p className="text-xs text-muted-foreground">field-sizing-content — no rows needed</p>
    </div>
    <div className="flex flex-col gap-1.5">
      <label htmlFor="ta-tall" className="text-sm font-medium text-foreground">
        Taller by class
      </label>
      <Textarea id="ta-tall" className="min-h-[140px] resize-y" placeholder="Summarize this review..." />
      <p className="text-xs text-muted-foreground">min-h-[140px] resize-y, as the review composer uses</p>
    </div>
  </div>
);
