import { gitSpawn, gitSpawnRaw } from "../../api/utils";
import { symbolGrammarForPath } from "./assets";
import { lookupSymbol, MAX_FILE_SIZE, type ProjectSource } from "./store";
import type { SymbolLookupResult } from "./types";

// A commit's tree as a symbol source, so go-to-definition in a commit's File
// Tree answers from the files of that commit rather than the working tree's.
//
// The store reads one file at a time, and a spawn per blob is a `git show` for
// every source file in the repository. So a read fetches the blob asked for
// together with the ones the store will ask for next, in one `cat-file
// --batch`, and holds that batch until a read falls outside it. The store
// walks the listing in order, which makes every batch after the first a hit.

/** How much blob content one `cat-file --batch` is asked for. */
const BATCH_BYTES = 8 * 1024 * 1024;
const BATCH_FILES = 1000;
/** A git that hangs — a stalled mount, a promisor remote that never answers —
 * would otherwise leave the build pending for good: an index that is building
 * is never evicted, and every later lookup at that commit waits on it. Killed,
 * the read fails, the build fails with it, and the index is dropped. */
const GIT_TIMEOUT_MS = 60_000;

interface TreeBlob {
  path: string;
  oid: string;
  size: number;
}

interface TreeListing {
  paths: string[];
  blobs: Map<string, TreeBlob>;
  /** The blobs the store will read, in the order it reads them. */
  indexed: TreeBlob[];
  /** A path's position in `indexed`. */
  position: Map<string, number>;
}

/**
 * `ls-tree -r -l -z` records: `<mode> <type> <oid> <size>\t<path>`, the size
 * right-aligned. Only regular files are kept. A submodule is a `commit` entry
 * with no content here, and a symlink's blob is the path it points at, which
 * would be parsed as source if its name had a source extension.
 */
export function parseTree(stdout: string): TreeListing {
  const paths: string[] = [];
  const blobs = new Map<string, TreeBlob>();
  const indexed: TreeBlob[] = [];
  const position = new Map<string, number>();
  for (const record of stdout.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, oid, size] = record.slice(0, tab).split(/ +/);
    if (type !== "blob" || mode === "120000" || !oid) continue;
    const blob = { path: record.slice(tab + 1), oid, size: Number(size) };
    paths.push(blob.path);
    blobs.set(blob.path, blob);
    if (symbolGrammarForPath(blob.path) !== null && blob.size <= MAX_FILE_SIZE) {
      position.set(blob.path, indexed.length);
      indexed.push(blob);
    }
  }
  return { paths, blobs, indexed, position };
}

/**
 * `cat-file --batch` output, as text per requested blob: one
 * `<oid> <type> <size>\n<content>\n` per line of input, in input order. Sizes
 * count bytes, so the content is cut from the bytes and decoded afterwards. An
 * object git does not have answers `<name> missing\n` with no content.
 */
export function parseBatch(bytes: Uint8Array, requested: TreeBlob[]): Map<string, string> {
  const decoder = new TextDecoder();
  const out = new Map<string, string>();
  let at = 0;
  for (const blob of requested) {
    const headerEnd = bytes.indexOf(0x0a, at);
    if (headerEnd < 0) break;
    const header = decoder.decode(bytes.subarray(at, headerEnd));
    at = headerEnd + 1;
    if (header.endsWith(" missing")) continue;
    const size = Number(header.slice(header.lastIndexOf(" ") + 1));
    if (!Number.isInteger(size)) break;
    out.set(blob.path, decoder.decode(bytes.subarray(at, at + size)));
    at += size + 1;
  }
  return out;
}

async function readBatch(dir: string, blobs: TreeBlob[]): Promise<Map<string, string>> {
  const { bytes, exitCode } = await gitSpawnRaw(dir, ["cat-file", "--batch"], {
    stdin: blobs.map((blob) => `${blob.oid}\n`).join(""),
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if (exitCode !== 0) throw new Error("Failed to read blobs");
  return parseBatch(bytes, blobs);
}

/** `sha` must be a full commit hash: it is part of what the index is cached by. */
export function commitSource(
  dir: string,
  sha: string,
  batchBytes: number = BATCH_BYTES,
): ProjectSource {
  let listing: Promise<TreeListing> | null = null;
  const tree = () =>
    (listing ??= gitSpawn(dir, ["ls-tree", "-r", "-l", "-z", sha], { timeoutMs: GIT_TIMEOUT_MS }).then(({ stdout, exitCode }) => {
      if (exitCode !== 0) throw new Error("Failed to list the commit's files");
      return parseTree(stdout);
    }));
  let batch = new Map<string, string>();

  return {
    immutable: true,
    listFiles: async () => (await tree()).paths,
    async stat(path) {
      const blob = (await tree()).blobs.get(path);
      // A blob has no mtime, and needs none: the index is never revalidated.
      return blob ? { mtimeMs: 0, size: blob.size } : null;
    },
    async read(path) {
      if (!batch.has(path)) {
        const { blobs, indexed, position } = await tree();
        const start = position.get(path);
        let wanted: TreeBlob[];
        if (start === undefined) {
          // Not a file the store indexes; answered alone if it exists at all.
          const blob = blobs.get(path);
          wanted = blob ? [blob] : [];
        } else {
          wanted = [];
          let bytes = 0;
          for (let i = start; i < indexed.length && wanted.length < BATCH_FILES; i++) {
            const blob = indexed[i]!;
            if (wanted.length > 0 && bytes + blob.size > batchBytes) break;
            wanted.push(blob);
            bytes += blob.size;
          }
        }
        batch = wanted.length > 0 ? await readBatch(dir, wanted) : new Map();
      }
      return batch.get(path) ?? "";
    },
    now: () => Date.now(),
  };
}

/** `lookupSymbol`, over the files of one commit. */
export function lookupCommitSymbol(
  dir: string,
  sha: string,
  name: string,
  source: ProjectSource = commitSource(dir, sha),
): Promise<SymbolLookupResult> {
  // NUL cannot appear in a path, so no directory can be taken for a commit's key.
  return lookupSymbol(`${dir}\0${sha}`, name, source);
}
