import { test, expect, afterEach } from "bun:test";
import { fetchFileSearch } from "./use-file-search";
import { projectRoot, taskRoot } from "../repo-root";

/**
 * The fetch behind `useFileSearch`: which URL a root asks, and what the
 * composer's `quietRefusals` does with a route that refuses the root.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(status: number, body: unknown = {}) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return urls;
}

test("a project root asks the project's route, and a task root the task's", async () => {
  const urls = answer(200, { results: [] });
  await fetchFileSearch(projectRoot("web"), "a b");
  await fetchFileSearch(taskRoot("t1"), "x");
  expect(urls).toEqual(["/api/projects/web/files/search?q=a%20b", "/api/tasks/t1/files/search?q=x"]);
});

test("with quietRefusals a 400 or 404 is no results, not an error", async () => {
  answer(404, { error: "no such project" });
  expect(await fetchFileSearch(projectRoot("gone"), "a", { quietRefusals: true })).toEqual({
    results: [],
  });
  answer(400, { error: "no directory" });
  expect(await fetchFileSearch(projectRoot("general"), "a", { quietRefusals: true })).toEqual({
    results: [],
  });
});

test("any other failure still throws, quiet or not", async () => {
  answer(500, { error: "boom" });
  await expect(fetchFileSearch(projectRoot("web"), "a", { quietRefusals: true })).rejects.toThrow("boom");
  answer(404, { error: "no such task" });
  await expect(fetchFileSearch(taskRoot("t1"), "a")).rejects.toThrow("no such task");
});
