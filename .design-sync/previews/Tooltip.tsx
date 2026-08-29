import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "codetoaster";
import {
  Columns2,
  EllipsisVertical,
  GitBranch,
  Plus,
  Search,
  TerminalSquare,
  WrapText,
} from "lucide-react";

const noop = () => {};

/** The common case: an icon-only control whose tooltip supplies its name. */
export const IconButton = () => (
  <TooltipProvider>
    <div
      className="flex w-full items-center justify-center"
      style={{ minHeight: 140, paddingTop: 56 }}
    >
      <Tooltip open onOpenChange={noop}>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="New session">
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">New session ⌘N</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);

/** `side` on all four edges — the arrow follows the trigger. */
export const Sides = () => (
  <TooltipProvider>
    <div
      className="w-full"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        columnGap: 200,
        rowGap: 110,
        padding: "56px 72px",
        justifyItems: "center",
      }}
    >
      {(
        [
          { side: "top", label: "Terminal search", icon: Search, hint: "Terminal search ⌘F" },
          { side: "bottom", label: "Wrap lines", icon: WrapText, hint: "Wrap long lines" },
          { side: "right", label: "Branch", icon: GitBranch, hint: "On branch v2" },
          { side: "left", label: "Split view", icon: Columns2, hint: "Side-by-side diff" },
        ] as const
      ).map(({ side, label, icon: Icon, hint }) => (
        <Tooltip key={side} open onOpenChange={noop}>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" aria-label={label}>
              <Icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={side}>{hint}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  </TooltipProvider>
);

/** How the collapsed sidebar labels its rail: text only, always to the right. */
export const CollapsedSidebarRail = () => (
  <TooltipProvider>
    <div className="flex" style={{ minHeight: 200 }}>
      <div className="bg-sidebar border-border flex w-12 flex-col items-center gap-1 rounded-md border py-2">
        <Tooltip open onOpenChange={noop}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="codetoaster · v2">
              <TerminalSquare />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" align="center">
            codetoaster · v2
          </TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon" aria-label="api-gateway · main">
          <TerminalSquare />
        </Button>
        <Button variant="ghost" size="icon" aria-label="More">
          <EllipsisVertical />
        </Button>
      </div>
    </div>
  </TooltipProvider>
);

/** Tooltips stay text: a longer hint wraps and balances rather than growing
 * into a panel. Anything clickable belongs in a Popover instead. */
export const LongHint = () => (
  <TooltipProvider>
    <div
      className="flex w-full items-center justify-center"
      style={{ minHeight: 180, paddingTop: 96 }}
    >
      <Tooltip open onOpenChange={noop}>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm">
            Suspended
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" style={{ maxWidth: 260 }}>
          Harvested after 30 minutes idle. The scrollback is on disk — reopening
          the session restores it and starts the shell again.
        </TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);
