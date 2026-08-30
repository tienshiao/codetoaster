---
id: TASK-23
title: >-
  Re-key view-state-store to tab keys; thin tab hosts for
  diff/file/commit/history
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-08-30 04:11'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-18
documentation:
  - docs/v2-architecture.md
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
view-state-store.ts survives but is keyed by tab key instead of session id (§7.4); helpers (pruneSet, toggleInSet, withAll, pruneComments) carry over unchanged. GitViewState/DiffViewState shrink to per-tab shapes. DiffView.tsx / FileView.tsx / GitView.tsx become thin hosts that render DiffLayout / file content / CommitDetail for one descriptor. New tab kinds: diff (one working-tree file), diffAll, file (with optional line), commit (sha), history.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 View state is stored and pruned per tab key; closing a tab drops its state
- [x] #2 Each TabDescriptor kind renders the matching existing component without duplicating its logic
- [x] #3 Scroll offsets, expanded paths, hunk expansions, and comments survive switching tabs and reloads
- [x] #4 Existing diff/file/git component tests pass unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. view-state-store re-key. Store becomes Map<string, Slot> keyed `${taskId}:${viewKey}`, where viewKey is a tabKey (agent, diffAll, diff:<path>, file:<path>, commit:<sha>, history) or a non-tab key (review, files). A typed slot registry (ViewStateShapes + per-kind default factories) keeps getViewState/useViewState as ergonomic as today with one fewer degree of freedom. Slots: diffAll, diffFile, file, commit, history, review, files. gitDetailState/peekGitDetailState and the whole sha-reset dance are DELETED - a commit tab's key already carries the sha, so per-sha state is just per-key state.

2. Comments are per-task, not per-tab (the `review` slot). A comment left on a diff:<path> tab and one left on diffAll are one review, and Submit gathers both; splitting them per tab would silently drop half a review.

3. Persistence (AC3). persist.ts beside the store: one localStorage entry per task, Set/Map revived on load, debounced write, following layout-store's load/save/retain pattern including its quota-swallow. hunkExpansions is omitted from the serialized shape BY CONSTRUCTION rather than by a filter, so it cannot leak in: it is derived from the diff, potentially megabytes, and restoring it stale is exactly the corruption DiffView's prune effect exists to prevent.

4. Pruning (AC1). retainViewStates(taskId, validKeys) drops slots for tabs no longer in the layout while always keeping the non-tab keys; dropTaskViewStates(taskId) for a task that is gone. Called from use-task-layout on every layout change, and from SessionContext where retainViewStates(validIds) is called today.

5. Shared leaf components become prop-driven. diff/FileTree, file/FileTree, CommitList and RefSidebar reach into the store by sessionId today, which is precisely the coupling that stops one component serving two tab keys; they take their state as props instead (both FileTrees already have the prop-or-store fallback half-built). CommitDetail takes a viewKey instead of (sessionId, sha).

6. The hosts, under components/tabs/panes/: DiffAllPane, DiffFilePane, FilePane, CommitPane, HistoryPane, plus a TabPane dispatcher replacing PaneFixture's non-terminal branch in routes/shell.tsx. Terminal panes stay fixture - their host is TASK-27/28's. Each host is thin: resolve the view key, pull the slot, render the existing component.

7. v1 stays running until TASK-21 deletes it. DiffView/FileView/GitView keep their routes and read the SAME slots the hosts read (v1's diff tab IS diffAll; v1's git tab is history + commit:<sha>), so there is no forked state. A small v1-only `nav` slot carries lastTab and the git URL-selection mirror that utils/session-nav.ts still reads, and GitView's splitRatio; all of it is deleted with the routes in TASK-21 and is labelled as such.

