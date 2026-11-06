---
id: TASK-144
title: Long worktree names wrap the Explorer picker onto two lines
status: Done
assignee: []
created_date: '2026-11-06T22:27:00Z'
updated_date: '2026-11-06T22:32:00Z'
labels:
  - frontend
  - bug
dependencies: []
ordinal: 148000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A worktree whose branch and directory are long (Claude Code names one `.claude/worktrees/<name>` on branch `worktree-<name>`) wrapped the Explorer picker label onto a second, centred line. Every v2 Select trigger was meant to truncate, but Radix `Select.Value` drops its className, so the truncate classes never reached the DOM.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A v2 Select trigger whose label is longer than the chip shows one line ending in an ellipsis
- [x] #2 A worktree whose branch already contains its directory name is labelled by the branch alone; others keep branch and directory
- [x] #3 Tests cover the label rule and the trigger layout classes
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The v2 Select trigger now puts its truncate/min-w-0/text-left classes on a wrapper span around Radix Value, which drops className, so a long label ends in an ellipsis instead of wrapping; this fixes every v2 Select, not only the worktree picker. worktreeLabel drops the directory when the branch names it as whole words (worktree-<name> on .claude/worktrees/<name>), keeping it otherwise (web is not named by feature/webhooks). Tests: use-worktrees.test.ts for the label rule, a Select render test for the trigger classes, Explorer-worktrees expectations updated. Code review (--fix): two findings, both fixed: substring matching dropped short directories (now whole-word) and a stale WorktreePicker comment. Verify: isolated server with long worktree names, the picker trigger shows one truncated line, the open list shows full names, composer chips unchanged. bun run test 2175 + 595 pass, typecheck clean.
<!-- SECTION:FINAL_SUMMARY:END -->
