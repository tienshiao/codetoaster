import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FileDiff, Files, GitBranch, GitCommitHorizontal } from "lucide-react";
import type { ExplorerRailItem } from "@/frontend/components/v2/ExplorerRail";
import {
  AppShell,
  SectionLabel,
  type ShellTab,
  type ShellTaskGroup,
} from "@/frontend/components/v2/AppShell";
import { Badge } from "@/frontend/components/v2/Badge";
import { Button } from "@/frontend/components/v2/Button";
import { FileRow } from "@/frontend/components/v2/FileRow";

export const Route = createFileRoute("/shell")({
  component: ShellPreview,
});

// The Explorer's four sections (§7.1). Glyphs match the tab kinds each section
// opens, so a rail icon and the tab it produces read as the same thing.
const EXPLORER_SECTIONS: ExplorerRailItem[] = [
  { label: "Changes", icon: FileDiff, count: 5 },
  { label: "Files", icon: Files },
  { label: "Commits", icon: GitCommitHorizontal },
  { label: "Refs", icon: GitBranch },
];

/**
 * Preview of the v2 app shell (TASK-46), rendering the fixture data from the
 * design project's `templates/app-shell/AppShell.dc.html`.
 *
 * The shell itself is real; the data is not. Nothing here talks to the daemon
 * — wiring is TASK-18/19/20/24/25/26, and TASK-28 is where this layout
 * replaces the v1 UI at `/`. Until then this route is how the chrome gets
 * looked at without the rest of Phase 4 existing.
 */
function ShellPreview() {
  const [filter, setFilter] = useState("");
  const [explorerTab, setExplorerTab] = useState("Changes");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    codetoaster: true,
    atlas: false,
  });
  const [activeTab, setActiveTab] = useState("agent");

  const toggleGroup = (id: string) =>
    setOpenGroups((open) => ({ ...open, [id]: !open[id] }));

  const groups: ShellTaskGroup[] = [
    {
      id: "codetoaster",
      name: "CodeToaster",
      open: openGroups.codetoaster,
      onToggle: () => toggleGroup("codetoaster"),
      tasks: [
        { id: "1", title: "Extract Pty from Session", state: "busy", meta: "4m", selected: true, worktree: true },
        { id: "2", title: "Worktree eviction grace", state: "attention", meta: "9m" },
        { id: "3", title: "Multiplex protocol v2 tests", state: "idle", meta: "1h" },
        { id: "4", title: "Hook reporter CLI", state: "suspended", meta: "2d" },
      ],
    },
    {
      id: "atlas",
      name: "Atlas",
      open: openGroups.atlas,
      count: 2,
      onToggle: () => toggleGroup("atlas"),
      tasks: [
        { id: "5", title: "Ingest retry budget", state: "idle", meta: "3d" },
        { id: "6", title: "Drop the v1 exporter", state: "exited", meta: "6d" },
      ],
    },
  ];

  const tabDefs: Omit<ShellTab, "active" | "onClick">[] = [
    { id: "agent", kind: "agent", label: "agent", detail: "claude", closable: false },
    { id: "diff", kind: "diff", label: "pty.ts", detail: "+142 −38" },
    { id: "file", kind: "file", label: "v2-architecture.md", preview: true },
    { id: "shell", kind: "shell", label: "zsh" },
  ];
  const tabs: ShellTab[] = tabDefs.map((tab) => ({
    ...tab,
    active: tab.id === activeTab,
    onClick: () => setActiveTab(tab.id),
  }));

  return (
    <AppShell
      groups={groups}
      taskFilter={filter}
      onTaskFilterChange={(e) => setFilter(e.target.value)}
      endpoint=":4000"
      tabs={tabs}
      breadcrumb={{
        title: "Extract Pty from Session",
        path: "~/.codetoaster/worktrees/pty-extract",
        branch: "v2/pty-extract",
        badge: <Badge>sonnet · acceptEdits</Badge>,
      }}
      status={{ state: "busy", items: ["80×24", "utf-8", "sonnet"], right: "+142 −38 · 4 files" }}
      explorerSections={EXPLORER_SECTIONS}
      explorerTab={explorerTab}
      onExplorerTabChange={setExplorerTab}
      explorer={explorerTab === "Changes" ? <ChangesFixture /> : <UnbuiltSection name={explorerTab} />}
      explorerFooter={
        explorerTab === "Changes" ? (
          <>
            <Button variant="outline" className="flex-1">Review all</Button>
            <Button variant="primary" className="flex-1">Commit</Button>
          </>
        ) : undefined
      }
    >
      <TerminalFixture />
    </AppShell>
  );
}

/** Only Changes has fixture content. Saying so beats showing the diff tree
 * under all four labels and calling the rail verified. */
function UnbuiltSection({ name }: { name: string }) {
  return (
    <div className="px-2 py-3 text-xs text-subtle-foreground">
      {name} is not built yet — see TASK-26.
    </div>
  );
}

function ChangesFixture() {
  return (
    <>
      <SectionLabel>src/lib/xtmux</SectionLabel>
      <FileRow name="pty.ts" status="modified" additions={142} deletions={38} selected />
      <FileRow name="manager.ts" status="modified" additions={9} deletions={7} />
      <FileRow name="multiplex.test.ts" status="added" additions={61} />
      <SectionLabel className="mt-1.5">src/frontend</SectionLabel>
      <FileRow name="SessionContext.tsx" status="deleted" deletions={214} />
      <FileRow name="TopBar.tsx" status="renamed" note="renamed" />
    </>
  );
}

/**
 * Stands in for the agent terminal at the product's real metrics. The design
 * system ships a `TerminalFrame` for exactly this and says never to use it in
 * production — so it was not ported, and this fixture lives with the preview
 * route rather than in the component library. TASK-19 puts the real
 * multi-instance `Terminal` here.
 */
function TerminalFixture() {
  return (
    <div className="h-full overflow-auto bg-pane px-3 py-2 font-mono text-base leading-code tracking-mono">
      <div className="text-subtle-foreground">
        $ claude --session-id 1fc1a3c8 --settings ./settings.json "extract Pty from Session"
      </div>
      <Gap />
      <div>
        <span className="text-state-busy">›</span> extract Pty from Session, keeping the OSC handlers intact
      </div>
      <Gap />
      <div className="text-muted-foreground">
        I'll split the process-owning half of <span className="text-foreground">Session</span> into{" "}
        <span className="text-foreground">Pty</span> and leave naming on the task record.
      </div>
      <Gap />
      <div>
        <span className="text-success">●</span> <span className="text-muted-foreground">Read</span>{" "}
        src/lib/xtmux/session.ts <span className="text-subtle-foreground">399 lines</span>
      </div>
      <div>
        <span className="text-success">●</span> <span className="text-muted-foreground">Write</span>{" "}
        src/lib/xtmux/pty.ts <span className="text-diff-add-marker">+142</span>{" "}
        <span className="text-diff-del-marker">−38</span>
      </div>
      <div>
        <span className="text-state-busy">●</span> <span className="text-muted-foreground">Bash</span>{" "}
        bun test src/lib/xtmux
      </div>
      <Gap />
      <div className="text-subtle-foreground">
        {"  multiplex.test.ts:  "}
        <span className="text-success">12 pass</span>
        {"  0 fail"}
      </div>
      <div className="mt-1 inline-block h-[1.05em] w-[0.6em] translate-y-[0.15em] bg-foreground [animation:ct-caret_1s_step-end_infinite]" />
    </div>
  );
}

function Gap() {
  return <div className="h-2.5" aria-hidden />;
}
