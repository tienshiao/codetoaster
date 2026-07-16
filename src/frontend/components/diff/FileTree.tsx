import { useState, useEffect } from "react";
import { ChevronRight, ChevronDown, MessageCircle, Search, X } from "lucide-react";
import { FileIcon } from "./FileIcon";
import { DiffStat } from "./DiffStat";
import { buildTree, FILE_KEY } from "../../utils/sortFiles";
import { useViewState } from "../../hooks/use-view-state";
import { collectPathPrefixes, pruneSet } from "../../view-state-store";
import type { FileTreeNode } from "../../utils/sortFiles";
import type { FileDiff } from "../../types/diff";

interface FileTreeProps {
  sessionId: string;
  files: FileDiff[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  totalAdditions: number;
  totalDeletions: number;
  commentCounts?: Map<string, number>;
}

export function FileTree({ sessionId, files, selectedFile, onSelectFile, totalAdditions, totalDeletions, commentCounts }: FileTreeProps) {
  const [filter, setFilter] = useState("");
  // Collapse-tracking (not expansion): directories newly entering the diff
  // default to expanded, while the user's collapses survive refetches.
  const [collapsedPaths, setCollapsedPaths] = useViewState(sessionId, "diffView", "treeCollapsedPaths");

  const filteredFiles = filter
    ? files.filter((file) =>
        file.newPath.toLowerCase().includes(filter.toLowerCase())
      )
    : files;

  const tree = buildTree(filteredFiles);

  // Reconcile: drop collapse entries for directories no longer in the diff,
  // so a directory that leaves and comes back defaults to expanded again
  useEffect(() => {
    if (files.length === 0) return;
    const dirs = collectPathPrefixes(files.map((f) => f.newPath));
    setCollapsedPaths((prev) => pruneSet(prev, dirs));
  }, [files, setCollapsedPaths]);

  // Un-collapse the selected file's ancestors so it's visible
  useEffect(() => {
    if (!selectedFile) return;
    const parentPaths = collectPathPrefixes([selectedFile]);
    setCollapsedPaths((prev) => {
      if (![...parentPaths].some((p) => prev.has(p))) return prev;
      const next = new Set(prev);
      parentPaths.forEach((p) => next.delete(p));
      return next;
    });
  }, [selectedFile, setCollapsedPaths]);

  const toggleDirectory = (path: string) => {
    setCollapsedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderTree = (
    node: FileTreeNode,
    path: string = "",
    depth: number = 0
  ) => {
    return Object.entries(node)
      .sort(([aKey, aVal], [bKey, bVal]) => {
        const aIsDir = !aVal[FILE_KEY];
        const bIsDir = !bVal[FILE_KEY];
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
      })
      .map(([key, value]) => {
      const fullPath = path ? `${path}/${key}` : key;
      const isFile = value[FILE_KEY];
      const file = value[FILE_KEY];
      const isExpanded = !collapsedPaths.has(fullPath);

      return (
        <div key={fullPath}>
          <div
            className={`flex items-center gap-1 py-0.5 px-2 text-xs cursor-pointer hover:bg-accent/50 ${
              selectedFile === file?.newPath ? "bg-accent text-accent-foreground" : "text-foreground/80"
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            title={fullPath}
            onClick={() => isFile ? onSelectFile(file!.newPath) : toggleDirectory(fullPath)}
          >
            {!isFile && (
              <span className="shrink-0 text-muted-foreground">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            )}
            <span className="shrink-0">
              <FileIcon filename={key} isFolder={!isFile} />
            </span>
            <span className="truncate">{key}</span>
            {isFile && file && (
              <span className="ml-auto flex items-center gap-1.5 shrink-0 text-[11px]">
                <DiffStat additions={file.additions} deletions={file.deletions} />
              </span>
            )}
            {isFile && (
              <span className="shrink-0 ml-1 w-5 flex justify-center">
                {(() => {
                  const count = commentCounts?.get(file?.newPath || "") || 0;
                  if (count > 0) {
                    return (
                      <span className="flex items-center gap-0.5 text-blue-400 text-[10px]">
                        <MessageCircle size={10} /> {count}
                      </span>
                    );
                  }
                  if (file?.status === "added") {
                    return <span className="w-2 h-2 rounded-full bg-green-500" title="Added" />;
                  }
                  if (file?.status === "deleted") {
                    return <span className="w-2 h-2 rounded-full bg-red-500" title="Deleted" />;
                  }
                  if (file?.status === "renamed" || file?.status === "copied") {
                    return <span className="w-2 h-2 rounded-full bg-purple-500" title={file.status === "copied" ? "Copied" : "Renamed"} />;
                  }
                  return null;
                })()}
              </span>
            )}
          </div>
          {!isFile && isExpanded && renderTree(value, fullPath, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col h-full border-r border-border">
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {files.length} file{files.length !== 1 ? "s" : ""} changed
          </span>
          <span className="flex items-center gap-1.5">
            <DiffStat additions={totalAdditions} deletions={totalDeletions} />
          </span>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter files"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-muted/50 text-xs text-foreground rounded-md pl-7 pr-7 py-1.5 outline-none border border-transparent focus:border-border placeholder:text-muted-foreground"
          />
          {filter && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setFilter("")}
              aria-label="Clear filter"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">{renderTree(tree)}</div>
    </div>
  );
}
