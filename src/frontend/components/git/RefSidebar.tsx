import { useEffect, useMemo, useState, useCallback, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, Check, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { FilterInput } from "../FilterInput";
import { buildRefTree, countRefs, isRefFolder, type RefTreeNode } from "../../utils/refTree";
import { collectPathPrefixes, getViewState, toggleInSet, withAll } from "../../view-state-store";
import { useViewState } from "../../hooks/use-view-state";
import type { GitRef, GitRefsResponse } from "../../types/git";

// Shared empty-set default for sections with no persisted expansion state.
const EMPTY_SET: Set<string> = new Set();

interface RefSidebarProps {
  sessionId: string;
  refs: GitRefsResponse | undefined;
  refsError: boolean;
  onSelectRef: (sha: string) => void;
  /** Sha whose fetch-until is currently in flight (shows a spinner). */
  pendingSha: string | null;
}

interface SectionProps {
  title: string;
  items: GitRef[];
  headBranch?: string | null;
  onSelectRef: (sha: string) => void;
  pendingSha: string | null;
  /** True while the sidebar filter is non-empty — forces every folder open. */
  filterActive: boolean;
  // Controlled section open/closed and folder-expansion state, lifted to
  // RefSidebar so both persist in the per-session view-state store.
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expanded: Set<string>;
  onExpandedChange: Dispatch<SetStateAction<Set<string>>>;
}

function RefSection({
  title,
  items,
  headBranch,
  onSelectRef,
  pendingSha,
  filterActive,
  open,
  onOpenChange,
  expanded,
  onExpandedChange,
}: SectionProps) {
  const tree = useMemo(() => buildRefTree(items), [items]);

  const headAncestors = useMemo(
    () => (headBranch ? collectPathPrefixes([headBranch]) : null),
    [headBranch],
  );

  // Ancestor folders of the pending ref, so a collapsed folder can roll up the
  // in-flight spinner that its hidden leaf would otherwise show.
  const pendingAncestors = useMemo(() => {
    if (pendingSha == null) return null;
    const names = items.filter((r) => r.sha === pendingSha).map((r) => r.name);
    return names.length > 0 ? collectPathPrefixes(names) : null;
  }, [items, pendingSha]);

  if (items.length === 0) return null;

  const toggle = (path: string) => onExpandedChange((prev) => toggleInSet(prev, path));

  const renderNodes = (nodes: RefTreeNode[], depth: number) =>
    nodes.map((node) => {
      if (isRefFolder(node)) {
        // While a filter is active every folder is forced open (the upstream
        // `filtered` memo already narrowed `items` to matches) and toggling is
        // suppressed — otherwise clicks would silently flip the hidden manual
        // set that comes back when the filter clears.
        const isExpanded = filterActive || expanded.has(node.path);
        const rollupPending = !isExpanded && pendingAncestors?.has(node.path);
        const rollupHead = !isExpanded && !rollupPending && headAncestors?.has(node.path);
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => {
                if (!filterActive) toggle(node.path);
              }}
              className="w-full flex items-center gap-1.5 pr-2 py-1 text-left text-xs text-foreground/90 hover:bg-accent/40"
              style={{ paddingLeft: depth * 12 + 24 }}
            >
              {isExpanded ? (
                <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{node.name}</span>
              <span className="ml-auto flex items-center gap-1">
                {rollupPending ? (
                  <Loader2 size={11} className="shrink-0 animate-spin text-muted-foreground" />
                ) : rollupHead ? (
                  <Check size={11} className="shrink-0 text-primary" />
                ) : null}
                <span className="text-[10px] font-normal opacity-60">{countRefs(node)}</span>
              </span>
            </button>
            {isExpanded && renderNodes(node.children, depth + 1)}
          </div>
        );
      }

      const ref = node.ref;
      if (!ref) return null;
      const isHead = headBranch != null && ref.name === headBranch;
      const isPending = pendingSha != null && ref.sha === pendingSha;
      return (
        <button
          key={node.path}
          type="button"
          onClick={() => onSelectRef(ref.sha)}
          title={ref.name}
          className="w-full flex items-center gap-1.5 pr-2 py-1 text-left text-xs text-foreground/90 hover:bg-accent/40"
          style={{ paddingLeft: depth * 12 + 24 }}
        >
          {isPending ? (
            <Loader2 size={11} className="shrink-0 animate-spin text-muted-foreground" />
          ) : isHead ? (
            <Check size={11} className="shrink-0 text-primary" />
          ) : (
            <span className="w-[11px] shrink-0" />
          )}
          <span className={`truncate ${isHead ? "font-medium text-foreground" : ""}`}>
            {node.name}
          </span>
        </button>
      );
    });

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="mb-1">
      <CollapsibleTrigger className="w-full flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
        <span className="ml-auto text-[10px] font-normal opacity-60">{items.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>{renderNodes(tree, 0)}</CollapsibleContent>
    </Collapsible>
  );
}

export function RefSidebar({ sessionId, refs, refsError, onSelectRef, pendingSha }: RefSidebarProps) {
  const [filter, setFilter] = useState("");

  const filterActive = filter.trim() !== "";

  // Persisted section open/closed (tracked as closures — sections default open)
  // and per-section folder expansion, both surviving tab switches.
  const [closedSections, setClosedSections] = useViewState(sessionId, "gitView", "refsClosedSections");
  const [refsExpanded, setRefsExpanded] = useViewState(sessionId, "gitView", "refsExpanded");

  // setState-style update scoped to one section's expansion set. Replaces that
  // section's Set inside a new Map immutably; a same-reference result bails
  // out so no-op updates don't re-render.
  const handleExpandedChange = useCallback(
    (title: string, action: SetStateAction<Set<string>>) =>
      setRefsExpanded((prev) => {
        const current = prev.get(title) ?? EMPTY_SET;
        const nextSet =
          typeof action === "function"
            ? (action as (p: Set<string>) => Set<string>)(current)
            : action;
        if (nextSet === current) return prev;
        return new Map(prev).set(title, nextSet);
      }),
    [setRefsExpanded],
  );

  const headBranch = refs?.head.ref;

  // Reveal HEAD's ancestor folders when HEAD actually changes (refs load
  // async; a checkout in the terminal moves HEAD mid-session). Runs once per
  // HEAD value — not per remount, which would silently undo a user's collapse
  // of those folders on every tab switch now that the expansion set persists.
  useEffect(() => {
    if (!headBranch) return;
    const gitView = getViewState(sessionId).gitView;
    if (gitView.refsHeadExpandedFor === headBranch) return;
    gitView.refsHeadExpandedFor = headBranch;
    handleExpandedChange("Branches", (prev) => withAll(prev, collectPathPrefixes([headBranch])));
  }, [headBranch, sessionId, handleExpandedChange]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const match = (r: GitRef) => q === "" || r.name.toLowerCase().includes(q);
    return {
      branches: refs?.branches.filter(match) ?? [],
      remotes: refs?.remotes.filter(match) ?? [],
      tags: refs?.tags.filter(match) ?? [],
    };
  }, [refs, filter]);

  return (
    <div className="w-56 shrink-0 border-r border-border flex flex-col overflow-hidden">
      <div className="shrink-0 p-2 border-b border-border">
        <FilterInput value={filter} onChange={setFilter} placeholder="Filter refs..." />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {refsError ? (
          <div className="px-3 py-4 text-xs text-muted-foreground italic">refs unavailable</div>
        ) : (
          <>
            {(
              [
                { title: "Branches", items: filtered.branches, headBranch },
                { title: "Remotes", items: filtered.remotes },
                { title: "Tags", items: filtered.tags },
              ] as const
            ).map((s) => (
              <RefSection
                key={s.title}
                title={s.title}
                items={s.items}
                headBranch={"headBranch" in s ? s.headBranch : undefined}
                onSelectRef={onSelectRef}
                pendingSha={pendingSha}
                filterActive={filterActive}
                open={!closedSections.has(s.title)}
                onOpenChange={() => setClosedSections((prev) => toggleInSet(prev, s.title))}
                expanded={refsExpanded.get(s.title) ?? EMPTY_SET}
                onExpandedChange={(action) => handleExpandedChange(s.title, action)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
