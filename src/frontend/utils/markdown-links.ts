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
 * linking `/services/archive.md` means `wiki/services/archive.md`. Both are
 * covered by trying the repository root and then each of `fromFile`'s
 * ancestors, outermost first, and taking the first that holds the file.
 *
 * Wikis also drop the extension (a Bitbucket wiki writes `LED%20API%203` for
 * `LED API 3.md`) and link a directory for its README, so each base tries the
 * exact path, then the `.md` page, then a README or index inside it.
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
  files: ReadonlySet<string> | null,
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
  const bases = raw.startsWith("/") ? ancestors(dir) : [dir];

  let fallback: string | null = null;
  for (const base of bases) {
    const joined = normalize(base ? `${base}/${raw}` : raw);
    if (joined === null) continue;
    fallback ??= joined;
    if (!files) break;
    for (const candidate of candidates(joined)) {
      if (files.has(candidate)) return target(candidate);
    }
  }
  return fallback === null ? null : target(fallback);
}

/** `a/b` → `["", "a", "a/b"]`: the repository root, then inward. */
function ancestors(dir: string): string[] {
  const out = [""];
  if (dir === "") return out;
  const segments = dir.split("/");
  for (let i = 1; i <= segments.length; i++) out.push(segments.slice(0, i).join("/"));
  return out;
}

function candidates(path: string): string[] {
  const out = [path];
  if (!path.toLowerCase().endsWith(".md")) out.push(`${path}.md`);
  out.push(`${path}/README.md`, `${path}/index.md`);
  return out;
}

/** A malformed escape (`100%.md`) is taken literally rather than thrown. */
function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
