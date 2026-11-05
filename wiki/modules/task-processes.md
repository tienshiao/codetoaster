---
type: Module
title: Task processes and ports
description: The Explorer's Processes section shows the process tree under a task's terminals and the TCP ports each process listens on, read per request from one ps and one pid-restricted lsof, and polled while the section is open.
tags: [module, processes, ports, explorer, tasks]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-05T02:00:00Z }
sources:
  - id: processes
    resource: ../../src/lib/processes.ts
    title: src/lib/processes.ts
  - id: route
    resource: ../../src/api/tasks.ts
    title: src/api/tasks.ts
  - id: section
    resource: ../../src/frontend/components/ProcessesSection.tsx
    title: src/frontend/components/ProcessesSection.tsx
  - id: task-138-1
    resource: "../../backlog/tasks/task-138.1 - Show-a-tasks-process-tree-and-the-ports-it-is-listening-on.md"
    title: "TASK-138.1 — Show a task's process tree and the ports it is listening on"
---

# What it does

A task whose agent fans out into subagents, dev servers and test runners shows one interleaved terminal stream. The Processes section is the other view of the same work: what is running under each of the task's terminals, as a tree, and which ports it holds.[^task-138-1]

# How the tree is read

`GET /api/tasks/:id/processes` takes a snapshot when asked; nothing is cached or pushed.[^route] [^processes]

- **Roots** are the pids of the task's terminals that are still running, the agent's first and then each shell tab (`TaskManager.processRoots`, off `Pty.pid`).
- **The table** comes from one `ps -A -o pid=,ppid=,command=`, which reads the same on macOS and Linux. The tree is walked in memory from each root, depth-first with children in pid order, so it is one spawn however deep the tree goes.
- **Ports** come from one `lsof -a -nP -iTCP -sTCP:LISTEN -Fpn -p <the tree's pids>`. The `-a` matters: without it lsof ORs the selections and lists every listener on the machine. A server bound on both IPv4 and IPv6 is reported once.

Both tools run through a bounded `Bun.spawn` (never `spawnSync`, which blocks the daemon's event loop, and never `Bun.$`). The two failures are kept apart:

- `ps` failing means nobody can say what is running, so the route answers 503.
- `lsof` failing or missing means the tree is still right, so the answer carries `portsKnown: false`, and an empty port list is not read as "listening on nothing".

A task with no running terminal (suspended, evicted, or every program exited) answers 200 with `live: false`. That is a state to show, not an error.

# The section

`useTaskProcesses` polls every two seconds, because nothing announces a process starting or stopping: the watcher sees files, and terminal output says nothing about the children a program forks. Only the open section mounts the hook, so a closed panel costs nothing. The rail offers Processes for task roots only, since a project browsed from the composer has no terminals.[^section]

Rows are indented by depth under an Agent or Shell label and show the pid, then the program's file name with its arguments (the full command line is the row's `title`). Each port is a link to `http://localhost:<port>`. The section is read-only: stopping a process is a signal to something the user has not confirmed is the one they mean, and its terminal is a click away.

# Related

The file watcher that drives the other Explorer sections: [Change watcher and shared watch streams](/modules/change-watcher.md).

[^processes]: src/lib/processes.ts
[^route]: src/api/tasks.ts
[^section]: src/frontend/components/ProcessesSection.tsx
[^task-138-1]: TASK-138.1 — Show a task's process tree and the ports it is listening on
