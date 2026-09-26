import { resolveTaskRoot, safePath, diffUntrackedFiles, gitSpawn, coalesce } from "./utils";
import { highlightFile } from "../lib/highlight/tokenize";
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
 * an addition. */
async function workingTreeDiff(dir: string): Promise<string> {
  const [unstaged, staged, untracked] = await Promise.all([
    diffOrThrow(dir, []),
    diffOrThrow(dir, ["--cached"]),
    diffUntrackedFiles(dir),
  ]);
  return unstaged + staged + untracked;
}

export const diffRoutes = {
  "/api/tasks/:id/diff": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveTaskRoot(req.params.id);
        if ("error" in result) return result.error;
        const { repoRoot: dir } = result;

        // Coalesced per task: the Explorer rail, the Changes panel and an open
        // diff tab all hold this query, and one watcher batch invalidates it
        // for every client at once. Each of those wants the same bytes. The
        // directory is in the key because the root is re-resolved per request
        // and can move under a task whose agent has changed repository; a
        // caller with the new root must not be handed the old tree's diff.
        const diff = await coalesce(`diff:${req.params.id}:${dir}`, () => workingTreeDiff(dir));
        const hash = Bun.hash(diff).toString(16);
        return Response.json({ diff, directory: dir, hash });
      } catch (error) {
        return Response.json(
          { error: "Failed to get git diff", message: error instanceof Error ? error.message : String(error) },
          { status: 500 }
        );
      }
    },
  },

  "/api/tasks/:id/context": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveTaskRoot(req.params.id);
        if ("error" in result) return result.error;
        const { repoRoot: dir } = result;

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
          lines.push({ lineNum: i, content: allLines[i - 1] ?? "" });
        }

        // Tree-sitter tokens for the returned lines (null => client regex
        // fallback). Whole-file highlight is cached, so repeat expansions are free.
        let tokens: (LineTokens)[] | null = null;
        try {
          const fileTokens = await highlightFile(content, filePath);
          if (fileTokens) tokens = lines.map((l) => fileTokens[l.lineNum - 1] ?? []);
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
  },
} as const;
