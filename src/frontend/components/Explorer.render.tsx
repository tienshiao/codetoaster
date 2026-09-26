import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ExplorerSection } from "@/frontend/explorer-store";
import type { FilesResponse } from "@/frontend/types/file";
import { projectRoot, taskRoot, type RepoRoot } from "@/frontend/repo-root";
import { Explorer, useExplorerRail } from "./Explorer";

/**
 * The Explorer following the composer's project (TASK-106): which routes a
 * root reads, and what the panel shows with no root at all.
 *
 * A mounted tree with its queries and a stubbed `fetch`, so Vitest's, not
 * `bun test`'s (CLAUDE.md, "Testing"). The URL a section asks for is the whole
 * claim — that is where a project root and a task root differ.
 */

const FILES: FilesResponse = {
  directory: "/repo",
  files: [
    { path: "README.md", name: "README.md", isDirectory: false, depth: 0 },
    { path: "package.json", name: "package.json", isDirectory: false, depth: 0 },
  ],
};

const ONE_CHANGE = [
  "diff --git a/a.ts b/a.ts",
  "index 1111111..2222222 100644",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");

/** What `/diff` answers; empty is a clean tree. */
let diff = "";
let requests: string[] = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  diff = "";
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      requests.push(url);
      const path = url.split("?")[0]!;
      if (path.endsWith("/files")) return json(FILES);
      if (path.endsWith("/diff")) return json({ diff, hash: diff ? "h1" : "h0" });
      if (path.endsWith("/diff-tokens")) return json({ files: {} });
      if (path.endsWith("/backlog")) return json({ detected: false });
      return new Response(JSON.stringify({ error: "not stubbed" }), { status: 404 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(node, { wrapper });
}

function Files({ root }: { root: RepoRoot | null }) {
  return (
    <Explorer
      root={root}
      placeholder="Nothing to browse here."
      section="Files"
      backlogTab="Open"
      onBacklogTabChange={vi.fn()}
      onOpenTab={vi.fn()}
    />
  );
}

test("a project root reads the project's files", async () => {
  mount(<Files root={projectRoot("web")} />);
  await screen.findByText("README.md");
  expect(screen.getByText("package.json")).toBeTruthy();
  expect(requests).toContain("/api/projects/web/files");
});

test("with no root the placeholder shows and nothing is fetched", () => {
  mount(<Files root={null} />);
  expect(screen.getByText("Nothing to browse here.")).toBeTruthy();
  expect(requests).toEqual([]);
});

test("moving to another project reads that project instead", async () => {
  const view = mount(<Files root={projectRoot("web")} />);
  await screen.findByText("README.md");
  view.rerender(<Files root={projectRoot("api")} />);
  await waitFor(() => expect(requests).toContain("/api/projects/api/files"));
});

test("a task root reads the task's files, as it always did", async () => {
  mount(<Files root={taskRoot("t1")} />);
  await screen.findByText("README.md");
  expect(requests).toContain("/api/tasks/t1/files");
  expect(requests.some((r) => r.startsWith("/api/projects/"))).toBe(false);
});

// ── the rail ────────────────────────────────────────────────────────────────

function Rail({ root, section }: { root: RepoRoot | null; section?: ExplorerSection }) {
  const items = useExplorerRail(root, section);
  return <div data-testid="rail">{items.map((i) => i.label).join(",")}</div>;
}

test("a clean project offers no Changes item", async () => {
  mount(<Rail root={projectRoot("web")} section="Files" />);
  await waitFor(() => expect(requests).toContain("/api/projects/web/diff"));
  await waitFor(() =>
    expect(screen.getByTestId("rail").textContent).toBe("Files,History,Refs"),
  );
});

test("a project with changes offers Changes", async () => {
  diff = ONE_CHANGE;
  mount(<Rail root={projectRoot("web")} section="Files" />);
  await waitFor(() =>
    expect(screen.getByTestId("rail").textContent).toBe("Changes,Files,History,Refs"),
  );
});

test("an undecided project keeps Changes only while it is the section showing", () => {
  // Before the diff answers: kept for the section on screen, so the panel is
  // not left titled Changes with no rail item under it…
  mount(<Rail root={projectRoot("web")} section="Changes" />);
  expect(screen.getByTestId("rail").textContent).toContain("Changes");
});

test("an undecided project offers no Changes for any other section", () => {
  // …and not flashed onto a project that will turn out to be clean.
  mount(<Rail root={projectRoot("web")} section="Files" />);
  expect(screen.getByTestId("rail").textContent).toBe("Files,History,Refs");
});

test("a task always offers Changes, clean tree or not", async () => {
  mount(<Rail root={taskRoot("t1")} section="Files" />);
  await waitFor(() => expect(requests).toContain("/api/tasks/t1/diff"));
  // Settled on the empty diff and still there.
  await waitFor(() => expect(screen.getByTestId("rail").textContent).toContain("Changes"));
  expect(screen.getByTestId("rail").textContent).toBe("Changes,Files,History,Refs");
});
