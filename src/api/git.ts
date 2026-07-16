import { resolveSessionGitRoot, gitSpawn, parseNonNegInt, SHA_RE } from "./utils";

// ---------------------------------------------------------------------------
// Pure parsers (exported for unit tests — no repo required)
// ---------------------------------------------------------------------------

export interface GitLogCommit {
  hash: string;
  parents: string[];
  refs: string[];
  author: string;
  email: string;
  date: number;
  subject: string;
}

/**
 * Parse a git `%D` decoration string into a flat ref-name array.
 * - Splits on ", " (git's separator between decorations).
 * - "HEAD -> main" emits both "HEAD" and "main".
 * - "tag: v1.0" → "v1.0".
 * - Empty / whitespace-only input → [].
 */
export function parseRefDecorations(decoration: string): string[] {
  const trimmed = decoration.trim();
  if (!trimmed) return [];
  const refs: string[] = [];
  for (const rawPart of trimmed.split(", ")) {
    const part = rawPart.trim();
    if (!part) continue;
    const arrowIdx = part.indexOf(" -> ");
    if (arrowIdx !== -1) {
      // "HEAD -> main" → emit the symbolic ref and its target branch
      const head = part.slice(0, arrowIdx).trim();
      const branch = part.slice(arrowIdx + 4).trim();
      if (head) refs.push(head);
      if (branch) refs.push(branch.replace(/^tag: /, ""));
    } else {
      refs.push(part.replace(/^tag: /, ""));
    }
  }
  return refs;
}

/**
 * Parse the output of `git log --format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e`.
 * Records are terminated by \x1e; fields are separated by \x1f. Git emits a
 * newline after each record, which becomes the leading char of the next
 * record after the split — that is stripped here.
 */
export function parseLogOutput(stdout: string): GitLogCommit[] {
  const commits: GitLogCommit[] = [];
  for (const rawRecord of stdout.split("\x1e")) {
    const record = rawRecord.replace(/^[\r\n]+/, "");
    if (!record) continue;
    const fields = record.split("\x1f");
    if (fields.length < 7) continue;
    const [hash, parents, author, email, at, decoration, subject] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    commits.push({
      hash: hash.trim(),
      parents: parents.trim() ? parents.trim().split(" ") : [],
      refs: parseRefDecorations(decoration),
      author,
      email,
      date: parseInt(at, 10),
      subject,
    });
  }
  return commits;
}

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

const LOG_FORMAT = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e";
const COMMIT_META_FORMAT = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ct%x1f%D%x1f%B";

// Strip any leading non-"diff --git" lines (git diff-tree prefixes its patch
// with the commit id) so the string starts like standard unified diff text
// that the client parseDiff consumes.
function stripToFirstDiff(text: string): string {
  const idx = text.indexOf("diff --git ");
  return idx === -1 ? "" : text.slice(idx);
}

