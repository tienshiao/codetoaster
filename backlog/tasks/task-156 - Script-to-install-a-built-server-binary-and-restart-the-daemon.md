---
id: TASK-156
title: Script to install a built server binary and restart the daemon
status: Done
assignee:
  - '@claude'
created_date: '2026-11-24T11:01:00Z'
updated_date: '2026-11-24T11:06:00Z'
labels:
  - tooling
dependencies: []
ordinal: 159000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Updating the daemon takes several manual steps: build, rm the old binary before copying (an in-place copy over the old one does not work on macOS), stop, and start again with the same flags. The restart cannot simply be typed into a CodeToaster shell tab, because stopping the daemon closes that terminal and kills the shell before the start runs. The same goes for an agent session inside CodeToaster.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One command installs dist-executables/codetoaster to the destination as a new file (old one moved aside, then cp), and refuses to install or restart if the new binary does not run
- [x] #2 The daemon is restarted with the flags the running daemon was started with
- [x] #3 The restart survives being run from inside CodeToaster, from a shell tab or an agent session
- [x] #4 Optional build step; usage documented in the wiki runbooks
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
scripts/install-server.sh (bun run install:server): optional build; run check on the build; capture the running daemon's pid, flags (after foreground/fg) and cwd; move the old binary aside, cp, run check, restore on failure; stop and start in a perl setsid + nohup process that waits for the old pid to exit and starts in the old cwd. Wiki runbook.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Code review (high, --fix): eight findings, all fixed: wait for the old pid instead of a fixed sleep, check the build before touching dest and restore the old binary on failure (agents call <dest> hook), keep the daemon's cwd, accept fg, refuse --dest equal to the build, portable size, required option values, empty pid. Verified against a throwaway daemon (port 4598, scratch db, started from a scratch dir, script run from src/): restarted from the new binary with identical flags and the original cwd, no backup left. The detach itself was proven by the real restart of port 4000 from this agent session earlier the same day (same perl setsid + nohup shape). shellcheck clean; wiki links pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
scripts/install-server.sh (also bun run install:server) builds optionally, installs the binary as a new file with the old one moved aside and restored if the new one does not run, and restarts the daemon with its own flags and directory in a detached session, so it works from a CodeToaster shell tab or agent session. Review found eight issues, all fixed. Verified on a throwaway daemon; the real port-4000 restart was not repeated with the final script.
<!-- SECTION:FINAL_SUMMARY:END -->
