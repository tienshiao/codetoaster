import { sessionManager } from "../lib/xtmux/session-manager";

export async function resolveSessionGitRoot(
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

export const IMAGE_MIME_TYPES: Record<string, string> = {
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

export function getImageMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return IMAGE_MIME_TYPES[ext] || "application/octet-stream";
}