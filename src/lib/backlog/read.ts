// Reading a Backlog.md project off disk (TASK-84). The shell asks for this
// again every few seconds while an agent files and updates tasks through the
// CLI, so it is file reads and nothing else — no git, no `backlog` spawn.

import { readdir } from "node:fs/promises";
import * as path from "node:path";
import type { BacklogTask, BacklogResponse } from "../../types/backlog";

/** Backlog.md's own defaults, used when config.yml is silent or unreadable. */
const DEFAULT_STATUSES = ["To Do", "In Progress", "Done"];
const DEFAULT_PREFIX = "task";

/** The two directories that hold live tasks. `archive/` and `drafts/` are
 * deliberately absent: neither belongs on the board the client draws. */
const TASK_DIRS = ["backlog/tasks", "backlog/completed"];

function extractFrontmatter(content: string): string | null {
  // A byte-order mark ahead of the opening `---` would otherwise read as "no
  // frontmatter" and silently drop the task.
  const body = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = body.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") return lines.slice(1, i).join("\n");
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  // `assignee: '@tma'` and `assignee: ['@tma']` are both written in the wild,
  // and the client only ever wants the list form.
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string");
}

/**
 * One task file's frontmatter, or null when there is nothing usable in it.
 * Pure and exported so the parsing rules can be tested without a fixture tree.
 *
 * Returning null rather than throwing is the point: a half-written file — the
 * agent is editing these while the client polls — skips a card instead of
 * failing the whole list.
 */
export function parseTaskFile(content: string, filePath: string): BacklogTask | null {
  const frontmatter = extractFrontmatter(content);
  if (frontmatter === null) return null;

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(frontmatter);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const fm = parsed as Record<string, unknown>;
  if (typeof fm.id !== "string") return null;

  // A folded `title: >-` arrives from the YAML parser already joined into one
  // line, which is exactly what the card wants.
  const ordinal = typeof fm.ordinal === "number" && Number.isFinite(fm.ordinal) ? fm.ordinal : null;

  return {
    id: fm.id,
    title: fm.title === undefined || fm.title === null ? "" : String(fm.title),
    status: typeof fm.status === "string" ? fm.status : "",
    ordinal,
    priority: typeof fm.priority === "string" ? fm.priority : null,
    labels: asStringArray(fm.labels),
    assignee: asStringArray(fm.assignee),
    path: filePath,
  };
}

/** The number after the last `-` in an id (`TASK-82` → 82), NaN when there is none. */
function numericId(id: string): number {
  const tail = id.slice(id.lastIndexOf("-") + 1);
  return tail.length === 0 ? NaN : Number(tail);
}

/**
 * Backlog.md's board order: ordinal ascending, then numeric id. A file with no
 * ordinal has never been placed on the board, so it sorts after every one that
 * has; an id with no number in it sorts last for the same reason.
 */
export function compareBacklogTasks(a: BacklogTask, b: BacklogTask): number {
  if (a.ordinal !== b.ordinal) {
    if (a.ordinal === null) return 1;
    if (b.ordinal === null) return -1;
    return a.ordinal - b.ordinal;
  }
  const an = numericId(a.id);
  const bn = numericId(b.id);
  if (an === bn) return 0;
  if (Number.isNaN(an)) return 1;
  if (Number.isNaN(bn)) return -1;
  return an - bn;
}

async function listMarkdown(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    // No recursion: Backlog.md keeps task files flat, and the nested trees that
    // do exist (`archive/tasks/`) are the ones that must not be listed.
    return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function readBacklog(repoRoot: string): Promise<BacklogResponse> {
  const configPath = path.join(repoRoot, "backlog", "config.yml");
  const configFile = Bun.file(configPath);
  if (!(await configFile.exists())) return { detected: false };

  let statuses = DEFAULT_STATUSES;
  let prefix = DEFAULT_PREFIX;
  try {
    const config = Bun.YAML.parse(await configFile.text()) as Record<string, unknown> | null;
    if (config && typeof config === "object" && !Array.isArray(config)) {
      if (Array.isArray(config.statuses) && config.statuses.every((s) => typeof s === "string")) {
        statuses = config.statuses as string[];
      }
      if (typeof config.task_prefix === "string" && config.task_prefix.length > 0) {
        prefix = config.task_prefix;
      }
    }
  } catch {
    // The directory is there, so this is a Backlog.md project whatever its
    // config says. Answering `detected: false` — or 500 — over a config the
    // user is mid-edit would blank the section; the defaults are closer.
  }

  const perDir = await Promise.all(
    TASK_DIRS.map(async (relDir) => {
      const names = await listMarkdown(path.join(repoRoot, relDir));
      return Promise.all(
        names.map(async (name) => {
          const relPath = `${relDir}/${name}`;
          try {
            return parseTaskFile(await Bun.file(path.join(repoRoot, relDir, name)).text(), relPath);
          } catch {
            return null;
          }
        })
      );
    })
  );

  const tasks = perDir.flat().filter((t): t is BacklogTask => t !== null);
  tasks.sort(compareBacklogTasks);

  return {
    detected: true,
    // Ids are written with the prefix uppercased (`TASK-82`) whatever case the
    // config uses, and the client matches on that exact form.
    prefix: prefix.toUpperCase(),
    statuses,
    tasks,
  };
}
