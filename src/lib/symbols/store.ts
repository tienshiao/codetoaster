import { listGitFiles, safePath } from "../../api/utils";
import { symbolGrammarForPath } from "./assets";
import { indexFileContent } from "./indexer";
import { scoreName } from "./nameMatch";
import type { SymbolEntry, SymbolLookupResult, SymbolNameMatch, SymbolSearchResult } from "./types";

// In-memory, per-git-root symbol index. Built lazily on first lookup and
// revalidated by mtime on a throttle. Never persisted — a full rebuild of even a
// large repo is a few seconds (see benchmark), so there is no on-disk index.

const MAX_PROJECTS = 4;
const MAX_FILES = 20_000;
const MAX_ENTRIES = 5_000_000;
const MAX_FILE_SIZE = 512 * 1024;
const VALIDATE_INTERVAL_MS = 5_000;
const YIELD_EVERY = 200;
const LOOKUP_CAP = 200;
const SEARCH_LIMIT = 50;

/** Abstracts the filesystem so the store can be tested without real files. */
export interface ProjectSource {
  listFiles(): Promise<string[]>;
  stat(path: string): Promise<{ mtimeMs: number; size: number } | null>;
  read(path: string): Promise<string>;
  now(): number;
}

interface FileIndex {
  mtimeMs: number;
  size: number;
  entries: SymbolEntry[];
}

interface ProjectIndex {
  files: Map<string, FileIndex>;
  byName: Map<string, SymbolEntry[]>;
  totalEntries: number;
  lastValidated: number;
  building: Promise<void> | null;
  revalidating: Promise<void> | null;
  partial: boolean;
}

const projects = new Map<string, ProjectIndex>();

function gitProjectSource(dir: string): ProjectSource {
  return {
    listFiles: () => listGitFiles(dir),
    async stat(path) {
      const full = safePath(dir, path);
      if (!full) return null;
      const file = Bun.file(full);
      if (!(await file.exists())) return null;
      const stat = await file.stat();
      return { mtimeMs: stat.mtimeMs, size: stat.size };
    },
    async read(path) {
      const full = safePath(dir, path);
      if (!full) return "";
      return Bun.file(full).text();
    },
    now: () => Date.now(),
  };
}

function addEntries(index: ProjectIndex, entries: SymbolEntry[]): void {
  for (const entry of entries) {
    let list = index.byName.get(entry.name);
    if (!list) {
      list = [];
      index.byName.set(entry.name, list);
    }
    list.push(entry);
  }
  index.totalEntries += entries.length;
}

function removeFile(index: ProjectIndex, path: string): void {
  const existing = index.files.get(path);
  if (!existing) return;
  for (const entry of existing.entries) {
    const list = index.byName.get(entry.name);
    if (!list) continue;
    const filtered = list.filter((e) => e.path !== path);
    if (filtered.length) index.byName.set(entry.name, filtered);
    else index.byName.delete(entry.name);
  }
  index.totalEntries -= existing.entries.length;
  index.files.delete(path);
}

async function indexOneFile(
  index: ProjectIndex,
  source: ProjectSource,
  path: string,
  stat: { mtimeMs: number; size: number },
): Promise<void> {
  const grammarId = symbolGrammarForPath(path);
  if (!grammarId) return;
  const content = await source.read(path);
  let entries = await indexFileContent(path, content, grammarId);
  // Past the entry cap keep definitions only, so navigation to defs still works.
  if (index.totalEntries >= MAX_ENTRIES) {
    index.partial = true;
    entries = entries.filter((e) => e.kind === "definition");
  }
  index.files.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, entries });
  addEntries(index, entries);
}

async function build(index: ProjectIndex, source: ProjectSource): Promise<void> {
  const all = await source.listFiles();
  const indexable = all.filter((p) => symbolGrammarForPath(p) !== null);
  if (indexable.length > MAX_FILES) index.partial = true;
  const files = indexable.slice(0, MAX_FILES);

  let processed = 0;
  for (const path of files) {
    const stat = await source.stat(path);
    if (stat && stat.size <= MAX_FILE_SIZE) {
      try {
        await indexOneFile(index, source, path, stat);
      } catch {
        // Skip files that fail to parse/read.
      }
    }
    if (++processed % YIELD_EVERY === 0) await Promise.resolve();
  }
  index.lastValidated = source.now();
}

async function revalidate(index: ProjectIndex, source: ProjectSource): Promise<void> {
  const all = await source.listFiles();
  const present = new Set<string>();
  let processed = 0;
  for (const path of all) {
    if (symbolGrammarForPath(path) === null) continue;
    present.add(path);
    const stat = await source.stat(path);
    if (!stat || stat.size > MAX_FILE_SIZE) {
      removeFile(index, path);
      continue;
    }
    const existing = index.files.get(path);
    if (!existing || existing.mtimeMs !== stat.mtimeMs || existing.size !== stat.size) {
      removeFile(index, path);
      try {
        await indexOneFile(index, source, path, stat);
      } catch {
        // ignore
      }
    }
    if (++processed % YIELD_EVERY === 0) await Promise.resolve();
  }
  // Drop files that no longer exist.
  for (const path of [...index.files.keys()]) {
    if (!present.has(path)) removeFile(index, path);
  }
  index.lastValidated = source.now();
}

