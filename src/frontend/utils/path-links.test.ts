import { test, expect, describe } from "bun:test";
import type { ILink, ILinkProvider } from "@xterm/xterm";
import {
  createPathLinkProvider,
  findPathLinks,
  indexFiles,
  type PathLinkContext,
  type PathLinkIndex,
} from "./path-links";

/**
 * The matcher behind file-path links in a terminal (TASK-108): what counts as a
 * path in an agent's prose, what it resolves against, and which of the
 * characters around it are part of it.
 */

const ROOT = "/repo";

const INDEX: PathLinkIndex = {
  root: ROOT,
  files: new Set([
    "README.md",
    "package.json",
    "src/api/files.ts",
    "src/frontend/Terminal.tsx",
    "web/src/app.ts",
    "@scope/pkg/index.ts",
  ]),
};

function paths(text: string, cwd: string | null = ROOT) {
  return findPathLinks(text, INDEX, cwd).map((m) => m.path);
}

describe("the forms agents print", () => {
  test("a bare relative path", () => {
    expect(paths("Updated src/api/files.ts to fix it")).toEqual(["src/api/files.ts"]);
  });

  test("a ./-prefixed path, linked as written", () => {
    const [link] = findPathLinks("see ./src/api/files.ts", INDEX, ROOT);
    expect(link?.path).toBe("src/api/files.ts");
    expect(link?.text).toBe("./src/api/files.ts");
  });

  test("an absolute path inside the root", () => {
    expect(paths("Read /repo/src/frontend/Terminal.tsx")).toEqual(["src/frontend/Terminal.tsx"]);
  });

  test("a bare file name at the root", () => {
    expect(paths("bumped package.json and README.md")).toEqual(["package.json", "README.md"]);
  });

  test("the tool-call shape Claude Code draws", () => {
    expect(paths("⏺ Update(src/api/files.ts)")).toEqual(["src/api/files.ts"]);
  });

  test("an @-mention links the file, not the @", () => {
    const [link] = findPathLinks("look at @src/api/files.ts", INDEX, ROOT);
    expect(link?.path).toBe("src/api/files.ts");
    expect(link?.text).toBe("src/api/files.ts");
    expect(link?.start).toBe(9);
  });

  test("a leading @ that belongs to the name is kept", () => {
    expect(paths("@scope/pkg/index.ts")).toEqual(["@scope/pkg/index.ts"]);
  });
});

describe(":line and :line:col", () => {
  test("a line is part of the link and carried", () => {
    const [link] = findPathLinks("src/api/files.ts:263 is the route", INDEX, ROOT);
    expect(link).toMatchObject({ path: "src/api/files.ts", line: 263, text: "src/api/files.ts:263" });
  });

  test("a column is part of the link and dropped", () => {
    const [link] = findPathLinks("src/api/files.ts:263:9", INDEX, ROOT);
    expect(link).toMatchObject({ line: 263, text: "src/api/files.ts:263:9" });
  });

  test("anything else after the colon is not part of the link", () => {
    const [link] = findPathLinks("src/api/files.ts:12-20", INDEX, ROOT);
    expect(link).toMatchObject({ line: 12, text: "src/api/files.ts:12" });
    const [bare] = findPathLinks("src/api/files.ts: the route", INDEX, ROOT);
    expect(bare?.text).toBe("src/api/files.ts");
    expect(bare?.line).toBeUndefined();
  });
});

describe("punctuation around a path", () => {
  test.each([
    ["`src/api/files.ts`"],
    ['"src/api/files.ts"'],
    ["'src/api/files.ts'"],
    ["(src/api/files.ts)"],
    ["[src/api/files.ts]"],
    ["**src/api/files.ts**"],
    ["see src/api/files.ts."],
    ["src/api/files.ts, then"],
    ["src/api/files.ts; then"],
    ["done in src/api/files.ts!"],
    ["--file=src/api/files.ts"],
  ])("%s", (line) => {
    const [link, ...rest] = findPathLinks(line, INDEX, ROOT);
    expect(rest).toEqual([]);
    expect(link?.text).toBe("src/api/files.ts");
    expect(line.slice(link!.start, link!.end)).toBe("src/api/files.ts");
  });

  test("a trailing full stop after a line number", () => {
    const [link] = findPathLinks("see src/api/files.ts:12.", INDEX, ROOT);
    expect(link?.text).toBe("src/api/files.ts:12");
  });
});

