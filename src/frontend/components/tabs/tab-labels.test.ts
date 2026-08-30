import { test, expect } from "bun:test";
import { basename, presentTab } from "./tab-labels";

test("basename takes the last segment and tolerates a trailing slash", () => {
  expect(basename("src/lib/xtmux/pty.ts")).toBe("pty.ts");
  expect(basename("README.md")).toBe("README.md");
  expect(basename("src/lib/")).toBe("lib");
  expect(basename("")).toBe("");
});

test("the agent tab is prose and cannot be closed", () => {
  const agent = presentTab({ kind: "agent" });
  expect(agent.kind).toBe("agent");
  expect(agent.closable).toBe(false);
});

test("every other kind is closable", () => {
  const others = [
    presentTab({ kind: "shell", ptyId: "pty-1" }),
    presentTab({ kind: "diffAll" }),
    presentTab({ kind: "history" }),
    presentTab({ kind: "diff", path: "a/b.ts" }),
    presentTab({ kind: "file", path: "a/b.ts" }),
    presentTab({ kind: "commit", sha: "0123456789abcdef" }),
  ];
  expect(others.every((t) => t.closable)).toBe(true);
});

test("a path is shown by its basename and disambiguated by the tooltip", () => {
  const diff = presentTab({ kind: "diff", path: "src/lib/xtmux/pty.ts" });
  expect(diff.label).toBe("pty.ts");
  expect(diff.detail).toBeUndefined();
  expect(diff.title).toBe("src/lib/xtmux/pty.ts");
});

test("a file opened at a line says so, because the line is why it reopened", () => {
  const at = presentTab({ kind: "file", path: "src/server.ts", line: 42 });
  expect(at.label).toBe("server.ts");
  expect(at.detail).toBe(":42");
  expect(at.title).toBe("src/server.ts:42");

  const plain = presentTab({ kind: "file", path: "src/server.ts" });
  expect(plain.detail).toBeUndefined();
  expect(plain.title).toBe("src/server.ts");
});

test("a commit is labelled by the abbreviation git itself uses", () => {
  const commit = presentTab({ kind: "commit", sha: "6ca79d1f0a2b3c4d5e6f" });
  expect(commit.label).toBe("6ca79d1");
  expect(commit.title).toBe("6ca79d1f0a2b3c4d5e6f");
});

test("the kind is carried through, since it is the strip's only colour", () => {
  expect(presentTab({ kind: "diffAll" }).kind).toBe("diffAll");
  expect(presentTab({ kind: "history" }).kind).toBe("history");
  expect(presentTab({ kind: "shell", ptyId: "p" }).kind).toBe("shell");
});
