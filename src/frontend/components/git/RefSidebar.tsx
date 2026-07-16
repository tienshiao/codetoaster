import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Check, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { FilterInput } from "../FilterInput";
import { buildRefTree, countRefs, isRefFolder, type RefTreeNode } from "../../utils/refTree";
import { collectPathPrefixes, toggleInSet } from "../../view-state-store";
import type { GitRef, GitRefsResponse } from "../../types/git";

interface RefSidebarProps {
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
}

function RefSection({ title, items, headBranch, onSelectRef, pendingSha, filterActive }: SectionProps) {
  // Controlled open state (default open) — Radix drives the toggle/content, and
  // the icon swap below preserves the original chevron visuals exactly. Matches
  // AppSidebar's controlled-Collapsible pattern.
  const [open, setOpen] = useState(true);

  // Folders start collapsed. No persistence across reloads.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const tree = useMemo(() => buildRefTree(items), [items]);

  const headAncestors = useMemo(
    () => (headBranch ? collectPathPrefixes([headBranch]) : null),
    [headBranch],
  );

  // Reveal HEAD whenever it changes (refs load async, and a checkout in the
  // terminal moves HEAD mid-session) by unioning its ancestors into the expand
  // set — the user's manual state is otherwise untouched. Same pattern as
  // file/FileTree's auto-expand of the selected file's ancestors.
  useEffect(() => {
    if (headAncestors == null || headAncestors.size === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const path of headAncestors) next.add(path);
      return next.size === prev.size ? prev : next;
    });
  }, [headAncestors]);

  // Ancestor folders of the pending ref, so a collapsed folder can roll up the
  // in-flight spinner that its hidden leaf would otherwise show.
  const pendingAncestors = useMemo(() => {
    if (pendingSha == null) return null;
    const names = items.filter((r) => r.sha === pendingSha).map((r) => r.name);
    return names.length > 0 ? collectPathPrefixes(names) : null;
  }, [items, pendingSha]);

  if (items.length === 0) return null;

  const toggle = (path: string) => setExpanded((prev) => toggleInSet(prev, path));

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
    <Collapsible open={open} onOpenChange={setOpen} className="mb-1">
      <CollapsibleTrigger className="w-full flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
        <span className="ml-auto text-[10px] font-normal opacity-60">{items.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>{renderNodes(tree, 0)}</CollapsibleContent>
    </Collapsible>
  );
}

export function RefSidebar({ refs, refsError, onSelectRef, pendingSha }: RefSidebarProps) {
  const [filter, setFilter] = useState("");

  const filterActive = filter.trim() !== "";

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
            <RefSection
              title="Branches"
              items={filtered.branches}
              headBranch={refs?.head.ref}
              onSelectRef={onSelectRef}
              pendingSha={pendingSha}
              filterActive={filterActive}
            />
            <RefSection
              title="Remotes"
              items={filtered.remotes}
              onSelectRef={onSelectRef}
              pendingSha={pendingSha}
              filterActive={filterActive}
            />
            <RefSection
              title="Tags"
              items={filtered.tags}
              onSelectRef={onSelectRef}
              pendingSha={pendingSha}
              filterActive={filterActive}
            />
          </>
        )}
      </div>
    </div>
  );
}
