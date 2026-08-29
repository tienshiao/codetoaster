import { TerminalSearchBar } from "codetoaster";
import type { SearchAddon } from "@xterm/addon-search";
import { useEffect, useMemo, useRef, type ReactNode } from "react";

// TerminalSearchBar drives a live xterm SearchAddon and keeps its query in a ref
// on an uncontrolled input, so a static render always shows the empty bar with no
// match count. These stories drive the REAL component the real way: a stand-in
// addon that answers `findNext(query)` from a match table and reports through its
// own onDidChangeResults channel, plus genuine `input` events so the component's
// own onChange runs. No markup is reimplemented.
//
// The queries are typed as a SEQUENCE, one commit apart, because the component
// reads `hasQuery` off a ref: a query that goes straight from nothing to zero
// matches leaves resultIndex/resultCount at their initial -1/0, React bails out
// of the re-render, and the "No results" label never appears. Typing a matching
// query first and then replacing it is both what a user does and what makes the
// component render the state the story is about.
const MATCHES: Record<string, { index: number; count: number }> = {
  test: { index: 2, count: 12 },
  "pty.test.ts": { index: 0, count: 2 },
};

function Bar({ type = [], children }: { type?: string[]; children?: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef<((e: { resultIndex: number; resultCount: number }) => void) | null>(null);
  const typeRef = useRef(type);
  typeRef.current = type;

  const addon = useMemo(
    () =>
      ({
        onDidChangeResults: (cb: (e: { resultIndex: number; resultCount: number }) => void) => {
          cbRef.current = cb;
          return { dispose() {} };
        },
        findNext: (query: string) => {
          const hit = MATCHES[query] ?? { index: -1, count: 0 };
          cbRef.current?.({ resultIndex: hit.index, resultCount: hit.count });
          return hit.count > 0;
        },
        findPrevious: () => true,
        clearDecorations: () => {},
      }) as unknown as SearchAddon,
    [],
  );

  useEffect(() => {
    const queries = typeRef.current;
    const input = hostRef.current?.querySelector("input");
    if (!input || queries.length === 0) return;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      setValue?.call(input, queries[i]);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      i += 1;
      if (i < queries.length) timer = setTimeout(step, 40);
    };
    step();
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      ref={hostRef}
      className="relative h-[200px] w-[620px] overflow-hidden rounded-md bg-[#1e1e1e] p-3 font-mono text-xs leading-5 text-[#d4d4d4]"
    >
      {children}
      <TerminalSearchBar searchAddon={addon} onClose={() => {}} />
    </div>
  );
}

const scrollback = (
  <>
    <div><span className="text-[#7ee787]">$</span> bun test src/lib/xtmux</div>
    <div className="text-[#8b949e]">bun test v1.2.0</div>
    <div><span className="text-[#7ee787]">✓</span> pty.test.ts (12 tests)</div>
    <div><span className="text-[#7ee787]">✓</span> manager.test.ts (31 tests)</div>
    <div><span className="text-[#7ee787]">✓</span> resume.test.ts (8 tests)</div>
    <div className="text-[#8b949e]">51 pass, 0 fail</div>
  </>
);

/** A query with hits: the bar reports position within the match set. */
export const WithMatches = () => <Bar type={["test"]}>{scrollback}</Bar>;

/** The same bar after the query is narrowed to something the buffer lacks. */
export const NoMatches = () => <Bar type={["test", "websocket"]}>{scrollback}</Bar>;

/** Freshly opened with ⌘F: placeholder, no count, controls still live. */
export const Empty = () => <Bar>{scrollback}</Bar>;
