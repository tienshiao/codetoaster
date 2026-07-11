import { test, expect } from "bun:test";
import { indexFileContent } from "./indexer";

test("indexes TypeScript definitions with correct 1-based lines", async () => {
  const src = [
    "export function greet(name: string) {", // 1
    "  return format(name);", //                 2
    "}", //                                       3
    "class Widget {", //                          4
    "  render() { return draw(); }", //           5
    "}", //                                       6
    "interface Options {}", //                    7
  ].join("\n");
  const entries = await indexFileContent("a.ts", src, "typescript");
  const defs = entries.filter((e) => e.kind === "definition");

  const greet = defs.find((e) => e.name === "greet");
  expect(greet?.symbolKind).toBe("function");
  expect(greet?.line).toBe(1);
  expect(defs.find((e) => e.name === "Widget")?.symbolKind).toBe("class");
  expect(defs.find((e) => e.name === "render")?.line).toBe(5);
  expect(defs.find((e) => e.name === "Options")?.symbolKind).toBe("interface");

  const refs = entries.filter((e) => e.kind === "reference").map((e) => e.name);
  expect(refs).toContain("format");
  expect(refs).toContain("draw");
});

test("indexes Python definitions and call references", async () => {
  const src = ["def foo():", "    return bar()", "class Baz:", "    def method(self):", "        pass"].join("\n");
  const entries = await indexFileContent("a.py", src, "python");
  const defs = entries.filter((e) => e.kind === "definition");
  expect(defs.find((e) => e.name === "foo")?.symbolKind).toBe("function");
  expect(defs.find((e) => e.name === "foo")?.line).toBe(1);
  expect(defs.find((e) => e.name === "Baz")?.symbolKind).toBe("class");
  expect(defs.find((e) => e.name === "method")?.line).toBe(4);
  expect(entries.some((e) => e.kind === "reference" && e.name === "bar")).toBe(true);
});

test("indexes Go definitions and references", async () => {
  const src = ["package main", "func Foo() int {", "  return Bar()", "}", "type T struct{}"].join("\n");
  const entries = await indexFileContent("a.go", src, "go");
  const defs = entries.filter((e) => e.kind === "definition");
  expect(defs.find((e) => e.name === "Foo")?.symbolKind).toBe("function");
  expect(defs.find((e) => e.name === "Foo")?.line).toBe(2);
  expect(defs.find((e) => e.name === "T")?.symbolKind).toBe("type");
  expect(entries.some((e) => e.kind === "reference" && e.name === "Bar")).toBe(true);
});

test("context is the trimmed source line", async () => {
  const entries = await indexFileContent("a.ts", "    function spaced() {}", "typescript");
  const def = entries.find((e) => e.name === "spaced");
  expect(def?.context).toBe("function spaced() {}");
});
