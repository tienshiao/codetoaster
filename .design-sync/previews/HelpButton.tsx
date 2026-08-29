import { useEffect, useRef } from "react";
import { HelpButton } from "codetoaster";

// HelpButton owns its own dialog and takes no props, so the only way to show
// the open state is to press the real trigger once the card has mounted.
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

// Where it actually lives: the sidebar footer strip, a muted ghost icon button
// sitting at the end of the row.
export const InSidebarFooter = () => (
  <div className="w-64 overflow-hidden rounded-md border border-border bg-background">
    <div className="flex flex-col gap-0.5 p-2">
      <div className="rounded px-2 py-1.5 text-sm text-foreground">
        codetoaster · v2
      </div>
      <div className="rounded px-2 py-1.5 text-sm text-muted-foreground">
        api-gateway · main
      </div>
      <div className="rounded px-2 py-1.5 text-sm text-muted-foreground">
        docs-site · draft
      </div>
    </div>
    <div className="border-t border-border p-2">
      <div className="flex items-center gap-1">
        <span className="flex-1 px-2 text-xs text-muted-foreground">
          CodeToaster
        </span>
        <HelpButton />
      </div>
    </div>
  </div>
);

// Pressed: the keyboard-shortcut reference, one row per binding with the keys
// as <kbd> chips. Modifier glyphs follow the host platform.
export const ShortcutReference = () => (
  <PressOnMount>
    <HelpButton />
  </PressOnMount>
);
