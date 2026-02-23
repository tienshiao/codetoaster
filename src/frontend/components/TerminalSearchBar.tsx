import { useEffect, useRef, useState, useCallback } from "react";
import type { SearchAddon } from "@xterm/addon-search";
import { ChevronUp, ChevronDown, X } from "lucide-react";

const isMac = navigator.platform.startsWith("Mac");

const SEARCH_OPTIONS = {
  decorations: {
    matchBackground: "#515C6A",
    matchBorder: "#515C6A",
    matchOverviewRuler: "#515C6A",
    activeMatchBackground: "#EAA549",
    activeMatchBorder: "#EAA549",
    activeMatchColorOverviewRuler: "#EAA549",
  },
};

interface TerminalSearchBarProps {
  searchAddon: SearchAddon;
  onClose: () => void;
}

export function TerminalSearchBar({ searchAddon, onClose }: TerminalSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef("");
  const [resultIndex, setResultIndex] = useState(-1);
  const [resultCount, setResultCount] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Subscribe to search result changes
  useEffect(() => {
    const disposable = searchAddon.onDidChangeResults((e) => {
      setResultIndex(e.resultIndex);
      setResultCount(e.resultCount);
    });
    return () => disposable.dispose();
  }, [searchAddon]);

  const findNext = useCallback(() => {
    if (queryRef.current) searchAddon.findNext(queryRef.current, SEARCH_OPTIONS);
  }, [searchAddon]);

  const findPrevious = useCallback(() => {
    if (queryRef.current) searchAddon.findPrevious(queryRef.current, SEARCH_OPTIONS);
  }, [searchAddon]);

  const close = useCallback(() => {
    searchAddon.clearDecorations();
    setResultIndex(-1);
    setResultCount(0);
    onClose();
  }, [searchAddon, onClose]);

  // Global Cmd+G / Shift+Cmd+G for find next/previous
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "g" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        if (e.shiftKey) findPrevious();
        else findNext();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [findNext, findPrevious]);

  const hasQuery = queryRef.current.length > 0;

  return (
    <div className="absolute top-2 right-4 z-30 flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 shadow-lg w-72">
      <input
        ref={inputRef}
        type="text"
        placeholder="Search..."
        className="bg-transparent text-sm text-zinc-200 placeholder:text-zinc-500 outline-none flex-1 min-w-0"
        onChange={(e) => {
          queryRef.current = e.target.value;
          if (e.target.value) {
            searchAddon.findNext(e.target.value, SEARCH_OPTIONS);
          } else {
            searchAddon.clearDecorations();
            setResultIndex(-1);
            setResultCount(0);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) findPrevious();
            else findNext();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      />
      <span className="text-xs text-zinc-500 tabular-nums whitespace-nowrap w-16 text-right">
        {hasQuery
          ? resultCount === 0
            ? "No results"
            : resultIndex >= 0
              ? `${resultIndex + 1}/${resultCount}`
              : `${resultCount}+`
          : ""}
      </span>
      <button
        onClick={findPrevious}
        className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
        title={`Previous (${isMac ? "⇧⌘G" : "Ctrl+Shift+G"})`}
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        onClick={findNext}
        className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
        title={`Next (${isMac ? "⌘G" : "Ctrl+G"})`}
      >
        <ChevronDown className="size-4" />
      </button>
      <button
        onClick={close}
        className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
        title="Close (Escape)"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
