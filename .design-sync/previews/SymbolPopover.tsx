import { PreviewQuery, PreviewRouter, SymbolPopover } from "codetoaster";
import type { ReactNode } from "react";

// SymbolPopover reads router context (useNavigate/useParams) and fetches its data
// through react-query. Both providers come from the bundle (see
// .design-sync/preview-context.tsx) so they are the same module instances the
// component reads from, and the query cache is seeded with a real
// SymbolLookupResult under the hook's own key. The component renders from genuine
// data on its real code path — nothing here reimplements its markup.
const SESSION = "codetoaster-v2";
const SYMBOL = "resolveSession";
const key = [["sessions", SESSION, "symbols", SYMBOL]] as const;

const entry = (
  path: string,
  line: number,
  kind: "definition" | "reference",
  context: string,
) => ({ name: SYMBOL, path, line, kind, symbolKind: "function", context });

const DEFINITION = entry(
  "src/lib/xtmux/manager.ts",
  142,
  "definition",
  "export function resolveSession(id: string): Session | null {",
);
const REFERENCES = [
  entry("src/api/tasks.ts", 88, "reference", "const session = resolveSession(params.id);"),
  entry("src/server.ts", 214, "reference", "if (!resolveSession(sessionId)) return notFound();"),
];

function Stage({ data, children }: { data: unknown; children: ReactNode }) {
  return (
    <PreviewQuery seed={[[key[0], data]]}>
      <PreviewRouter>
        <div className="relative h-[440px] w-[620px] rounded-md border border-border bg-background">
          {children}
        </div>
      </PreviewRouter>
    </PreviewQuery>
  );
}

const target = { name: SYMBOL, x: 140, y: 96 };
const popover = <SymbolPopover sessionId={SESSION} target={target} onClose={() => {}} />;

export const DefinitionsAndReferences = () => (
  <Stage data={{ definitions: [DEFINITION], references: REFERENCES, truncated: false }}>
    {popover}
  </Stage>
);

export const DefinitionOnly = () => (
  <Stage data={{ definitions: [DEFINITION], references: [], truncated: false }}>{popover}</Stage>
);

// The symbol index answered, and had nothing. Seeded as a real empty result
// rather than left unseeded: an unseeded query would reach the same markup by
// failing its fetch, which is a different thing wearing the same face.
export const NoResults = () => (
  <Stage data={{ definitions: [], references: [], truncated: false }}>{popover}</Stage>
);
