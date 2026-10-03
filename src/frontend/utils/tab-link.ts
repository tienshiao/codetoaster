import { defaultStringifySearch } from "@tanstack/react-router";

/**
 * A URL for a file tab (TASK-126), and the route's reading of one.
 *
 * The task route ensures a tab from `?tab=<key>` (§7.3). A tab key carries no
 * position, so a file tab's line and heading ride beside it as `line` and
 * `anchor`. The markdown preview gives its links these URLs, so the things a
 * browser does with an `href` on its own — open in a new tab, copy the link —
 * land on the file rather than on a route that does not exist.
 *
 * Built with the router's own serializer, which quotes any string that would
 * otherwise parse as JSON on the way back in: a heading called `2024` stays the
 * string "2024" instead of arriving as a number.
 */

export interface FileTabTarget {
  path: string;
  line?: number;
  anchor?: string;
}

/** `base` is the task's route, `/t/<slug>`. */
export function fileTabHref(base: string, target: FileTabTarget): string {
  return `${base}${defaultStringifySearch({
    tab: `file:${target.path}`,
    ...(target.line ? { line: target.line } : {}),
    ...(target.anchor ? { anchor: target.anchor } : {}),
  })}`;
}

export interface TabSearch {
  tab?: string;
  line?: number;
  anchor?: string;
}

/** The route's `validateSearch`: each field kept only when it has the shape it
 * should, so a hand-edited URL degrades to opening less rather than failing. */
export function parseTabSearch(search: Record<string, unknown>): TabSearch {
  const { tab, line, anchor } = search;
  return {
    ...(typeof tab === "string" && tab ? { tab } : {}),
    ...(typeof line === "number" && Number.isInteger(line) && line > 0 ? { line } : {}),
    ...(typeof anchor === "string" && anchor ? { anchor } : {}),
  };
}
