import { test, expect, describe } from "bun:test";
import { delimiterForPath, parseDelimited, rowForLine, type Delimiter } from "./delimited";

const rowsOf = (text: string, d: Delimiter) => parseDelimited(text, d).rows;

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
    expect(rowsOf("a,b,c\n1,2,3", ",")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  test("a trailing line break adds no empty row", () => {
    expect(rowsOf("a,b\n1,2\n", ",")).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("CRLF and lone CR end rows", () => {
    expect(rowsOf("a,b\r\n1,2\r\n", ",")).toEqual([["a", "b"], ["1", "2"]]);
    expect(rowsOf("a\rb", ",")).toEqual([["a"], ["b"]]);
  });

  test("a leading BOM is dropped", () => {
    expect(rowsOf("﻿name,age\nx,1", ",")[0]).toEqual(["name", "age"]);
  });

  test("empty text is no rows", () => {
    expect(rowsOf("", ",")).toEqual([]);
    expect(rowsOf("﻿", ",")).toEqual([]);
  });

  test("empty fields, including a trailing one", () => {
    expect(rowsOf(",a,,\n", ",")).toEqual([["", "a", "", ""]]);
  });

  test("blank lines are rows of one empty field", () => {
    expect(rowsOf("a\n\nb", ",")).toEqual([["a"], [""], ["b"]]);
  });

  test("quoted fields hold delimiters, doubled quotes and line breaks", () => {
    const text = 'id,note\n1,"hello, world"\n2,"say ""hi"""\n3,"two\r\nlines"\n';
    expect(rowsOf(text, ",")).toEqual([
      ["id", "note"],
      ["1", "hello, world"],
      ["2", 'say "hi"'],
      ["3", "two\r\nlines"],
    ]);
  });

  test("a quote mid-field is literal", () => {
    expect(rowsOf('5" pipe,x', ",")).toEqual([['5" pipe', "x"]]);
  });

  test("text after a closing quote is kept", () => {
    expect(rowsOf('"a"b,c', ",")).toEqual([["ab", "c"]]);
  });

  test("an unterminated quote runs to the end", () => {
    expect(rowsOf('a,"b\nc', ",")).toEqual([["a", "b\nc"]]);
  });

  test("an empty quoted field", () => {
    expect(rowsOf('"",x', ",")).toEqual([["", "x"]]);
  });

  test("tabs split TSV and commas stay in the field", () => {
    expect(rowsOf("a\tb\n1,5\t2", "\t")).toEqual([["a", "b"], ["1,5", "2"]]);
  });

  test("ragged rows are returned as-is", () => {
    expect(rowsOf("a,b,c\n1\n1,2,3,4", ",")).toEqual([["a", "b", "c"], ["1"], ["1", "2", "3", "4"]]);
  });
});

describe("row source lines", () => {
  test("one line per row", () => {
    expect(parseDelimited("a\nb\r\nc\n", ",").rowLines).toEqual([1, 2, 3]);
  });

  test("a quoted line break pushes later rows down", () => {
    // line 1: h | line 2-4: "x\ny\nz" | line 5: next
    expect(parseDelimited('h\n"x\ny\r\nz",1\nnext', ",").rowLines).toEqual([1, 2, 5]);
  });

  test("a lone CR ends a row without starting a line", () => {
    expect(parseDelimited("a\rb\nc", ",").rowLines).toEqual([1, 1, 2]);
  });

  test("rowForLine finds the row a line falls in", () => {
    const lines = [1, 2, 5];
    expect(rowForLine(lines, 1)).toBe(0);
    expect(rowForLine(lines, 3)).toBe(1);
    expect(rowForLine(lines, 5)).toBe(2);
    expect(rowForLine(lines, 99)).toBe(2);
    expect(rowForLine([], 1)).toBe(-1);
  });
});