8. Tests. Rewrite view-state-store.test.ts for keying, defaults, pruning, and the persist round-trip (Set/Map revive, and hunkExpansions' absence from the blob).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Store layer landed. view-state-store.ts is re-keyed to task + view key with nine typed slots (diffAll, diffFile, file, commit, history, review, files, prefs, nav) and a PERSISTED allowlist per kind; hunkExpansions is omitted from that allowlist by construction rather than filtered on the way out. gitDetailState/peekGitDetailState/useGitDetailState and the whole sha-reset dance are deleted: a commit tab's key contains the sha, so per-commit state is per-key state with nothing to invalidate.

Persistence is one localStorage entry per task, Sets and Maps tagged through JSON, debounced 250ms, flushed on pagehide/visibilitychange from inside the store so no consumer has to remember it.

Pruning (AC1) lives in components/tabs/use-task-layout.ts: the layout is what decides how long a tab's view state lives, and it prunes on load as well as on change, so a tab closed on another device does not leave state behind.

Four bugs found and fixed during the store's own test pass, all one root cause - a function reading only what was in memory, when a task is not hydrated until one of its views is first read:
- writeNow serialized an un-hydrated task to nothing and the empty result was taken for 'no state', deleting the entry;
- retainTaskViewStates derived its candidates from memory only, so a startup sweep reached nothing on disk - precisely the leak it exists to prevent;
- clearViewState on an un-hydrated task was a no-op the next read resurrected;
- retainViewStates likewise, which mattered most: the load-time prune above runs before anything has read the task, so AC1 was pruning an empty map on a fresh page load.
All four now hydrate first.

v1 keeps running until TASK-21 deletes it, reading the SAME slots the v2 hosts read (v1's diff tab IS diffAll; v1's git tab is history + commit:<sha>), so there is no forked state. Two v1-only keys, 'nav' and 'fileView', carry what utils/session-nav.ts still needs and die with the routes.

Panes and dispatcher landed. hooks/use-hunk-expansions.ts (the stale-expansion prune and handleExpandContext) and hooks/use-git-history.ts (log/refs queries, refSets, selectRef, the activity-settle refetch, the refs-hash log reset) were extracted so the panes reuse that logic rather than copying it - AC2. components/tabs/panes/ holds FilePane, CommitPane, DiffFilePane, HistoryPane and a TabPane dispatcher; diffAll renders DiffView directly, since it already takes a task and a submit and already addresses the diffAll and review slots, so a wrapper would forward two props. agent/shell still render the terminal fixture: that host is TASK-27/28's.

DiffLayout gained two additive props (showFileTree, showViewModeToggle, both defaulting true) because a per-file tab has nothing to select; the toolbar band is skipped when it would be empty. Separately its floating Prev/Next bar is now gated on files.length > 1 - it was rendering two dead buttons over '1 of 1', which also affected v1 whenever the working tree held a single file. Both are behaviour-preserving for existing callers.

The localStorage prefix was harmonised from 'codetoaster.viewstate.' to 'codetoaster:viewstate:' to match layout-store's existing 'codetoaster:layout:' convention - layout-store.test.ts was already asserting on the colon form.

Verified at runtime against an isolated server (foreground --port 4599, own db) with a real task in this repo:
- diffAll renders the live 28-file diff with tree and All/Single toggle; a diff:<path> tab renders the one file with no tree, no toggle and no prev/next; a path absent from the diff gets a message and a Refresh, not a crash.
- file tabs are independent: layout-store.ts scrolled to 1000px with Wrap on, its sibling view-state-store.ts opened at line 1 with Wrap off.
- AC3 across a real page reload: after reloading, the file tab reopened at the same 1000px offset with Wrap still latched, and an unsubmitted review comment came back rendered inline with 'Submit Review (1)' and the tree's comment badge. The stored blob shows the comment under the task-wide 'review' slot, separate from 'diffAll'.
- No console errors.

bunx tsc --noEmit exits 0; bun test is 638 pass / 0 fail across 41 files.

Post-implementation code review (/code-review --fix) found and fixed two further bugs:

1. Two live panes on one slot lost each other's writes. useViewState kept a private useState copy and resolved updaters against it, which was sound while only one view could be mounted per session but is not now that splitTab exists and the review slot is task-wide: diffAll in one group and diff:<path> in another both address it, so the second pane's setComments(prev => ...) ran against a Map snapshotted before the first pane's write and wrote it back, silently destroying a comment. Fixed by adding per-FIELD change notification to the store (subscribeViewField, notified from setViewField) and reworking useViewState to resolve every updater against the store and subscribe to its field. Keyed per field so the per-frame scrollTop/listScrollTop writes, which nothing subscribes to, wake nobody. Verified in the browser with a real split: a comment in each pane, both present in the stored review, and the left pane's toolbar moved to 'Submit Review (2)' on its own.

2. TabArea's startDrag/startResize assigned the gesture ref before calling listen, and listen begins by releasing the previous gesture - whose finish handler nulls that very ref. A second pointer landing before the first lifted therefore killed the drag it was starting. Fixed by releasing before writing the ref. NOTE: this is committed TASK-22 code, not part of TASK-23's change; it is a correct one-line fix but belongs to TabArea rather than to this task.

Two findings were deliberately not fixed: the v1 GitView commit slot keyed by the URL's sha spelling rather than the resolved hash (v1 code, deleted in TASK-21), and a per-file diff tab offering no Submit affordance for the comments it collects (a design decision, not a correctness repair - worth raising separately).

bunx tsc --noEmit exits 0; bun test is 639 pass / 0 fail.

The TabArea gesture-ref fix listed above was split out into TASK-50 and does not belong to this task's change. It remains in the working tree and should be committed separately.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Re-keyed view-state-store from one blob per session to typed slots addressed by task + view key, where the view key is the tab's own key - so 'which tab is this' and 'whose scroll offset is this' stop being two questions that can disagree. Nine slots (diffAll, diffFile, file, commit, history, review, files, prefs, nav); the git detail cache's sha-reset machinery is deleted rather than ported, because a commit tab's key contains the sha and per-commit state is now per-key state with nothing to invalidate.

The cheap fields persist to localStorage per task with Sets and Maps tagged through JSON; hunkExpansions is left out of the PERSISTED allowlist by construction, since it holds fetched diff lines and restoring it stale is exactly the corruption the diff view's prune effect exists to prevent. Tab-close pruning lives in use-task-layout, on load as well as on change.

The shared components (both FileTrees, CommitList, RefSidebar, CommitDetail) are now prop-driven - that store coupling was what stopped one component serving two tabs. v1 keeps running until TASK-21 deletes it and reads the same slots the v2 hosts read, so there is no forked state; two v1-only keys (nav, fileView) are labelled as dying with the routes.

Five defects were found and fixed along the way, four of them one root cause - functions reading only what was in memory when a task is not hydrated until first read. The load-bearing one: retainViewStates is called by the load-time prune before anything has read the task, so AC1 was pruning an empty map on every fresh page load. Each has a regression test confirmed to fail against the pre-fix code and only that test.

Verified with bunx tsc --noEmit (exit 0), bun test (638 pass / 0 fail), and a real browser pass against an isolated server: all four tab kinds render, sibling file tabs keep independent scroll and toggles, and after a full page reload a file tab reopened at its exact offset with Wrap latched and an unsubmitted review comment came back inline.
<!-- SECTION:FINAL_SUMMARY:END -->