export const gitRoutes = {
  "/api/sessions/:id/git/log": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const url = new URL(req.url);
        const skip = parseNonNegInt(url.searchParams.get("skip"), 0);
        const limitRaw = parseNonNegInt(url.searchParams.get("limit"), 200);
        if (skip === null || limitRaw === null) {
          return Response.json({ error: "skip and limit must be non-negative integers" }, { status: 400 });
        }
        const limit = Math.min(limitRaw, 1000);

        // Fetch limit+1 rows to detect whether more history remains.
        const { stdout, exitCode } = await gitSpawn(dir, [
          "log",
          "--all",
          "--topo-order",
          `--skip=${skip}`,
          "-n",
          String(limit + 1),
          LOG_FORMAT,
        ]);

        // `git log --all` exits 0 with empty stdout on an empty repo, so a
        // non-zero exit is a real failure — surface it rather than masking it
        // as an empty history.
        if (exitCode !== 0) {
          return Response.json({ error: "Failed to get git log" }, { status: 500 });
        }

        const parsed = parseLogOutput(stdout);
        const hasMore = parsed.length > limit;
        const commits = hasMore ? parsed.slice(0, limit) : parsed;
        return Response.json({ commits, hasMore });
      } catch (error) {
        return Response.json(
          { error: "Failed to get git log", message: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    },
  },

  "/api/sessions/:id/git/refs": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const [forEach, symbolic, revParse] = await Promise.all([
          gitSpawn(dir, [
            "for-each-ref",
            "--format=%(refname)%1f%(objectname)%1f%(*objectname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
          ]),
          gitSpawn(dir, ["symbolic-ref", "-q", "HEAD"]),
          gitSpawn(dir, ["rev-parse", "HEAD"]),
        ]);

        const branches: { name: string; sha: string }[] = [];
        const remotes: { name: string; sha: string }[] = [];
        const tags: { name: string; sha: string }[] = [];

        for (const line of forEach.stdout.split("\n")) {
          if (!line) continue;
          const [refname, objectname, peeled] = line.split("\x1f");
          if (!refname || !objectname) continue;
          // Annotated tags: %(*objectname) is the peeled commit; use it when set.
          const sha = (peeled && peeled.length > 0 ? peeled : objectname).trim();
          if (refname.startsWith("refs/heads/")) {
            branches.push({ name: refname.slice("refs/heads/".length), sha });
          } else if (refname.startsWith("refs/remotes/")) {
            remotes.push({ name: refname.slice("refs/remotes/".length), sha });
          } else if (refname.startsWith("refs/tags/")) {
            tags.push({ name: refname.slice("refs/tags/".length), sha });
          }
        }

        // symbolic-ref exits non-zero (empty stdout) on detached HEAD.
        const symbolicRef = symbolic.exitCode === 0 ? symbolic.stdout.trim() : "";
        const headRef = symbolicRef.startsWith("refs/heads/")
          ? symbolicRef.slice("refs/heads/".length)
          : symbolicRef || null;
        const headSha = revParse.exitCode === 0 ? revParse.stdout.trim() : "";

        const payload = { head: { ref: headRef, sha: headSha }, branches, remotes, tags };
        const hash = Bun.hash(JSON.stringify(payload)).toString(16);
        return Response.json({ ...payload, hash });
      } catch (error) {
        return Response.json(
          { error: "Failed to get git refs", message: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    },
  },

  "/api/sessions/:id/git/commit": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const url = new URL(req.url);
        const sha = url.searchParams.get("sha") ?? "";
        if (!SHA_RE.test(sha)) {
          return Response.json({ error: "Invalid sha" }, { status: 400 });
        }

        // Verify the object exists and is a commit.
        const verify = await gitSpawn(dir, ["rev-parse", "--verify", `${sha}^{commit}`]);
        if (verify.exitCode !== 0) {
          return Response.json({ error: "Commit not found" }, { status: 404 });
        }
        const resolvedSha = verify.stdout.trim();

        const metaResult = await gitSpawn(dir, ["show", "-s", COMMIT_META_FORMAT, resolvedSha]);
        if (metaResult.exitCode !== 0) {
          return Response.json({ error: "Commit not found" }, { status: 404 });
        }

        // Fields: %H %P %an %ae %at %cn %ct %D %B. %B (full message) is last and
        // may contain newlines; it never contains \x1f, so rejoin the tail.
        const fields = metaResult.stdout.replace(/[\r\n]+$/, "").split("\x1f");
        const [hash, parentsRaw, author, email, at, committer, ct, decoration] = fields as string[];
        const message = fields.slice(8).join("\x1f");
        const parents = (parentsRaw ?? "").trim() ? parentsRaw!.trim().split(" ") : [];

        // Non-merge (≤1 parent): diff-tree against the (possibly empty) parent,
        // with --root so the initial commit shows all files as added. Merge
        // (2+ parents): diff against the first parent.
        const diffResult =
          parents.length >= 2
            ? await gitSpawn(dir, ["diff", "-M", `${resolvedSha}^1`, resolvedSha])
            : await gitSpawn(dir, ["diff-tree", "--patch", "--root", "-M", resolvedSha]);

        const diff = stripToFirstDiff(diffResult.stdout);
        const hashOfDiff = Bun.hash(diff).toString(16);

        return Response.json({
          meta: {
            hash: (hash ?? "").trim(),
            parents,
            author: author ?? "",
            email: email ?? "",
            authoredAt: parseInt(at ?? "0", 10),
            committer: committer ?? "",
            committedAt: parseInt(ct ?? "0", 10),
            refs: parseRefDecorations(decoration ?? ""),
            message,
          },
          diff,
          hash: hashOfDiff,
        });
      } catch (error) {
        return Response.json(
          { error: "Failed to get commit", message: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    },
  },
} as const;
