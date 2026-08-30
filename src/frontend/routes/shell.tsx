import { useCallback, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { taskStateOf, useTasks } from "@/frontend/TaskContext";
import { usePty } from "@/frontend/PtyContext";
import { sessionDisplayNames } from "@/lib/xtmux/naming";
import { AppShell } from "@/frontend/components/v2/AppShell";
import { useTaskSidebar } from "@/frontend/components/TaskSidebar";
import { Badge } from "@/frontend/components/v2/Badge";
import { Button } from "@/frontend/components/v2/Button";
import { TaskHeader } from "@/frontend/components/v2/TaskHeader";
import { Explorer, useExplorerRail } from "@/frontend/components/Explorer";
import { useExplorerPanel } from "@/frontend/hooks/use-explorer-panel";
import { TabArea, TabPane, useTaskLayout } from "@/frontend/components/tabs";
import { openTab, type OpenOptions, type TabDescriptor } from "@/frontend/layout-store";

export const Route = createFileRoute("/shell")({
  component: ShellPreview,
});

/**
 * The v2 app shell, at `/shell` until TASK-28 puts it at `/`.
 *
 * The left column is live: real tasks from `TaskContext`, in the design's rows.
 * The tab area is live too — a real `TaskLayout` per task, persisted, with
 * drag, split, close and preview tabs (TASK-22) — and so is what a pane holds:
 * the diff, file, commit and history tabs render the real thing. So is the
 * Explorer: its four sections host the real trees and open real tabs. What is
 * left is the agent terminal, which arrives with the tab host that knows which
 * PTY it is showing.
 *
 * The sidebar's own behaviour — recency, grouping, the filter, the archived
 * toggle and the per-row actions — is `useTaskSidebar`'s; this route only says
 * which task is selected.
 */
function ShellPreview() {
  const { tasks, loaded } = useTasks();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const explorerPanel = useExplorerPanel();
  const explorerSections = useExplorerRail(selectedTaskId);
  // A real layout for the selected task, persisted per task id.
  const { layout, setLayout } = useTaskLayout(selectedTaskId);
  const sidebar = useTaskSidebar({ selectedTaskId, onSelectTask: setSelectedTaskId });

  // Only for the task header below — the sidebar projects its own labels. The
  // label is projected, not stored: an explicit rename, else the live
  // terminal title when it carries real content *and is unique*, else the
  // stable name. Claude Code sits on a bare "Claude Code" until it has a task,
  // so without this every agent task in the list reads identically — which is
  // the failure the projection exists to prevent (naming.ts).
  const displayNames = useMemo(
    () =>
      sessionDisplayNames(
        tasks.map((t) => ({
          id: t.id,
          name: t.title,
          nameSource: t.titleSource,
          title: t.terminalTitle,
        })),
      ),
    [tasks],
  );
  const selected = tasks.find((t) => t.id === selectedTaskId);
  const { sendInput } = usePty();

  const handleOpenTab = useCallback(
    (descriptor: TabDescriptor, options?: OpenOptions) => {
      if (!layout) return;
      setLayout(openTab(layout, descriptor, options));
    },
    [layout, setLayout],
  );

  // Having a ptyId is not the same as having somewhere to write. A PTY whose
  // process exited on its own is never removed from PtyManager — only `kill`
  // does that — so `TaskInfo.ptyId` stays non-null for the whole life of the
  // daemon while `Pty.write` silently drops everything. Testing the id alone
  // therefore passed for exactly the case this guard exists for.
  const ptyId = selected?.ptyId ?? null;
  const canDeliver = !!ptyId && !selected?.exited;

  const handleSubmitReview = useCallback(
    (promptText: string): boolean => {
      // No terminal, no delivery. Said out loud so the caller keeps the review:
      // a task whose agent has exited cannot take the prompt, and silently
      // swallowing it while the comments were cleared threw the whole review
      // away with nothing to show for it.
      if (!canDeliver || !ptyId || !layout) return false;
      sendInput(ptyId, promptText);
      // The review has gone to the agent, so the agent is what the user wants
      // to be looking at.
      setLayout(openTab(layout, { kind: "agent" }));
      return true;
    },
    [canDeliver, ptyId, sendInput, layout, setLayout],
  );

  return (
    <AppShell
      {...sidebar}
      endpoint={loaded ? `:${location.port || "80"}` : "connecting…"}
      tabArea={
        layout
          ? ({ leading }) => (
              <TabArea
                layout={layout}
                onLayoutChange={setLayout}
                leading={leading}
                header={
                  <TaskHeader
                    title={selected ? (displayNames.get(selected.id) ?? selected.title) : "Task"}
                    path="~/.codetoaster/worktrees/pty-extract"
                    branch="v2/pty-extract"
                    badge={<Badge>sonnet · acceptEdits</Badge>}
                  />
                }
                renderPane={(tab, _group, visible) => (
                  // Keyed by task *and* tab. The tab key alone was not enough:
                  // every task's agent tab keys as "agent", so switching tasks
                  // handed the same React position the same key and the same
                  // component type, and the previous task's terminal — grid,
                  // attachment and all — was reused for the next one.
                  //
                  // Within a task it is still the tab key that matters:
                  // `useViewState` binds its slot once, at mount, so switching
                  // from one file tab to another without a key would draw the
                  // second file's contents under the first file's scroll offset
                  // and toggles, and write them back to the first file's slot.
                  <TabPane
                    key={`${selectedTaskId}:${tab.key}`}
                    taskId={selectedTaskId!}
                    tab={tab}
                    onOpenTab={handleOpenTab}
                    onSubmitReview={handleSubmitReview}
                    visible={visible}
                  />
                )}
              />
            )
          : undefined
      }
      status={{
        state: selected ? taskStateOf(selected) : undefined,
        items: selected
          ? [`${selected.size.cols}×${selected.size.rows}`, `${selected.clientCount} viewing`]
          : ["no task"],
        right: "+142 −38 · 4 files",
      }}
      explorerSections={explorerSections}
      explorerTab={explorerPanel.section}
      onExplorerTabChange={explorerPanel.setSection}
      explorerOpen={explorerPanel.open}
      onExplorerOpenChange={explorerPanel.setOpen}
      explorer={
        <Explorer
          taskId={selectedTaskId}
          section={explorerPanel.section}
          onOpenTab={handleOpenTab}
        />
      }
      // No "Commit" button beside it: every route under `src/api/git.ts` is a
      // read-only GET, so there is nothing behind one.
      explorerFooter={
        explorerPanel.section === "Changes" && layout ? (
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => handleOpenTab({ kind: "diffAll" })}
          >
            Review all
          </Button>
        ) : undefined
      }
    >
      <NoTaskFixture />
    </AppShell>
  );
}

/** The main area before a task is picked. TASK-24 puts the composer here. */
function NoTaskFixture() {
  return (
    <div className="grid h-full place-items-center text-sm text-subtle-foreground">
      Pick a task on the left.
    </div>
  );
}
