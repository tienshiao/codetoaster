import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "codetoaster";
import { FolderGit2 } from "lucide-react";

const noop = () => {};

/**
 * The rename flow from the sidebar's session menu (RenameDialog): one field,
 * seeded with the label currently on screen.
 */
export const RenameSession = () => (
  <Dialog open onOpenChange={noop}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Rename session</DialogTitle>
        <DialogDescription>
          Pins a name for this session. Clearing it lets the terminal title show
          through again.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="session-name">
          Name
        </label>
        <Input id="session-name" defaultValue="codetoaster · v2" />
      </div>
      <DialogFooter>
        <Button variant="outline">Cancel</Button>
        <Button>Rename</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/** A form dialog with several fields — the project create/edit surface. */
export const NewProject = () => (
  <Dialog open onOpenChange={noop}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          Projects group sessions under a working directory. New sessions start
          in the initial path below.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="project-name">
            Project name
          </label>
          <Input id="project-name" defaultValue="codetoaster" />
        </div>
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="project-path">
            Initial path
          </label>
          <Input
            id="project-path"
            className="font-mono text-xs"
            defaultValue="~/Projects/codetoaster"
          />
          <p className="text-muted-foreground text-xs">
            Relative paths resolve against your home directory.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline">Cancel</Button>
        <Button>
          <FolderGit2 />
          Create project
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/** A wider dialog whose body scrolls — the settings surface. */
export const Settings = () => (
  <Dialog open onOpenChange={noop}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>
          Appearance and terminal preferences. Changes apply to every session.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid items-start gap-x-6 gap-y-2 sm:grid-cols-[1fr_1.5fr]">
          <div>
            <div className="text-sm font-medium">Theme</div>
            <p className="text-muted-foreground text-xs">
              Controls the app's light and dark appearance
            </p>
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="flex-1">
              System
            </Button>
            <Button variant="outline" size="sm" className="border-primary bg-accent flex-1">
              Light
            </Button>
            <Button variant="outline" size="sm" className="flex-1">
              Dark
            </Button>
          </div>
        </div>
        <div className="grid items-start gap-x-6 gap-y-2 sm:grid-cols-[1fr_1.5fr]">
          <div>
            <div className="text-sm font-medium">Terminal font</div>
            <p className="text-muted-foreground text-xs">
              Family and size for the terminal emulator
            </p>
          </div>
          <div className="flex gap-2">
            <Input className="font-mono text-xs" defaultValue="JetBrainsMono Nerd Font" />
            <Input className="w-16 font-mono text-xs" defaultValue="13" />
          </div>
        </div>
        <div className="grid items-start gap-x-6 gap-y-2 sm:grid-cols-[1fr_1.5fr]">
          <div>
            <div className="text-sm font-medium">Bell sound</div>
            <p className="text-muted-foreground text-xs">
              Played when a session emits a terminal bell
            </p>
          </div>
          <div className="flex gap-2">
            <Input defaultValue="Subtle chime" />
            <Button variant="outline" size="sm">
              Preview
            </Button>
          </div>
        </div>
      </div>
      <DialogFooter showCloseButton />
    </DialogContent>
  </Dialog>
);

/** Content-only dialog — no footer actions, just reference material. */
export const KeyboardShortcuts = () => (
  <Dialog open onOpenChange={noop}>
    <DialogContent
      className="sm:max-w-md"
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <DialogHeader>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>
          Available anywhere in CodeToaster except while the terminal has raw
          input focus.
        </DialogDescription>
      </DialogHeader>
      <div className="grid">
        {[
          { keys: ["⌘", "B"], description: "Toggle sidebar" },
          { keys: ["⌘", "Shift", "P"], description: "Command palette" },
          { keys: ["⌘", "F"], description: "Terminal search" },
          { keys: ["⌘", "`"], description: "Next session (MRU)" },
          { keys: ["Shift", "Enter"], description: "Literal newline" },
          { keys: ["← / →"], description: "Prev/next file (diff view)" },
        ].map(({ keys, description }) => (
          <div key={description} className="flex items-center justify-between py-1.5">
            <span className="text-muted-foreground text-sm">{description}</span>
            <div className="flex items-center gap-1">
              {keys.map((key) => (
                <kbd
                  key={key}
                  className="bg-muted min-w-[1.5rem] rounded border px-1.5 py-0.5 text-center font-mono text-xs"
                >
                  {key}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);
