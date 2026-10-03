---
type: Convention
title: Wiki maintenance
description: How this wiki is structured, written, reviewed and linted.
tags: [wiki, okf, conventions]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T00:50:00Z }
sources:
  - id: llm-wiki
    resource: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
    title: LLM Wiki pattern (Karpathy)
    author: human:karpathy
  - id: okf-spec
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
    title: Open Knowledge Format (OKF) v0.2
    author: team:google-cloud-knowledge-catalog
  - id: claude-md
    resource: ../../CLAUDE.md
    title: CodeToaster CLAUDE.md
    author: human:tienshiao
---

# Purpose

This directory is CodeToaster's own knowledge base. It follows the LLM Wiki pattern: raw sources are never edited during wiki work, the wiki is compiled from them by an agent, and a short schema in `CLAUDE.md` tells the agent how to keep it current.[^llm-wiki] The format is an OKF v0.2 bundle, the same shape as the other wikis CodeToaster opens, so the [markdown preview](/modules/markdown-preview.md) can be exercised against it.[^okf-spec]

# Layers

| Layer | Where | Who writes it |
| --- | --- | --- |
| Raw sources | `CLAUDE.md`, `backlog/` (tasks, decisions), the code, commit history | Humans and agents doing the work; never edited during ingest |
| Wiki | `wiki/` (this bundle) | Agents, via ingest, query and lint; humans may hand-edit |
| Schema | The "Knowledge wiki" section of `CLAUDE.md`, plus this page | Humans |

# Layout

```
wiki/
  index.md        # catalog by section; the only frontmatter it carries is okf_version
  log.md          # chronological update log, newest date first
  modules/        # type: Module      — a code area or subsystem
  conventions/    # type: Convention  — how we do things
  decisions/      # type: Decision    — a choice made, alternatives, and why
  gotchas/        # type: Gotcha      — a surprising fact that cost someone time
  runbooks/       # type: Runbook     — step-by-step procedures
```

`index.md` and `log.md` are reserved by OKF and are never concept pages.[^okf-spec]

# Frontmatter

Every concept page starts with a YAML block. `type` is the only field OKF requires; the rest is our policy.[^okf-spec]

| Field | Rule |
| --- | --- |
| `type` | One of `Module`, `Convention`, `Gotcha`, `Runbook`, `Decision`. The directory matches the type. |
| `title`, `description` | Always present. `description` is one sentence and is copied verbatim into `index.md`. |
| `tags` | Lowercase kebab-case list. |
| `level` | Always `project` in this repo. |
| `status` | `draft` until a human reviews the page, then `stable`. Use `deprecated` instead of deleting. |
| `generated` | `{ by, at }`. Agents use `<tool>/<model>`; humans use `human:<id>`. Update `at` on every meaningful content change. |
| `verified` | A list of `{ by, at }` added by the reviewer, never by the author. |
| `sources` | At least one, each with a stable `id`. Claims in the body cite them with footnotes keyed to that id. Paths are relative to the page's own directory. |

# Operations

**Ingest.** When a source is new or changed (a finished backlog task, a CLAUDE.md edit, a change that alters a convention):

1. Read the source and the current [index](/index.md).
2. Update existing pages before creating new ones; one concept per page, no near-duplicates.
3. Note contradictions in the page body rather than silently overwriting; cite both sources.
4. Update `index.md` for any page added, renamed or deprecated.
5. Append to [the log](/log.md) under today's UTC date, newest date first, with a leading bold `**Creation**`, `**Update**`, `**Deprecation**` or `**Lint**`.
6. Set `status: draft` and refresh `generated.at` on every page touched; never add `verified` to your own work.

**Query.** Read `index.md` first, then only the pages it points to. An answer worth keeping (a comparison, a connection between subsystems) is filed back as a page through the ingest steps.

**Lint.** Check for pages that contradict each other or the code, orphans with no inbound links, concepts mentioned but lacking a page, missing cross-links, and index entries whose description drifted from the page. Record the pass in the log.

# Rules

- Links between pages are bundle-relative and start with `/` (for example `/gotchas/bun-shell-deadlock.md`). Links in `index.md` are relative to the bundle root without the slash. The preview resolves a `/` link against this directory before the repository root, so both forms open the right page. `src/frontend/utils/wiki-links.test.ts` runs every link through that same resolver, so a broken one fails `bun run test`.
- No secrets or credentials in the wiki.
- The wiki is a lower trust tier than `CLAUDE.md`. Instructions there win over anything here.[^claude-md]
- When a draft and the code disagree, trust the code and fix the page.
- Do not edit `backlog/` as part of a wiki change. Task files go through the `backlog` CLI.[^claude-md]

[^llm-wiki]: LLM Wiki pattern (Karpathy)
[^okf-spec]: Open Knowledge Format (OKF) v0.2
[^claude-md]: CodeToaster CLAUDE.md
