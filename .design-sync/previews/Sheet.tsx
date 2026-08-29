import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "codetoaster";
import { FileDiff, GitBranch, Plus, TerminalSquare } from "lucide-react";

const noop = () => {};

const detail = (label: string, value: string, mono = false) => (
  <div key={label} className="flex items-baseline justify-between gap-4 py-1.5">
    <span className="text-muted-foreground text-xs">{label}</span>
    <span className={`text-xs ${mono ? "font-mono" : ""}`}>{value}</span>
  </div>
);

/** `side="right"` (the default) — the session inspector. */
export const SessionDetails = () => (
  <Sheet open onOpenChange={noop}>
    <SheetContent side="right">
      <SheetHeader>
        <SheetTitle>codetoaster · v2</SheetTitle>
        <SheetDescription>
          Session details and the process behind this terminal.
        </SheetDescription>
      </SheetHeader>
      <div className="border-border mx-4 border-t" />
      <div className="px-4">
        {detail("Status", "Running")}
        {detail("Working directory", "~/Projects/codetoaster", true)}
        {detail("Branch", "v2", true)}
        {detail("Shell", "/opt/homebrew/bin/fish", true)}
        {detail("Size", "148 × 42")}
        {detail("Attached clients", "2")}
      </div>
      <SheetFooter>
        <Button variant="outline">Detach all clients</Button>
        <Button variant="destructive">Kill session</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
);

/** `side="left"` — the sidebar as it appears on a narrow viewport. */
export const MobileSidebar = () => (
  <Sheet open onOpenChange={noop}>
    <SheetContent side="left" onOpenAutoFocus={(e) => e.preventDefault()}>
      <SheetHeader>
        <SheetTitle>Sessions</SheetTitle>
        <SheetDescription>Every project on this daemon.</SheetDescription>
      </SheetHeader>
      <nav className="flex flex-col gap-0.5 px-2">
        <div className="text-muted-foreground px-2 py-1 text-xs font-medium">
          codetoaster
        </div>
        {[
          { name: "codetoaster · v2", dot: "bg-green-500/80", active: true },
          { name: "codetoaster · main", dot: "bg-green-700/60", active: false },
        ].map((s) => (
          <button
            key={s.name}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
              s.active ? "bg-accent text-accent-foreground" : "hover:bg-accent"
            }`}
          >
            <TerminalSquare className="size-4 shrink-0" />
            <span className="truncate">{s.name}</span>
            <span className={`ml-auto size-2 shrink-0 rounded-full ${s.dot}`} />
          </button>
        ))}
        <div className="text-muted-foreground mt-2 px-2 py-1 text-xs font-medium">
          api-gateway
        </div>
        {["api-gateway · main", "api-gateway · fix/origin-guard"].map((name) => (
          <button
            key={name}
            className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
          >
            <TerminalSquare className="size-4 shrink-0" />
            <span className="truncate">{name}</span>
          </button>
        ))}
      </nav>
      <SheetFooter>
        <Button className="w-full">
          <Plus />
          New session
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
);

/** `side="bottom"` — a short, wide surface that leaves the terminal visible. */
export const ChangedFilesTray = () => (
  <Sheet open onOpenChange={noop}>
    <SheetContent side="bottom">
      <SheetHeader>
        <SheetTitle>Uncommitted changes · 4 files</SheetTitle>
        <SheetDescription>
          Working tree of ~/Projects/codetoaster against v2.
        </SheetDescription>
      </SheetHeader>
      <div className="grid gap-1 px-4">
        {[
          { path: "src/lib/xtmux/pty.ts", add: 42, del: 6 },
          { path: "src/lib/tasks/harvester.ts", add: 118, del: 0 },
          { path: "src/api/origin.ts", add: 9, del: 11 },
          { path: "src/frontend/DiffView.tsx", add: 3, del: 3 },
        ].map((f) => (
          <div key={f.path} className="flex items-center gap-2 py-0.5 font-mono text-xs">
            <FileDiff className="text-muted-foreground size-3.5 shrink-0" />
            <span className="truncate">{f.path}</span>
            <span className="ml-auto text-green-500">+{f.add}</span>
            <span className="text-red-500">−{f.del}</span>
          </div>
        ))}
      </div>
      <SheetFooter className="flex-row justify-end">
        <Button variant="outline">Dismiss</Button>
        <Button>Review changes</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
);

/** `side="top"` — a banner-height surface for a single decision. */
export const BranchSwitchBanner = () => (
  <Sheet open onOpenChange={noop}>
    <SheetContent side="top">
      <SheetHeader>
        <SheetTitle>The agent moved to another branch</SheetTitle>
        <SheetDescription>
          This session's repository is now on{" "}
          <span className="text-foreground font-mono">feat/idle-harvester</span>{" "}
          — the diff you are reviewing was taken on{" "}
          <span className="text-foreground font-mono">v2</span>.
        </SheetDescription>
      </SheetHeader>
      <SheetFooter className="flex-row justify-end">
        <Button variant="outline">Keep this diff</Button>
        <Button>
          <GitBranch />
          Reload on feat/idle-harvester
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
);
