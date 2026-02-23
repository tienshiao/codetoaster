import { sessionManager } from "../lib/xtmux/session-manager";

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
};

function getImageMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return IMAGE_MIME_TYPES[ext] || "application/octet-stream";
}

function unescapeGitPath(path: string): string {
  let r = path;
  if (r.startsWith('"') && r.endsWith('"')) r = r.slice(1, -1);
  r = r.replace(/((?:\\[0-7]{3})+)/g, (match) => {
    const bytes: number[] = [];
    const octalPattern = /\\([0-7]{3})/g;
    let octalMatch;
    while ((octalMatch = octalPattern.exec(match)) !== null) {
      bytes.push(parseInt(octalMatch[1]!, 8));
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  });
  return r.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

async function resolveSessionGitRoot(
  sessionId: string
): Promise<{ dir: string } | { error: Response }> {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return { error: Response.json({ error: "Session not found" }, { status: 404 }) };
  }
  const cwd = await session.getCwd();
  if (!cwd) {
    return { error: Response.json({ error: "Cannot determine session CWD" }, { status: 400 }) };
  }
  const gitRootResult = await Bun.$`git -C ${cwd} rev-parse --show-toplevel`.quiet().nothrow();
  if (gitRootResult.exitCode !== 0) {
    return { error: Response.json({ error: "Not a git repository" }, { status: 400 }) };
  }
  return { dir: gitRootResult.text().trim() };
}

export const diffRoutes = {
  "/api/sessions/:id/diff": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const [unstagedDiff, stagedDiff, untrackedDiffs] = await Promise.all([
          Bun.$`git -C ${dir} diff`.quiet().text(),
          Bun.$`git -C ${dir} diff --cached`.quiet().text(),
          Bun.$`git -C ${dir} ls-files --others --exclude-standard`.quiet().then(async (lsResult) => {
            const untrackedFiles = lsResult.text().trim().split("\n").filter(Boolean).map(unescapeGitPath);
            return Promise.all(
              untrackedFiles.map(async (file: string) => {
                const diff = await Bun.$`git -C ${dir} diff --no-index /dev/null ${file}`.quiet().nothrow();
                return diff.stdout.length > 0 ? diff.text() : "";
              })
            );
          }),
        ]);

        const diff = unstagedDiff + stagedDiff + untrackedDiffs.join("");
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

  "/api/sessions/:id/context": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const url = new URL(req.url);
        const filePath = url.searchParams.get("file");
        const start = parseInt(url.searchParams.get("start") || "1", 10);
        const end = parseInt(url.searchParams.get("end") || "1", 10);

        if (!filePath) {
          return Response.json({ error: "Missing file parameter" }, { status: 400 });
        }

        const fullPath = `${dir}/${filePath}`;
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

        return Response.json({ lines, hasMore: end < totalLines, totalLines });
      } catch (error) {
        return Response.json(
          { error: "Failed to read file context", message: error instanceof Error ? error.message : String(error) },
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

        const fullPath = `${dir}/${filePath}`;
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
