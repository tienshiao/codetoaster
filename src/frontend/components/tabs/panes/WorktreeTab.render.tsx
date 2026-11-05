import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { tabKey, type TabDescriptor, type TabState } from "@/frontend/layout-store";
import { rootApi, taskRoot, worktreeRoot } from "@/frontend/repo-root";
import type { WorktreeInfo } from "@/frontend/hooks/use-worktrees";

/**
 * A working-tree tab on another worktree (TASK-138.2): it reads through that
 * worktree's root, says which worktree it is, and says so plainly when the
 * worktree has gone rather than showing the route's 404.
 *
 * Mounted through `TabPane`, because that is where a descriptor's worktree
 * becomes a root; the fetch is stubbed per root so the content on screen is
 * the proof of which checkout was read.
 */

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({ tasks: [], taskById: () => undefined, resumeTask: vi.fn() }),
}));
vi.mock("@/frontend/PtyContext", () => ({
  usePty: () => ({ attach: vi.fn(), detach: vi.fn(), resize: vi.fn(), send: vi.fn(), isConnected: true }),
}));
vi.mock("@/frontend/hooks/use-profiles", () => ({ useProfiles: () => ({ data: undefined }) }));
vi.mock("@/frontend/components/SymbolPopover", () => ({ SymbolPopover: () => null }));

const { TabPane } = await import("./TabPane");

const TASK = "wt-tab-task";
const SIDE = "/repo/.claude/worktrees/agent-a";
const OTHER = "/repo/.claude/worktrees/agent-b";

let worktrees: WorktreeInfo[] = [];
let requests: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const content = (text: string) => ({
  isBinary: false,
  isImage: false,
  lines: [{ lineNum: 1, content: text }],
  totalLines: 1,
});

beforeEach(() => {
  worktrees = [
    { path: "/repo", branch: "main", head: "a".repeat(40), current: true },
    { path: SIDE, branch: "feature/side", head: "b".repeat(40), current: false },
  ];
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      requests.push(url);
      const path = url.split("?")[0]!;
      if (path === `/api/tasks/${TASK}/worktrees`) return json({ worktrees });
      if (path.endsWith("/file")) {
        if (path.startsWith(rootApi(worktreeRoot(taskRoot(TASK), SIDE)))) return json(content("from the side worktree"));
        if (path.startsWith("/api/worktrees/")) return json({ error: "Worktree not found" }, 404);
        return json(content("from the task's checkout"));
      }
      if (path.endsWith("/diff")) return json({ diff: "", hash: "h0" });
      if (path.endsWith("/files")) return json({ directory: "/x", files: [] });
      if (path.endsWith("/backlog")) return json({ detected: false });
      return json({ error: "not stubbed" }, 404);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function tab(descriptor: TabDescriptor): TabState {
  return { id: `tab-${tabKey(descriptor)}`, descriptor, key: tabKey(descriptor), preview: false };
}

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function Pane({ descriptor }: { descriptor: TabDescriptor }) {
  return (
    <TabPane root={taskRoot(TASK)} tab={tab(descriptor)} onOpenTab={vi.fn()} onSubmitReview={() => true} visible />
  );
}

test("a file tab on a worktree reads that worktree and names it", async () => {
  mount(<Pane descriptor={{ kind: "file", path: "README.md", worktree: SIDE }} />);
  expect(await screen.findByText("from the side worktree")).toBeTruthy();
  const sidePrefix = rootApi(worktreeRoot(taskRoot(TASK), SIDE));
  expect(requests).toContain(`${sidePrefix}/file?file=README.md`);
  expect(requests.some((r) => r.startsWith(`/api/tasks/${TASK}/file`))).toBe(false);
  // The line above the pane: the branch, and the directory.
  const line = screen.getByTitle(SIDE);
  await waitFor(() => expect(within(line).getByText("feature/side")).toBeTruthy());
  expect(within(line).getByText("agent-a")).toBeTruthy();
});

test("the same path on the task's checkout and on a worktree are two tabs reading two trees", async () => {
  const own: TabDescriptor = { kind: "file", path: "README.md" };
  const side: TabDescriptor = { kind: "file", path: "README.md", worktree: SIDE };
  expect(tabKey(own)).not.toBe(tabKey(side));
  mount(
    <>
      <Pane key={tabKey(own)} descriptor={own} />
      <Pane key={tabKey(side)} descriptor={side} />
    </>,
  );
  expect(await screen.findByText("from the task's checkout")).toBeTruthy();
  expect(await screen.findByText("from the side worktree")).toBeTruthy();
});

test("a tab whose worktree is gone says so instead of the route's error", async () => {
  mount(<Pane descriptor={{ kind: "file", path: "README.md", worktree: OTHER }} />);
  expect(await screen.findByText("This worktree no longer exists.")).toBeTruthy();
  expect(screen.queryByText("Worktree not found")).toBeNull();
});

test("a diff tab on a worktree that is gone says so too", async () => {
  mount(<Pane descriptor={{ kind: "diff", path: "README.md", worktree: OTHER }} />);
  expect(await screen.findByText("This worktree no longer exists.")).toBeTruthy();
});

test("a tab on the task's own checkout asks nothing about worktrees", async () => {
  mount(<Pane descriptor={{ kind: "file", path: "README.md" }} />);
  expect(await screen.findByText("from the task's checkout")).toBeTruthy();
  await waitFor(() => expect(requests.length).toBeGreaterThan(0));
  expect(requests.some((r) => r.endsWith("/worktrees"))).toBe(false);
  expect(screen.queryByTitle(SIDE)).toBeNull();
});
