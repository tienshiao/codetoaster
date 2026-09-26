import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ProjectInfo } from "../../lib/xtmux/types";
import type { OpenOptions, TabDescriptor, TabState } from "../layout-store";
import { clearLayout, createLayout, loadLayout, openTab, saveLayout } from "../layout-store";
import { resetComposerDraft, setComposerDraftProject } from "../composer-draft-store";

/**
 * The composer screen as a tab area (TASK-106): with a browsable project
 * chosen, `/` holds that project's own layout, the composer is what its agent
 * tab shows, and what the Explorer opens lands beside it as ordinary tabs.
 *
 * Vitest's, not `bun test`'s — see CLAUDE.md, "Testing": which layout is on
 * screen, and whether the composer survives a tab opening beside it, are
 * questions only a mounted shell can answer.
 *
 * Stubbed as `TaskShell.render.tsx` stubs it, with three differences that are
 * the subject here: the Explorer records the `onOpenTab` it was handed, so a
 * test can open a tab the way a click in it would; the pane draws the agent
 * tab's `agentContent` and names every other tab by key; and `AppShell`
 * renders `children` on the branch with no tab area, as the real one does.
 */

const stubs = vi.hoisted(() => ({
  projects: [] as ProjectInfo[],
  onOpenTab: null as ((d: TabDescriptor, o?: OpenOptions) => void) | null,
}));

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({
    tasks: [],
    loaded: true,
    projects: stubs.projects,
    openShell: vi.fn(),
    closeShell: vi.fn(),
    setViewedTask: vi.fn(),
    resolveWip: vi.fn(),
  }),
  taskStateOf: () => "idle",
  taskDisplayNames: () => new Map(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/frontend/PtyContext", () => ({ usePty: () => ({ sendInput: vi.fn() }) }));
vi.mock("@/frontend/hooks/use-task-nav", () => ({
  COMPOSER_PROMPT_ID: "composer-prompt",
  useOpenTask: () => vi.fn(),
  useOpenComposer: () => vi.fn(),
}));
vi.mock("@/frontend/hooks/use-explorer-panel", () => ({
  useExplorerPanel: () => ({
    section: "Changes",
    setSection: vi.fn(),
    open: true,
    setOpen: vi.fn(),
    backlogTab: "Open",
    setBacklogTab: vi.fn(),
  }),
}));
vi.mock("@/frontend/components/Explorer", () => ({
  Explorer: ({ onOpenTab }: { onOpenTab: (d: TabDescriptor, o?: OpenOptions) => void }) => {
    stubs.onOpenTab = onOpenTab;
    return null;
  },
  useExplorerRail: () => [],
}));
vi.mock("@/frontend/components/TaskSidebar", () => ({ useTaskSidebar: () => ({}) }));
vi.mock("@/frontend/components/CommandPalette", () => ({ CommandPaletteHost: () => null }));
vi.mock("@/frontend/components/v2/AppShell", () => ({
  AppShell: ({
    tabArea,
    explorer,
    children,
  }: {
    tabArea?: (chrome: { leading: ReactNode }) => ReactNode;
    explorer?: ReactNode;
    children?: ReactNode;
  }) => (
    <div>
      {tabArea ? tabArea({ leading: null }) : children}
      {explorer}
    </div>
  ),
}));
vi.mock("@/frontend/components/tabs/panes", () => ({
  TabPane: ({ tab, agentContent }: { tab: TabState; agentContent?: ReactNode }) =>
    tab.descriptor.kind === "agent" ? (
      <div data-testid="agent-pane">{agentContent}</div>
    ) : (
      <div data-testid="pane">{tab.key}</div>
    ),
}));

const { TaskShell } = await import("./TaskShell");
const { TerminalThemeProvider } = await import("../hooks/use-terminal-theme");

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TerminalThemeProvider>{children}</TerminalThemeProvider>
    </QueryClientProvider>
  );
}

function project(id: string, initialPath: string): ProjectInfo {
  return {
    id,
    name: id,
    initialPath,
    taskIds: [],
    defaultModel: null,
    defaultProfile: null,
    defaultPermissionMode: null,
    defaultBaseRef: null,
    setupCommand: null,
    worktreeCopy: null,
    worktreeDefault: false,
  } as ProjectInfo;
}

const COMPOSER = "the composer body";

function renderComposer() {
  return render(
    <TaskShell taskId={null}>
      <p>{COMPOSER}</p>
    </TaskShell>,
    { wrapper: Providers },
  );
}

/** Every tab key a stored layout holds, in order. */
function storedKeys(id: string): string[] {
  return loadLayout(id).groups.flatMap((g) => g.tabs.map((t) => t.key));
}

const IDS = ["project:web", "project:api", "project:general"];

beforeEach(() => {
  resetComposerDraft();
  for (const id of IDS) clearLayout(id);
  stubs.projects = [project("web", "/repo/web"), project("api", "/repo/api")];
  stubs.onOpenTab = null;
  setComposerDraftProject("web");
  // The status bar's profile list; nothing here asks about it.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const id of IDS) clearLayout(id);
  resetComposerDraft();
});

test("the composer is the project's agent tab, and the tab reads New task", () => {
  renderComposer();
  const agentPane = screen.getByTestId("agent-pane");
  expect(agentPane.textContent).toBe(COMPOSER);
  expect(screen.getByRole("tab", { name: /New task/ })).toBeTruthy();
  expect(screen.queryByText("Agent")).toBeNull();
});

test("a file opened from the Explorer is a tab in the project's layout, and the composer stays", () => {
  renderComposer();
  act(() => stubs.onOpenTab!({ kind: "file", path: "a.ts" }, { preview: true }));

  expect(storedKeys("project:web")).toEqual(["agent", "file:a.ts"]);
  expect(screen.getByTestId("pane").textContent).toBe("file:a.ts");
  // Behind the file tab, not unmounted: the prompt being written is still there.
  expect(screen.getByText(COMPOSER)).toBeTruthy();
});

test("moving the draft to another project shows that project's tabs, not the last one's", () => {
  saveLayout("project:web", openTab(createLayout(), { kind: "file", path: "web.ts" }));
  saveLayout("project:api", openTab(createLayout(), { kind: "commit", sha: "abcdef1234567" }));
  renderComposer();
  expect(screen.getByTestId("pane").textContent).toBe("file:web.ts");

  act(() => {
    setComposerDraftProject("api");
  });

  expect(screen.getByTestId("pane").textContent).toBe("commit:abcdef1234567");
  expect(screen.queryByText("web.ts")).toBeNull();
  // Each project's layout is its own, and moving between them wrote neither.
  expect(storedKeys("project:web")).toEqual(["agent", "file:web.ts"]);
  expect(storedKeys("project:api")).toEqual(["agent", "commit:abcdef1234567"]);
});

test("a project with no directory has no layout, and the composer stands alone", () => {
  stubs.projects = [project("general", "")];
  resetComposerDraft();
  renderComposer();

  expect(screen.getByText(COMPOSER)).toBeTruthy();
  expect(screen.queryByTestId("agent-pane")).toBeNull();
  expect(screen.queryByRole("tab")).toBeNull();
  expect(localStorage.getItem("codetoaster:layout:project:general")).toBeNull();
});
