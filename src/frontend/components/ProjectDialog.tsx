import { useState, useRef, useEffect } from "react";
import { FolderOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import type { ProjectInfo } from "../SessionContext";
import { InitialPathAutocomplete } from "./InitialPathAutocomplete";
import { DirectoryPickerDialog } from "./DirectoryPickerDialog";

interface ProjectDialogProps {
  mode: "create" | "edit";
  project: ProjectInfo | null;
  open: boolean;
  onSave: (name: string, initialPath: string) => void;
  onClose: () => void;
}

export function ProjectDialog({
  mode,
  project,
  open,
  onSave,
  onClose,
}: ProjectDialogProps) {
  const [name, setName] = useState("");
  const [initialPath, setInitialPath] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isPathAutocompleteOpen, setIsPathAutocompleteOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      if (mode === "edit" && project) {
        setName(project.name);
        setInitialPath(project.initialPath);
      } else {
        setName("");
        setInitialPath("");
      }
      setIsPathAutocompleteOpen(false);
      setTimeout(() => nameInputRef.current?.select(), 0);
    }
  }, [open, mode, project?.id]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, initialPath.trim());
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="overflow-visible">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New Project" : "Edit Project"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isPathAutocompleteOpen) return;
            handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="project-name" className="text-sm font-medium">Name</label>
            <Input
              id="project-name"
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              data-1p-ignore
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="project-path" className="text-sm font-medium">Initial Path</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <InitialPathAutocomplete
                  inputId="project-path"
                  value={initialPath}
                  onChange={setInitialPath}
                  onOpenChange={setIsPathAutocompleteOpen}
                  placeholder="~/projects/my-app"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setIsPickerOpen(true)}
                title="Browse directories"
              >
                <FolderOpen size={16} />
              </Button>
            </div>
            <p className="text-xs text-zinc-500">New sessions in this project will start in this directory</p>
          </div>
          <DirectoryPickerDialog
            open={isPickerOpen}
            onOpenChange={setIsPickerOpen}
            initialPath={initialPath}
            onSelect={setInitialPath}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
