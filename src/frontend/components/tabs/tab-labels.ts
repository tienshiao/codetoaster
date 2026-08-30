import type { TabDescriptor } from "@/frontend/layout-store";
import type { TabKind } from "@/frontend/components/v2/TabStrip";

/**
 * What a `TabDescriptor` looks like in the strip.
 *
 * Separate from both the store and the component: the store says what is open,
 * `Tab` says how a tab is drawn, and this is the projection between them — the
 * only place that decides a `commit` tab is labelled by a short sha and a
 * `file` tab by its basename.
 */
export interface TabPresentation {
  kind: TabKind;
  /** What the tab reads as. Short by design: the strip is scanned. */
  label: string;
  /** Trailing mono detail — a line number, a path fragment, a stat. */
  detail?: string;
  /** The full thing, for the native tooltip. A basename is ambiguous across
   * directories, and the strip has no room to disambiguate. */
  title: string;
  /** The agent tab is the task; closing it would mean killing the task, which
   * is the task list's action (§7.2). `closeTab` refuses it as well, so this is
   * the affordance and not the rule. */
  closable: boolean;
}

/** The last path segment, or the whole thing when there is no separator. */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

export function presentTab(descriptor: TabDescriptor): TabPresentation {
  switch (descriptor.kind) {
    case "agent":
      // Prose, not a path: it is the one tab that names a conversation rather
      // than a file, which is also why `Tab` sets it in the sans face.
      return { kind: "agent", label: "Agent", title: "The agent terminal", closable: false };

    case "shell":
      return { kind: "shell", label: "shell", title: "A shell in the task's directory", closable: true };

    case "diffAll":
      return { kind: "diffAll", label: "Changes", title: "The working tree diff", closable: true };

    case "history":
      return { kind: "history", label: "History", title: "The commit graph", closable: true };

    case "diff":
      // No detail: the directory is what disambiguates two files of the same
      // name, and it is far too long for a strip that is scanned rather than
      // read. It is in the tooltip, where a second of hover buys the answer.
      return {
        kind: "diff",
        label: basename(descriptor.path),
        title: descriptor.path,
        closable: true,
      };

    case "file":
      return {
        kind: "file",
        label: basename(descriptor.path),
        // A line is the reason this tab was reopened at all — the
        // go-to-definition case — so it earns the detail slot over the path.
        detail: descriptor.line != null ? `:${descriptor.line}` : undefined,
        title: descriptor.line != null ? `${descriptor.path}:${descriptor.line}` : descriptor.path,
        closable: true,
      };

    case "commit":
      return {
        kind: "commit",
        // Git's own abbreviation. The full 40 is never what a strip should show
        // and never what a human types.
        label: descriptor.sha.slice(0, 7),
        title: descriptor.sha,
        closable: true,
      };
  }
}
