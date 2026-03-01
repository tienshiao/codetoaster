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

const COLOR_PRESETS = [
  "",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

interface ProjectDialogProps {
  mode: "create" | "edit";
  project: ProjectInfo | null;
  open: boolean;
  onSave: (name: string, initialPath: string, color: string) => void;
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
  const [color, setColor] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isPathAutocompleteOpen, setIsPathAutocompleteOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      if (mode === "edit" && project) {
        setName(project.name);
        setInitialPath(project.initialPath);
        setColor(project.color);
      } else {
        setName("");
        setInitialPath("");
        setColor("");
      }
      setIsPathAutocompleteOpen(false);
      setTimeout(() => nameInputRef.current?.select(), 0);
    }
  }, [open, mode, project?.id]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, initialPath.trim(), color);
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
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Color</span>
            <div className="flex gap-3 flex-wrap">
              {COLOR_PRESETS.map((c) => {
                const isSelected = color === c;
                return (
                  <button
                    key={c || "none"}
                    type="button"
                    className="size-6 rounded-full transition-shadow"
                    style={{
                      backgroundColor: c || "transparent",
                      border: c === ""
                        ? `2px ${isSelected ? "solid" : "dashed"} hsl(240 5% 35%)`
                        : "2px solid transparent",
                      boxShadow: isSelected
                        ? "0 0 0 2px rgba(0,0,0,0.8), 0 0 0 4px rgba(255,255,255,0.8)"
                        : "none",
                    }}
                    onClick={() => setColor(c)}
                    title={c || "None"}
                  />
                );
              })}
            </div>
          </div>
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
