import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { safePath } from "../../api/utils";
import type { ProjectRow } from "../db";
import { WorktreeError } from "./errors";

// The project files a checkout needs and git will not carry
// (docs/v2-architecture.md §5.6).

/** What a copy needs off a project row. Narrower than `ProjectRow` so a test
 * can build one, and shared by create and restore because both have to leave
 * the checkout in the state the project asked for. */
export type WorktreeProject = Pick<ProjectRow, "id" | "initial_path" | "worktree_copy">;

/** The `worktree_copy` entries, one per line.
 *
 * Newline-separated and nothing else. Commas are tempting as a second
 * separator and are wrong: a filename may contain one, and a list format that
 * is sometimes ambiguous is worse than one that is always strict. */
export function parseCopyList(worktreeCopy: string | null): string[] {
  if (!worktreeCopy) return [];
  return worktreeCopy.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Copy the project's ignored-but-needed files into the new checkout.
 *
 * These are load-bearing rather than a convenience (§5.6): the WIP snapshot
 * that makes eviction safe is built with `git add -A`, which honours
 * `.gitignore`, so an ignored `.env` or a build directory does not survive an
 * evict/restore round trip. This and `setup_command` are what put them back.
 *
 * Both ends are contained with `safePath`. The list is project configuration
 * rather than user input at the moment, but it is edited in a text field and
 * `../../.ssh/id_rsa` reads out of the project and writes into somewhere that
 * is not the worktree — a containment check costs a `path.resolve`. */
export async function copyProjectFiles(
  project: WorktreeProject,
  projectRoot: string,
  worktreePath: string,
): Promise<string[]> {
  const copied: string[] = [];
  for (const entry of parseCopyList(project.worktree_copy)) {
    const from = safePath(projectRoot, entry);
    const to = safePath(worktreePath, entry);
    if (!from || !to) {
      throw new WorktreeError("copy-failed", `worktree_copy entry escapes the project: ${entry}`);
    }
    if (!fs.existsSync(from)) continue;
    try {
      await fsp.mkdir(path.dirname(to), { recursive: true });
      // Recursive so an entry may be a directory — `.claude/`, a `vendor/`
      // tree — and not only a single dotfile.
      await fsp.cp(from, to, { recursive: true });
      copied.push(entry);
    } catch (e) {
      throw new WorktreeError("copy-failed", `could not copy ${entry}`, String(e));
    }
  }
  return copied;
}
