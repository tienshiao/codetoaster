import {
  rootRoutes,
  cachedPromise,
  getImageMimeType,
  IMAGE_MIME_TYPES,
  listGitFiles,
  safePath,
  buildFileListing,
  type CachedPromise,
} from "./utils";
import { highlightFile } from "../lib/highlight/tokenize";
import { extractFrontmatter } from "../lib/frontmatter";
import type { FileTokens } from "../types/highlight";
import type { FileSearchResult } from "../types/files";
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

/** How long one `git ls-files` answer stands in for the next. */
const FILE_LIST_TTL_MS = 3000;

/**
 * `git ls-files` for `dir`, at most once every few seconds.
 *
 * Both callers of `searchFiles` are per-keystroke — the composer behind a
 * 150ms debounce, the palette behind none at all — so a word typed into either
 * one used to fork a git process per character and list the whole repository
 * each time. Nothing in a repository's file list changes meaningfully inside
 * three seconds of typing, and the query is re-matched against the cached list
 * every time regardless, so what the cache costs is a file created mid-word
 * appearing a moment late.
 *
 * Here rather than in `listGitFiles`, deliberately: the diff routes and the
 * symbol store ask it about a tree they have just changed and need the real
 * answer. The caching itself is `cachedPromise`'s.
 */
const fileListCache = new Map<string, CachedPromise<string[]>>();

function cachedGitFiles(dir: string): Promise<string[]> {
  return cachedPromise(fileListCache, dir, FILE_LIST_TTL_MS, () => listGitFiles(dir));
}

/**
 * The tracked files of `dir` that fuzzy-match `q`, best first.
 *
 * One matcher for the palette (task scope) and the composer (project scope):
 * a composer whose suggestions ranked differently from the palette's would be
 * the drift worth avoiding.
 *
 * Throws when `dir` is not a repository — `listGitFiles` does — which the
 * route's resolved root makes unlikely but not impossible.
 */
export async function searchFiles(dir: string, q: string): Promise<FileSearchResult[]> {
  const filePaths = await cachedGitFiles(dir);
  const scored: { path: string; name: string; score: number; indices: number[] }[] = [];

  for (const fp of filePaths) {
    const match = fuzzyMatch(fp, q);
    if (match !== null) {
      scored.push({ path: fp, name: fp.split("/").pop() || fp, ...match });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 20).map(({ path, name, indices }) => ({ path, name, indices }));
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

/**
 * The command that reveals `fullPath` in the platform's file manager, or null
 * where there is none worth running.
 *
 * macOS only: `open -R` selects the file in a Finder window, which is the whole
 * point. `xdg-open` on the parent directory would open *a* window but select
 * nothing, and the button is only offered to a browser on a Mac anyway.
 */
export function revealCommand(fullPath: string, platform: NodeJS.Platform = process.platform): string[] | null {
  return platform === "darwin" ? ["open", "-R", fullPath] : null;
}

export const fileRoutes = {
  ...rootRoutes("files", {
    async GET({ repoRoot: dir }) {
      try {
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
  }),

  /**
   * Fuzzy file search, for the palette (task) and the composer's `@`
   * completion (project — there is no task while the prompt is being written).
   *
   * The root is resolved before the query is looked at, so an id that cannot
   * be resolved is its 404/400 whatever was typed: those are answers about the
   * task or project, not about the query, and the composer's hook is what
   * decides they are not worth showing the user.
   */
  ...rootRoutes("files/search", {
    async GET(root, req, scope) {
      try {
        const q = new URL(req.url).searchParams.get("q") || "";
        if (!q) return Response.json({ results: [] });
        // Relative to where the reader will use them. The composer writes a
        // project hit into a prompt for an agent that starts in the project's
        // directory (or the matching subdirectory of its worktree, TASK-65),
        // so a project searches from its `cwd`; the palette opens a task hit
        // as a file tab, and those are repo-relative.
        const dir = scope === "projects" ? root.cwd : root.repoRoot;
        return Response.json({ results: await searchFiles(dir, q) });
      } catch (error) {
        return Response.json(
          { error: "Failed to search files", message: error instanceof Error ? error.message : String(error) },
          { status: 500 }
        );
      }
    },
  }),

  ...rootRoutes("file", {
    async GET({ repoRoot: dir }, req) {
      try {
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
  }),

  /**
   * Show a file in Finder on the daemon's machine (TASK-120).
   *
   * The browser cannot do this itself, and the daemon can only do it for a
   * browser sitting at the same Mac — which the client checks before offering
   * the button. Refusals come before the spawn, so a test can cover them
   * without a Finder window opening.
   */
  ...rootRoutes("reveal", {
    async POST({ repoRoot: dir }, req) {
      let filePath: unknown;
      try {
        ({ file: filePath } = (await req.json()) as { file?: unknown });
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      if (typeof filePath !== "string" || !filePath) {
        return Response.json({ error: "Missing file parameter" }, { status: 400 });
      }

      const fullPath = safePath(dir, filePath);
      if (!fullPath) {
        return Response.json({ error: "Invalid file path" }, { status: 400 });
      }
      if (!(await Bun.file(fullPath).exists())) {
        return Response.json({ error: "File not found" }, { status: 404 });
      }

      const cmd = revealCommand(fullPath);
      if (!cmd) {
        return Response.json({ error: "Show in Finder needs a macOS daemon" }, { status: 501 });
      }

      try {
        const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
        const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
        if (exitCode !== 0) {
          return Response.json(
            { error: "Could not show the file in Finder", message: stderr.trim() },
            { status: 500 },
          );
        }
        return new Response(null, { status: 204 });
      } catch (error) {
        return Response.json(
          { error: "Could not show the file in Finder", message: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    },
  }),

  ...rootRoutes("image", {
    async GET({ repoRoot: dir }, req) {
      try {
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
  }),

  ...rootRoutes("image/git", {
    async GET({ repoRoot: dir }, req) {
      try {
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
  }),
};
