// SettingsButton calls useTerminalTheme() unconditionally at the top of the
// component — before its dialog is even open — so it must be wrapped in a
// TerminalThemeProvider. That provider is imported from "codetoaster" (the
// bundle re-exports it through .design-sync/preview-context.tsx) and never
// from src/ or node_modules directly, so the context identity matches the one
// the shipped component closed over.
import { useEffect, useRef } from "react";
import { SettingsButton, TerminalThemeProvider } from "codetoaster";

// SettingsButton owns its own dialog and takes no props, so the open state is
// reached by pressing the real trigger once the card has mounted.
function PressOnMount({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.querySelector("button")?.click();
    }, 0);
    return () => clearTimeout(t);
  }, []);
  return <div ref={ref}>{children}</div>;
}

// Where it actually lives: the sidebar footer strip, a muted ghost row that
// stretches to fill the space left of the help button.
export const InSidebarFooter = () => (
  <TerminalThemeProvider>
    <div className="w-64 overflow-hidden rounded-md border border-border bg-background">
      <div className="flex flex-col gap-0.5 p-2">
        <div className="rounded px-2 py-1.5 text-sm text-foreground">
          codetoaster · v2
        </div>
        <div className="rounded px-2 py-1.5 text-sm text-muted-foreground">
          api-gateway · main
        </div>
      </div>
      <div className="border-t border-border p-2">
        <div className="flex items-center gap-1">
          <SettingsButton />
        </div>
      </div>
    </div>
  </TerminalThemeProvider>
);

// Pressed: the preferences sheet — app theme, terminal theme with its swatch
// strip, terminal font and size, and the two notification sounds.
export const PreferencesDialog = () => (
  <TerminalThemeProvider>
    <PressOnMount>
      <SettingsButton />
    </PressOnMount>
  </TerminalThemeProvider>
);
