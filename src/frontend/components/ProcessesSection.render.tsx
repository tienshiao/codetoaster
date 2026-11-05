import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { taskRoot } from "@/frontend/repo-root";
import { ProcessesSection, shortCommand } from "./ProcessesSection";
import type { ProcessesResponse } from "@/types/processes";

/**
 * The Processes section (TASK-138.1). A rendering test because each state is
 * a query's answer drawn: a tree, a suspended task, a lookup that only half
 * worked, and a tree that changes on the next poll.
 */

function stubProcesses(...answers: ProcessesResponse[]) {
  let call = 0;
  const fetch = vi.fn(async () => {
    const body = answers[Math.min(call++, answers.length - 1)];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
  return render(wrap(<ProcessesSection root={taskRoot("t1")} />));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const TREE: ProcessesResponse = {
  live: true,
  portsKnown: true,
  processes: [
    { pid: 100, ppid: 1, command: "/bin/zsh -l", depth: 0, terminal: "agent", ports: [] },
    { pid: 120, ppid: 100, command: "/usr/local/bin/node vite --port 5173", depth: 1, terminal: "agent", ports: [5173, 24678] },
    { pid: 200, ppid: 1, command: "/bin/zsh -l", depth: 0, terminal: "shell", ports: [] },
  ],
};

test("draws each terminal's tree under its label, with ports as links", async () => {
  stubProcesses(TREE);
  const { container } = renderSection();

  await screen.findByText("node vite --port 5173");
  expect(screen.getByText("Agent")).toBeTruthy();
  expect(screen.getByText("Shell")).toBeTruthy();
  // The child is indented under its parent.
  const child = container.querySelector<HTMLElement>('[data-pid="120"]')!;
  const parent = container.querySelector<HTMLElement>('[data-pid="100"]')!;
  expect(parseInt(child.style.paddingLeft)).toBeGreaterThan(parseInt(parent.style.paddingLeft));
  expect(child.title).toBe("/usr/local/bin/node vite --port 5173");
  // Each port opens itself.
  const link = screen.getByText(":5173").closest("a")!;
  expect(link.getAttribute("href")).toBe("http://localhost:5173");
  expect(screen.getByText(":24678")).toBeTruthy();
});

test("a task with no live terminal says so instead of drawing an empty tree", async () => {
  stubProcesses({ live: false, processes: [], portsKnown: true });
  renderSection();
  await screen.findByText(/the task has no live terminal/);
});

test("a port lookup that failed is said, so no ports is not read as none", async () => {
  stubProcesses({ ...TREE, portsKnown: false });
  renderSection();
  await screen.findByText(/ports could not be read/);
});

test("a process that exits drops out on the next poll", async () => {
  const fetch = stubProcesses(TREE, { ...TREE, processes: TREE.processes.filter((p) => p.pid !== 120) });
  const { container } = renderSection();
  await screen.findByText("node vite --port 5173");
  await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 4000 });
  await waitFor(() => expect(container.querySelector('[data-pid="120"]')).toBeNull());
  expect(container.querySelector('[data-pid="100"]')).not.toBeNull();
});

test("the row leads with the program's name, not its path", () => {
  expect(shortCommand("/usr/local/bin/node vite --port 5173")).toBe("node vite --port 5173");
  expect(shortCommand("bun test")).toBe("bun test");
});
