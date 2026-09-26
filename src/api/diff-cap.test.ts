import { test, expect, describe } from "bun:test";
import { capDiff, MAX_DIFF_LINE_CHARS, MAX_FILE_DIFF_BYTES } from "./diff-cap";
import { formatOversizedMarker, parseOversizedMarker } from "../lib/diff/oversized";
import { parseDiff } from "../frontend/utils/parseDiff";

const small = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " one",
  "-two",
  "+TWO",
  " three",
  "",
].join("\n");

/** A modified file whose one line is `size` characters on each side. */
function singleLine(path: string, size: number, header = `diff --git a/${path} b/${path}`): string {
  return [
    header,
    "index 3333333..4444444 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    "-" + "a".repeat(size),
    "\\ No newline at end of file",
    "+" + "b".repeat(size),
    "\\ No newline at end of file",
    "",
  ].join("\n");
}

describe("oversized marker", () => {
  test("round-trips", () => {
    const stats = { bytes: 46_234_567, additions: 3, deletions: 2, longestLine: 22_086_638 };
    const line = formatOversizedMarker(stats);
    expect(line).toBe("Oversized diff omitted: 46234567 bytes, +3 -2, longest line 22086638 chars");
    expect(parseOversizedMarker(line)).toEqual(stats);
    expect(parseOversizedMarker(line + " ")).toBeNull();
    expect(parseOversizedMarker("+" + line)).toBeNull();
  });
});

