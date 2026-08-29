import { DirectoryPickerDialog } from "codetoaster";

// DirectoryPickerDialog browses the real filesystem through the server's
// GET /api/directories. There is no server behind a static preview, so the
// story stubs that ONE endpoint with a fixed tree — the component itself is
// the real one, unchanged.
const HOME = "/Users/tma";

const TREE: Record<string, string[]> = {
  "/": ["Applications", "Library", "System", "Users", "opt", "usr", "var"],
  "/Users": ["Shared", "tma"],
  "/Users/tma": ["Desktop", "Documents", "Downloads", "Projects", "go"],
  "/Users/tma/Projects": [
    "api-gateway",
    "codetoaster",
    "docs-site",
    "dotfiles",
  ],
  "/Users/tma/Projects/codetoaster": [
    "backlog",
    "ds-bundle",
    "node_modules",
    "scripts",
    "src",
  ],
  "/Users/tma/Projects/api-gateway": ["cmd", "internal", "proto"],
};

if (!(globalThis as any).__dsDirStub) {
  (globalThis as any).__dsDirStub = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: any, init?: any) => {
    const url =
      typeof input === "string" ? input : (input?.url ?? String(input));
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

// Opened from the project dialog with a path already filled in: every
// ancestor is expanded and the target row is selected and scrolled into view.
export const BrowsingToAProject = () => (
  <DirectoryPickerDialog
    open
    onOpenChange={noop}
    initialPath="~/Projects/codetoaster"
    onSelect={noop}
  />
);

// A shallower starting point — the ~ home directory, with its siblings listed
// under a collapsed root.
export const AtHome = () => (
  <DirectoryPickerDialog
    open
    onOpenChange={noop}
    initialPath="~"
    onSelect={noop}
  />
);

// No initial path: only the filesystem root is expanded, the summary bar reads
// "No selection" and the confirm button stays disabled.
export const NoSelection = () => (
  <DirectoryPickerDialog
    open
    onOpenChange={noop}
    initialPath=""
    onSelect={noop}
  />
);
