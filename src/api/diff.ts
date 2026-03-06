import { resolveSessionGitRoot, safePath } from "./utils";

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

        return Response.json({ lines, hasMore: end < totalLines, totalLines });
      } catch (error) {
        return Response.json(
          { error: "Failed to read file context", message: error instanceof Error ? error.message : String(error) },
          { status: 500 }
        );
      }
    },
  },
} as const;
