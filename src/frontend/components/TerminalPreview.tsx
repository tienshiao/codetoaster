import { useId, type ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { Tooltip, TooltipTrigger } from "./ui/tooltip";
import { useTerminalTheme } from "../hooks/use-terminal-theme";

interface TerminalPreviewProps {
  sessionId: string;
  children: ReactNode;
  fetchPreview: (sessionId: string) => void;
  getPreview: (sessionId: string) => string | null;
}

export function TerminalPreview({
  sessionId,
  children,
  fetchPreview,
  getPreview,
}: TerminalPreviewProps) {
  const { theme, cssFontFamily } = useTerminalTheme();
  const html = getPreview(sessionId);
  const scopeId = useId();
  const scopeClass = `tp-${scopeId.replace(/:/g, "")}`;

  const bg = theme?.background ?? "#1e1e1e";
  const fg = theme?.foreground ?? "#d4d4d4";

  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild onMouseEnter={() => fetchPreview(sessionId)}>
        {children}
      </TooltipTrigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="right"
          sideOffset={8}
          className="animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=right]:slide-in-from-left-2 z-50 rounded-md shadow-xl"
          style={{ backgroundColor: bg }}
        >
          {html ? (
            <div
              className={`${scopeClass} rounded-md overflow-hidden pointer-events-none`}
              style={{ maxWidth: 360, maxHeight: 200 }}
            >
              <style dangerouslySetInnerHTML={{ __html: `
                .${scopeClass} pre {
                  margin: 0 !important;
                  padding: 0 !important;
                  background: transparent !important;
                }
                .${scopeClass} pre > div {
                  font-size: 7px !important;
                  line-height: 8px !important;
                  font-family: ${cssFontFamily} !important;
                }
                .${scopeClass} pre > div > div {
                  background: inherit !important;
                }
              `}} />
              <div dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          ) : (
            <div
              className="rounded-md px-3 py-2 text-xs"
              style={{ background: bg, color: fg }}
            >
              Loading…
            </div>
          )}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </Tooltip>
  );
}
