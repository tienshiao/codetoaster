import { FilterInput } from "codetoaster";
import { Check, ChevronDown, ChevronRight, FileText } from "lucide-react";

const noop = () => {};

export const EmptyAndFiltering = () => (
  <div className="flex w-[280px] flex-col gap-4">
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">No filter — clear button hidden</span>
      <FilterInput value="" onChange={noop} placeholder="Filter files" />
    </div>
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Filtering — clear button shown</span>
      <FilterInput value="xtmux" onChange={noop} placeholder="Filter files" />
    </div>
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Path fragment — the field takes a full path segment</span>
      <FilterInput value="src/lib/tasks/harvester" onChange={noop} placeholder="Filter files" />
    </div>
  </div>
);

// The diff view's file tree header: counts, then the filter above the tree.
export const InFileTree = () => (
  <div style={{ height: 320 }} className="flex w-[280px] flex-col overflow-hidden rounded-md border border-border">
    <div className="shrink-0 border-b border-border p-2">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>4 files changed</span>
        <span className="flex items-center gap-1.5">
          <span className="text-green-500">+128</span>
          <span className="text-red-500">-34</span>
        </span>
      </div>
      <FilterInput value="tasks" onChange={noop} placeholder="Filter files" />
    </div>
    <div className="flex-1 overflow-hidden py-1">
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-foreground/90">
        <ChevronDown size={12} className="text-muted-foreground" />
        <span>src/lib/tasks</span>
      </div>
      {["harvester.ts", "manager.ts", "snapshot.ts"].map((f) => (
        <div key={f} className="flex items-center gap-1.5 py-1 pl-7 pr-2 text-xs text-foreground/90 hover:bg-accent/40">
          <FileText size={12} className="shrink-0 text-muted-foreground" />
          <span className="truncate">{f}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-foreground/90">
        <ChevronRight size={12} className="text-muted-foreground" />
        <span>src/api</span>
      </div>
    </div>
  </div>
);

// The git view's ref sidebar: the filter sits above the collapsible ref sections.
export const InRefSidebar = () => (
  <div style={{ height: 320, width: 224 }} className="flex flex-col overflow-hidden rounded-md border border-border">
    <div className="shrink-0 border-b border-border p-2">
      <FilterInput value="v2" onChange={noop} placeholder="Filter refs..." />
    </div>
    <div className="flex-1 overflow-hidden py-1">
      <div className="mb-1">
        <div className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ChevronDown size={12} />
          Branches
          <span className="ml-auto text-[10px] font-normal opacity-60">2</span>
        </div>
        <div style={{ paddingLeft: 24 }} className="flex w-full items-center gap-1.5 py-1 pr-2 text-xs text-foreground">
          <Check size={11} className="shrink-0 text-primary" />
          <span className="truncate font-medium">v2</span>
        </div>
        <div style={{ paddingLeft: 24 }} className="flex w-full items-center gap-1.5 py-1 pr-2 text-xs text-foreground/90 hover:bg-accent/40">
          <span className="w-[11px] shrink-0" />
          <span className="truncate">v2-snapshot-restore</span>
        </div>
      </div>
      <div className="mb-1">
        <div className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ChevronDown size={12} />
          Remotes
          <span className="ml-auto text-[10px] font-normal opacity-60">1</span>
        </div>
        <div style={{ paddingLeft: 24 }} className="flex w-full items-center gap-1.5 py-1 pr-2 text-xs text-foreground/90 hover:bg-accent/40">
          <span className="w-[11px] shrink-0" />
          <span className="truncate">origin/v2</span>
        </div>
      </div>
    </div>
  </div>
);
