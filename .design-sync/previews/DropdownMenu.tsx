import type { ReactNode } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "codetoaster";
import {
  Copy,
  EllipsisVertical,
  ExternalLink,
  GitBranch,
  Pencil,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";

const noop = () => {};

/** Reserves the room the portalled menu occupies so a card cell frames it.
 * Inline style, not a utility class — see the batch learnings note on Tailwind
 * classes that only exist in a preview. */
const Stage = ({ children }: { children: ReactNode }) => (
  <div className="w-full" style={{ minHeight: 300 }}>
    {children}
  </div>
);

/** The row menu on a session in the sidebar: plain actions, a shortcut hint,
 * and one destructive item at the bottom. */
export const SessionActions = () => (
  <Stage>
    <DropdownMenu open onOpenChange={noop} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Session actions">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>codetoaster · v2</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <Pencil />
            Rename session
            <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Copy />
            Copy session URL
          </DropdownMenuItem>
          <DropdownMenuItem>
            <GitBranch />
            Review changes
            <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <X />
          Close session
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </Stage>
);

/** Stateful options: `DropdownMenuCheckboxItem` for toggles and a
 * `DropdownMenuRadioGroup` for a single choice, separated by a label. */
export const DiffViewOptions = () => (
  <Stage>
    <DropdownMenu open onOpenChange={noop} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal />
          View
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Layout</DropdownMenuLabel>
        <DropdownMenuRadioGroup value="unified">
          <DropdownMenuRadioItem value="unified">Unified</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="split">Side by side</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Display</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked>Wrap long lines</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked>Word-level highlight</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={false}>
          Show whitespace
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <RefreshCw />
          Refresh diff
          <DropdownMenuShortcut>⌘⇧R</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </Stage>
);

/** `DropdownMenuSub` nests a second menu, and a disabled item shows an action
 * that is unavailable rather than hidden. */
export const ProjectMenuWithSubmenu = () => (
  <Stage>
    <DropdownMenu open onOpenChange={noop} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Project actions">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>api-gateway</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Plus />
          New session
          <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>
            <ExternalLink />
            Open in
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-32">
            <DropdownMenuItem>Finder</DropdownMenuItem>
            <DropdownMenuItem>VS Code</DropdownMenuItem>
            <DropdownMenuItem>Cursor</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem>
          <Pencil />
          Edit project
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <GitBranch />
          Review changes
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive">
          <Trash2 />
          Delete project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </Stage>
);
