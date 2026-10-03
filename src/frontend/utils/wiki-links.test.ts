import { test, expect } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { anchorKey, headingSlug, hrefKind, resolveMarkdownLink } from "./markdown-links";

/**
 * Every link and image in `wiki/` reaches something that exists (TASK-123).
 *
 * The wiki is the preview's live test data — it is written in the same
 * shapes as the wikis users open (bundle-relative `/` links, extensionless
 * pages, directory links, Bitbucket heading anchors) — so this runs each
 * link through the resolver the preview uses, against the real tree, and
 * checks a heading anchor against the headings of the page it lands on
 * (TASK-124). A link the preview would open as a missing file or a heading
 * that is not there fails here instead, which also lints the wiki.
 */
const REPO = join(import.meta.dir, "../../..");
const WIKI = join(REPO, "wiki");

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

function withoutFences(source: string): string {
  return source.replace(/^```[\s\S]*?^```/gm, "");
}

/** Markdown with fenced blocks and inline code spans taken out: neither links. */
function prose(source: string): string {
  return withoutFences(source).replace(/`[^`\n]*`/g, "");
}

/**
 * Inline link and image targets, in either destination form (`(a.md)`,
 * `(<a b.md>)`) and with or without a title. Reference-style links are not
 * used in this wiki.
 */
const INLINE_LINK = /!?\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

function links(source: string): string[] {
  return [...prose(source).matchAll(INLINE_LINK)].map((m) => m[1] ?? m[2]!);
}

/** The `anchorKey` of every heading in a page, numbered repeats included —
 * the ids the preview's heading plugin would give them. */
function headingKeys(source: string): Set<string> {
  const seen = new Map<string, number>();
  const keys = new Set<string>();
  // A code span's text is part of a heading's text, so only fences come out.
  for (const [, text] of withoutFences(source).matchAll(/^#{1,6}[ \t]+(.+?)[ \t#]*$/gm)) {
    const plain = text!
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1");
    const slug = headingSlug(plain);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    keys.add(anchorKey(count === 0 ? slug : `${slug}-${count}`));
  }
  return keys;
}

const isFile = {
  has(path: string): boolean {
    try {
      return statSync(join(REPO, path)).isFile();
    } catch {
      return false;
    }
  },
};

test("the wiki has pages to check", () => {
  expect(markdownFiles(WIKI).length).toBeGreaterThan(3);
});

test("links with a title or an angle-bracketed destination are found, images too", () => {
  expect(links('[a](/x.md "T") [b](<y z.md>) [c](w.md) ![i](p.png) `[no](code.md)`')).toEqual([
    "/x.md",
    "y z.md",
    "w.md",
    "p.png",
  ]);
});

test("heading keys follow the preview's ids", () => {
  expect(headingKeys("# Setup\n\n## LED `API` 2\n\n# Setup")).toEqual(new Set(["setup", "led-api-2", "setup-1"]));
});

test("every wiki link and image resolves to a file, and every anchor to a heading", async () => {
  const pages = new Map<string, string>();
  for (const file of markdownFiles(WIKI)) pages.set(relative(REPO, file), await Bun.file(file).text());

  const broken: string[] = [];
  for (const [fromFile, source] of pages) {
    for (const href of links(source)) {
      const kind = hrefKind(href);
      if (kind === "external") continue;

      if (kind === "fragment") {
        if (!headingKeys(source).has(anchorKey(href.slice(1)))) broken.push(`${fromFile}: ${href} → no such heading`);
        continue;
      }

      const target = resolveMarkdownLink(href, fromFile, isFile);
      if (!target || !isFile.has(target.path)) {
        broken.push(`${fromFile}: ${href} → ${target?.path ?? "nothing"}`);
      } else if (target.anchor && target.path.endsWith(".md")) {
        const page = pages.get(target.path) ?? (await Bun.file(join(REPO, target.path)).text());
        if (!headingKeys(page).has(anchorKey(target.anchor))) {
          broken.push(`${fromFile}: ${href} → ${target.path} has no such heading`);
        }
      }
    }
  }
  expect(broken).toEqual([]);
});
