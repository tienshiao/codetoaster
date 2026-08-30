import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { taskStateOf, useTasks } from "@/frontend/TaskContext";
import { usePty } from "@/frontend/PtyContext";
import { useSession } from "@/frontend/SessionContext";
import { sessionDisplayNames } from "@/lib/xtmux/naming";
import { AppShell } from "@/frontend/components/v2/AppShell";
import { useTaskSidebar } from "@/frontend/components/TaskSidebar";
import { Button } from "@/frontend/components/v2/Button";
import { TaskHeader } from "@/frontend/components/v2/TaskHeader";
import { Explorer, useExplorerRail } from "@/frontend/components/Explorer";
import { useExplorerPanel } from "@/frontend/hooks/use-explorer-panel";
import { useOpenTask } from "@/frontend/hooks/use-task-nav";
import { TabArea, TabPane, useTaskLayout } from "@/frontend/components/tabs";
import {
  descriptorFromKey,
  openTab,
  type OpenOptions,
  type TabDescriptor,
} from "@/frontend/layout-store";

export interface TaskShellProps {
  /** The task the URL names, or null at `/`. */
  taskId: string | null;
  /** A `?tab=` deep link's tab key, to be opened if absent and focused if not
   * (§7.3). Null once there is nothing pending. */
  pendingTab?: string | null;
  /** Called once `pendingTab` has been honoured, so the route can drop the
   * parameter. Ensuring is a one-off instruction, not a description of the
   * layout: leaving `?tab=` in the URL would reopen a tab the user then closed,
   * on the next render that touched the layout. */
  onTabEnsured?: () => void;
  /** The main area when there is no task — the composer at `/` (§7.5). */
  children?: ReactNode;
}

/**
 * The v2 app shell: task list left, tab area centre, Explorer right (§7.1).
 *
 * Both routes render this. Which task is showing is the URL's business and
 * arrives as a prop; everything else — the layout, the Explorer's section, the
 * sidebar's ordering, filter and per-row actions — belongs to the shell and its
 * hooks, so the routes stay about addresses.
 */
export function TaskShell({ taskId, pendingTab = null, onTabEnsured, children }: TaskShellProps) {
  const { tasks, loaded } = useTasks();
  const openTask = useOpenTask();
  const explorerPanel = useExplorerPanel();
  const explorerSections = useExplorerRail(taskId);
  // A real layout for the selected task, persisted per task id.
  const { layout, setLayout } = useTaskLayout(taskId);
  const sidebar = useTaskSidebar({ selectedTaskId: taskId, onSelectTask: openTask });

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
  const selected = tasks.find((t) => t.id === taskId);
  const { sendInput } = usePty();

  // The label the header shows, in the browser's tab too. Set here rather than
  // by the route, which knows an id and not a title — and left unset, the tab
  // reads a static "CodeToaster" for every task, which is how the v1 session
  // route's title effect (TASK-21) is not simply dropped.
  const label = selected ? (displayNames.get(selected.id) ?? selected.title) : null;
  useEffect(() => {
    document.title = label ? `${label} — CodeToaster` : "CodeToaster";
  }, [label]);

  // Which task is on screen, for the notification adapter. It decides whether a
  // notification is for the terminal the user is already watching — and with
  // nothing telling it, every one of them rings.
  const { setViewedTask } = useSession();
  useEffect(() => {
    setViewedTask(taskId);
    return () => setViewedTask(null);
  }, [taskId, setViewedTask]);

  const handleOpenTab = useCallback(
    (descriptor: TabDescriptor, options?: OpenOptions) => {
      if (!layout) return;
      setLayout(openTab(layout, descriptor, options));
    },
    [layout, setLayout],
  );

  // ── ?tab= ─────────────────────────────────────────────────────────────────
  // Guarded by what was ensured rather than left to run again: `setLayout` and
  // the route's parameter clear are two separate state updates, so there is a
  // render in between where the layout has changed and the parameter has not,
  // and without the token that render would ensure a second time. `openTab` is
  // idempotent, so the cost would only be a redundant navigate — but the guard
  // is also what lets the same link be followed twice in a row: the token
  // clears when the parameter does, not when the tab closes.
  const ensuredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingTab || !taskId) {
      ensuredRef.current = null;
      return;
    }
    if (!layout) return;
    const token = `${taskId}:${pendingTab}`;
    if (ensuredRef.current === token) return;
    ensuredRef.current = token;

    // A key this build cannot open — an older link, or a hand-edited URL — is
    // dropped rather than being allowed to hold the parameter open forever.
    const descriptor = descriptorFromKey(pendingTab);
    // Deliberately permanent, not preview: following a link is the user asking
    // for that tab by name, and a preview tab would be replaced by their next
    // click in the Explorer.
    if (descriptor) setLayout(openTab(layout, descriptor));
    onTabEnsured?.();
  }, [pendingTab, taskId, layout, setLayout, onTabEnsured]);

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
                  // No path or branch yet: neither is on the wire, and a task
                  // header is the wrong place to invent one. They arrive with
                  // the worktree work in Phase 5, which is what makes a task's
                  // checkout a fact the server knows.
                  <TaskHeader
                    title={selected ? (displayNames.get(selected.id) ?? selected.title) : "Task"}
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
                    key={`${taskId}:${tab.key}`}
                    taskId={taskId!}
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
      }}
      explorerSections={explorerSections}
      explorerTab={explorerPanel.section}
      onExplorerTabChange={explorerPanel.setSection}
      explorerOpen={explorerPanel.open}
      onExplorerOpenChange={explorerPanel.setOpen}
      explorer={
        <Explorer taskId={taskId} section={explorerPanel.section} onOpenTab={handleOpenTab} />
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
      {children}
    </AppShell>
  );
}
