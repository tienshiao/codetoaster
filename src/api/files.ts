import { resolveTaskRoot, getImageMimeType, IMAGE_MIME_TYPES, listGitFiles, safePath, buildFileListing } from "./utils";
import { highlightFile } from "../lib/highlight/tokenize";
import { extractFrontmatter } from "../lib/frontmatter";
import type { FileTokens } from "../types/highlight";
import type { Frontmatter, FrontmatterEntry, FrontmatterValue } from "../types/frontmatter";

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

// The client decides a file is markdown from getLanguageFromPath; the server
// only needs the extension, and only to know whether a leading `---` block is
// frontmatter or just a horizontal rule in some other language's file.
const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdx"];

function isMarkdownPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** One frontmatter value, shaped for the header the client draws (TASK-87). */
function shapeValue(value: unknown): FrontmatterValue {
  if (typeof value === "string") return { kind: "text", text: value };
  if (typeof value === "number" || typeof value === "boolean") {
    return { kind: "scalar", text: String(value) };
  }
  // `assignee: []` and `priority:` are both "written, but says nothing", and a
  // header that drew them as an empty cell would read as a rendering bug.
  if (value === null || value === undefined) return { kind: "empty" };
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: "empty" };
    if (value.every((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
      return { kind: "list", items: value.map((v) => String(v)) };
    }
  }
  return { kind: "block", yaml: Bun.YAML.stringify(value, null, 2).trimEnd() };
}

/**
 * The file's frontmatter, or undefined when there is nothing to draw.
 *
 * Undefined for a block that will not parse or parses to something other than a
 * mapping: the preview then shows the raw text, which is the honest answer for
 * a file the user is mid-edit and the only one that cannot lose a line.
 */
function readFrontmatter(content: string, filePath: string): Frontmatter | undefined {
  if (!isMarkdownPath(filePath)) return undefined;
  const block = extractFrontmatter(content);
  if (!block) return undefined;

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(block.yaml);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;

  // Object key order is the file's key order, which is the order a reader wrote
  // and the order the header keeps.
  const entries: FrontmatterEntry[] = Object.entries(parsed as Record<string, unknown>).map(
    ([key, value]) => ({ key, value: shapeValue(value) }),
  );
  return { entries, lineCount: block.lineCount };
}

// Shared non-image body of the /file and git/file routes: binary detection,
// text decode, per-line data, server-side tree-sitter tokens (null => client
// regex fallback; highlighting failure never breaks the response), and — for a
// markdown file — its parsed frontmatter.
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

  const frontmatter = readFrontmatter(content, filePath);

  return {
    lines: lineData,
    totalLines: lines.length,
    isBinary: false,
    isImage: false,
    size: buffer.byteLength,
    tokens,
    // Absent rather than null when there is none: the client's check is
    // presence, and a null would have to be spelled out at every reader.
    ...(frontmatter ? { frontmatter } : {}),
  };
}

export const fileRoutes = {
  "/api/tasks/:id/files": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveTaskRoot(req.params.id);
        if ("error" in result) return result.error;
        const { repoRoot: dir } = result;

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

  "/api/tasks/:id/files/search": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const url = new URL(req.url);
        const q = url.searchParams.get("q") || "";
        if (!q) return Response.json({ results: [] });

        const result = await resolveTaskRoot(req.params.id);
        if ("error" in result) return result.error;
        const { repoRoot: dir } = result;

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

  "/api/tasks/:id/file": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveTaskRoot(req.params.id);
        if ("error" in result) return result.error;
        const { repoRoot: dir } = result;

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

  "/api/tasks/:id/image": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveTaskRoot(req.params.id);
        if ("error" in result) return result.error;
        const { repoRoot: dir } = result;

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

  "/api/tasks/:id/image/git": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveTaskRoot(req.params.id);
        if ("error" in result) return result.error;
        const { repoRoot: dir } = result;

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
