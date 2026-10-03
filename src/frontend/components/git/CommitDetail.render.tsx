import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { chooseOption, openSelect, selectValue } from "../../../../test/v2-select";
import { gitKeys } from "@/frontend/query-keys";
import { rootId, taskRoot } from "@/frontend/repo-root";
import { getViewState, resetViewStates, setViewField, viewRef } from "@/frontend/view-state-store";
import type { FileDiff } from "@/frontend/types/diff";
import type { GitRefsResponse, GitViewMode } from "@/frontend/types/git";
import { CommitDetail } from "./CommitDetail";

/**
 * What a commit's Changes diff is relative to (TASK-128).
 *
 * The diff itself is `DiffLayout`'s and the merge base is the server's
 * (`commit-base.test.ts`); this is the part between them — which base is asked
 * for, when, and where the answer's old side is handed on to.
 */

const SHA = "a".repeat(40);
const PARENT = "b".repeat(40);
const V2 = "c".repeat(40);
const V2_MOVED = "d".repeat(40);
const FORK = "e".repeat(40);
const TASK = "t-commit-detail";
const ROOT = taskRoot(TASK);
const VIEW = viewRef(TASK, `commit:${SHA}`);

const REFS: GitRefsResponse = {
  head: { ref: "feature", sha: SHA },
  branches: [
    { name: "feature", sha: SHA },
    { name: "v2", sha: V2 },
  ],
  remotes: [{ name: "origin/main", sha: PARENT }],
  tags: [{ name: "v1.0", sha: PARENT }],
  hash: "refs-1",
};

function diffOf(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
}

const layout = vi.hoisted(() => ({ props: vi.fn() }));

vi.mock("../diff/DiffLayout", () => ({
  DiffLayout: (props: { files: FileDiff[]; imageRefs?: { old: string; new: string } }) => {
    layout.props(props);
    return <div data-testid="layout">{props.files.map((f) => f.newPath).join(",")}</div>;
  },
}));
vi.mock("./CommitTree", () => ({ CommitTree: () => <div data-testid="tree" /> }));

let refs: GitRefsResponse = REFS;
/** Bases whose diff is empty: the commit is already in them. */
let emptyAgainst = new Set<string>();
let commitRequests: string[] = [];
let tokenBodies: { sha?: string; base?: string }[] = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  refs = REFS;
  emptyAgainst = new Set();
  commitRequests = [];
  tokenBodies = [];
  layout.props.mockReset();
  resetViewStates(TASK);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/git/refs")) return json(refs);
      if (url.pathname.endsWith("/diff-tokens")) {
        tokenBodies.push(JSON.parse(String(init?.body)));
        return json({ files: {} });
      }
      if (url.pathname.endsWith("/git/commit")) {
        commitRequests.push(url.search);
        const base = url.searchParams.get("base");
        const diff = base === null ? diffOf("tip.ts") : emptyAgainst.has(base) ? "" : diffOf("tip.ts") + diffOf("earlier.ts");
        return json({
          meta: {
            hash: SHA,
            parents: [PARENT],
            author: "Ada",
            email: "ada@example.com",
            authoredAt: 1,
            committer: "Ada",
            committedAt: 1,
            refs: [],
            message: "tip",
          },
          diff,
          hash: `diff-${base ?? "parent"}`,
          diffBase: base === null ? PARENT : FORK,
        });
      }
      return new Response(JSON.stringify({ error: "not stubbed" }), { status: 404 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function mount(mode: GitViewMode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CommitDetail
        root={ROOT}
        view={VIEW}
        sha={SHA}
        mode={mode}
        onSelectMode={() => {}}
        onSelectCommit={() => {}}
        file={undefined}
        onSelectFile={() => {}}
        refSets={{ branches: new Set(), remotes: new Set(), tags: new Set(), headBranch: null }}
      />
    </QueryClientProvider>,
  );
  return client;
}

const shownFiles = () => screen.getByTestId("layout").textContent;
/** The selector is disabled until the refs it lists have loaded. */
const refsLoaded = () =>
  waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("combobox", { name: "Relative to" }).disabled).toBe(false),
  );
const lastLayout = () => layout.props.mock.calls.at(-1)![0] as { imageRefs: { old: string; new: string } };

