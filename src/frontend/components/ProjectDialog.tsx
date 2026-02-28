import { useState, useRef, useEffect, useCallback } from "react";
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

interface DirResult {
  parent: string;
  directories: string[];
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

  const [suggestions, setSuggestions] = useState<DirResult | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
      setSuggestions(null);
      setShowSuggestions(false);
      setTimeout(() => nameInputRef.current?.select(), 0);
    }
  }, [open, mode, project?.id]);

  const fetchSuggestions = useCallback((path: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!path) {
        setSuggestions(null);
        setShowSuggestions(false);
        return;
      }
      try {
        const res = await fetch(
          `/api/directories?path=${encodeURIComponent(path)}`
        );
        const data: DirResult = await res.json();
        setSuggestions(data);
        setShowSuggestions(data.directories.length > 0);
        setSelectedIndex(0);
      } catch {
        setSuggestions(null);
        setShowSuggestions(false);
      }
    }, 200);
  }, []);

  const selectSuggestion = useCallback(
    (dirName: string) => {
      if (!suggestions) return;
      const newPath = suggestions.parent + "/" + dirName + "/";
      setInitialPath(newPath);
      setShowSuggestions(false);
      // Fetch next level
      fetchSuggestions(newPath);
    },
    [suggestions, fetchSuggestions]
  );

  const handlePathChange = (value: string) => {
    setInitialPath(value);
    fetchSuggestions(value);
  };

  const handlePathKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || !suggestions) return;

    const dirs = suggestions.directories;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, dirs.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (dirs[selectedIndex]) selectSuggestion(dirs[selectedIndex]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (dirs[selectedIndex]) selectSuggestion(dirs[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowSuggestions(false);
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (!showSuggestions || !dropdownRef.current) return;
    const el = dropdownRef.current.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, showSuggestions]);

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
            if (showSuggestions) return;
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
            <div className="relative">
              <Input
                id="project-path"
                value={initialPath}
                onChange={(e) => handlePathChange(e.target.value)}
                onKeyDown={handlePathKeyDown}
                onFocus={() => {
                  if (suggestions && suggestions.directories.length > 0) {
                    setShowSuggestions(true);
                  }
                }}
                onBlur={() => {
                  blurTimeoutRef.current = setTimeout(
                    () => setShowSuggestions(false),
                    150
                  );
                }}
                placeholder="~/projects/my-app"
                autoComplete="off"
                data-1p-ignore
              />
              {showSuggestions && suggestions && suggestions.directories.length > 0 && (
                <div
                  ref={dropdownRef}
                  className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
                >
                  {suggestions.directories.map((dir, i) => (
                    <div
                      key={dir}
                      className={`cursor-pointer px-3 py-1.5 text-sm ${
                        i === selectedIndex
                          ? "bg-zinc-700 text-white"
                          : "text-zinc-300 hover:bg-zinc-800"
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault(); // Prevent input blur
                        selectSuggestion(dir);
                      }}
                      onMouseEnter={() => setSelectedIndex(i)}
                    >
                      {dir}/
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-zinc-500">New sessions in this project will start in this directory</p>
          </div>
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