describe("what is not a link", () => {
  test("a path that does not exist", () => {
    expect(paths("src/api/nope.ts and and/or")).toEqual([]);
  });

  test("a directory", () => {
    const withDirs = indexFiles({
      directory: ROOT,
      files: [
        { path: "src", name: "src", isDirectory: true, depth: 0 },
        { path: "src/a.ts", name: "a.ts", isDirectory: false, depth: 1 },
      ],
    })!;
    expect(findPathLinks("src and src/a.ts", withDirs, ROOT).map((m) => m.path)).toEqual(["src/a.ts"]);
  });

  test("an absolute path outside the root, even with a matching tail", () => {
    expect(paths("/elsewhere/src/api/files.ts")).toEqual([]);
    expect(paths("/repository/src/api/files.ts")).toEqual([]);
  });

  test("a relative path that climbs out of the root", () => {
    expect(paths("../src/api/files.ts")).toEqual([]);
  });

  test("a home-relative path", () => {
    expect(paths("~/src/api/files.ts")).toEqual([]);
  });

  test("a URL, including the path inside it", () => {
    expect(paths("https://github.com/o/r/blob/main/src/api/files.ts")).toEqual([]);
  });

  test("a task id", () => {
    expect(paths("filed TASK-108")).toEqual([]);
  });
});

describe("resolution against the cwd", () => {
  test("a path relative to a subdirectory cwd", () => {
    expect(paths("src/app.ts", `${ROOT}/web`)).toEqual(["web/src/app.ts"]);
  });

  test("falls back to the root when the cwd has no such file", () => {
    expect(paths("src/api/files.ts", `${ROOT}/web`)).toEqual(["src/api/files.ts"]);
  });

  test("../ from a subdirectory stays inside the root", () => {
    expect(paths("../README.md", `${ROOT}/web`)).toEqual(["README.md"]);
  });

  test("a cwd outside the root resolves against the root alone", () => {
    expect(paths("src/app.ts", "/tmp")).toEqual([]);
    expect(paths("src/api/files.ts", "/tmp")).toEqual(["src/api/files.ts"]);
  });

  test("no cwd at all resolves against the root", () => {
    expect(paths("src/api/files.ts", null)).toEqual(["src/api/files.ts"]);
  });
});

test("several paths on a line keep their own offsets", () => {
  const line = "moved src/api/files.ts:3 into src/frontend/Terminal.tsx";
  const links = findPathLinks(line, INDEX, ROOT);
  expect(links.map((l) => line.slice(l.start, l.end))).toEqual([
    "src/api/files.ts:3",
    "src/frontend/Terminal.tsx",
  ]);
});

test("indexFiles trims the root and is null before the list arrives", () => {
  expect(indexFiles(undefined)).toBeNull();
  expect(indexFiles({ directory: "/repo/", files: [] })?.root).toBe("/repo");
});

// ── the provider ────────────────────────────────────────────────────────────

function buffer(...lines: string[]) {
  return {
    buffer: {
      active: {
        getLine: (y: number) =>
          lines[y] === undefined ? undefined : { translateToString: () => lines[y]! },
      },
    },
  };
}

function provide(provider: ILinkProvider, y: number) {
  let links: ILink[] | undefined;
  provider.provideLinks(y, (result) => {
    links = result;
  });
  return links;
}

const CONTEXT: PathLinkContext = { index: INDEX, cwd: ROOT };

test("the provider maps a match to 1-based inclusive ranges, and opens at the line", () => {
  const opened: Array<[string, number | undefined]> = [];
  const provider = createPathLinkProvider(
    buffer("see src/api/files.ts:263 and README.md"),
    () => CONTEXT,
    (path, line) => opened.push([path, line]),
  );

  const links = provide(provider, 1);
  expect(links?.map((l) => l.text)).toEqual(["src/api/files.ts:263", "README.md"]);
  // [4, 24) 0-based → columns 5 through 24.
  expect(links![0]!.range).toEqual({ start: { x: 5, y: 1 }, end: { x: 24, y: 1 } });
  expect(links![0]!.decorations).toEqual({ pointerCursor: true, underline: true });

  links![0]!.activate({} as MouseEvent, links![0]!.text);
  links![1]!.activate({} as MouseEvent, links![1]!.text);
  expect(opened).toEqual([
    ["src/api/files.ts", 263],
    ["README.md", undefined],
  ]);
});

test("the provider offers nothing without a context, or for a missing line", () => {
  expect(provide(createPathLinkProvider(buffer("README.md"), () => null, () => {}), 1)).toBeUndefined();
  expect(provide(createPathLinkProvider(buffer("README.md"), () => CONTEXT, () => {}), 5)).toBeUndefined();
  expect(provide(createPathLinkProvider(buffer("nothing here"), () => CONTEXT, () => {}), 1)).toBeUndefined();
});

test("the provider reads the context afresh, so a new file becomes a link", () => {
  let context: PathLinkContext = { index: { root: ROOT, files: new Set() }, cwd: ROOT };
  const provider = createPathLinkProvider(buffer("wrote NOTES.md"), () => context, () => {});
  expect(provide(provider, 1)).toBeUndefined();

  context = { index: { root: ROOT, files: new Set(["NOTES.md"]) }, cwd: ROOT };
  expect(provide(provider, 1)?.map((l) => l.text)).toEqual(["NOTES.md"]);
});
