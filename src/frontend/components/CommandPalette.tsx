import { useState, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Braces, ChevronLeft, FileText, Loader2, PanelLeft, Pencil, Plus, TerminalSquare, X } from "lucide-react";
import { useSession } from "../SessionContext";
import { buildSessionSlug } from "../utils/slug";
import { sessionNavTarget, closeNavTarget } from "../utils/session-nav";
import { RenameDialog } from "./RenameDialog";
import { useSidebar } from "./ui/sidebar";
import { useFileSearch, type FileSearchResult } from "../hooks/use-file-search";
import { useRecentFiles } from "../hooks/use-recent-files";
import { useSymbolSearch } from "../hooks/use-symbol-search";
import { modifierSymbol } from "../utils/platform";
import type { SymbolEntry } from "../../lib/symbols/types";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./ui/command";

function HighlightedPath({ path, indices }: FileSearchResult) {
  const indexSet = new Set(indices);
  const parts: { text: string; highlight: boolean }[] = [];
  let current = "";
  let currentHL = false;

  for (let i = 0; i < path.length; i++) {
    const hl = indexSet.has(i);
    if (hl !== currentHL && current) {
      parts.push({ text: current, highlight: currentHL });
      current = "";
    }
    current += path[i];
    currentHL = hl;
  }
  if (current) parts.push({ text: current, highlight: currentHL });

  return (
    <span className="truncate font-mono text-xs">
      {parts.map((p, i) =>
        p.highlight ? (
          <span key={i} className="text-primary font-semibold">{p.text}</span>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { sessions, currentSessionId, createSession, closeSession, renameSession: doRenameSession, terminalRef } = useSession();
  const { toggleSidebar } = useSidebar();
  const [renameItem, setRenameItem] = useState<{ id: string; name: string } | null>(null);
  const navigate = useNavigate();

  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  // Symbol-lookup mode: the input becomes an exact symbol-name query instead of
  // the default session/command/file search. Also documents the ⌘/Ctrl-click
  // gesture, which is otherwise undiscoverable.
  const [symbolMode, setSymbolMode] = useState(false);
  const modLabel = modifierSymbol();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(inputValue), 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputValue]);

  // Reset input when palette closes
  useEffect(() => {
    if (!open) {
      setInputValue("");
      setDebouncedQuery("");
      setSymbolMode(false);
    }
  }, [open]);

  const { data: fileSearchData, isLoading: fileSearchLoading } = useFileSearch(
    currentSessionId ?? null,
    debouncedQuery,
  );
  const fileResults = fileSearchData?.results ?? [];

  const currentSession = currentSessionId
    ? sessions.find((s) => s.id === currentSessionId)
    : null;

  const { recentFiles, addRecentFile } = useRecentFiles(currentSessionId ?? null);

  // Fuzzy/prefix symbol search, active only in symbol mode.
  const { data: symbolData, isLoading: symbolLoading } = useSymbolSearch(
    currentSessionId ?? "",
    symbolMode ? (debouncedQuery || null) : null,
  );
  const symbolMatches = symbolData?.matches ?? [];

  const goToSymbol = (entry: SymbolEntry) => {
    if (!currentSession) return;
    addRecentFile(entry.path);
    navigate({
      to: "/sessions/$slug/file",
      params: { slug: buildSessionSlug(currentSession) },
      search: { file: entry.path, line: entry.line },
    });
    setOpen(false);
  };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "p" && (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (<>
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command Palette"
      description="Search for sessions, commands, or files"
      // Symbol results are ranked server-side; let cmdk filter/sort everything else.
      shouldFilter={!symbolMode}
    >
      <CommandInput
        placeholder={symbolMode ? "Search symbols by name…" : "Search sessions, commands, files..."}
        value={inputValue}
        onValueChange={setInputValue}
      />
      <CommandList>
        {symbolMode ? (
          <>
            <CommandGroup forceMount>
              <CommandItem
                value="__back-to-commands"
                forceMount
                onSelect={() => {
                  setSymbolMode(false);
                  setInputValue("");
                  setDebouncedQuery("");
                }}
              >
                <ChevronLeft className="size-4" />
                <span>Back</span>
              </CommandItem>
            </CommandGroup>
            {debouncedQuery.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Type to search symbols by name.
              </div>
            ) : symbolLoading ? (
              <CommandItem value="symbol-loading" disabled forceMount>
                <Loader2 className="size-4 animate-spin" />
                <span>Searching symbols…</span>
              </CommandItem>
            ) : symbolMatches.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No symbols match “{debouncedQuery}”.
              </div>
            ) : (
              <CommandGroup heading="Symbols" forceMount>
                {symbolMatches.map((m, i) => (
                  <CommandItem
                    key={`sym:${m.name}:${m.primary.path}:${m.primary.line}:${i}`}
                    value={`sym:${m.name}:${i}`}
                    forceMount
                    onSelect={() => goToSymbol(m.primary)}
                  >
                    <Braces className="size-4 shrink-0" />
                    <span className="font-mono text-xs">{m.name}</span>
                    <span className="ml-2 truncate font-mono text-[10px] text-muted-foreground">
                      {m.primary.path}:{m.primary.line}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {m.symbolKind}
                      {m.defCount + m.refCount > 1 && ` · ${m.defCount + m.refCount}`}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {symbolMode && symbolData?.partial && symbolMatches.length > 0 && (
              <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border">
                Index partial — some symbols may be missing
              </div>
            )}
          </>
        ) : (
          <>
        {!(fileResults.length > 0 || fileSearchLoading) && (
          <CommandEmpty>No results found.</CommandEmpty>
        )}
        <CommandGroup heading="Commands">
          <CommandItem
            value="new session"
            onSelect={() => {
              const { id, name } = createSession();
              navigate({
                to: "/sessions/$slug",
                params: { slug: buildSessionSlug({ id, name }) },
              });
              setOpen(false);
              setTimeout(() => terminalRef.current?.focus(), 100);
            }}
          >
            <Plus className="size-4" />
            <span>New Session</span>
          </CommandItem>
          <CommandItem
            value="close session"
            disabled={!currentSessionId}
            onSelect={() => {
              if (!currentSessionId) return;
              const remaining = sessions.filter((s) => s.id !== currentSessionId);
              closeSession(currentSessionId);
              navigate(closeNavTarget(remaining));
              setOpen(false);
            }}
          >
            <X className="size-4" />
            <span>
              Close Session
              {currentSessionId && !sessions.find((s) => s.id === currentSessionId)?.exited && (
                <span className="text-destructive ml-1">(running)</span>
              )}
            </span>
          </CommandItem>
          <CommandItem
            value="rename session"
            disabled={!currentSessionId}
            onSelect={() => {
              if (!currentSessionId) return;
              const session = sessions.find((s) => s.id === currentSessionId);
              if (!session) return;
              setOpen(false);
              setRenameItem({ id: session.id, name: session.name });
            }}
          >
            <Pencil className="size-4" />
            <span>Rename Session</span>
          </CommandItem>
          <CommandItem
            value="toggle sidebar"
            onSelect={() => {
              toggleSidebar();
              setOpen(false);
            }}
          >
            <PanelLeft className="size-4" />
            <span>Toggle Sidebar</span>
          </CommandItem>
          <CommandItem
            value="find symbol go to definition reference"
            disabled={!currentSession}
            onSelect={() => {
              setSymbolMode(true);
              setInputValue("");
              setDebouncedQuery("");
            }}
          >
            <Braces className="size-4" />
            <span>Find Symbol…</span>
            <span className="ml-auto text-xs text-muted-foreground">{modLabel}-click in code</span>
          </CommandItem>
        </CommandGroup>
        {currentSession && debouncedQuery.length === 0 && recentFiles.length > 0 && (
          <CommandGroup heading="Recent Files" forceMount>
            {recentFiles.map((filePath) => (
              <CommandItem
                key={filePath}
                value={`recent:${filePath}`}
                forceMount
                onSelect={() => {
                  addRecentFile(filePath);
                  navigate({
                    to: "/sessions/$slug/file",
                    params: { slug: buildSessionSlug(currentSession) },
                    search: { file: filePath },
                  });
                  setOpen(false);
                }}
              >
                <FileText className="size-4" />
                <span className="truncate font-mono text-xs">{filePath}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Sessions">
          {sessions.map((session) => (
            <CommandItem
              key={session.id}
              value={`${session.name} ${session.title ?? ""} ${session.id}`}
              onSelect={() => {
                navigate(sessionNavTarget(session));
                setOpen(false);
              }}
            >
              <TerminalSquare className="size-4" />
              <span>
                {session.name}
                {session.id === currentSessionId && (
                  <span className="text-muted-foreground ml-1">(current)</span>
                )}
              </span>
              {session.title && (
                <span className="text-muted-foreground ml-auto truncate text-xs">
                  {session.title}
                </span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
        {currentSession && debouncedQuery.length > 0 && (fileSearchLoading || fileResults.length > 0) && (
          <CommandGroup heading="Files" forceMount>
            {fileSearchLoading && (
              <CommandItem value="file-search-loading" disabled forceMount>
                <Loader2 className="size-4 animate-spin" />
                <span>Searching files...</span>
              </CommandItem>
            )}
            {fileResults.map((file) => (
              <CommandItem
                key={file.path}
                value={`file:${file.path}`}
                forceMount
                onSelect={() => {
                  addRecentFile(file.path);
                  navigate({
                    to: "/sessions/$slug/file",
                    params: { slug: buildSessionSlug(currentSession) },
                    search: { file: file.path },
                  });
                  setOpen(false);
                }}
              >
                <FileText className="size-4" />
                <HighlightedPath {...file} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
          </>
        )}
      </CommandList>
    </CommandDialog>
    <RenameDialog
      item={renameItem}
      title="Rename Session"
      onRename={(id, name) => {
        doRenameSession(id, name);
        if (id === currentSessionId) {
          // keep the current tab; a plain /sessions/$slug navigation would
          // kick a rename on the diff/file tab back to terminal
          navigate({ ...sessionNavTarget({ id, name }), replace: true });
        }
      }}
      onClose={() => setRenameItem(null)}
    />
  </>
  );
}
