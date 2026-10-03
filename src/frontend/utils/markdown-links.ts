import { normalize } from "./path-links";

/**
 * Links in the markdown preview (TASK-122).
 *
 * A repository's markdown links point at other files in it — a wiki most of
 * all, which is nothing but pages linking pages. Left to the browser, an
 * `href` like `services/archive.md` resolves against the app's own URL and
 * lands on a route that does not exist. These rules turn it into the file it
 * names instead, so the preview can open it in a file tab.
 *
 * DOM-free, like `path-links.ts`: what a link resolves to is the part worth
 * testing, and none of it needs a page.
 */

export type HrefKind =
  /** Has a scheme (`https:`, `mailto:`) or is protocol-relative: the browser's. */
  | "external"
  /** Only a fragment: a heading in this same document. */
  | "fragment"
  /** A path in the repository. */
  | "file";

const SCHEME = /^[a-z][a-z\d+.-]*:/i;

export function hrefKind(href: string): HrefKind {
  if (SCHEME.test(href) || href.startsWith("//")) return "external";
  if (href.startsWith("#")) return "fragment";
  return "file";
}

export interface MarkdownLinkTarget {
  /** Relative to the repository root — what a file tab takes. */
  path: string;
  /** From a GitHub-style `#L12` (or `#L12-L20`) fragment. */
  line?: number;
  /** Any other fragment, decoded: a heading to scroll the preview to (TASK-124). */
  anchor?: string;
}

const LINE_FRAGMENT = /^L(\d+)(?:-L\d+)?$/;

/** Whether a fragment (without its `#`) is GitHub's `L12` line form. */
export function isLineFragment(fragment: string): boolean {
  return LINE_FRAGMENT.test(fragment);
}

/**
 * A heading's id, as GitHub derives it: lower-cased, punctuation dropped,
 * each space a hyphen. Two headings with the same text get the same slug;
 * numbering the repeats (`-1`, `-2`) is the caller's, since only it sees the
 * whole document.
 */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Slugs for one document's headings, numbered the way GitHub's slugger
 * numbers them: a repeat gets `-1`, `-2`, skipping any number already taken,
 * so `A`, `A-1`, `A` come out `a`, `a-1`, `a-2` rather than two `a-1`s.
 * `reserved` are ids already in the document — footnotes — that a heading
 * must not take, or a heading called "fn 1" would steal footnote 1's target.
 * Shared by the preview and the wiki lint so both number alike.
 */
export function createSlugger(reserved: Iterable<string> = []): (text: string) => string {
  const occurrences = new Map<string, number>();
  for (const id of reserved) occurrences.set(id, 0);
  return (text) => {
    const base = headingSlug(text);
    let slug = base;
    while (occurrences.has(slug)) {
      const next = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, next);
      slug = `${base}-${next}`;
    }
    occurrences.set(slug, 0);
    return slug;
  };
}

/**
 * What a fragment and a heading id are compared by when they do not match
 * exactly. GitHub drops punctuation and keeps each space; Bitbucket prefixes
 * `markdown-header-` and turns every run of anything else into one hyphen —
 * `#markdown-header-led-api-2` for a heading GitHub calls `led-api-2`, and the
 * two disagree on `Color (array) subsets`. Collapsing both the same way lets
 * a wiki written for either host land on its heading.
 */
