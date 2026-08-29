// NOTE ON SIZING: ds-bundle's Tailwind CSS is compiled by package-build, which
// subagents may not run, so a utility this repo does not already use (w-64,
// w-[620px], mb-3, gap-0 …) has no rule and silently does nothing. Every
// non-standard dimension below is therefore an inline style; class names are
// limited to the semantic-token vocabulary the app already ships.
import { Tabs, TabsContent, TabsList, TabsTrigger, StatusDot } from "codetoaster";
import { FileDiff, Files, GitBranch, Terminal } from "lucide-react";

const shell = "overflow-hidden rounded-lg border border-border";

/**
 * The real session view switcher from TopBar.tsx: a compact tab bar pinned to
 * the right of the session strip, with the active view below it.
 */
export const SessionViews = () => (
  <Tabs defaultValue="terminal" className={shell} style={{ width: 620, gap: 0 }}>
    <div className="flex min-h-10 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 text-xs text-muted-foreground">
      <StatusDot isConnected isExited={false} isActive />
      <span className="truncate">codetoaster · v2</span>
      <TabsList className="ml-auto h-7">
        <TabsTrigger value="terminal" className="gap-1 px-2.5 text-xs" style={{ height: 20 }}>
          <Terminal className="h-3 w-3" /> Terminal
        </TabsTrigger>
        <TabsTrigger value="diff" className="gap-1 px-2.5 text-xs" style={{ height: 20 }}>
          <FileDiff className="h-3 w-3" /> Diff
        </TabsTrigger>
        <TabsTrigger value="file" className="gap-1 px-2.5 text-xs" style={{ height: 20 }}>
          <Files className="h-3 w-3" /> Files
        </TabsTrigger>
        <TabsTrigger value="git" className="gap-1 px-2.5 text-xs" style={{ height: 20 }}>
          <GitBranch className="h-3 w-3" /> Git
        </TabsTrigger>
      </TabsList>
    </div>
    <TabsContent
      value="terminal"
      className="bg-background p-3 font-mono text-xs leading-5"
      style={{ minHeight: 148 }}
    >
      <div className="text-muted-foreground">~/Projects/codetoaster (v2)</div>
      <div className="text-foreground">$ bun test src/lib/tasks</div>
      <div className="text-muted-foreground">bun test v1.2.4</div>
      <div className="text-foreground">src/lib/tasks/harvester.test.ts:</div>
      <div className="text-foreground">✓ leaves a task with a live client alone</div>
      <div className="text-foreground">✓ suspends only after the idle window</div>
      <div className="text-muted-foreground"> 24 pass, 0 fail — 312ms</div>
    </TabsContent>
    <TabsContent value="diff" className="bg-background p-3" />
    <TabsContent value="file" className="bg-background p-3" />
    <TabsContent value="git" className="bg-background p-3" />
  </Tabs>
);

/**
 * `variant="line"` — the underlined bar used for sections inside a panel, here
 * the review sidebar's own switch.
 */
export const LineVariant = () => (
  <Tabs defaultValue="changes" style={{ width: 420 }}>
    <TabsList variant="line" className="w-full justify-start border-b border-border">
      <TabsTrigger value="changes">Changes</TabsTrigger>
      <TabsTrigger value="commits">Commits</TabsTrigger>
      <TabsTrigger value="comments">Comments</TabsTrigger>
    </TabsList>
    <TabsContent value="changes" className="font-mono text-xs" style={{ minHeight: 96 }}>
      {[
        ["src/lib/tasks/harvester.ts", "+118 −0"],
        ["src/lib/xtmux/pty.ts", "+42 −17"],
        ["src/api/tasks.ts", "+9 −3"],
      ].map(([path, stat]) => (
        <div key={path} className="flex items-center justify-between rounded px-2 py-1.5">
          <span className="truncate text-foreground">{path}</span>
          <span className="shrink-0 text-muted-foreground">{stat}</span>
        </div>
      ))}
    </TabsContent>
    <TabsContent value="commits" />
    <TabsContent value="comments" />
  </Tabs>
);

/**
 * `orientation="vertical"` — the settings dialog's section rail beside its panel.
 */
export const Vertical = () => (
  <Tabs orientation="vertical" defaultValue="terminal" style={{ width: 460 }}>
    <TabsList className="shrink-0" style={{ width: 152 }}>
      <TabsTrigger value="terminal">Terminal</TabsTrigger>
      <TabsTrigger value="appearance">Appearance</TabsTrigger>
      <TabsTrigger value="keyboard">Keyboard</TabsTrigger>
      <TabsTrigger value="notifications">Notifications</TabsTrigger>
    </TabsList>
    <TabsContent value="terminal" className="px-3 text-sm">
      {[
        ["Font family", "JetBrainsMono Nerd Font Mono"],
        ["Scrollback", "10,000 lines"],
        ["Bell", "Play a sound on notification"],
      ].map(([label, value]) => (
        <div key={label} style={{ marginBottom: 14 }}>
          <div className="text-foreground">{label}</div>
          <div className="text-xs text-muted-foreground">{value}</div>
        </div>
      ))}
    </TabsContent>
    <TabsContent value="appearance" className="px-3" />
    <TabsContent value="keyboard" className="px-3" />
    <TabsContent value="notifications" className="px-3" />
  </Tabs>
);

/**
 * Views that need a git repo are disabled for a session opened on a plain
 * directory — the bar keeps its shape, the unavailable tabs just go quiet.
 */
export const DisabledTriggers = () => (
  <Tabs defaultValue="terminal" className={shell} style={{ width: 460, gap: 0 }}>
    <div className="flex min-h-10 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 text-xs text-muted-foreground">
      <StatusDot isConnected isExited={false} isActive={false} />
      <span className="truncate">Downloads · no repo</span>
      <TabsList className="ml-auto h-7">
        <TabsTrigger value="terminal" className="gap-1 px-2.5 text-xs" style={{ height: 20 }}>
          <Terminal className="h-3 w-3" /> Terminal
        </TabsTrigger>
        <TabsTrigger value="diff" disabled className="gap-1 px-2.5 text-xs" style={{ height: 20 }}>
          <FileDiff className="h-3 w-3" /> Diff
        </TabsTrigger>
        <TabsTrigger value="file" className="gap-1 px-2.5 text-xs" style={{ height: 20 }}>
          <Files className="h-3 w-3" /> Files
        </TabsTrigger>
        <TabsTrigger value="git" disabled className="gap-1 px-2.5 text-xs" style={{ height: 20 }}>
          <GitBranch className="h-3 w-3" /> Git
        </TabsTrigger>
      </TabsList>
    </div>
    <TabsContent
      value="terminal"
      className="bg-background p-3 text-xs text-muted-foreground"
      style={{ minHeight: 64 }}
    >
      ~/Downloads is not a git repository — Diff and Git stay disabled until the
      session is opened on a checkout.
    </TabsContent>
    <TabsContent value="file" className="bg-background p-3" />
  </Tabs>
);
