import { useState, useEffect } from "react";
import { ChevronRight, ChevronDown, MessageCircle, Search, X } from "lucide-react";
import { FileIcon } from "./FileIcon";
import { buildTree, FILE_KEY } from "../../utils/sortFiles";
import type { FileTreeNode } from "../../utils/sortFiles";
import type { FileDiff } from "../../types/diff";

interface FileTreeProps {
  files: FileDiff[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  totalAdditions: number;
  totalDeletions: number;
  commentCounts?: Map<string, number>;
}

export function FileTree({ files, selectedFile, onSelectFile, totalAdditions, totalDeletions, commentCounts }: FileTreeProps) {
  const [filter, setFilter] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [hasInitialized, setHasInitialized] = useState(false);

  const filteredFiles = filter
    ? files.filter((file) =>
        file.newPath.toLowerCase().includes(filter.toLowerCase())
      )
    : files;

  const getAllDirectoryPaths = (node: FileTreeNode, path: string = ""): string[] => {
    const paths: string[] = [];
    Object.entries(node).forEach(([key, value]) => {
      const fullPath = path ? `${path}/${key}` : key;
      if (!value[FILE_KEY]) {
        paths.push(fullPath);
        paths.push(...getAllDirectoryPaths(value, fullPath));
      }
    });
    return paths;
  };

  const tree = buildTree(filteredFiles);

  useEffect(() => {
    if (!hasInitialized && files.length > 0) {
      const allPaths = getAllDirectoryPaths(buildTree(files));
      setExpandedPaths(new Set(allPaths));
      setHasInitialized(true);
    }
  }, [files, hasInitialized]);

  useEffect(() => {
    if (selectedFile) {
      const parts = selectedFile.split("/");
      const parentPaths: string[] = [];
      for (let i = 1; i < parts.length; i++) {
        parentPaths.push(parts.slice(0, i).join("/"));
      }
      if (parentPaths.length > 0) {
        setExpandedPaths(prev => {
          const next = new Set(prev);
          parentPaths.forEach(p => next.add(p));
          return next;
        });
      }
    }
  }, [selectedFile]);

  const toggleDirectory = (path: string) => {
    setExpandedPaths(prev => {
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
      const isExpanded = expandedPaths.has(fullPath);

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
                <span className="text-green-500">+{file.additions}</span>
                <span className="text-red-500">-{file.deletions}</span>
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
            <span className="text-green-500">+{totalAdditions}</span>
            <span className="text-red-500">-{totalDeletions}</span>
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
