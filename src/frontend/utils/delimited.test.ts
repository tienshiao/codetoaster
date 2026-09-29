import { test, expect, describe } from "bun:test";
import { delimiterForPath, parseDelimited } from "./delimited";

describe("delimiterForPath", () => {
  test("by extension, case-insensitively", () => {
    expect(delimiterForPath("data/people.csv")).toBe(",");
    expect(delimiterForPath("OUT.CSV")).toBe(",");
    expect(delimiterForPath("x.tsv")).toBe("\t");
    expect(delimiterForPath("x.tab")).toBe("\t");
  });

  test("anything else is not a table", () => {
    expect(delimiterForPath("notes.md")).toBeNull();
    expect(delimiterForPath("csv")).toBeNull();
    expect(delimiterForPath("dir.csv/file.txt")).toBeNull();
  });
});

describe("parseDelimited", () => {
  test("plain rows", () => {
    expect(parseDelimited("a,b,c\n1,2,3", ",")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  test("a trailing line break adds no empty row", () => {
    expect(parseDelimited("a,b\n1,2\n", ",")).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("CRLF and lone CR end rows", () => {
    expect(parseDelimited("a,b\r\n1,2\r\n", ",")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseDelimited("a\rb", ",")).toEqual([["a"], ["b"]]);
  });

  test("a leading BOM is dropped", () => {
    expect(parseDelimited("﻿name,age\nx,1", ",")[0]).toEqual(["name", "age"]);
  });

  test("empty text is no rows", () => {
    expect(parseDelimited("", ",")).toEqual([]);
    expect(parseDelimited("﻿", ",")).toEqual([]);
  });

  test("empty fields, including a trailing one", () => {
    expect(parseDelimited(",a,,\n", ",")).toEqual([["", "a", "", ""]]);
  });

  test("blank lines are rows of one empty field", () => {
    expect(parseDelimited("a\n\nb", ",")).toEqual([["a"], [""], ["b"]]);
  });

  test("quoted fields hold delimiters, doubled quotes and line breaks", () => {
    const text = 'id,note\n1,"hello, world"\n2,"say ""hi"""\n3,"two\r\nlines"\n';
    expect(parseDelimited(text, ",")).toEqual([
      ["id", "note"],
      ["1", "hello, world"],
      ["2", 'say "hi"'],
      ["3", "two\r\nlines"],
    ]);
  });

  test("a quote mid-field is literal", () => {
    expect(parseDelimited('5" pipe,x', ",")).toEqual([['5" pipe', "x"]]);
  });

  test("text after a closing quote is kept", () => {
    expect(parseDelimited('"a"b,c', ",")).toEqual([["ab", "c"]]);
  });

  test("an unterminated quote runs to the end", () => {
    expect(parseDelimited('a,"b\nc', ",")).toEqual([["a", "b\nc"]]);
  });

  test("an empty quoted field", () => {
    expect(parseDelimited('"",x', ",")).toEqual([["", "x"]]);
  });

  test("tabs split TSV and commas stay in the field", () => {
    expect(parseDelimited("a\tb\n1,5\t2", "\t")).toEqual([["a", "b"], ["1,5", "2"]]);
  });

  test("ragged rows are returned as-is", () => {
    expect(parseDelimited("a,b,c\n1\n1,2,3,4", ",")).toEqual([["a", "b", "c"], ["1"], ["1", "2", "3", "4"]]);
  });
});
