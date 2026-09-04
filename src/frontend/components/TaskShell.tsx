import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { taskDisplayNames, taskStateOf, useTasks } from "@/frontend/TaskContext";
import { usePty } from "@/frontend/PtyContext";
import { AppShell } from "@/frontend/components/v2/AppShell";
import { useTaskSidebar } from "@/frontend/components/TaskSidebar";
import { Button } from "@/frontend/components/v2/Button";
import { WipNotice } from "@/frontend/components/WipNotice";
import { Explorer, useExplorerRail } from "@/frontend/components/Explorer";
import { SettingsDialog } from "@/frontend/components/SettingsDialog";
import { useExplorerPanel } from "@/frontend/hooks/use-explorer-panel";
import { useOpenComposer, useOpenTask } from "@/frontend/hooks/use-task-nav";
import { pathLabel } from "@/frontend/utils/path-label";
import { TabArea, TabPane, useTaskLayout } from "@/frontend/components/tabs";
import {
  allTabs,
  descriptorFromKey,
  openTab,
  reconcileShellTabs,
  type OpenOptions,
  type TabDescriptor,
  type TabState,
  type TaskLayout,
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
  const { tasks, loaded, home, openShell, closeShell, setViewedTask } = useTasks();
  const openTask = useOpenTask();
  const openComposer = useOpenComposer();
  const explorerPanel = useExplorerPanel();
  const explorerSections = useExplorerRail(taskId, explorerPanel.section);
  // The Explorer's section is per device and the Backlog one only exists for a
  // Backlog.md repository (TASK-85), so a user who left the panel on Backlog
  // and moved to a task without one would open onto a section whose rail item
  // is gone — nothing to click back out of.
  //
  // Read off the rail rather than re-derived from the same query: two
  // predicates over one `detected` disagreed about the undecided case, so at
  // the composer — where the query is disabled and so never answers `false` —
  // the rail dropped the item while this went on showing the section, and the
  // panel was titled Backlog with nothing under it to close.
  const explorerSection = explorerSections.some((s) => s.label === explorerPanel.section)
    ? explorerPanel.section
    : "Changes";
  // A real layout for the selected task, persisted per task id.
  const { layout, setLayout } = useTaskLayout(taskId);
  const sidebar = useTaskSidebar({
    selectedTaskId: taskId,
    onSelectTask: openTask,
    onNewTask: openComposer,
  });
  // The shell's footer draws the Settings button; the dialog it opens is held
  // here, since it is the shell's chrome and belongs to no task.
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * The layout as of the last commit *and* of any write already issued, plus
   * the task it belongs to.
   *
   * `handleNewShell` is the one layout write that spans an await, and the
   * `layout` a closure captured before it is stale by the time the spawn
   * answers. Two presses on `+` inside one round trip capture the same
   * snapshot, so the second write lands a layout that never held the first
   * shell's tab — leaving a shell running with nothing on screen to close it
   * and nothing to reap it short of the task being suspended. Every write goes
   * through `applyLayout` so the ref is never behind one.
   */
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;
  const applyLayout = useCallback(
    (next: TaskLayout) => {
      layoutRef.current = next;
      setLayout(next);
    },
    [setLayout],
  );

  // Only for the task header below — the sidebar projects its own labels. The
  // label is projected, not stored: an explicit rename, else the live
  // terminal title when it carries real content *and is unique*, else the
  // stable name. Claude Code sits on a bare "Claude Code" until it has a task,
  // so without this every agent task in the list reads identically — which is
  // the failure the projection exists to prevent (naming.ts).
  const displayNames = useMemo(() => taskDisplayNames(tasks), [tasks]);
  const selected = tasks.find((t) => t.id === taskId);
  const { sendInput } = usePty();

  // The label the browser's tab shows. Set here rather than by the route, which
  // knows an id and not a title — and left unset, the tab reads a static
  // "CodeToaster" for every task, which is how the v1 session route's title
  // effect (TASK-21) is not simply dropped.
  const label = selected ? (displayNames.get(selected.id) ?? selected.title) : null;
  useEffect(() => {
    document.title = label ? `${label} — CodeToaster` : "CodeToaster";
  }, [label]);

  // Which task is on screen. It decides whether a notification is for the
  // terminal the user is already watching — and with nothing telling it, every
  // one of them rings.
  useEffect(() => {
    setViewedTask(taskId);
    return () => setViewedTask(null);
  }, [taskId, setViewedTask]);

  const handleOpenTab = useCallback(
    (descriptor: TabDescriptor, options?: OpenOptions) => {
      if (!layout) return;
      applyLayout(openTab(layout, descriptor, options));
    },
    [layout, applyLayout],
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
    if (descriptor) applyLayout(openTab(layout, descriptor));
    onTabEnsured?.();
  }, [pendingTab, taskId, layout, applyLayout, onTabEnsured]);

  // Having a ptyId is not the same as having somewhere to write. A PTY whose
  // process exited on its own is never removed from PtyManager — only `kill`
  // does that — so `TaskInfo.ptyId` stays non-null for the whole life of the
  // daemon while `Pty.write` silently drops everything. Testing the id alone
  // therefore passed for exactly the case this guard exists for.
  const ptyId = selected?.ptyId ?? null;
  const canDeliver = !!ptyId && !selected?.exited;

  // ── shell tabs ────────────────────────────────────────────────────────────

  // Through `layoutRef`, not the captured `layout`: this is the one layout
  // write that spans an await, and the snapshot it started from is stale by the
  // time the spawn answers (see `applyLayout` above).
  const handleNewShell = useCallback(async () => {
    if (!taskId || !layoutRef.current) return;
    const result = await openShell(taskId);
    // The failure already reached the user as a toast; there is simply no tab
    // to open. The commonest one by far is a 409 — the task was harvested while
    // the strip sat on screen saying otherwise.
    if (!result.ok) return;
    // The user can have moved to another task under the round trip, and the
    // ref now holds *that* task's layout. The shell belongs to the task that
    // was asked, so it must not be opened somewhere it would name a PTY the
    // layout's task does not hold — and it cannot simply be dropped either.
    // §5.5's reconciliation prunes *tabs*; nothing there reaps a PTY no tab
    // names, so an abandoned shell would go on running in the task's directory
    // until the next suspend, with nothing on screen to close it. Killed here
    // instead, through the same door the close gesture uses.
    const current = layoutRef.current;
    if (!current || taskIdRef.current !== taskId) {
      void closeShell(taskId, result.value.ptyId);
      return;
    }
    applyLayout(openTab(current, { kind: "shell", ptyId: result.value.ptyId }));
  }, [taskId, openShell, closeShell, applyLayout]);

  // Closing a shell tab is what kills its shell. Only from the close gesture:
  // a shell tab dropped by the reconciliation below names a PTY that is already
  // gone, and a DELETE for it would be a 404 and a toast about a terminal the
  // user never asked to close.
  const handleCloseTab = useCallback(
    (tab: TabState) => {
      if (!taskId || tab.descriptor.kind !== "shell") return;
      void closeShell(taskId, tab.descriptor.ptyId);
    },
    [taskId, closeShell],
  );

  /**
   * Shell tabs whose PTY the client has been told is live. The layout is
   * per-device and persisted; the PTYs are not, and the two have to be
   * reconciled on the way back — §5.5's "shell tabs are not resumable", made
   * concrete below as: they are dropped, and the user is told.
   *
   * Held because the reconciliation acts on a PTY being *known dead*, never on
   * one being merely absent. A shell just opened is in the layout before any
   * broadcast has had to mention it, so pruning on absence would race a task
   * delta computed a moment before the spawn against the response that opened
   * the tab — and lose, by deleting the tab the user just asked for.
   *
   * A tab *restored from disk* is the other half of that, and it counts as
   * knowledge the moment the layout loads. Nothing is in flight for it — this
   * client did not spawn it — so its absence from `shellPtyIds` is evidence
   * rather than silence. Without seeding it here, a shell tab whose PTY died
   * while nothing was watching (a daemon restart, or a harvest the user then
   * resumed from the sidebar) would meet a task that is `live` again with the
   * ptyId in neither `seen` nor `shellPtyIds`, and neither rule would fire: the
   * tab would sit there for good, attached to nothing, and closing it would
   * DELETE a PTY the server has never heard of and raise an error toast.
   */
  const seenShellsRef = useRef<Set<string>>(new Set());
  const restoredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!taskId || !layout || restoredForRef.current === taskId) return;
    restoredForRef.current = taskId;
    for (const tab of allTabs(layout)) {
      if (tab.descriptor.kind === "shell") seenShellsRef.current.add(tab.descriptor.ptyId);
    }
  }, [taskId, layout]);

  const lifecycle = selected?.lifecycle;
  const shellPtyIds = selected?.shellPtyIds;
  useEffect(() => {
    if (!taskId || !layout || !lifecycle || !shellPtyIds) return;
    for (const ptyId of shellPtyIds) seenShellsRef.current.add(ptyId);

    const pruned = reconcileShellTabs(layout, { lifecycle, shellPtyIds }, seenShellsRef.current);
    if (pruned === layout) return;
    const dropped = allTabs(layout).length - allTabs(pruned).length;
    applyLayout(pruned);
    // Said out loud rather than done quietly: the user left a shell tab open
    // and it is not there any more, and a workspace that rearranges itself
    // without explanation reads as a bug.
    toast(dropped === 1 ? "Closed a shell tab" : `Closed ${dropped} shell tabs`, {
      description:
        lifecycle === "live"
          ? // A live task loses a shell when something killed it — this tab
            // closed in another browser, or the route called directly. A shell
            // that merely *exits* keeps its tab: the terminal is showing the
            // exit code, which is the one place the reason is written down.
            "That shell is no longer running."
          : "Shells are not resumable, so they do not survive a task being suspended.",
    });
  }, [taskId, layout, lifecycle, shellPtyIds, applyLayout]);

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
      applyLayout(openTab(layout, { kind: "agent" }));
      return true;
    },
    [canDeliver, ptyId, sendInput, layout, applyLayout],
  );

  return (
    <>
      <AppShell
        {...sidebar}
        endpoint={loaded ? `:${location.port || "80"}` : "connecting…"}
        onOpenSettings={() => setSettingsOpen(true)}
        tabArea={
          layout
            ? ({ leading }) => (
                // The notice sits above the whole tab area rather than inside a
                // pane, because the decision is about the *checkout* and every
                // tab is looking at it — the diff, the file tree and the history
                // all read the same tree. Shown once for the same reason: a
                // split renders two agent panes and this is one question.
                <div className="flex h-full min-h-0 flex-col">
                  {/* Keyed by task, because the notice holds the "Later"
                      dismissal in its own state and the shell does not remount
                      when the route moves between tasks. Unkeyed, React would
                      reconcile the two into one component and a dismissal on
                      one task would silently swallow the next task's notice —
                      the one case where the user is never told their work
                      could not be restored. */}
                  {selected?.wipPending && <WipNotice key={selected.id} taskId={selected.id} />}
                  <TabArea
                  layout={layout}
                  onLayoutChange={applyLayout}
                  onNewShell={taskId ? handleNewShell : undefined}
                  onCloseTab={handleCloseTab}
                  leading={leading}
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
                </div>
              )
            : undefined
        }
        status={{
          state: selected ? taskStateOf(selected) : undefined,
          // Where you are, then what you are on: the two facts here that are
          // about the task rather than about the window, and the reason this
          // bar carries them at all (TASK-71). The sidebar shows the branch
          // too, but the sidebar can be closed and the status bar cannot.
          //
          // The path is left out when the task is sitting where we put it,
          // because that path is `~/.codetoaster/worktrees/<project>/<uuid>` —
          // a generated location that says nothing the branch beside it does
          // not say better, and spends the whole width of the bar saying it.
          // What the comparison *does* catch is the two disagreeing: an agent
          // that has cd'd out of its own checkout (§5.4) gets its path back,
          // which is the case where a path is worth reading.
          //
          // Against `worktreeCwd` and not `worktreePath`: a project pointing
          // below the toplevel puts the agent in a subdirectory of its checkout
          // (TASK-65), so those two are only equal for a project at the root —
          // and comparing the wrong one shows the generated path permanently
          // for every other project, while hiding it in exactly the case worth
          // reporting.
          //
          // Shortened for display, with the real one in its `title`, so nothing
          // elided is more than a hover away.
          //
          // The branch is drawn only when there is one. A task running in the
          // project's own directory has no checkout of ours and a detached head
          // has no branch, and neither is a blank worth a column.
          //
          // Read off the task and not off `worktree`, which is the *measurement*
          // and exists only for a checkout that is on disk. Taking it from there
          // left an evicted task saying nothing at all about where it is — no
          // branch, because nothing had been measured, and no path either,
          // because the rule above suppresses it — which is the state a task
          // spends most of its life in.
          items: selected
            ? [
                ...(selected.cwd === selected.worktreeCwd
                  ? []
                  : [
                      <span key="cwd" title={selected.cwd}>
                        {pathLabel(selected.cwd, home)}
                      </span>,
                    ]),
                ...(selected.branch ? [selected.branch] : []),
                `${selected.size.cols}×${selected.size.rows}`,
                `${selected.clientCount} viewing`,
              ]
            : ["no task"],
        }}
        explorerSections={explorerSections}
        explorerTab={explorerSection}
        onExplorerTabChange={explorerPanel.setSection}
        explorerOpen={explorerPanel.open}
        onExplorerOpenChange={explorerPanel.setOpen}
        explorer={
          <Explorer
            taskId={taskId}
            section={explorerSection}
            backlogTab={explorerPanel.backlogTab}
            onBacklogTabChange={explorerPanel.setBacklogTab}
            onOpenTab={handleOpenTab}
          />
        }
        // No "Commit" button beside it: every route under `src/api/git.ts` is a
        // read-only GET, so there is nothing behind one.
        explorerFooter={
          explorerSection === "Changes" && layout ? (
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
      {/* A sibling of the shell, not one of its children: `AppShell` renders
          `children` only on the branch where no `tabArea` was supplied, so a
          dialog passed through there would never mount on a task page — which
          is every page with a layout, and so every page the Settings button in
          the sidebar footer is reachable from. */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
