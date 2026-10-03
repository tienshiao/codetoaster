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
  /** From a GitHub-style `#L12` fragment. */
  line?: number;
}

const LINE_FRAGMENT = /^L(\d+)/;

/**
 * The file `href`, written in `fromFile`, links to.
 *
 * A relative link resolves against `fromFile`'s directory, as on any host. A
 * `/`-prefixed one is less settled: GitHub reads it as the repository root,
 * but a wiki kept in a subdirectory means its own root — `wiki/index.md`
 * linking `/services/archive.md` means `wiki/services/archive.md`. So a `/`
 * link first tries the bundle `fromFile` sits in — the nearest ancestor
 * holding an `index.md`, which is how an LLM wiki (OKF) marks its root — and
 * then the repository root. A file in no bundle gets GitHub's reading. Any
 * other ancestor is tried last, for a wiki that marks its root some other way.
 * Asking for the bundle by its marker, rather than taking the first ancestor
 * that happens to hold the name, is what keeps a wiki's `/index.md` from
 * opening an outer docs page and a monorepo package's `/README.md` from
 * opening the package's.
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
  if (raw === "") return null;

  const lineMatch = LINE_FRAGMENT.exec(fragment);
  const line = lineMatch ? Number(lineMatch[1]) : undefined;
  const target = (path: string): MarkdownLinkTarget => (line ? { path, line } : { path });

  const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  const bases = raw.startsWith("/") ? rootBases(dir, files) : [dir];
  const isDir = DIRECTORY.test(raw);

  let fallback: string | null = null;
  for (const base of bases) {
    const joined = normalize(base ? `${base}/${raw}` : raw);
    if (joined === null) continue;
    const tried = candidates(joined, isDir);
    fallback ??= tried[0]!;
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
function rootBases(dir: string, files: Pick<ReadonlySet<string>, "has"> | null): string[] {
  const ancestors = [""];
  if (dir !== "") {
    const segments = dir.split("/");
    for (let i = 1; i <= segments.length; i++) ancestors.push(segments.slice(0, i).join("/"));
  }
  const bundle = files
    ? ancestors.findLast((base) => files.has(base ? `${base}/index.md` : "index.md"))
    : undefined;
  const first = bundle === undefined ? [""] : [bundle, ""];
  return [...new Set([...first, ...ancestors])];
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
function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
