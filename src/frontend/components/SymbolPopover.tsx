import { useNavigate, useParams } from "@tanstack/react-router";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
import { useSymbolLookup } from "../hooks/use-symbol-lookup";
import type { SymbolEntry } from "../../lib/symbols/types";
import { Loader2 } from "lucide-react";

export interface SymbolTarget {
  name: string;
  x: number;
  y: number;
}

interface SymbolPopoverProps {
  sessionId: string;
  target: SymbolTarget | null;
  onClose: () => void;
}

export function SymbolPopover({ sessionId, target, onClose }: SymbolPopoverProps) {
  const navigate = useNavigate();
  // Both the file and diff routes live under /sessions/$slug, so read the slug
  // loosely rather than threading it through every caller.
  const params = useParams({ strict: false }) as { slug?: string };
  const { data, isLoading } = useSymbolLookup(sessionId, target?.name ?? null);

  const go = (entry: SymbolEntry) => {
    if (params.slug) {
      navigate({
        to: "/sessions/$slug/file",
        params: { slug: params.slug },
        search: { file: entry.path, line: entry.line },
      });
    }
    onClose();
  };

  const defs = data?.definitions ?? [];
  const refs = data?.references ?? [];

  return (
    <Popover open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <PopoverAnchor asChild>
        <div
          style={{
            position: "fixed",
            left: target?.x ?? 0,
            top: target?.y ?? 0,
            width: 0,
            height: 0,
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-96 max-h-80 overflow-auto p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-3 py-2 border-b border-border">
          <span className="font-mono text-xs font-semibold">{target?.name}</span>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 size={13} className="animate-spin" /> Searching…
          </div>
        ) : defs.length === 0 && refs.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">No definitions or references found</div>
        ) : (
          <>
            <SymbolSection title="Definitions" entries={defs} onGo={go} />
            <SymbolSection title="References" entries={refs} onGo={go} />
            {data?.partial && (
              <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border">
                Index partial — some results may be missing
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SymbolSection({
  title,
  entries,
  onGo,
}: {
  title: string;
  entries: SymbolEntry[];
  onGo: (entry: SymbolEntry) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="py-1">
      <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {title} ({entries.length})
      </div>
      {entries.map((entry, i) => (
        <button
          key={`${entry.path}:${entry.line}:${i}`}
          className="w-full text-left px-3 py-1.5 hover:bg-accent flex flex-col gap-0.5"
          onClick={() => onGo(entry)}
        >
          <span className="font-mono text-[11px] text-foreground">
            {entry.path}:{entry.line}
            <span className="ml-2 text-muted-foreground">{entry.symbolKind}</span>
          </span>
          <span className="font-mono text-[10px] text-muted-foreground truncate">{entry.context}</span>
        </button>
      ))}
    </div>
  );
}
