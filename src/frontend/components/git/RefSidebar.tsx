import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Check, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { FilterInput } from "../FilterInput";
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
}

function RefSection({ title, items, headBranch, onSelectRef, pendingSha }: SectionProps) {
  // Controlled open state (default open) — Radix drives the toggle/content, and
  // the icon swap below preserves the original chevron visuals exactly. Matches
  // AppSidebar's controlled-Collapsible pattern.
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-1">
      <CollapsibleTrigger className="w-full flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
        <span className="ml-auto text-[10px] font-normal opacity-60">{items.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {items.map((ref) => {
          const isHead = headBranch != null && ref.name === headBranch;
          const isPending = pendingSha != null && ref.sha === pendingSha;
          return (
            <button
              key={ref.name}
              type="button"
              onClick={() => onSelectRef(ref.sha)}
              title={ref.name}
              className="w-full flex items-center gap-1.5 pl-6 pr-2 py-1 text-left text-xs text-foreground/90 hover:bg-accent/40"
            >
              {isPending ? (
                <Loader2 size={11} className="shrink-0 animate-spin text-muted-foreground" />
              ) : isHead ? (
                <Check size={11} className="shrink-0 text-primary" />
              ) : (
                <span className="w-[11px] shrink-0" />
              )}
              <span className={`truncate ${isHead ? "font-medium text-foreground" : ""}`}>
                {ref.name}
              </span>
            </button>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function RefSidebar({ refs, refsError, onSelectRef, pendingSha }: RefSidebarProps) {
  const [filter, setFilter] = useState("");

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
            />
            <RefSection
              title="Remotes"
              items={filtered.remotes}
              onSelectRef={onSelectRef}
              pendingSha={pendingSha}
            />
            <RefSection
              title="Tags"
              items={filtered.tags}
              onSelectRef={onSelectRef}
              pendingSha={pendingSha}
            />
          </>
        )}
      </div>
    </div>
  );
}