function touchLru(dir: string, index: ProjectIndex): void {
  projects.delete(dir);
  projects.set(dir, index);
  while (projects.size > MAX_PROJECTS) {
    // Evict the oldest project that isn't mid-build/revalidate; dropping a
    // busy index would silently discard its in-flight work and force a rebuild.
    let evicted = false;
    for (const [key, proj] of projects) {
      if (proj.building || proj.revalidating) continue;
      projects.delete(key);
      evicted = true;
      break;
    }
    if (!evicted) break; // everything is busy — let it grow past the cap briefly
  }
}

async function ensureIndex(dir: string, source: ProjectSource): Promise<ProjectIndex> {
  let index = projects.get(dir);
  if (!index) {
    index = {
      files: new Map(),
      byName: new Map(),
      totalEntries: 0,
      lastValidated: 0,
      building: null,
      revalidating: null,
      partial: false,
    };
    projects.set(dir, index);
    index.building = build(index, source).finally(() => {
      index!.building = null;
    });
  }
  touchLru(dir, index);
  if (index.building) {
    await index.building;
  } else if (source.now() - index.lastValidated > VALIDATE_INTERVAL_MS) {
    // Dedupe concurrent revalidations against the shared, mutable index:
    // a burst of lookups shares one in-flight pass instead of racing.
    if (!index.revalidating) {
      const idx = index;
      idx.revalidating = revalidate(idx, source).finally(() => {
        idx.revalidating = null;
      });
    }
    await index.revalidating;
  }
  return index;
}

export async function lookupSymbol(
  dir: string,
  name: string,
  source: ProjectSource = gitProjectSource(dir),
): Promise<SymbolLookupResult> {
  const index = await ensureIndex(dir, source);
  const all = index.byName.get(name) ?? [];
  const definitions = all.filter((e) => e.kind === "definition");
  const references = all.filter((e) => e.kind === "reference");
  const truncated = definitions.length > LOOKUP_CAP || references.length > LOOKUP_CAP;
  return {
    definitions: definitions.slice(0, LOOKUP_CAP),
    references: references.slice(0, LOOKUP_CAP),
    truncated,
    partial: index.partial,
  };
}

/**
 * Fuzzy/prefix search over distinct symbol names, returning the top matches with
 * counts and a location to jump to. Scores names only (cheap) to rank them, then
 * scans entries for just the top `limit` names — so even a broad one-character
 * query never walks the full entry set (potentially millions).
 */
export async function searchSymbolNames(
  dir: string,
  query: string,
  source: ProjectSource = gitProjectSource(dir),
  limit: number = SEARCH_LIMIT,
): Promise<SymbolSearchResult> {
  const index = await ensureIndex(dir, source);
  const q = query.trim().toLowerCase();
  if (!q) return { matches: [], partial: index.partial };

  // Phase 1: score names (no entry iteration) and rank. defCount can't tie-break
  // yet — it's only a secondary key, resolved among the returned set in phase 2.
  const ranked: { name: string; entries: SymbolEntry[]; score: number }[] = [];
  for (const [name, entries] of index.byName) {
    const score = scoreName(name, q);
    if (score !== null) ranked.push({ name, entries, score });
  }
  ranked.sort(
    (a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name),
  );

  // Phase 2: count occurrences and pick a jump target for only the top names.
  const scored: { score: number; match: SymbolNameMatch }[] = [];
  for (const { name, entries, score } of ranked.slice(0, limit)) {
    let defCount = 0;
    let refCount = 0;
    let primary: SymbolEntry | undefined;
    for (const entry of entries) {
      if (entry.kind === "definition") {
        defCount++;
        // Prefer a definition as the jump target; keep the first one.
        if (!primary || primary.kind !== "definition") primary = entry;
      } else {
        refCount++;
        if (!primary) primary = entry;
      }
    }
    if (!primary) continue;
    scored.push({ score, match: { name, symbolKind: primary.symbolKind, defCount, refCount, primary } });
  }

  // Now that counts are known, apply defCount as the score tie-break.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.match.defCount - a.match.defCount ||
      a.match.name.length - b.match.name.length ||
      a.match.name.localeCompare(b.match.name),
  );

  return { matches: scored.map((s) => s.match), partial: index.partial };
}

/** Test-only: drop all cached project indexes. */
export function _resetStore(): void {
  projects.clear();
}
