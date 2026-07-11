import { resolveSessionGitRoot, safePath } from "./utils";
import { highlightFile } from "../lib/highlight/tokenize";
import { readOldSide } from "../lib/highlight/gitContent";
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
): Promise<FileSides> {
  const result: FileSides = { old: null, new: null };
  try {
    if (file.needNew) {
      const full = safePath(dir, file.path);
      if (full) {
        const f = Bun.file(full);
        if (await f.exists()) {
          result.new = await highlightFile(await f.text(), file.path);
        }
      }
    }
    if (file.needOld) {
      const oldPath = file.oldPath ?? file.path;
      // safePath guards the path shape; readOldSide passes it to git as argv.
      if (safePath(dir, oldPath)) {
        const oldContent = await readOldSide(dir, oldPath);
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

        const body = (await req.json()) as { files?: DiffTokenRequestFile[] };
        const files = (body.files ?? []).slice(0, MAX_FILES);

        const out: Record<string, FileSides> = {};
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
          const batch = files.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(
            batch.map((file) => tokensForFile(dir, file)),
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
