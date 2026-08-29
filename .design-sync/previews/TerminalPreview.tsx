import { StatusDot, TerminalPreview, TerminalThemeProvider, TooltipProvider } from "codetoaster";
import { useEffect, useRef, type ReactNode } from "react";

// TerminalPreview IS the hover panel — the row it wraps is just the trigger — so
// a card that only shows rows shows nothing of the component. Radix opens a
// tooltip on focus as well as on hover (Trigger.onFocus -> context.onOpen), so
// these stories focus one row on mount and the component's own portal renders
// its real content: the scrollback thumbnail, or the suspended fallback.
//
// `getPreview` returns exactly what `/api/tasks/:id/preview` returns —
// serialize-addon HTML, a <pre> of one <div> per row — because the component's
// scoped CSS shrinks `pre > div` to 7px to make the thumbnail.
const row = (html: string) => `<div>${html}</div>`;
const dim = (text: string) => `<span style="color:#8b949e">${text}</span>`;
const ok = (text: string) => `<span style="color:#7ee787">${text}</span>`;

const scrollback =
  `<pre style="background-color:#1e1e1e;color:#d4d4d4">` +
  [
    `${ok("$")} bun test src/lib/xtmux`,
    dim("bun test v1.2.0"),
    "",
    `${ok("✓")} pty.test.ts &gt; smallest client wins [12ms]`,
    `${ok("✓")} pty.test.ts &gt; scrollback survives [8ms]`,
    `${ok("✓")} manager.test.ts &gt; slug keeps uuid [3ms]`,
    `${ok("✓")} manager.test.ts &gt; harvests idle [41ms]`,
    `${ok("✓")} resume.test.ts &gt; replays snapshot [19ms]`,
    "",
    dim(" 51 pass"),
    dim("  0 fail"),
    dim(" Ran 51 tests [612ms]"),
    "",
    `${ok("$")} git status --short`,
    " M src/lib/xtmux/pty.ts",
    " M src/lib/tasks/manager.ts",
    `${ok("$")} ` + `<span style="background-color:#d4d4d4;color:#1e1e1e"> </span>`,
  ]
    .map(row)
    .join("") +
  `</pre>`;

/** Focuses the row marked `data-open`, which is what opens the panel. */
const Wrap = ({ children }: { children: ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-open]")?.focus();
  }, []);
  return (
    <TerminalThemeProvider>
      <TooltipProvider>
        <div ref={ref} style={{ width: 760, minHeight: 220, paddingBottom: 24 }}>
          {/* p-1, not p-2: the row is the tooltip's anchor and the panel sits 8px
              off it, so a fatter gutter would leave the panel flush against the
              list's own border. */}
          <div className="w-72 rounded-md border border-border p-1">{children}</div>
        </div>
      </TooltipProvider>
    </TerminalThemeProvider>
  );
};

const Row = ({ name, connected }: { name: string; connected: boolean }) => (
  <div className="flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-accent">
    <StatusDot isConnected={connected} isExited={false} isActive={false} isSuspended={!connected} />
    <span className="truncate text-foreground">{name}</span>
  </div>
);

export const SessionRows = () => (
  <Wrap>
    {[
      { id: "a", name: "codetoaster · v2", connected: true, open: true },
      { id: "b", name: "api-gateway · main", connected: true, open: false },
      { id: "c", name: "docs-site · draft", connected: true, open: false },
    ].map((s) => (
      <TerminalPreview
        key={s.id}
        sessionId={s.id}
        fetchPreview={() => {}}
        getPreview={() => scrollback}
      >
        <div tabIndex={0} data-open={s.open || undefined} className="rounded outline-none">
          <Row name={s.name} connected={s.connected} />
        </div>
      </TerminalPreview>
    ))}
  </Wrap>
);

export const SuspendedSession = () => (
  <Wrap>
    <TerminalPreview
      sessionId="d"
      hasTerminal={false}
      fetchPreview={() => {}}
      getPreview={() => null}
    >
      <div tabIndex={0} data-open className="rounded outline-none">
        <Row name="docs-site · draft" connected={false} />
      </div>
    </TerminalPreview>
  </Wrap>
);