describe("capDiff", () => {
  test("a diff within budget comes back unchanged", () => {
    expect(capDiff(small)).toBe(small);
    expect(capDiff("")).toBe("");
    // Under tight budgets the small diff still fits.
    expect(capDiff(small, { maxFileBytes: 10_000, maxLineChars: 50 })).toBe(small);
  });

  test("a section over the byte budget keeps its headers and gains a marker", () => {
    // 600 lines of 2 kB each: no long line, over a 1 MB budget.
    const lines = Array.from({ length: 600 }, (_, i) => "+" + String(i).padEnd(2_000, "x"));
    const big = [
      "diff --git a/big.txt b/big.txt",
      "index 5555555..6666666 100644",
      "--- a/big.txt",
      "+++ b/big.txt",
      "@@ -1,2 +1,601 @@",
      " keep",
      "-gone",
      ...lines,
      " tail",
      "",
    ].join("\n");
    expect(big.length).toBeGreaterThan(MAX_FILE_DIFF_BYTES);

    const out = capDiff(big);
    expect(out).toBe(
      [
        "diff --git a/big.txt b/big.txt",
        "index 5555555..6666666 100644",
        "--- a/big.txt",
        "+++ b/big.txt",
        formatOversizedMarker({ bytes: big.length, additions: 600, deletions: 1, longestLine: 2_000 }),
        "",
      ].join("\n"),
    );
  });

  test("a section under the byte budget with one line over the length budget is capped", () => {
    const section = singleLine("data/min.js", 25_000);
    expect(section.length).toBeLessThan(MAX_FILE_DIFF_BYTES);
    const out = capDiff(section);
    expect(out.length).toBeLessThan(500);
    const marker = out.split("\n").map(parseOversizedMarker).find(Boolean);
    expect(marker).toEqual({ bytes: section.length, additions: 1, deletions: 1, longestLine: 25_000 });
    expect(out.startsWith("diff --git a/data/min.js b/data/min.js\nindex 3333333..4444444 100644\n--- a/data/min.js\n+++ b/data/min.js\n")).toBe(true);
  });

  test("bytes are UTF-8 bytes, not characters", () => {
    // 10k three-byte characters: 10k chars, 30k bytes.
    const section = small.replace("+TWO", "+" + "€".repeat(10_000));
    const out = capDiff(section, { maxFileBytes: 20_000, maxLineChars: MAX_DIFF_LINE_CHARS });
    const marker = out.split("\n").map(parseOversizedMarker).find(Boolean);
    expect(marker?.bytes).toBe(Buffer.byteLength(section, "utf8"));
  });

  test("bytes count two-, three- and four-byte characters and lone surrogates as UTF-8 does", () => {
    // é (2 bytes), € (3), 😀 (a surrogate pair, 4), a lone high surrogate
    // (written as U+FFFD, 3), each in its own section so the counter resumes
    // across sections and a pass-through section in between.
    const chars = ["é", "€", "😀", "\ud800"];
    const sections = chars.map((ch, i) => small.replaceAll("src/a.ts", `f${i}.ts`).replace("+TWO", "+" + ch.repeat(100)));
    const diff = sections.flatMap((s) => [s, small]).join("");
    const out = capDiff(diff, { maxFileBytes: 150 });
    const markers = out.split("\n").map(parseOversizedMarker).filter(Boolean);
    // TextEncoder is the oracle, being what writes the response: Bun 1.3's
    // Buffer.byteLength counts a lone surrogate as one byte.
    const encoder = new TextEncoder();
    expect(markers.map((m) => m!.bytes)).toEqual(sections.map((s) => encoder.encode(s).length));
    // Lines are measured in UTF-16 units, as the budget and the client are.
    expect(markers.map((m) => m!.longestLine)).toEqual([100, 100, 200, 100]);
    expect(out.split(small).length - 1).toBe(4);
  });

  test("a diff with nothing to cap is the same string, on every path", () => {
    const diff = small + small.replaceAll("src/a.ts", "src/b.ts") + "diff --git a/x b/x\nBinary files a/x and b/x differ\n";
    expect(capDiff(diff)).toBe(diff);
    expect(capDiff(diff, { maxFileBytes: 10_000, maxLineChars: 10, maxTotalBytes: 10_000 })).toBe(diff);
    expect(capDiff("no trailing newline")).toBe("no trailing newline");
    expect(capDiff("\n\n")).toBe("\n\n");
  });

  test("past the total budget every later section with hunks is capped, in order", () => {
    const sections = Array.from({ length: 5 }, (_, i) =>
      small.replaceAll("src/a.ts", `src/f${i}.ts`).replace("+TWO", "+" + "t".repeat(400)),
    );
    const binary = "diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n";
    const diff = sections.slice(0, 3).join("") + binary + sections.slice(3).join("");
    const size = sections[0]!.length;
    // Each section is well within the file budget. The first two stay under
    // the total, the second crosses it and is kept whole, and every section
    // with hunks after it is capped; the binary one has none and passes.
    const out = capDiff(diff, { maxTotalBytes: size + 1 });
    expect(out.startsWith(sections[0]! + sections[1]!)).toBe(true);
    const rest = out.slice(2 * size);
    expect(rest).toBe(
      [2, "binary", 3, 4]
        .map((i) =>
          i === "binary"
            ? binary
            : [
                `diff --git a/src/f${i}.ts b/src/f${i}.ts`,
                "index 1111111..2222222 100644",
                `--- a/src/f${i}.ts`,
                `+++ b/src/f${i}.ts`,
                formatOversizedMarker({ bytes: size, additions: 1, deletions: 1, longestLine: 400 }),
                "",
              ].join("\n"),
        )
        .join(""),
    );
    // The parser reads them as oversized files with their counts, in order.
    const files = parseDiff(out);
    expect(files.map((f) => f.newPath)).toEqual(["src/f0.ts", "src/f1.ts", "src/f2.ts", "img.png", "src/f3.ts", "src/f4.ts"]);
    expect(files.map((f) => Boolean(f.oversized))).toEqual([false, false, true, false, true, true]);
  });

  test("a mixed diff caps only the big file and leaves its neighbours byte-identical", () => {
    const after = small.replaceAll("src/a.ts", "src/c.ts");
    const diff = small + singleLine("street-sides.geojson", 30_000) + after;
    const out = capDiff(diff);
    expect(out.startsWith(small)).toBe(true);
    expect(out.endsWith(after)).toBe(true);
    expect(out.length).toBeLessThan(small.length + after.length + 500);
  });

  test("a quoted path header survives", () => {
    const header = 'diff --git "a/sub dir/\\342\\200\\224.json" "b/sub dir/\\342\\200\\224.json"';
    const section = singleLine("x", 30_000, header)
      .replace("--- a/x", '--- "a/sub dir/\\342\\200\\224.json"')
      .replace("+++ b/x", '+++ "b/sub dir/\\342\\200\\224.json"');
    const out = capDiff(section);
    expect(out.startsWith(header + "\n")).toBe(true);
    const [file] = parseDiff(out);
    expect(file!.newPath).toBe("sub dir/—.json");
    expect(file!.oversized).toBeDefined();
  });

  test("a binary section is untouched", () => {
    const binary = [
      "diff --git a/img.png b/img.png",
      "index 7777777..8888888 100644",
      "Binary files a/img.png and b/img.png differ",
      "",
    ].join("\n");
    const diff = binary + singleLine("big.json", 30_000);
    const out = capDiff(diff, { maxFileBytes: 10, maxLineChars: MAX_DIFF_LINE_CHARS });
    expect(out.startsWith(binary)).toBe(true);
  });

  test("the capped output parses into a file with no hunks, its counts and the flag", () => {
    const section = singleLine("data/los-angeles/street-sides.geojson", 30_000);
    const files = parseDiff(capDiff(small + section));
    expect(files).toHaveLength(2);
    expect(files[0]!.hunks).toHaveLength(1);
    expect(files[0]!.oversized).toBeUndefined();

    const big = files[1]!;
    expect(big.newPath).toBe("data/los-angeles/street-sides.geojson");
    expect(big.status).toBe("modified");
    expect(big.hunks).toHaveLength(0);
    expect(big.additions).toBe(1);
    expect(big.deletions).toBe(1);
    expect(big.oversized).toEqual({ bytes: section.length, longestLine: 30_000 });
  });

  // A plain `git diff` mid-conflict prints the conflicted file under
  // `diff --cc`. Missing that boundary folded the conflict into the file
  // before it, so a large conflict capped its small neighbour.
  test("a combined-diff header starts its own section", () => {
    const small = [
      "diff --git a/small.txt b/small.txt",
      "index 1111111..2222222 100644",
      "--- a/small.txt",
      "+++ b/small.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const conflict = [
      "diff --cc big.txt",
      "index 3333333,4444444..0000000",
      "--- a/big.txt",
      "+++ b/big.txt",
      "@@@ -1,1 -1,1 +1,1 @@@",
      "++" + "x".repeat(MAX_DIFF_LINE_CHARS + 10),
      "",
    ].join("\n");

    const out = capDiff(small + conflict);

    expect(out.startsWith(small)).toBe(true);
    expect(out.slice(small.length)).toContain("Oversized diff omitted:");
    expect(out.slice(small.length).startsWith("diff --cc big.txt\n")).toBe(true);
  });
});
