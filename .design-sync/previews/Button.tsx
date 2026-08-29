import { Button } from "codetoaster";
import { GitBranch, Plus, Trash2, X } from "lucide-react";

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button>New session</Button>
    <Button variant="secondary">Attach</Button>
    <Button variant="outline">Open folder</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="destructive">Kill session</Button>
    <Button variant="link">View changes</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button size="sm">Small</Button>
    <Button size="default">Default</Button>
    <Button size="lg">Large</Button>
    <Button size="icon" aria-label="Close">
      <X />
    </Button>
  </div>
);

export const WithIcons = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button>
      <Plus /> New session
    </Button>
    <Button variant="outline">
      <GitBranch /> main
    </Button>
    <Button variant="destructive">
      <Trash2 /> Delete project
    </Button>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button disabled>New session</Button>
    <Button variant="outline" disabled>
      Open folder
    </Button>
    <Button variant="destructive" disabled>
      Kill session
    </Button>
  </div>
);
