import { useQuery } from "@tanstack/react-query";
import { taskKeys } from "../query-keys";
import { refetchOnFocusFor, rootApi, rootId, type RepoRoot } from "../repo-root";
import type { SymbolLookupResult } from "../../lib/symbols/types";

async function fetchSymbol(root: RepoRoot, name: string, sha?: string): Promise<SymbolLookupResult> {
  const scope = sha ? `&sha=${encodeURIComponent(sha)}` : "";
  const res = await fetch(
    `${rootApi(root)}/symbols?name=${encodeURIComponent(name)}${scope}`,
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to look up symbol");
  }
  return res.json();
}

/** One symbol's definitions and references: in the working tree, or — with
 * `sha` — in the files of that commit (TASK-127). A commit's answer cannot
 * change, so it is keyed apart from the working tree's and never refetched. */
export function useSymbolLookup(root: RepoRoot, name: string | null, sha?: string) {
  return useQuery({
    queryKey: sha ? ["git-symbol", rootId(root), sha, name] : taskKeys.symbol(rootId(root), name),
    queryFn: () => fetchSymbol(root, name!, sha),
    enabled: !!name,
    staleTime: sha ? Infinity : 5000,
    refetchOnWindowFocus: sha ? false : refetchOnFocusFor(root),
  });
}