test("the selector belongs to Changes: Commit and File Tree do not draw it", async () => {
  mount("commit");
  await screen.findByText("1 file changed");
  expect(screen.queryByRole("combobox", { name: "Relative to" })).toBeNull();
});

test("File Tree does not draw it either", async () => {
  mount("tree");
  await screen.findByTestId("tree");
  expect(screen.queryByRole("combobox", { name: "Relative to" })).toBeNull();
});

test("Changes starts relative to the parent, and offers every ref", async () => {
  mount("changes");
  await waitFor(() => expect(shownFiles()).toBe("tip.ts"));
  expect(selectValue("Relative to")).toBe("Parent commit");
  expect(commitRequests).toEqual([`?sha=${SHA}`]);
  expect(lastLayout().imageRefs).toEqual({ old: PARENT, new: SHA });

  await refsLoaded();
  openSelect("Relative to");
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Parent commit",
    "feature",
    "v2",
    "origin/mainremote",
    "v1.0tag",
  ]);
});

test("choosing a ref asks for the diff against it, and reads the old side from the merge base", async () => {
  mount("changes");
  await refsLoaded();
  setViewField("commit", VIEW, "changesScrollTop", 400);
  chooseOption("Relative to", "v2");

  await waitFor(() => expect(shownFiles()).toBe("earlier.ts,tip.ts"));
  expect(selectValue("Relative to")).toBe("v2");
  expect(commitRequests.at(-1)).toBe(`?sha=${SHA}&base=${V2}`);
  expect(getViewState("commit", VIEW).changesBase).toBe("branch:v2");
  // A different diff: the old one's offset means nothing in it.
  expect(getViewState("commit", VIEW).changesScrollTop).toBe(0);
  // The old side is the merge base the server named, not the ref's own tip.
  expect(lastLayout().imageRefs).toEqual({ old: FORK, new: SHA });
  await waitFor(() => expect(tokenBodies.at(-1)).toMatchObject({ sha: SHA, base: FORK }));

  chooseOption("Relative to", "Parent commit");
  await waitFor(() => expect(shownFiles()).toBe("tip.ts"));
  expect(getViewState("commit", VIEW).changesBase).toBeNull();
});

test("a stored choice is restored without the parent's diff being fetched first", async () => {
  setViewField("commit", VIEW, "changesBase", "branch:v2");
  mount("changes");
  await waitFor(() => expect(shownFiles()).toBe("earlier.ts,tip.ts"));
  expect(selectValue("Relative to")).toBe("v2");
  expect(commitRequests).toEqual([`?sha=${SHA}&base=${V2}`]);
});

test("the diff follows the ref when it moves", async () => {
  setViewField("commit", VIEW, "changesBase", "branch:v2");
  const client = mount("changes");
  await waitFor(() => expect(commitRequests).toEqual([`?sha=${SHA}&base=${V2}`]));

  act(() => {
    client.setQueryData(gitKeys.refs(rootId(ROOT)), {
      ...REFS,
      branches: [REFS.branches[0]!, { name: "v2", sha: V2_MOVED }],
    });
  });
  await waitFor(() => expect(commitRequests.at(-1)).toBe(`?sha=${SHA}&base=${V2_MOVED}`));
});

test("a chosen ref that is gone reads as the parent again, and is not forgotten", async () => {
  setViewField("commit", VIEW, "changesBase", "branch:deleted");
  mount("changes");
  await waitFor(() => expect(shownFiles()).toBe("tip.ts"));
  expect(selectValue("Relative to")).toBe("Parent commit");
  expect(commitRequests).toEqual([`?sha=${SHA}`]);
  expect(getViewState("commit", VIEW).changesBase).toBe("branch:deleted");
});

test("Commit mode is the commit's own diff, whatever Changes is relative to", async () => {
  setViewField("commit", VIEW, "changesBase", "branch:v2");
  mount("commit");
  await screen.findByText("1 file changed");
  expect(commitRequests).toEqual([`?sha=${SHA}`]);
});

test("nothing changed relative to the ref says so, and the selector stays", async () => {
  emptyAgainst = new Set([V2]);
  setViewField("commit", VIEW, "changesBase", "branch:v2");
  mount("changes");
  await screen.findByText("No changes relative to v2");
  expect(selectValue("Relative to")).toBe("v2");
});
