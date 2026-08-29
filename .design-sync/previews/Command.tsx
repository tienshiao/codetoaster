import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "codetoaster";
import { FileText, GitBranch, Plus, Settings, TerminalSquare, Trash2 } from "lucide-react";

export const SessionPalette = () => (
  <Command className="w-[420px] rounded-lg border border-border shadow-md">
    <CommandInput placeholder="Search sessions and commands…" />
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>
      <CommandGroup heading="Sessions">
        <CommandItem>
          <TerminalSquare />
          <span>codetoaster · v2</span>
          <CommandShortcut>⌘1</CommandShortcut>
        </CommandItem>
        <CommandItem>
          <TerminalSquare />
          <span>api-gateway · main</span>
          <CommandShortcut>⌘2</CommandShortcut>
        </CommandItem>
        <CommandItem>
          <TerminalSquare />
          <span>docs-site · draft</span>
          <CommandShortcut>⌘3</CommandShortcut>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Actions">
        <CommandItem>
          <Plus />
          <span>New session</span>
          <CommandShortcut>⌘N</CommandShortcut>
        </CommandItem>
        <CommandItem>
          <GitBranch />
          <span>Review changes</span>
          <CommandShortcut>⌘R</CommandShortcut>
        </CommandItem>
        <CommandItem>
          <Settings />
          <span>Settings</span>
          <CommandShortcut>⌘,</CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
);

export const Filtered = () => (
  <Command className="w-[420px] rounded-lg border border-border shadow-md">
    <CommandInput placeholder="Search sessions and commands…" value="task" />
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>
      <CommandGroup heading="Files">
        <CommandItem>
          <FileText />
          <span>src/api/tasks.ts</span>
        </CommandItem>
        <CommandItem>
          <FileText />
          <span>src/lib/tasks/manager.ts</span>
        </CommandItem>
        <CommandItem>
          <FileText />
          <span>src/lib/tasks/harvester.ts</span>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
);

export const Empty = () => (
  <Command className="w-[420px] rounded-lg border border-border shadow-md">
    <CommandInput placeholder="Search sessions and commands…" value="zzz" />
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>
    </CommandList>
  </Command>
);

export const DestructiveAction = () => (
  <Command className="w-[420px] rounded-lg border border-border shadow-md">
    <CommandInput placeholder="Search…" value="kill" />
    <CommandList>
      <CommandGroup heading="Danger zone">
        <CommandItem className="text-destructive data-[selected=true]:text-destructive">
          <Trash2 />
          <span>Kill session · codetoaster · v2</span>
        </CommandItem>
        <CommandItem className="text-destructive data-[selected=true]:text-destructive">
          <Trash2 />
          <span>Kill all exited sessions</span>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
);
