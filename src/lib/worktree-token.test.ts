import { test, expect } from "bun:test";
import { decodeWorktreeToken, encodeWorktreeToken } from "./worktree-token";

test("a token round-trips its scope, id and path", () => {
  const value = { scope: "tasks" as const, id: "6f1c-uuid", path: "/Users/me/repo/.worktrees/a" };
  expect(decodeWorktreeToken(encodeWorktreeToken(value))).toEqual(value);
});

test("paths with non-ASCII characters and spaces survive, in the URL-safe alphabet", () => {
  const value = { scope: "projects" as const, id: "web", path: "/tmp/réseau ünïcode/日本語?&#" };
  const token = encodeWorktreeToken(value);
  expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(decodeWorktreeToken(token)).toEqual(value);
});

test("anything this module did not write decodes to null", () => {
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  expect(decodeWorktreeToken("")).toBeNull();
  expect(decodeWorktreeToken("has space")).toBeNull();
  expect(decodeWorktreeToken("abc=")).toBeNull();
  expect(decodeWorktreeToken(btoa("not json").replace(/=+$/, ""))).toBeNull();
  expect(decodeWorktreeToken(enc({ scope: "worktrees", id: "x", path: "/a" }))).toBeNull();
  expect(decodeWorktreeToken(enc({ scope: "tasks", id: "", path: "/a" }))).toBeNull();
  expect(decodeWorktreeToken(enc({ scope: "tasks", id: "x", path: "relative" }))).toBeNull();
  expect(decodeWorktreeToken(enc(["tasks", "x", "/a"]))).toBeNull();
  // Bytes that are not UTF-8.
  expect(decodeWorktreeToken(btoa("\xff\xfe").replace(/=+$/, ""))).toBeNull();
});
