import { rootRoutes, safePath, diffUntrackedFiles, gitSpawn, coalesce } from "./utils";
import { highlightFile } from "../lib/highlight/tokenize";
import { capDiff, MAX_DIFF_LINE_CHARS } from "./diff-cap";
import type { LineTokens } from "../types/highlight";

/** `git diff` with the given arguments, or a throw the route turns into a 500:
 * a diff that could not be taken is not an empty diff, and git's own account
 * of why is the only useful part of the message. */
async function diffOrThrow(dir: string, args: string[]): Promise<string> {
  const { stdout, stderr, exitCode } = await gitSpawn(dir, ["diff", ...args], { captureStderr: true });
  if (exitCode !== 0) {
    throw new Error(`git diff ${args.join(" ")} exited ${exitCode}: ${stderr.trim()}`);
  }
  return stdout;
}

/** The working-tree diff: unstaged, then staged, then every untracked file as
 * an addition, with any file over the size budgets reduced to its headers and
 * an oversized marker (`diff-cap.ts`). */
async function workingTreeDiff(dir: string): Promise<string> {
  const [unstaged, staged, untracked] = await Promise.all([
    diffOrThrow(dir, []),
    diffOrThrow(dir, ["--cached"]),
    diffUntrackedFiles(dir),
  ]);
  return capDiff(unstaged + staged + untracked);
}

/** A file line for hunk expansion, cut to the per-line diff budget with a
 * suffix that says how much is missing; a line within budget is returned as
 * it is.
 *
 * The diff routes never ship such a line, but expansion reads the file itself,
 * so a 20 MB line below an otherwise small file's hunk would reach the DOM the
 * moment the user expanded down to it (TASK-117). Truncated rather than
 * refused: the user asked for the surrounding context, and the lines around
 * the long one are still what they wanted to see. */
function capContextLine(line: string): string {
  if (line.length <= MAX_DIFF_LINE_CHARS) return line;
  let cut = MAX_DIFF_LINE_CHARS;
  // Do not leave half a surrogate pair at the cut.
  const last = line.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut--;
  return `${line.slice(0, cut)} … (+${line.length - cut} chars)`;
}

export const diffRoutes = {
  ...rootRoutes("diff", {
    async GET({ repoRoot: dir }) {
      try {
        // Coalesced per directory: the Explorer rail, the Changes panel and an
        // open diff tab all hold this query, and one watcher batch invalidates
        // it for every client at once. Each of those wants the same bytes. The
        // key is the directory, not the task or project id, because the root
        // is re-resolved per request and can move under a task whose agent has
        // changed repository — a caller with the new root must not be handed
        // the old tree's diff — and because a task and its project over one
        // checkout want exactly the same bytes.
        const diff = await coalesce(`diff:${dir}`, () => workingTreeDiff(dir));
        const hash = Bun.hash(diff).toString(16);
        return Response.json({ diff, directory: dir, hash });
      } catch (error) {
        return Response.json(
          { error: "Failed to get git diff", message: error instanceof Error ? error.message : String(error) },
          { status: 500 }
        );
      }
    },
  }),

  ...rootRoutes("context", {
    async GET({ repoRoot: dir }, req) {
      try {
        const url = new URL(req.url);
        const filePath = url.searchParams.get("file");
        const start = parseInt(url.searchParams.get("start") || "1", 10);
        const end = parseInt(url.searchParams.get("end") || "1", 10);

        if (!filePath) {
          return Response.json({ error: "Missing file parameter" }, { status: 400 });
        }

        const fullPath = safePath(dir, filePath);
        if (!fullPath) {
          return Response.json({ error: "Invalid file path" }, { status: 400 });
        }
        const file = Bun.file(fullPath);
        if (!(await file.exists())) {
          return Response.json({ error: "File not found" }, { status: 404 });
        }

        const content = await file.text();
        const allLines = content.split("\n");
        const totalLines = allLines.length;

        const clampedStart = Math.max(1, Math.min(start, totalLines));
        const clampedEnd = Math.max(1, Math.min(end, totalLines));

        const lines: { lineNum: number; content: string }[] = [];
        for (let i = clampedStart; i <= clampedEnd; i++) {
          lines.push({ lineNum: i, content: capContextLine(allLines[i - 1] ?? "") });
        }

        // Tree-sitter tokens for the returned lines (null => client regex
        // fallback). Whole-file highlight is cached, so repeat expansions are free.
        let tokens: (LineTokens)[] | null = null;
        try {
          const fileTokens = await highlightFile(content, filePath);
          // A truncated line gets none: its tokens describe the whole line,
          // and would ship the size the cut just saved.
          if (fileTokens) {
            tokens = lines.map((l) =>
              l.content.length > MAX_DIFF_LINE_CHARS ? [] : fileTokens[l.lineNum - 1] ?? [],
            );
          }
        } catch {
          tokens = null;
        }

        return Response.json({ lines, hasMore: end < totalLines, totalLines, tokens });
      } catch (error) {
        return Response.json(
          { error: "Failed to read file context", message: error instanceof Error ? error.message : String(error) },
          { status: 500 }
        );
      }
    },
  }),
};
