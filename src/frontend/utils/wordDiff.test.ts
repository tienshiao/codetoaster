import { test, expect } from "bun:test";
import {
  applySyntaxToLine,
  applySyntaxToSegments,
  enhanceWithWordDiff,
  computeWordDiff,
  type DiffFileTokens,
} from "./wordDiff";
import type { LineTokens } from "../../types/highlight";
import type { FileDiff, TextSegment } from "../types/diff";

test("applySyntaxToLine uses valid precomputed server tokens", () => {
  const precomputed: LineTokens = [
    { text: "const", type: "keyword" },
    { text: " x", type: null },
  ];
  const segs = applySyntaxToLine("const x", precomputed, null);
  expect(segs).toEqual([
    { text: "const", highlighted: false, syntaxType: "keyword" },
    { text: " x", highlighted: false, syntaxType: undefined },
  ]);
});

test("applySyntaxToLine ignores precomputed tokens that don't reconstruct the line", () => {
  const stale: LineTokens = [{ text: "OLD", type: "keyword" }];
  // No config and invalid precomputed => plain single segment.
  const segs = applySyntaxToLine("const x", stale, null);
  expect(segs).toEqual([{ text: "const x", highlighted: false }]);
});

test("applySyntaxToSegments intersects word-diff segments with precomputed tokens", () => {
  const wordSegments: TextSegment[] = [
    { text: "const ", highlighted: false },
    { text: "x", highlighted: true },
  ];
  const precomputed: LineTokens = [
    { text: "const", type: "keyword" },
    { text: " ", type: null },
    { text: "x", type: "variable" },
  ];
  const result = applySyntaxToSegments(wordSegments, precomputed, null);
  expect(result).toEqual([
    { text: "const", highlighted: false, syntaxType: "keyword" },
    { text: " ", highlighted: false, syntaxType: undefined },
    { text: "x", highlighted: true, syntaxType: "variable" },
  ]);
});

test("applySyntaxToSegments returns segments unchanged with no tokens and no config", () => {
  const wordSegments: TextSegment[] = [
    { text: "foo ", highlighted: false },
    { text: "bar", highlighted: true },
  ];
  expect(applySyntaxToSegments(wordSegments, null, null)).toEqual(wordSegments);
});

test("enhanceWithWordDiff maps deletions to old tokens and additions to new tokens", () => {
  const file: FileDiff = {
    oldPath: "a.ts",
    newPath: "a.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    hunks: [
      {
        header: "@@ -5,1 +5,1 @@",
        oldStart: 5,
        oldCount: 1,
        newStart: 5,
        newCount: 1,
        lines: [
          { type: "deletion", content: "val", oldLineNum: 5 },
          { type: "addition", content: "val", newLineNum: 5 },
        ],
      },
    ],
  };

  // Same text "val" but tagged differently on each side so we can tell which
  // side's tokens were applied.
  const oldTokens: LineTokens[] = [];
  oldTokens[4] = [{ text: "val", type: "keyword" }];
  const newTokens: LineTokens[] = [];
  newTokens[4] = [{ text: "val", type: "variable" }];

  const map = new Map<string, DiffFileTokens>([
    ["a.ts", { old: oldTokens, new: newTokens }],
  ]);

  enhanceWithWordDiff([file], map);

  const del = file.hunks[0]!.lines[0]!;
  const add = file.hunks[0]!.lines[1]!;
  expect(del.segments?.[0]?.syntaxType).toBe("keyword"); // from old side
  expect(add.segments?.[0]?.syntaxType).toBe("variable"); // from new side
});

test("computeWordDiff still marks changed tokens (unchanged behavior)", () => {
  const { deletionSegments, additionSegments } = computeWordDiff("a b c", "a x c");
  expect(deletionSegments.some((s) => s.highlighted && s.text.includes("b"))).toBe(true);
  expect(additionSegments.some((s) => s.highlighted && s.text.includes("x"))).toBe(true);
});
