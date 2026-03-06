import { resolveSessionGitRoot, getImageMimeType, IMAGE_MIME_TYPES } from "./utils";

export const fileRoutes = {
  "/api/sessions/:id/files": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const findResult = await Bun.$`find ${dir} -mindepth 1`.quiet().text();
        const lines = findResult.trim().split("\n").filter(Boolean);

        const files = await Promise.all(
          lines.map(async (line) => {
            const relativePath = line.slice(dir.length + 1);
            const parts = relativePath.split("/");
            const name = parts[parts.length - 1]!;

            const stat = await Bun.file(line).stat();
            const isDirectory = stat.isDirectory();

            return {
              path: relativePath,
              name,
              isDirectory,
              size: isDirectory ? undefined : stat.size,
              depth: parts.length - 1,
            };
          })
        );

        return Response.json({ files, directory: dir });
      } catch (error) {
        return Response.json(
          { error: "Failed to list files", message: error instanceof Error ? error.message : String(error) },
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

        const fullPath = `${dir}/${filePath}`;
        const file = Bun.file(fullPath);

        if (!(await file.exists())) {
          return Response.json({ error: "File not found" }, { status: 404 });
        }

        const stat = await file.stat();
        const isImage = IMAGE_MIME_TYPES[filePath.split(".").pop()?.toLowerCase() || ""];

        if (isImage) {
          return Response.json({
            isBinary: true,
            isImage: true,
            size: stat.size,
          });
        }

        const content = await file.text();
        const lines = content.split("\n");
        const totalLines = lines.length;

        const lineData = lines.map((content, idx) => ({
          lineNum: idx + 1,
          content,
        }));

        return Response.json({
          lines: lineData,
          totalLines,
          isBinary: false,
          isImage: false,
          size: stat.size,
        });
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