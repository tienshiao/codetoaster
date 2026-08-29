import { Separator } from "codetoaster";

// Settings dialog sections: a rule between each group of controls.
export const Horizontal = () => (
  <div className="w-[420px] rounded-md border border-border px-4 py-1">
    <div className="py-3">
      <div className="text-sm font-medium text-foreground">Appearance</div>
      <p className="text-xs text-muted-foreground">Controls the app's light and dark appearance</p>
    </div>
    <Separator />
    <div className="py-3">
      <div className="text-sm font-medium text-foreground">Terminal</div>
      <p className="text-xs text-muted-foreground">Font, size and color scheme for the terminal emulator</p>
    </div>
    <Separator />
    <div className="py-3">
      <div className="text-sm font-medium text-foreground">Notifications</div>
      <p className="text-xs text-muted-foreground">Audible alert for terminal notifications and the bell</p>
    </div>
  </div>
);

// Session status bar: vertical rules need a parent with a definite height.
export const Vertical = () => (
  <div style={{ width: 560 }} className="flex h-8 items-center gap-3 rounded-md border border-border px-3 text-xs text-muted-foreground">
    <span className="text-foreground">codetoaster · v2</span>
    <Separator orientation="vertical" className="h-4" />
    <span>src/lib/xtmux/pty.ts</span>
    <Separator orientation="vertical" className="h-4" />
    <span>4 files changed</span>
    <Separator orientation="vertical" className="h-4" />
    <span>
      <span className="text-green-500">+128</span> <span className="text-red-500">-34</span>
    </span>
  </div>
);

// Grouping a session list: one rule per project boundary.
export const InList = () => (
  <div className="w-[280px] rounded-md border border-border p-2 text-sm">
    <div className="px-2 py-1 text-xs font-medium text-muted-foreground">codetoaster</div>
    <div className="rounded px-2 py-1.5 text-foreground hover:bg-accent">codetoaster · v2</div>
    <div className="rounded px-2 py-1.5 text-foreground hover:bg-accent">codetoaster · main</div>
    <div className="my-2">
      <Separator />
    </div>
    <div className="px-2 py-1 text-xs font-medium text-muted-foreground">api-gateway</div>
    <div className="rounded px-2 py-1.5 text-foreground hover:bg-accent">api-gateway · main</div>
    <div className="rounded px-2 py-1.5 text-foreground hover:bg-accent">api-gateway · hotfix</div>
  </div>
);
