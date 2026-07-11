export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "module"
  | "field"
  | "constant"
  | "call";

export interface SymbolEntry {
  name: string;
  path: string; // repo-relative
  line: number; // 1-based
  kind: "definition" | "reference";
  symbolKind: SymbolKind;
  context: string; // the source line, trimmed (<= 200 chars)
}

export interface SymbolLookupResult {
  definitions: SymbolEntry[];
  references: SymbolEntry[];
  truncated: boolean;
  partial: boolean;
}

/** One matched name from a fuzzy/prefix search, with its counts and a location
 *  to jump to (a definition when one exists, else the first occurrence). */
export interface SymbolNameMatch {
  name: string;
  symbolKind: SymbolKind;
  defCount: number;
  refCount: number;
  primary: SymbolEntry;
}

export interface SymbolSearchResult {
  matches: SymbolNameMatch[];
  partial: boolean;
}
