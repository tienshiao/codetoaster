import { test, expect, describe } from "bun:test";
import { hrefKind, resolveMarkdownLink } from "./markdown-links";

const FILES = new Set([
  "README.md",
  "docs/guide.md",
  "docs/README.md",
  "wiki/index.md",
  "wiki/services/archive.md",
  "wiki/services/cell.md",
  "wiki/conventions/repo-layout.md",
  "puffco/LED API 3.md",
  "puffco/Home.md",
  "puffco/color.ts",
  "src/api/files.ts",
]);

describe("hrefKind", () => {
  test("a scheme or protocol-relative URL is external", () => {
    expect(hrefKind("https://example.com/a.md")).toBe("external");
    expect(hrefKind("mailto:someone@example.com")).toBe("external");
    expect(hrefKind("//example.com/a")).toBe("external");
  });

  test("a bare fragment is a fragment", () => {
    expect(hrefKind("#markdown-header-logging")).toBe("fragment");
  });

  test("anything else is a path", () => {
    expect(hrefKind("services/archive.md")).toBe("file");
    expect(hrefKind("/services/archive.md")).toBe("file");
    expect(hrefKind("../README.md#setup")).toBe("file");
    expect(hrefKind("LED%20API%203")).toBe("file");
  });
});

describe("resolveMarkdownLink", () => {
  test("a relative link resolves against the file's directory", () => {
    expect(resolveMarkdownLink("services/archive.md", "wiki/index.md", FILES)).toEqual({
      path: "wiki/services/archive.md",
    });
    expect(resolveMarkdownLink("./cell.md", "wiki/services/archive.md", FILES)).toEqual({
      path: "wiki/services/cell.md",
    });
    expect(resolveMarkdownLink("../conventions/repo-layout.md", "wiki/services/archive.md", FILES)).toEqual({
      path: "wiki/conventions/repo-layout.md",
    });
  });

  test("a relative link from a root file resolves against the root", () => {
    expect(resolveMarkdownLink("docs/guide.md", "README.md", FILES)).toEqual({ path: "docs/guide.md" });
  });

  test("a root-absolute link resolves against the wiki's own root", () => {
    expect(resolveMarkdownLink("/services/cell.md", "wiki/index.md", FILES)).toEqual({
      path: "wiki/services/cell.md",
    });
    expect(resolveMarkdownLink("/conventions/repo-layout.md", "wiki/services/archive.md", FILES)).toEqual({
      path: "wiki/conventions/repo-layout.md",
    });
  });

  test("the wiki's root beats the repository's for a name both have", () => {
    expect(resolveMarkdownLink("/index.md", "wiki/services/archive.md", FILES)).toEqual({ path: "wiki/index.md" });
  });

  test("a root-absolute link falls back to the repository root", () => {
    expect(resolveMarkdownLink("/src/api/files.ts", "wiki/services/archive.md", FILES)).toEqual({
      path: "src/api/files.ts",
    });
    expect(resolveMarkdownLink("/README.md", "wiki/services/archive.md", FILES)).toEqual({ path: "README.md" });
  });

  test("escapes are decoded and an extensionless page finds its .md", () => {
    expect(resolveMarkdownLink("LED%20API%203", "puffco/Home.md", FILES)).toEqual({ path: "puffco/LED API 3.md" });
    expect(resolveMarkdownLink("color.ts", "puffco/Home.md", FILES)).toEqual({ path: "puffco/color.ts" });
  });

  test("a directory link opens its README", () => {
    expect(resolveMarkdownLink("docs/", "README.md", FILES)).toEqual({ path: "docs/README.md" });
    expect(resolveMarkdownLink("docs", "README.md", FILES)).toEqual({ path: "docs/README.md" });
  });

  test("a lower-case readme counts", () => {
    expect(resolveMarkdownLink("notes/", "README.md", new Set(["notes/readme.md"]))).toEqual({
      path: "notes/readme.md",
    });
  });

  test("a trailing slash skips a same-named page", () => {
    const files = new Set(["docs.md", "docs/README.md"]);
    expect(resolveMarkdownLink("docs/", "README.md", files)).toEqual({ path: "docs/README.md" });
    expect(resolveMarkdownLink("docs", "README.md", files)).toEqual({ path: "docs.md" });
    // With no page inside, the README it asked for — the tab says it is missing.
    expect(resolveMarkdownLink("nothing/", "README.md", files)).toEqual({ path: "nothing/README.md" });
  });

  test("a link to the repository root opens its README", () => {
    expect(resolveMarkdownLink("../", "docs/guide.md", FILES)).toEqual({ path: "README.md" });
    expect(resolveMarkdownLink("./", "puffco/Home.md", FILES)).toEqual({ path: "puffco/README.md" });
    expect(resolveMarkdownLink("/", "README.md", FILES)).toEqual({ path: "README.md" });
  });

  test("the fragment and query are not part of the path", () => {
    expect(resolveMarkdownLink("Home#markdown-header-led-api-2", "puffco/LED API 3.md", FILES)).toEqual({
      path: "puffco/Home.md",
    });
    expect(resolveMarkdownLink("guide.md?plain=1", "docs/README.md", FILES)).toEqual({ path: "docs/guide.md" });
  });

  test("a #L fragment carries the line", () => {
    expect(resolveMarkdownLink("../src/api/files.ts#L263", "docs/guide.md", FILES)).toEqual({
      path: "src/api/files.ts",
      line: 263,
    });
  });

  test("an unknown file still resolves to its plain path", () => {
    expect(resolveMarkdownLink("missing.md", "wiki/index.md", FILES)).toEqual({ path: "wiki/missing.md" });
    expect(resolveMarkdownLink("/missing.md", "wiki/index.md", FILES)).toEqual({ path: "wiki/missing.md" });
  });

  test("without a file list, the plain resolution", () => {
    expect(resolveMarkdownLink("LED%20API%203", "puffco/Home.md", null)).toEqual({ path: "puffco/LED API 3" });
  });

  test("a link out of the repository, or to nothing, is null", () => {
    expect(resolveMarkdownLink("../../outside.md", "docs/guide.md", FILES)).toBeNull();
    expect(resolveMarkdownLink("?x=1", "docs/guide.md", FILES)).toBeNull();
  });

  test("a malformed escape is taken literally", () => {
    expect(resolveMarkdownLink("100%.md", "README.md", null)).toEqual({ path: "100%.md" });
  });
});
