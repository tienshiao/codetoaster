import { test, expect, describe } from "bun:test";
import { applyMention, findMention, isAbsoluteQuery } from "./mention";

/**
 * The token arithmetic behind the composer's `@` completion (TASK-100).
 *
 * All of it is a string and a caret, which is why it lives apart from the hook
 * that fetches and the component that draws: these are the cases that decide
 * whether a list opens at all, and none of them need a DOM to ask.
 */

/** `findMention` with the caret written into the text as `|`. */
function at(marked: string) {
  const caret = marked.indexOf("|");
  return findMention(marked.replace("|", ""), caret);
}

describe("findMention", () => {
  test("an @ at the start of the text is a mention", () => {
    expect(at("@src|")).toEqual({ start: 0, end: 4, query: "src" });
  });

  test("an @ after whitespace is a mention", () => {
    expect(at("look at @src|")).toEqual({ start: 8, end: 12, query: "src" });
  });

  test("an @ after a newline is one too", () => {
    expect(at("look at\n@src|")).toEqual({ start: 8, end: 12, query: "src" });
  });

  test("the bare @ is a mention with nothing typed yet", () => {
    expect(at("@|")).toEqual({ start: 0, end: 1, query: "" });
  });

  test("an @ inside a word is not a mention", () => {
    // The address case, which is the whole reason for the word-start rule.
    expect(at("mail me at tma@example.com|")).toBeNull();
    expect(at("a@b|")).toBeNull();
  });

  test("a caret past the end of the token is not inside it", () => {
    expect(at("@src done|")).toBeNull();
    // Nor is one before the @ at all.
    expect(at("|@src")).toBeNull();
  });

  test("a caret in the middle of a token queries only the prefix", () => {
    // `end` still runs to the end of the token, so accepting replaces the whole
    // path rather than leaving "er.ts" behind the insert.
    expect(at("@src/pars|er.ts")).toEqual({ start: 0, end: 14, query: "src/pars" });
  });

  test("a token with a mention after it belongs to the caret's own @", () => {
    expect(at("@one @tw|o three")).toEqual({ start: 5, end: 9, query: "tw" });
  });

  test("a caret clamped to the text is still answered", () => {
    expect(findMention("@src", 99)).toEqual({ start: 0, end: 4, query: "src" });
  });
});

describe("isAbsoluteQuery", () => {
  test("/ and ~ name the filesystem; anything else names the project", () => {
    expect(isAbsoluteQuery("/Users")).toBe(true);
    expect(isAbsoluteQuery("~/Projects")).toBe(true);
    expect(isAbsoluteQuery("~")).toBe(true);
    expect(isAbsoluteQuery("src/app")).toBe(false);
    expect(isAbsoluteQuery("")).toBe(false);
  });
});

describe("applyMention", () => {
  test("a file ends the token with a space, and the caret follows it", () => {
    const mention = findMention("look at @par", 12)!;
    const result = applyMention("look at @par", mention, "src/parser.ts", "file");

    expect(result.text).toBe("look at @src/parser.ts ");
    expect(result.caret).toBe(result.text.length);
    expect(result.text[result.caret - 1]).toBe(" ");
  });

  test("a directory ends with a slash, which is what re-queries inside it", () => {
    const mention = findMention("@src", 4)!;
    const result = applyMention("@src", mention, "~/Projects", "directory");

    expect(result.text).toBe("@~/Projects/");
    expect(result.caret).toBe(12);
  });

  test("accepting from the middle replaces the whole token, not the prefix", () => {
    const text = "see @src/pars er.ts";
    const mention = findMention(text, 13)!;
    const result = applyMention(text, mention, "src/parser.ts", "file");

    expect(result.text).toBe("see @src/parser.ts  er.ts");
    // Just past the inserted space, with the rest of the line untouched.
    expect(result.caret).toBe(19);
  });

  test("the text after the token survives the insert", () => {
    const text = "@src and more";
    const mention = findMention(text, 4)!;
    const result = applyMention(text, mention, "src/app.tsx", "file");

    // The token's own space, then whatever followed it: the insert replaces the
    // token and nothing around it, so a mention finished mid-sentence keeps the
    // separator that was already there.
    expect(result.text).toBe("@src/app.tsx  and more");
    expect(result.caret).toBe(13);
  });
});
