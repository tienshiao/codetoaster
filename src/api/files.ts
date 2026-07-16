import { resolveSessionGitRoot, getImageMimeType, IMAGE_MIME_TYPES, listGitFiles, safePath, buildFileListing } from "./utils";
import { highlightFile } from "../lib/highlight/tokenize";
import type { FileTokens } from "../types/highlight";

function fuzzyMatch(filePath: string, query: string): { score: number; indices: number[] } | null {
  const lowerPath = filePath.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const basename = lowerPath.split("/").pop() || "";
  const basenameStart = lowerPath.length - basename.length;

  let qi = 0;
  let score = 0;
  let prevMatchIdx = -2;
  const indices: number[] = [];

  for (let pi = 0; pi < lowerPath.length && qi < lowerQuery.length; pi++) {
    if (lowerPath[pi] === lowerQuery[qi]) {
      if (pi === prevMatchIdx + 1) score += 3;
      if (pi === 0 || lowerPath[pi - 1] === "/") score += 5;
      if (pi >= basenameStart) score += 2;
      prevMatchIdx = pi;
      indices.push(pi);
      qi++;
    }
  }

  if (qi < lowerQuery.length) return null;
  return { score, indices };
}

export function isBinaryContent(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer, 0, Math.min(8192, buffer.byteLength));
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

// Shared non-image body of the /file and git/file routes: binary detection,
// text decode, per-line data, and server-side tree-sitter tokens (null => client
// regex fallback; highlighting failure never breaks the response).
export async function serializeFileContent(buffer: ArrayBuffer, filePath: string) {
  if (isBinaryContent(buffer)) {
    return { isBinary: true, isImage: false, size: buffer.byteLength };
  }

  const content = new TextDecoder().decode(buffer);
  const lines = content.split("\n");
  const lineData = lines.map((content, idx) => ({ lineNum: idx + 1, content }));

  let tokens: FileTokens | null = null;
  try {
    tokens = await highlightFile(content, filePath);
  } catch {
    tokens = null;
  }

  return {
    lines: lineData,
    totalLines: lines.length,
    isBinary: false,
    isImage: false,
    size: buffer.byteLength,
    tokens,
  };
}

export const fileRoutes = {
  "/api/sessions/:id/files": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const filePaths = await listGitFiles(dir);

        // Shared directory-synthesis derivation; layer the per-file stat size on
        // top (non-directories only) preserving the try/catch semantics.
        const files = buildFileListing(filePaths).map((f) => {
          if (f.isDirectory) return f;
          let size: number | undefined;
          try {
            size = Bun.file(`${dir}/${f.path}`).size;
          } catch {}
          return { ...f, size };
        });

        return Response.json({ files, directory: dir });
      } catch (error) {
        return Response.json(
          { error: "Failed to list files", message: error instanceof Error ? error.message : String(error) },
          { status: 500 }
        );
      }
    },
  },

  "/api/sessions/:id/files/search": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const url = new URL(req.url);
        const q = url.searchParams.get("q") || "";
        if (!q) return Response.json({ results: [] });

        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const filePaths = await listGitFiles(dir);
        const scored: { path: string; name: string; score: number; indices: number[] }[] = [];

        for (const fp of filePaths) {
          const match = fuzzyMatch(fp, q);
          if (match !== null) {
            scored.push({ path: fp, name: fp.split("/").pop() || fp, ...match });
          }
        }

        scored.sort((a, b) => b.score - a.score);
        const results = scored.slice(0, 20).map(({ path, name, indices }) => ({ path, name, indices }));

        return Response.json({ results });
      } catch (error) {
        return Response.json(
          { error: "Failed to search files", message: error instanceof Error ? error.message : String(error) },
          { status: 500 }
        );
      }
    },
  },

  "/api/sessions/:id/file": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const url = new URL(req.url);
        const filePath = url.searchParams.get("file");
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

        const isImage = !!IMAGE_MIME_TYPES[filePath.split(".").pop()?.toLowerCase() || ""];

        if (isImage) {
          return Response.json({
            isBinary: true,
            isImage: true,
            size: file.size,
          });
        }

        const buffer = await file.arrayBuffer();
        return Response.json(await serializeFileContent(buffer, filePath));
      } catch (error) {
        return Response.json(
          { error: "Failed to read file", message: error instanceof Error ? error.message : String(error) },
          { status: 500 }
        );
      }
    },
  },

  "/api/sessions/:id/image": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const url = new URL(req.url);
        const filePath = url.searchParams.get("file");
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

        const data = await file.arrayBuffer();
        return new Response(data, {
          headers: { "Content-Type": getImageMimeType(filePath), "Cache-Control": "no-cache" },
        });
      } catch (error) {
        return Response.json(
          { error: "Failed to read image", message: error instanceof Error ? error.message : String(error) },
          { status: 500 }
        );
      }
    },
  },

  "/api/sessions/:id/image/git": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const url = new URL(req.url);
        const filePath = url.searchParams.get("file");
        const ref = url.searchParams.get("ref") || "HEAD";
        if (!filePath) {
          return Response.json({ error: "Missing file parameter" }, { status: 400 });
        }

        if (safePath(dir, filePath) === null) {
          return Response.json({ error: "Invalid file path" }, { status: 400 });
        }

        const gitResult = await Bun.$`git -C ${dir} show ${ref}:${filePath}`.quiet().nothrow();
        if (gitResult.exitCode !== 0) {
          return Response.json({ error: "File not found in git history" }, { status: 404 });
        }

        return new Response(new Uint8Array(gitResult.stdout), {
          headers: { "Content-Type": getImageMimeType(filePath), "Cache-Control": "no-cache" },
        });
      } catch (error) {
        return Response.json(
          { error: "Failed to read image from git", message: error instanceof Error ? error.message : String(error) },
          { status: 500 }
        );
      }
    },
  },
} as const;
