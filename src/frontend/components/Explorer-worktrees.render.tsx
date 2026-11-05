import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ExplorerSection } from "@/frontend/explorer-store";
import type { TabDescriptor } from "@/frontend/layout-store";
import { rootApi, rootId, taskRoot, worktreeRoot, type RepoRoot } from "@/frontend/repo-root";
import { getViewState, resetViewStates, setViewField, viewRef } from "@/frontend/view-state-store";
import type { WorktreeInfo } from "@/frontend/hooks/use-worktrees";
import { chooseOption, selectValue } from "../../../test/v2-select";
import { Explorer, useExplorerRail } from "./Explorer";

/**
 * The Explorer's worktree picker (TASK-138.2): when it shows, what choosing a
 * worktree points the sections at, and what becomes of a choice whose
 * worktree has gone.
 *
 * A stubbed `fetch` answering per root, so the URL a section asks for — the
 * task's prefix or a worktree token's — is the claim, and the listing it gets
 * back is the proof it was asked of the right checkout.
 */

const OWN = "/repo";
const SIDE = "/repo/.claude/worktrees/agent-a";

const OWN_ENTRY: WorktreeInfo = { path: OWN, branch: "main", head: "a".repeat(40), current: true };
const SIDE_ENTRY: WorktreeInfo = { path: SIDE, branch: "agent-a", head: "b".repeat(40), current: false };

let worktrees: WorktreeInfo[] = [];
let requests: string[] = [];

/** The worktree's prefix, through the module's own builder: the assertion is
 * about which root was asked for, not about the token's bytes. */
const sideApi = (task: string) => rootApi(worktreeRoot(taskRoot(task), SIDE));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function files(...paths: string[]) {
  return {
    directory: "/x",
    files: paths.map((path) => ({ path, name: path, isDirectory: false, depth: 0 })),
  };
}

