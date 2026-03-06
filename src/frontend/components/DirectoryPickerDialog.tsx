import { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";

interface DirectoryPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPath: string;
  onSelect: (path: string) => void;
}

interface DirResult {
  parent: string;
  directories: string[];
  home: string;
}

// Module-level cache: absolute path -> child directory names
let childrenCache = new Map<string, string[]>();

async function fetchDir(absolutePath: string): Promise<DirResult> {
  const queryPath = absolutePath.endsWith("/")
    ? absolutePath
    : absolutePath + "/";
  const res = await fetch(
    `/api/directories?path=${encodeURIComponent(queryPath)}`
  );
  return res.json();
}

async function fetchChildren(absolutePath: string): Promise<string[]> {
  const cached = childrenCache.get(absolutePath);
  if (cached) return cached;

  const data = await fetchDir(absolutePath);
  childrenCache.set(absolutePath, data.directories);
  return data.directories;
}

function childPath(parent: string, childName: string): string {
  return parent === "/" ? "/" + childName : parent + "/" + childName;
}

export function DirectoryPickerDialog({
  open,
  onOpenChange,
  initialPath,
  onSelect,
}: DirectoryPickerDialogProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Map<string, string[]>>(
    new Map()
  );
  const [home, setHome] = useState<string>("");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Convert absolute path to ~-prefixed display path
  const toDisplayPath = useCallback(
    (absPath: string) => {
      if (!home) return absPath;
      if (absPath === home) return "~";
      if (absPath.startsWith(home + "/")) return "~" + absPath.slice(home.length);
      return absPath;
    },
    [home]
  );

  // Initialize when dialog opens
  useEffect(() => {
    if (!open) return;

    childrenCache = new Map();
    setChildrenMap(new Map());
    setLoadingPaths(new Set());

    const init = async () => {
      // Resolve homedir from API
      const rootData = await fetchDir("/");
      const resolvedHome = rootData.home;
      setHome(resolvedHome);

      // Translate initialPath to absolute
      let path = initialPath.trim();
      if (path.startsWith("~")) {
        path = resolvedHome + path.slice(1);
      }
      // Remove trailing slash
      if (path.length > 1 && path.endsWith("/")) {
        path = path.slice(0, -1);
      }

      // Build ancestor segments
      const segments: string[] = ["/"];
      if (path && path !== "/") {
        const parts = path.split("/").filter(Boolean);
        for (let i = 0; i < parts.length; i++) {
          segments.push("/" + parts.slice(0, i + 1).join("/"));
        }
      }

      // Fetch children for all ancestors in parallel (root already fetched)
      childrenCache.set("/", rootData.directories);
      const fetches = segments.slice(1).map(async (seg) => {
        try {
          const children = await fetchChildren(seg);
          return [seg, children] as const;
        } catch {
          return [seg, []] as const;
        }
      });

      const results = await Promise.all(fetches);
      const newMap = new Map<string, string[]>();
      const newExpanded = new Set<string>();

      newMap.set("/", rootData.directories);
      newExpanded.add("/");
      for (const [seg, children] of results) {
        newMap.set(seg, [...children]);
        newExpanded.add(seg);
      }

      setChildrenMap(newMap);
      setExpandedPaths(newExpanded);

      const hasInitialPath = initialPath.trim().length > 0;
      const selected = hasInitialPath ? (segments[segments.length - 1] ?? null) : null;
      setSelectedPath(selected);

      if (selected) {
        requestAnimationFrame(() => {
          scrollContainerRef.current
            ?.querySelector("[data-selected]")
            ?.scrollIntoView({ block: "nearest" });
        });
      }
    };

    init();
  }, [open]);

  const loadAndToggle = useCallback(
    async (path: string) => {
      const isExpanded = expandedPaths.has(path);

      if (isExpanded) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
        return;
      }

      if (childrenMap.has(path)) {
        setExpandedPaths((prev) => new Set(prev).add(path));
        return;
      }

      setLoadingPaths((prev) => new Set(prev).add(path));
      try {
        const children = await fetchChildren(path);
        setChildrenMap((prev) => new Map(prev).set(path, children));
        setExpandedPaths((prev) => new Set(prev).add(path));
      } catch {
        // ignore
      } finally {
        setLoadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [expandedPaths, childrenMap]
  );

  const handleClick = useCallback(
    (path: string) => {
      setSelectedPath(path);
      loadAndToggle(path);
    },
    [loadAndToggle]
  );

  const handleDoubleClick = useCallback(
    (path: string) => {
      onSelect(toDisplayPath(path));
      onOpenChange(false);
    },
    [onSelect, onOpenChange, toDisplayPath]
  );

  const handleConfirm = () => {
    if (selectedPath) {
      onSelect(toDisplayPath(selectedPath));
      onOpenChange(false);
    }
  };

  const renderNode = (name: string, path: string, depth: number) => {
    const isExpanded = expandedPaths.has(path);
    const isLoading = loadingPaths.has(path);
    const isSelected = selectedPath === path;
    const children = childrenMap.get(path);

    return (
      <div key={path}>
        <div
          className={`flex items-center gap-1.5 py-1 px-2 text-sm cursor-pointer select-none hover:bg-accent/50 ${
            isSelected ? "bg-accent text-accent-foreground" : "text-foreground/80"
          }`}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
          {...(isSelected ? { "data-selected": true } : undefined)}
          onClick={() => handleClick(path)}
          onDoubleClick={() => handleDoubleClick(path)}
        >
          <span className="shrink-0 text-muted-foreground w-4 flex items-center justify-center">
            {isLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </span>
          <span className="shrink-0 text-muted-foreground">
            {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
          </span>
          <span className="truncate">{name}</span>
        </div>
        {isExpanded &&
          children?.map((childName) =>
            renderNode(childName, childPath(path, childName), depth + 1)
          )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Select Directory</DialogTitle>
        </DialogHeader>
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground truncate">
          {selectedPath ? toDisplayPath(selectedPath) : "No selection"}
        </div>
        <div ref={scrollContainerRef} className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
          {renderNode("/", "/", 0)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedPath}>
            Select Directory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
