import { useState } from "react";
import { CircleHelp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";

const isMac =
  typeof navigator !== "undefined" && navigator.platform.includes("Mac");
const mod = isMac ? "⌘" : "Ctrl";

const hotkeys: { keys: string[]; description: string }[] = [
  { keys: [mod, "B"], description: "Toggle sidebar" },
  { keys: [mod, "Shift", "P"], description: "Command palette" },
  { keys: [mod, "F"], description: "Terminal search" },
  { keys: [mod, "G"], description: "Find next" },
  { keys: [mod, "Shift", "G"], description: "Find previous" },
  { keys: [mod, "`"], description: "Next session (MRU)" },
  { keys: [mod, "Shift", "`"], description: "Previous session (MRU)" },
  { keys: ["Shift", "Enter"], description: "Literal newline" },
  { keys: ["\u2190 / \u2192"], description: "Prev/next file (diff view)" },
];

export function HelpButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-zinc-500"
        onClick={() => setOpen(true)}
      >
        <CircleHelp className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            {hotkeys.map(({ keys, description }) => (
              <div
                key={description}
                className="flex items-center justify-between py-1.5"
              >
                <span className="text-sm text-muted-foreground">
                  {description}
                </span>
                <div className="flex items-center gap-1">
                  {keys.map((key, i) => (
                    <kbd
                      key={i}
                      className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded border min-w-[1.5rem] text-center"
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
    </>
  );
}
