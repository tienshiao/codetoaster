import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { BacklogResponse } from "@/types/backlog";
import type { ExplorerSection } from "@/frontend/explorer-store";
import type { TabDescriptor } from "@/frontend/layout-store";
import { BacklogSection } from "./BacklogSection";
import { useExplorerRail } from "./Explorer";

/**
 * The Backlog section's grouping and its one gesture (TASK-85), plus the rail
 * item that exists only for a Backlog.md repository.
 *
 * All of it is what a mounted tree does with a fetched response — which order
 * the headers come out in, which tab a status lands on, what a card click opens
 * — so this is Vitest's, not `bun test`'s (CLAUDE.md, "Testing").
 */

const STATUSES = ["To Do", "In Progress", "Done"];

/** In the order the route hands them over: Backlog.md's board order, which the
 * section preserves within each status. */
const TASKS = [
  { id: "TASK-10", title: "first todo", status: "To Do" },
  { id: "TASK-11", title: "second todo", status: "To Do" },
  {
    id: "TASK-12",
    title: "in flight",
    status: "In Progress",
    priority: "high",
    labels: ["frontend", "ui"],
  },
  { id: "TASK-13", title: "shipped", status: "Done" },
  { id: "TASK-14", title: "archived", status: "Done", path: "backlog/completed/task-14 - done.md" },
] as Array<{
  id: string;
  title: string;
  status: string;
  priority?: string;
  labels?: string[];
  path?: string;
}>;

function response(): BacklogResponse {
  return {
    detected: true,
    prefix: "TASK",
    statuses: STATUSES,
    tasks: TASKS.map((t, i) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      ordinal: i * 1000,
      priority: t.priority ?? null,
      labels: t.labels ?? [],
      assignee: [],
      path: t.path ?? `backlog/tasks/${t.id.toLowerCase()} - ${t.title}.md`,
    })),
  };
}

let body: BacklogResponse;

