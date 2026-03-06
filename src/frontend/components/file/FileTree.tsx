import { useState, useEffect, useMemo } from "react";
import { ChevronRight, ChevronDown, Search, X } from "lucide-react";
import { FileIcon } from "../diff/FileIcon";
import { formatSize } from "../../utils/formatSize";
import type { FileInfo } from "../../types/file";

interface FileTreeProps {
  files: FileInfo[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
  size?: number;
}

function buildTree(files: FileInfo[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDirectory: true, children: [] };

  files.forEach((file) => {
    const parts = file.path.split("/");
    let current = root;

    parts.forEach((part, idx) => {
      let child = current.children.find((c) => c.name === part);
      const fullPath = parts.slice(0, idx + 1).join("/");

      if (!child) {
        const isDir = file.isDirectory || idx < parts.length - 1;
        child = {
          name: part,
          path: fullPath,
          isDirectory: isDir,
          children: [],
          size: file.size,
        };
        current.children.push(child);
      } else if (file.isDirectory && !child.isDirectory) {
        child.isDirectory = true;
        child.children = [];
      } else if (!file.isDirectory && child.isDirectory) {
        child.size = file.size;
      }
      current = child;
    });
  });

  return root.children;
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((node) => ({
      ...node,
      children: sortTree(node.children),
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
}

export function FileTree({ files, selectedFile, onSelectFile }: FileTreeProps) {
  const [filter, setFilter] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const filteredFiles = useMemo(() => {
    if (!filter) return files;
    return files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()));
  }, [files, filter]);

  const tree = useMemo(() => sortTree(buildTree(filteredFiles)), [filteredFiles]);

  useEffect(() => {
    if (selectedFile) {
      const parts = selectedFile.split("/");
      const parentPaths = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        parentPaths.forEach((p) => next.add(p));
        return next;
      });
    }
  }, [selectedFile]);

  const toggleDirectory = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderTree = (nodes: TreeNode[], depth: number = 0) => {
    return nodes.map((node) => {
      const isExpanded = expandedPaths.has(node.path);
      const isSelected = selectedFile === node.path;

      return (
        <div key={node.path}>
          <div
            className={`flex items-center gap-1 py-0.5 px-2 text-xs cursor-pointer hover:bg-accent/50 ${
              isSelected ? "bg-accent text-accent-foreground" : "text-foreground/80"
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            title={node.path}
            onClick={() => (node.isDirectory ? toggleDirectory(node.path) : onSelectFile(node.path))}
          >
            {node.isDirectory && (
              <span className="shrink-0 text-muted-foreground">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            )}
            <span className="shrink-0">
              <FileIcon filename={node.name} isFolder={node.isDirectory} />
            </span>
            <span className="truncate">{node.name}</span>
            {!node.isDirectory && node.size !== undefined && (
              <span className="ml-auto text-[10px] text-muted-foreground">
                {formatSize(node.size)}
              </span>
            )}
          </div>
          {node.isDirectory && isExpanded && renderTree(node.children, depth + 1)}
        </div>
      );
    });
  };

  const fileCount = filteredFiles.filter((f) => !f.isDirectory).length;
  const dirCount = filteredFiles.filter((f) => f.isDirectory).length;

  return (
    <div className="flex flex-col h-full border-r border-border">
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {fileCount} file{fileCount !== 1 ? "s" : ""}{dirCount > 0 && `, ${dirCount} folder${
              dirCount !== 1 ? "s" : ""
            }`}
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