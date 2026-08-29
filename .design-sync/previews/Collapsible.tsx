import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "codetoaster";
import { Check, ChevronDown, ChevronRight } from "lucide-react";

const Ref = ({ name, head = false, indent = 24 }: { name: string; head?: boolean; indent?: number }) => (
  <div
    className="flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs text-foreground/90 hover:bg-accent/40"
    style={{ paddingLeft: indent }}
  >
    {head ? <Check size={11} className="shrink-0 text-primary" /> : <span className="w-[11px] shrink-0" />}
    <span className={head ? "truncate font-medium text-foreground" : "truncate"}>{name}</span>
  </div>
);

const SectionTrigger = ({ title, count, open }: { title: string; count: number; open: boolean }) => (
  <CollapsibleTrigger className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
    {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
    {title}
    <span className="ml-auto text-[10px] font-normal opacity-60">{count}</span>
  </CollapsibleTrigger>
);

// Both states of the same section side by side: closed keeps only the trigger
// and its count, so the chevron and the number carry the whole affordance.
export const OpenAndClosed = () => (
  <div className="flex gap-4">
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Closed</span>
      <div style={{ width: 224 }} className="rounded-md border border-border py-1">
        <Collapsible open={false} className="mb-1">
          <SectionTrigger title="Branches" count={4} open={false} />
          <CollapsibleContent>
            <Ref name="v2" head />
            <Ref name="main" />
            <Ref name="v2-snapshot-restore" />
            <Ref name="fix/origin-guard" />
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Open</span>
      <div style={{ width: 224 }} className="rounded-md border border-border py-1">
        <Collapsible open className="mb-1">
          <SectionTrigger title="Branches" count={4} open />
          <CollapsibleContent>
            <Ref name="v2" head />
            <Ref name="main" />
            <Ref name="v2-snapshot-restore" />
            <Ref name="fix/origin-guard" />
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  </div>
);

// Sibling sections read as a group when the triggers are styled identically.
export const RefSidebar = () => (
  <div style={{ width: 224 }} className="rounded-md border border-border py-1">
    <Collapsible open className="mb-1">
      <SectionTrigger title="Branches" count={3} open />
      <CollapsibleContent>
        <Ref name="v2" head />
        <Ref name="main" />
        <Ref name="v2-snapshot-restore" />
      </CollapsibleContent>
    </Collapsible>
    <Collapsible open className="mb-1">
      <SectionTrigger title="Remotes" count={2} open />
      <CollapsibleContent>
        <div style={{ paddingLeft: 12 }} className="flex w-full items-center gap-1 py-1 pr-2 text-xs text-foreground/90">
          <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
          <span className="truncate">origin</span>
          <span className="ml-auto text-[10px] font-normal opacity-60">2</span>
        </div>
        <Ref name="v2" indent={36} />
        <Ref name="main" indent={36} />
      </CollapsibleContent>
    </Collapsible>
    <Collapsible open={false} className="mb-1">
      <SectionTrigger title="Tags" count={7} open={false} />
      <CollapsibleContent>
        <Ref name="v2.0.0" />
      </CollapsibleContent>
    </Collapsible>
  </div>
);

// A nested folder inside a section, matching how refTree groups `fix/*`.
export const NestedFolders = () => (
  <div style={{ width: 224 }} className="rounded-md border border-border py-1">
    <Collapsible open className="mb-1">
      <SectionTrigger title="Branches" count={5} open />
      <CollapsibleContent>
        <Ref name="v2" head />
        <Collapsible open>
          <CollapsibleTrigger style={{ paddingLeft: 12 }} className="flex w-full items-center gap-1 py-1 pr-2 text-xs text-foreground/90 hover:bg-accent/40">
            <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
            <span className="truncate">fix</span>
            <span className="ml-auto text-[10px] font-normal opacity-60">3</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Ref name="origin-guard" indent={36} />
            <Ref name="compacting-state" indent={36} />
            <Ref name="port-0-health" indent={36} />
          </CollapsibleContent>
        </Collapsible>
        <Ref name="docs/xtmux-protocol" />
      </CollapsibleContent>
    </Collapsible>
  </div>
);