beforeEach(() => {
  worktrees = [OWN_ENTRY, SIDE_ENTRY];
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      requests.push(url);
      const path = url.split("?")[0]!;
      const onWorktree = path.startsWith("/api/worktrees/");
      if (path.endsWith("/worktrees") && !onWorktree) return json({ worktrees });
      if (path.endsWith("/files")) return json(onWorktree ? files("side-only.ts") : files("own-only.ts"));
      if (path.endsWith("/diff")) return json({ diff: "", hash: "h0" });
      if (path.endsWith("/backlog")) return json({ detected: false });
      return json({ error: "not stubbed" }, 404);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function mount(node: ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...render(node, { wrapper }) };
}

function FilesOf({
  task,
  onOpenTab = vi.fn(),
  section = "Files",
}: {
  task: string;
  onOpenTab?: (d: TabDescriptor) => void;
  section?: ExplorerSection;
}) {
  return (
    <Explorer
      root={taskRoot(task)}
      placeholder=""
      section={section}
      backlogTab="Open"
      onBacklogTabChange={vi.fn()}
      onOpenTab={onOpenTab}
    />
  );
}

test("with one worktree there is no picker", async () => {
  worktrees = [OWN_ENTRY];
  mount(<FilesOf task="wt-one" />);
  await screen.findByText("own-only.ts");
  await waitFor(() => expect(requests).toContain("/api/tasks/wt-one/worktrees"));
  expect(screen.queryByRole("combobox", { name: "Worktree" })).toBeNull();
});

test("a repository with several worktrees offers them, the task's own checkout marked and chosen", async () => {
  mount(<FilesOf task="wt-list" />);
  await screen.findByRole("combobox", { name: "Worktree" });
  expect(selectValue("Worktree")).toBe("main · repo (this task)");
  // The sections read the task's checkout until something else is chosen.
  expect(await screen.findByText("own-only.ts")).toBeTruthy();
  resetViewStates("wt-list");
});

test("choosing a worktree points the section at it, and the tabs it opens carry it", async () => {
  const onOpenTab = vi.fn();
  mount(<FilesOf task="wt-choose" onOpenTab={onOpenTab} />);
  await screen.findByRole("combobox", { name: "Worktree" });

  chooseOption("Worktree", "agent-a · agent-a");
  expect(await screen.findByText("side-only.ts")).toBeTruthy();
  expect(requests).toContain(`${sideApi("wt-choose")}/files`);
  expect(getViewState("explorer", viewRef("wt-choose", "explorer")).worktree).toBe(SIDE);

  fireEvent.click(screen.getByText("side-only.ts"));
  expect(onOpenTab).toHaveBeenCalledWith({ kind: "file", path: "side-only.ts", worktree: SIDE }, { preview: true });

  // And back.
  chooseOption("Worktree", /this task/);
  expect(await screen.findByText("own-only.ts")).toBeTruthy();
  expect(getViewState("explorer", viewRef("wt-choose", "explorer")).worktree).toBeNull();
  resetViewStates("wt-choose");
});

test("the choice survives the Explorer being remounted", async () => {
  const first = mount(<FilesOf task="wt-remount" />);
  await screen.findByRole("combobox", { name: "Worktree" });
  chooseOption("Worktree", "agent-a · agent-a");
  await screen.findByText("side-only.ts");
  first.unmount();

  requests = [];
  mount(<FilesOf task="wt-remount" />, first.client);
  expect(await screen.findByText("side-only.ts")).toBeTruthy();
  expect(selectValue("Worktree")).toBe("agent-a · agent-a");
  expect(requests.some((r) => r.startsWith("/api/tasks/wt-remount/files"))).toBe(false);
  resetViewStates("wt-remount");
});

test("a chosen worktree that has gone falls back to the task's checkout, and the choice is cleared", async () => {
  setViewField("explorer", viewRef("wt-gone", "explorer"), "worktree", "/repo/.claude/worktrees/removed");
  mount(<FilesOf task="wt-gone" />);
  expect(await screen.findByText("own-only.ts")).toBeTruthy();
  await waitFor(() =>
    expect(getViewState("explorer", viewRef("wt-gone", "explorer")).worktree).toBeNull(),
  );
  expect(selectValue("Worktree")).toBe("main · repo (this task)");
  resetViewStates("wt-gone");
});

test("a worktree removed while chosen drops out of the list, and the sections go back", async () => {
  const { client } = mount(<FilesOf task="wt-drop" />);
  await screen.findByRole("combobox", { name: "Worktree" });
  chooseOption("Worktree", "agent-a · agent-a");
  await screen.findByText("side-only.ts");

  worktrees = [OWN_ENTRY];
  await client.invalidateQueries();
  expect(await screen.findByText("own-only.ts")).toBeTruthy();
  // One checkout left: nothing to pick.
  await waitFor(() => expect(screen.queryByRole("combobox", { name: "Worktree" })).toBeNull());
  resetViewStates("wt-drop");
});

test("Processes reads the task whatever worktree is chosen, and shows no picker", async () => {
  setViewField("explorer", viewRef("wt-proc", "explorer"), "worktree", SIDE);
  mount(<FilesOf task="wt-proc" section="Processes" />);
  await waitFor(() => expect(requests).toContain("/api/tasks/wt-proc/processes"));
  expect(requests.some((r) => r.startsWith("/api/worktrees/"))).toBe(false);
  expect(screen.queryByRole("combobox", { name: "Worktree" })).toBeNull();
  resetViewStates("wt-proc");
});

// ── the rail ────────────────────────────────────────────────────────────────

function Rail({ root, section }: { root: RepoRoot; section?: ExplorerSection }) {
  const items = useExplorerRail(root, section);
  return <div data-testid="rail">{items.map((i) => i.label).join(",")}</div>;
}

test("a worktree of a task always offers Changes and keeps the task's Processes", async () => {
  const root = worktreeRoot(taskRoot("wt-rail"), SIDE);
  mount(<Rail root={root} section="Files" />);
  await waitFor(() => expect(requests).toContain(`${rootApi(root)}/diff`));
  await waitFor(() =>
    expect(screen.getByTestId("rail").textContent).toBe("Changes,Files,History,Refs,Processes"),
  );
  expect(rootId(root)).not.toBe("wt-rail");
});
