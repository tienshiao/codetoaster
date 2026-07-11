// Reads the "old" side of a file for diff highlighting. Prefers the staged
// index blob (`:0:path`) — the true old side of unstaged hunks, which dominate
// this UI — and falls back to HEAD. Returns null if neither exists (e.g. an
// added file). Uses Bun.spawn (not Bun.$) to avoid deadlocks on large concurrent
// outputs, mirroring diffUntrackedFile in src/api/utils.ts.

async function gitShow(dir: string, ref: string): Promise<string | null> {
  const proc = Bun.spawn(["git", "-C", dir, "show", ref], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const [text, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  return exitCode === 0 ? text : null;
}

export async function readOldSide(dir: string, filePath: string): Promise<string | null> {
  const staged = await gitShow(dir, `:0:${filePath}`);
  if (staged !== null) return staged;
  return gitShow(dir, `HEAD:${filePath}`);
}
