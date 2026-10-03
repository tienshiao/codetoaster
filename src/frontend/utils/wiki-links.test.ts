import { test, expect } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { hrefKind, resolveMarkdownLink } from "./markdown-links";

/**
 * Every link in `wiki/` opens a file that exists (TASK-123).
 *
 * The wiki is the preview's live test data — it is written in the same
 * shapes as the wikis users open (bundle-relative `/` links, extensionless
 * pages, directory links) — so this runs each link through the resolver the
 * preview uses, against the real tree. A link the preview would open as a
 * missing file fails here instead, which also lints the wiki.
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

/**
 * Inline link targets outside fenced code, in either destination form
 * (`(a.md)`, `(<a b.md>)`) and with or without a title. Images are not links;
 * reference-style links are not used in this wiki.
 */
const INLINE_LINK = /(?<!!)\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

function links(source: string): string[] {
  const prose = source.replace(/^```[\s\S]*?^```/gm, "");
  return [...prose.matchAll(INLINE_LINK)].map((m) => m[1] ?? m[2]!);
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

test("links with a title or an angle-bracketed destination are still found", () => {
  expect(links('[a](/x.md "T") [b](<y z.md>) [c](w.md) ![i](p.png)')).toEqual(["/x.md", "y z.md", "w.md"]);
});

test("every wiki link resolves to a file", async () => {
  const broken: string[] = [];
  for (const file of markdownFiles(WIKI)) {
    const fromFile = relative(REPO, file);
    for (const href of links(await Bun.file(file).text())) {
      if (hrefKind(href) !== "file") continue;
      const target = resolveMarkdownLink(href, fromFile, isFile);
      if (!target || !isFile.has(target.path)) broken.push(`${fromFile}: ${href} → ${target?.path ?? "nothing"}`);
    }
  }
  expect(broken).toEqual([]);
});
