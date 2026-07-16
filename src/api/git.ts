import { resolveSessionGitRoot, gitSpawn, gitSpawnRaw, parseNonNegInt, safePath, buildFileListing, IMAGE_MIME_TYPES, SHA_RE } from "./utils";
import { serializeFileContent } from "./files";

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
// Drift detection & until-slicing (pure — exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Drift check for a windowed page fetched from `skip-1` (so its first parsed
 * row is the client's last-loaded commit, `after`). If the window no longer
 * matches server history — no rows at all, or row 0 isn't `after` — the client's
 * window is stale. Otherwise the leading predecessor row is dropped and the
 * remaining rows returned for normal slicing.
 */
export function applyAfterCheck(
  rows: GitLogCommit[],
  after: string,
): { stale: true } | { rows: GitLogCommit[] } {
  if (rows.length === 0 || rows[0]!.hash !== after) return { stale: true };
  return { rows: rows.slice(1) };
}

/**
 * Fetch-until-SHA slicing. Given post-drift rows, locate `until`:
 * - found at index i → commits[0..i] inclusive. `hasMore` is true when a row
 *   exists past i, OR `until` is the final row but the underlying git fetch was
 *   truncated at the cap (`fetchTruncated`) — the fetch stopped there, so more
 *   history may exist beyond the window even though nothing is known yet.
 * - not found → empty commits with `found: false` (the caller fetched a hard cap
 *   of rows and the target wasn't among them, i.e. it's too deep in history).
 */
export function sliceUntil(
  rows: GitLogCommit[],
  until: string,
  fetchTruncated: boolean,
): { commits: GitLogCommit[]; hasMore: boolean; found: boolean } {
  const i = rows.findIndex((r) => r.hash === until);
  if (i === -1) return { commits: [], hasMore: true, found: false };
  const hasMore = i + 1 < rows.length || (i + 1 === rows.length && fetchTruncated);
  return { commits: rows.slice(0, i + 1), hasMore, found: true };
}

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

// Hard cap on rows fetched for an until= request — never ship a 50k-row payload
// the client didn't ask to render.
const UNTIL_CAP = 50000;

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

        const after = url.searchParams.get("after");
        const until = url.searchParams.get("until");
        if (after !== null) {
          if (!SHA_RE.test(after)) {
            return Response.json({ error: "Invalid after sha" }, { status: 400 });
          }
          // Drift detection reads the predecessor at skip-1, so it's only
          // meaningful past the first page.
          if (skip === 0) {
            return Response.json({ error: "after requires skip > 0" }, { status: 400 });
          }
        }
        if (until !== null && !SHA_RE.test(until)) {
          return Response.json({ error: "Invalid until sha" }, { status: 400 });
        }

        // With `after`, fetch one row earlier so row 0 is the predecessor we
        // verify. `until` ignores limit and fetches up to the hard cap; both
        // over-fetch by one for hasMore detection.
        const withAfter = after !== null;
        const effectiveSkip = withAfter ? skip - 1 : skip;
        const baseN = until !== null ? UNTIL_CAP + 1 : limit + 1;
        const n = baseN + (withAfter ? 1 : 0);

        const { stdout, exitCode } = await gitSpawn(dir, [
          "log",
          "--all",
          "--topo-order",
          `--skip=${effectiveSkip}`,
          "-n",
          String(n),
          LOG_FORMAT,
        ]);

        // `git log --all` exits 0 with empty stdout on an empty repo, so a
        // non-zero exit is a real failure — surface it rather than masking it
        // as an empty history.
        if (exitCode !== 0) {
          return Response.json({ error: "Failed to get git log" }, { status: 500 });
        }

        let parsed = parseLogOutput(stdout);
        // Whether git returned every row we asked for (n). If so the fetch was
        // truncated at the cap and more history may exist beyond it. Captured
        // before applyAfterCheck trims the predecessor row below.
        const fetchTruncated = parsed.length === n;

        if (withAfter) {
          const checked = applyAfterCheck(parsed, after!);
          if ("stale" in checked) {
            return Response.json({ stale: true }, { status: 409 });
          }
          parsed = checked.rows;
        }

        if (until !== null) {
          return Response.json(sliceUntil(parsed, until, fetchTruncated));
        }

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

  "/api/sessions/:id/git/tree": {
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

        // -z null-terminates paths, avoiding git's quoting of special characters.
        const { stdout, exitCode } = await gitSpawn(dir, ["ls-tree", "-r", "-z", "--name-only", sha]);
        if (exitCode !== 0) {
          return Response.json({ error: "Commit not found" }, { status: 404 });
        }

        const paths = stdout.split("\0").filter(Boolean);
        return Response.json({ files: buildFileListing(paths), directory: dir });
      } catch (error) {
        return Response.json(
          { error: "Failed to get tree", message: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    },
  },

  "/api/sessions/:id/git/file": {
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
        const filePath = url.searchParams.get("file");
        if (!filePath) {
          return Response.json({ error: "Missing file parameter" }, { status: 400 });
        }
        // Shape guard only — the blob is read via git, not the filesystem.
        if (safePath(dir, filePath) === null) {
          return Response.json({ error: "Invalid file path" }, { status: 400 });
        }

        const isImage = !!IMAGE_MIME_TYPES[filePath.split(".").pop()?.toLowerCase() || ""];

        if (isImage) {
          // Pixels load via /image/git?ref=; here we only need the blob size.
          const sizeResult = await gitSpawn(dir, ["cat-file", "-s", `${sha}:${filePath}`]);
          if (sizeResult.exitCode !== 0) {
            return Response.json({ error: "File not found in commit" }, { status: 404 });
          }
          return Response.json({
            isBinary: true,
            isImage: true,
            size: parseInt(sizeResult.stdout.trim(), 10),
          });
        }

        // Fetch raw bytes: binary detection must not decode as text first.
        const { bytes, exitCode } = await gitSpawnRaw(dir, ["show", `${sha}:${filePath}`]);
        if (exitCode !== 0) {
          return Response.json({ error: "File not found in commit" }, { status: 404 });
        }

        return Response.json(await serializeFileContent(bytes.buffer as ArrayBuffer, filePath));
      } catch (error) {
        return Response.json(
          { error: "Failed to read file", message: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    },
  },
} as const;
