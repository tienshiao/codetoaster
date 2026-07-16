// Reads the "old" side of a file for diff highlighting. Prefers the staged
// index blob (`:0:path`) — the true old side of unstaged hunks, which dominate
// this UI — and falls back to HEAD. Returns null if neither exists (e.g. an
// added file).
import { gitSpawn } from "../../api/utils";

export async function gitShow(dir: string, ref: string): Promise<string | null> {
  const { stdout, exitCode } = await gitSpawn(dir, ["show", ref]);
  return exitCode === 0 ? stdout : null;
}

export async function readOldSide(dir: string, filePath: string): Promise<string | null> {
  const staged = await gitShow(dir, `:0:${filePath}`);
  if (staged !== null) return staged;
  return gitShow(dir, `HEAD:${filePath}`);
}
