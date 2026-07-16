import { resolveSessionGitRoot, safePath, SHA_RE } from "./utils";
import { highlightFile } from "../lib/highlight/tokenize";
import { readOldSide, gitShow } from "../lib/highlight/gitContent";
import type { FileTokens } from "../types/highlight";

interface DiffTokenRequestFile {
  path: string;
  oldPath?: string;
  needOld: boolean;
  needNew: boolean;
}

interface FileSides {
  old: FileTokens | null;
  new: FileTokens | null;
}

const MAX_FILES = 200;
const BATCH_SIZE = 8;

async function tokensForFile(
  dir: string,
  file: DiffTokenRequestFile,
  sha: string | undefined,
): Promise<FileSides> {
  const result: FileSides = { old: null, new: null };
  try {
    if (file.needNew) {
      // With `sha`, both sides come from git objects; without it the new side is
      // the working tree. safePath is a shape guard on the path either way.
      const full = safePath(dir, file.path);
      if (full) {
        let newContent: string | null = null;
        if (sha) {
          newContent = await gitShow(dir, `${sha}:${file.path}`);
        } else {
          const f = Bun.file(full);
          if (await f.exists()) newContent = await f.text();
        }
        if (newContent !== null) {
          result.new = await highlightFile(newContent, file.path);
        }
      }
    }
    if (file.needOld) {
      const oldPath = file.oldPath ?? file.path;
      // safePath guards the path shape; the ref is passed to git as argv.
      if (safePath(dir, oldPath)) {
        // With `sha`, the old side is the first parent — a root commit's
        // `<sha>^1` show fails and stays null (client regex fallback).
        const oldContent = sha
          ? await gitShow(dir, `${sha}^1:${oldPath}`)
          : await readOldSide(dir, oldPath);
        if (oldContent !== null) {
          result.old = await highlightFile(oldContent, oldPath);
        }
      }
    }
  } catch {
    // Any failure => null tokens => client regex fallback for this file.
  }
  return result;
}

export const highlightRoutes = {
  "/api/sessions/:id/diff-tokens": {
    async POST(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const body = (await req.json()) as { files?: DiffTokenRequestFile[]; sha?: string };
        // `sha` is optional; validate only when present. Absent => working-tree
        // behavior is unchanged.
        const sha = body.sha;
        if (sha !== undefined && !SHA_RE.test(sha)) {
          return Response.json({ error: "Invalid sha" }, { status: 400 });
        }
        const files = (body.files ?? []).slice(0, MAX_FILES);

        const out: Record<string, FileSides> = {};
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
          const batch = files.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(
            batch.map((file) => tokensForFile(dir, file, sha)),
          );
          batch.forEach((file, j) => {
            out[file.path] = results[j]!;
          });
        }

        return Response.json({ files: out });
      } catch (error) {
        return Response.json(
          { error: "Failed to compute diff tokens", message: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    },
  },
} as const;
