// ProjectDialog always renders InitialPathAutocomplete, which calls
// useDirectories() -> useQuery(). It needs a QueryClientProvider whose React
// context is the SAME module instance the shipped bundle closed over, so the
// provider is imported from "codetoaster" (the bundle re-exports it via
// cfg.extraEntries) and never from @tanstack/react-query directly — that would
// bundle a second copy with its own context and the dialog would throw
// "No QueryClient set".
import { useState } from "react";
import { QueryClient, QueryClientProvider, ProjectDialog } from "codetoaster";

// The path field autocompletes against the server's GET /api/directories.
// A static preview has no server, so that ONE endpoint is stubbed; the
// dialog and its children are the real components.
const HOME = "/Users/tma";
const TREE: Record<string, string[]> = {
  "/": ["Applications", "Library", "System", "Users", "opt", "usr", "var"],
  "/Users": ["Shared", "tma"],
  "/Users/tma": ["Desktop", "Documents", "Downloads", "Projects", "go"],
  "/Users/tma/Projects": ["api-gateway", "codetoaster", "docs-site", "dotfiles"],
};

if (!(globalThis as any).__dsDirStub) {
  (globalThis as any).__dsDirStub = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: any, init?: any) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    if (url.includes("/api/directories")) {
      const raw =
        new URL(url, "http://preview.local").searchParams.get("path") ?? "/";
      const path =
        raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw || "/";
      return Promise.resolve(
        new Response(
          JSON.stringify({
            parent: path,
            directories: TREE[path] ?? [],
            home: HOME,
          }),
          { headers: { "content-type": "application/json" } }
        )
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

const noop = () => {};

// Built lazily inside render, not at module scope: an exception while the
// preview module is still evaluating takes every cell down and the capture
// harness reports the component as ungradable instead of showing the cards.
const Providers = ({ children }: { children: React.ReactNode }) => {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

// "New Project" from the sidebar header: both fields start empty and Create
// stays disabled until a name is typed.
export const CreateProject = () => (
  <Providers>
    <ProjectDialog
      mode="create"
      project={null}
      open
      onSave={noop}
      onClose={noop}
    />
  </Providers>
);

// "Edit" from a project's row menu: the form is seeded with the stored name
// and initial path, and the primary action reads Save.
export const EditProject = () => (
  <Providers>
    <ProjectDialog
      mode="edit"
      project={{
        id: "prj_04a7",
        name: "codetoaster",
        initialPath: "~/Projects/codetoaster",
        sessionIds: ["tsk_9f3c21", "tsk_71be40", "tsk_2d10aa"],
      }}
      open
      onSave={noop}
      onClose={noop}
    />
  </Providers>
);