beforeEach(() => {
  body = response();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** The section on its own, with the preview-open pair stubbed: the pin gesture
 * belongs to `usePreviewOpen` and is tested where it lives. */
function mountSection(
  backlogTab: "Open" | "Closed" = "Open",
  onBacklogTabChange = vi.fn(),
  open: (d: TabDescriptor) => void = vi.fn(),
) {
  const view = mount(
    <BacklogSection
      taskId="t1"
      backlogTab={backlogTab}
      onBacklogTabChange={onBacklogTabChange}
      open={open}
      handlers={{ onClick: () => {}, onDoubleClick: () => {} }}
    />,
  );
  return { ...view, onBacklogTabChange, open };
}

/** Document order as one string. A header and the cards it heads are separate
 * elements, so the only claim worth making about them is which comes first. */
function order(container: HTMLElement, ...parts: string[]) {
  const text = container.textContent ?? "";
  const at = parts.map((p) => text.indexOf(p));
  for (const [i, index] of at.entries()) {
    expect(index, `${parts[i]} is on screen`).toBeGreaterThanOrEqual(0);
    if (i > 0) expect(index, `${parts[i]} after ${parts[i - 1]}`).toBeGreaterThan(at[i - 1]!);
  }
}

test("Open groups by status, most active first, in the response's order", async () => {
  const { container } = mountSection("Open");
  await screen.findByText("TASK-12");

  // In Progress above To Do: the configured statuses reversed with the terminal
  // one dropped, which is the rule a longer configuration gets too — so this
  // file does not have to name a status for it to hold.
  order(container, "In Progress", "TASK-12", "To Do", "TASK-10", "TASK-11");
});

test("the terminal status is off the Open tab", async () => {
  mountSection("Open");
  await screen.findByText("TASK-12");

  expect(screen.queryByText("TASK-13")).toBeNull();
  expect(screen.queryByText("TASK-14")).toBeNull();
  // The counts are the split itself: three open, two closed.
  expect(screen.getByRole("tab", { name: /Open/ }).textContent).toContain("3");
  expect(screen.getByRole("tab", { name: /Closed/ }).textContent).toContain("2");
});

test("Closed holds the terminal status, the completed folder included", async () => {
  mountSection("Closed");
  await screen.findByText("TASK-13");

  // TASK-14's file lives under backlog/completed/, which is a location and not
  // a status — the route already resolved it to Done, and this is where it goes.
  expect(screen.getByText("TASK-14")).toBeTruthy();
  expect(screen.queryByText("TASK-10")).toBeNull();
});

test("a card opens the task's own .md, the way the Files section opens a file", async () => {
  const open = vi.fn();
  mountSection("Open", vi.fn(), open);
  fireEvent.click(await screen.findByRole("button", { name: /TASK-12 in flight/ }));

  // A `file` descriptor and nothing else: markdown tabs default to preview
  // mode, so this lands on the rendered task.
  expect(open).toHaveBeenCalledWith({
    kind: "file",
    path: "backlog/tasks/task-12 - in flight.md",
  });
});

test("a card carries its priority and labels", async () => {
  mountSection("Open");
  await screen.findByText("TASK-12");

  const card = screen.getByRole("button", { name: /TASK-12 in flight/ });
  expect(card.textContent).toContain("high");
  expect(card.textContent).toContain("frontend");
  expect(card.textContent).toContain("ui");
});

test("the tab buttons report the choice rather than holding it", async () => {
  // The choice is the panel's, because it has to survive the section being
  // unmounted — which is what the Explorer does to a section it is not showing.
  const { onBacklogTabChange } = mountSection("Open");
  await screen.findByText("TASK-12");

  fireEvent.click(screen.getByRole("tab", { name: /Closed/ }));
  expect(onBacklogTabChange).toHaveBeenCalledWith("Closed");
});

test("a repository with no backlog says so rather than showing an empty list", async () => {
  body = { detected: false };
  mountSection("Open");

  // What shows for the frame before the shell falls back to Changes.
  expect(await screen.findByText("Not a Backlog.md repository.")).toBeTruthy();
});

// ── the rail item ───────────────────────────────────────────────────────────

/** The rail's labels only, so the claim is about which sections exist rather
 * than about the icons they carry. */
function Rail({
  taskId = "t1",
  section,
}: {
  taskId?: string | null;
  section?: ExplorerSection;
}) {
  const items = useExplorerRail(taskId, section);
  return <div data-testid="rail">{items.map((i) => i.label).join(",")}</div>;
}

test("the rail offers Backlog only where the route reports one", async () => {
  body = { detected: false };
  const undetected = mount(<Rail />);
  await waitFor(() =>
    expect(screen.getByTestId("rail").textContent).toBe("Changes,Files,History,Refs"),
  );
  // Absent, not disabled: a permanently greyed item is a promise about a
  // feature this repository will never have.
  undetected.unmount();

  body = response();
  mount(<Rail />);
  await waitFor(() => expect(screen.getByTestId("rail").textContent).toContain("Backlog"));
});

test("with no answer yet, Backlog survives only as the section showing", () => {
  // The composer is this case permanently: no task, so the query is disabled
  // and never reports `detected` either way. Dropping the item there left the
  // panel titled Backlog with no rail item under it to close — the shell reads
  // its section off the rail, so the item and the title now go together.
  mount(<Rail taskId={null} section="Backlog" />);
  expect(screen.getByTestId("rail").textContent).toContain("Backlog");
});

test("with no answer yet, Backlog stays absent for any other section", () => {
  // The other half: keeping the item while the answer is out would flash one
  // onto every repository that has no backlog.
  mount(<Rail taskId={null} section="Changes" />);
  expect(screen.getByTestId("rail").textContent).toBe("Changes,Files,History,Refs");
});

test("a detected repository outranks the section showing", async () => {
  // `detected` decides once it lands, in both directions: present for a backlog
  // repository the user is not looking at the section of...
  const detected = mount(<Rail section="Changes" />);
  await waitFor(() => expect(screen.getByTestId("rail").textContent).toContain("Backlog"));
  detected.unmount();

  // ...and gone for one that is not, even though the panel is on Backlog — the
  // frame before the shell falls the section back to Changes.
  body = { detected: false };
  mount(<Rail section="Backlog" />);
  await waitFor(() =>
    expect(screen.getByTestId("rail").textContent).toBe("Changes,Files,History,Refs"),
  );
});
