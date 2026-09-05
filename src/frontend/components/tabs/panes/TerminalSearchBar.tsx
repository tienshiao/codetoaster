import { useEffect, useRef, useState, useCallback, type RefObject } from "react";
import type { SearchAddon } from "@xterm/addon-search";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import { IconButton } from "@/frontend/components/v2/IconButton";
import { isSearchChord, isSearchOpenChord, searchStepHint } from "@/frontend/keymap";

/**
 * xterm decoration colours, not CSS: the addon paints these into the grid's
 * own canvas/webgl layer, so they have to be colour *strings* and cannot be
 * `var(--…)` tokens the way the chrome around them is.
 */
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
  /** Rises on every open request; the input takes focus and selects on each
   * rise, so ⌘F while already open re-enters the field. */
  activation: number;
  /** This pane's root. ⌘G / ⇧⌘G are listened for on the document, and this is
   * what says a press was typed *inside* this pane — see the effect below. */
  scope: RefObject<HTMLElement | null>;
  /** Whether this pane's group is the layout's active one. It decides which bar
   * answers a ⌘G pressed outside every terminal — see the effect below. */
  active?: boolean;
}

export function TerminalSearchBar({
  searchAddon,
  onClose,
  activation,
  scope,
  active = false,
}: TerminalSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // State rather than a ref, because the count span reads it. A first query
  // that matches nothing fires `onDidChangeResults` with the same `-1 / 0` the
  // bar started at, React bails out of the render — and with the query in a ref
  // there is nothing else changing, so "No results" never appeared.
  const [query, setQuery] = useState("");
  const [resultIndex, setResultIndex] = useState(-1);
  const [resultCount, setResultCount] = useState(0);

  // On the activation counter rather than on mount: the bar stays mounted
  // while it is open, so a second ⌘F is a re-entry into a field that is already
  // there — see `useTerminalSearch`.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [activation]);

  // Subscribe to search result changes
  useEffect(() => {
    const disposable = searchAddon.onDidChangeResults((e) => {
      setResultIndex(e.resultIndex);
      setResultCount(e.resultCount);
    });
    return () => disposable.dispose();
  }, [searchAddon]);

  const findNext = useCallback(() => {
    if (query) searchAddon.findNext(query, SEARCH_OPTIONS);
  }, [searchAddon, query]);

  const findPrevious = useCallback(() => {
    if (query) searchAddon.findPrevious(query, SEARCH_OPTIONS);
  }, [searchAddon, query]);

  const close = useCallback(() => {
    searchAddon.clearDecorations();
    onClose();
  }, [searchAddon, onClose]);

  // ⌘G / ⇧⌘G for next and previous match, heard on the document but answered by
  // one bar.
  //
  // Bound on the pane root, the chord did nothing the moment the caret left the
  // pane — clicking the Explorer, the tab strip, or anywhere in the body — while
  // the bar went on advertising it on its own buttons. Bound on the document and
  // nothing else, a split's two open bars would both answer one press and step
  // matches in a terminal the user is not looking at.
  //
  // So the document hears it and two rules decide whose it is. If the press came
  // from inside this pane it is this pane's, whatever else is open: that is the
  // caret in this terminal or in this bar's own input. Otherwise — a press from
  // outside every terminal, which is what `[data-terminal-pane]` marks — it
  // belongs to the pane in the layout's active group, so exactly one bar answers
  // and a press aimed at *another* terminal is left to that terminal's own bar.
  //
  // Matched with the same predicate the terminal yields on, so the key it lets
  // past is the key this binds — spelling it out here is how ⇧⌘G ended up
  // reaching nobody, since with Shift held the browser reports `G`. Bubble phase
  // for the same reason: xterm's handler runs first and lets the chord through
  // (`terminalMustYield`).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isSearchChord(e)) return;
      const target = e.target as Element | null;
      const inside = scope.current?.contains(target as Node | null) ?? false;
      const inAnotherTerminal = !inside && target?.closest?.("[data-terminal-pane]") != null;
      if (!inside && (!active || inAnotherTerminal)) return;
      e.preventDefault();
      if (e.shiftKey) findPrevious();
      else findNext();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [scope, active, findNext, findPrevious]);

  const hasQuery = query.length > 0;

  return (
    <div
      role="search"
      aria-label="Find in terminal"
      // `z-30`: above the pane's reopen overlay and the terminal's drag/resize
      // layers, which sit at z-20 and are rendered after the bar.
      className="absolute top-2 right-3 z-30 flex w-72 items-center gap-1 rounded-md border border-border bg-popover px-2 py-1 shadow-overlay"
    >
      <input
        ref={inputRef}
        type="text"
        placeholder="Search…"
        aria-label="Search terminal"
        className="min-w-0 flex-1 bg-transparent font-sans text-sm tracking-ui text-foreground outline-none placeholder:text-subtle-foreground"
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value) {
            searchAddon.findNext(e.target.value, SEARCH_OPTIONS);
          } else {
            searchAddon.clearDecorations();
            setResultIndex(-1);
            setResultCount(0);
          }
        }}
        onKeyDown={(e) => {
          if (isSearchOpenChord(e)) {
            // ⌘F with the caret already here: re-select rather than let the
            // browser's own find open over the app — xterm's handler only sees
            // it from the grid.
            e.preventDefault();
            e.currentTarget.select();
            return;
          }
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
      <span className="w-16 text-right font-mono text-micro tabular-nums text-subtle-foreground">
        {hasQuery
          ? resultCount === 0
            ? "No results"
            : resultIndex >= 0
              ? `${resultIndex + 1}/${resultCount}`
              : `${resultCount}+`
          : ""}
      </span>
      <IconButton
        icon={ChevronUp}
        label="Previous match"
        hint={searchStepHint(true)}
        size="sm"
        onClick={findPrevious}
      />
      <IconButton
        icon={ChevronDown}
        label="Next match"
        hint={searchStepHint(false)}
        size="sm"
        onClick={findNext}
      />
      <IconButton icon={X} label="Close search" hint="Escape" size="sm" onClick={close} />
    </div>
  );
}