export function anchorKey(fragment: string): string {
  return fragment
    .replace(/^user-content-/, "")
    .replace(/^markdown-header-/, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The file `href`, written in `fromFile`, links to.
 *
 * A relative link resolves against `fromFile`'s directory, as on any host. A
 * `/`-prefixed one is less settled: GitHub reads it as the repository root,
 * but a wiki kept in a subdirectory means its own root — `wiki/index.md`
 * linking `/services/archive.md` means `wiki/services/archive.md`. So a `/`
 * link first tries the bundle `fromFile` sits in — the nearest ancestor
 * holding an LLM wiki's `index.md` and `log.md`, else the outermost holding an
 * `index.md` — and then the repository root. A file in no bundle gets GitHub's
 * reading. Any other ancestor is tried last, for a wiki that marks its root
 * some other way. Asking for the bundle by its markers, rather than taking the
 * first ancestor that happens to hold the name, is what keeps a wiki's
 * `/index.md` from opening an outer docs page or a section's own index, and a
 * monorepo package's `/README.md` from opening the package's.
 *
 * Wikis also drop the extension (a Bitbucket wiki writes `LED%20API%203` for
 * `LED API 3.md`) and link a directory for its README, so each base tries the
 * exact path, then the `.md` page, then a README or index inside it. A link
 * that says it is a directory (`docs/`, `.`, `..`) tries only the last.
 *
 * `files` is the repository's file list. Without it, or when nothing matches,
 * the answer is the first plain resolution: the file tab then says it is
 * missing, which beats a link that silently does nothing — and an ignored
 * file, absent from the list, still opens. Null only for a link that climbs
 * out of the repository or names nothing.
 */
export function resolveMarkdownLink(
  href: string,
  fromFile: string,
  files: Pick<ReadonlySet<string>, "has"> | null,
): MarkdownLinkTarget | null {
  const hashAt = href.indexOf("#");
  const fragment = hashAt === -1 ? "" : href.slice(hashAt + 1);
  let raw = hashAt === -1 ? href : href.slice(0, hashAt);
  const queryAt = raw.indexOf("?");
  if (queryAt !== -1) raw = raw.slice(0, queryAt);
  raw = decode(raw);

  const lineMatch = LINE_FRAGMENT.exec(fragment);
  const line = lineMatch ? Number(lineMatch[1]) : undefined;
  const anchor = !lineMatch && fragment ? decode(fragment) : undefined;
  const target = (path: string): MarkdownLinkTarget => ({
    path,
    ...(line ? { line } : {}),
    ...(anchor ? { anchor } : {}),
  });
  // A bare fragment names a place in this same file — a heading, or a line.
  if (raw === "") return fragment ? target(fromFile) : null;

  const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  // `home` is where a link that matches nothing is taken to point.
  const { bases, home } = raw.startsWith("/") ? rootBases(dir, files) : { bases: [dir], home: dir };
  const isDir = DIRECTORY.test(raw);

  let fallback: string | null = null;
  for (const base of bases) {
    const joined = normalize(base ? `${base}/${raw}` : raw);
    if (joined === null) continue;
    const tried = candidates(joined, isDir);
    if (base === home) fallback = tried[0]!;
    if (!files) break;
    const hit = tried.find((candidate) => files.has(candidate));
    if (hit) return target(hit);
  }
  return fallback === null ? null : target(fallback);
}

/** Ends in `/`, or in a `.` or `..` segment. */
const DIRECTORY = /(?:^|\/)(?:\.\.?)?$/;

/**
 * What a `/` link may be relative to, best first: the enclosing bundle's root
 * when there is one, the repository root, then the remaining ancestors from
 * the outside in.
 */
function rootBases(
  dir: string,
  files: Pick<ReadonlySet<string>, "has"> | null,
): { bases: string[]; home: string } {
  const ancestors = [""];
  if (dir !== "") {
    const segments = dir.split("/");
    for (let i = 1; i <= segments.length; i++) ancestors.push(segments.slice(0, i).join("/"));
  }
  const has = (base: string, name: string) => files?.has(base ? `${base}/${name}` : name) ?? false;
  // An LLM wiki's root holds both its catalog and its log; a section of one
  // may hold an index.md of its own and must not be taken for the root. The
  // nearest such pair wins, so a wiki nested in a larger docs tree is its own
  // bundle. Failing that, the outermost index.md below the repository root —
  // a weaker sign, good enough to try first but not to send a link that
  // matches nothing there: an outer docs folder's index.md does not make
  // `/scripts/gen.sh` mean `docs/scripts/gen.sh`.
  const wiki = ancestors.findLast((base) => has(base, "index.md") && has(base, "log.md"));
  const bundle = wiki ?? ancestors.find((base) => base !== "" && has(base, "index.md"));
  const first = bundle === undefined ? [""] : [bundle, ""];
  return { bases: [...new Set([...first, ...ancestors])], home: wiki ?? "" };
}

/** What `path` may name, most literal first. `""` is the repository root. */
function candidates(path: string, isDir: boolean): string[] {
  const inside = path ? `${path}/` : "";
  const dirPages = [`${inside}README.md`, `${inside}readme.md`, `${inside}index.md`];
  if (isDir || path === "") return dirPages;
  const out = [path];
  if (!path.toLowerCase().endsWith(".md")) out.push(`${path}.md`);
  return [...out, ...dirPages];
}

/** A malformed escape (`100%.md`) is taken literally rather than thrown. */
export function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
