import { useState, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { FileIcon } from "../diff/FileIcon";
import { FilterInput } from "../FilterInput";
import { formatSize } from "../../utils/formatSize";
import { collectDirectoryPaths, collectPathPrefixes, pruneSet, toggleInSet, withAll } from "../../view-state-store";
import { compareTreeSiblings } from "../../utils/sortFiles";
import { cn } from "@/frontend/lib/utils";
import type { FileInfo } from "../../types/file";

interface FileTreeProps {
  files: FileInfo[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  // Expansion state is owned by the caller, so reusing the tree for an old
  // commit never corrupts the file view's persisted set — an old commit's tree
  // lacks directories that exist today.
  expandedPaths: Set<string>;
  onExpandedPathsChange: Dispatch<SetStateAction<Set<string>>>;
  /** Merged onto the outer container, so the Explorer can host the tree
   * without v1's route chrome. */
  className?: string;
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
    .sort((a, b) => compareTreeSiblings(a.isDirectory, b.isDirectory, a.name, b.name));
}

export function FileTree({ files, selectedFile, onSelectFile, expandedPaths, onExpandedPathsChange: setExpandedPaths, className }: FileTreeProps) {
  const [filter, setFilter] = useState("");

  const filteredFiles = useMemo(() => {
    if (!filter) return files;
    return files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()));
  }, [files, filter]);

  const tree = useMemo(() => sortTree(buildTree(filteredFiles)), [filteredFiles]);

  // Drop expansion entries for directories that no longer exist (pruneSet
  // returns the same reference when nothing changed, so this doesn't loop)
  useEffect(() => {
    if (files.length === 0) return;
    const validDirs = collectDirectoryPaths(files);
    setExpandedPaths((prev) => pruneSet(prev, validDirs));
  }, [files, setExpandedPaths]);

  // Reveal the selection's ancestor directories when the selection *changes*,
  // not on every mount. The Explorer unmounts this tree on every rail switch
  // while the selection persists with the view, so a mount-time reveal would
  // reopen directories the user had deliberately collapsed — every switch,
  // forever, with no way to make a collapse stick. (RefSidebar's HEAD reveal is
  // the same story and had to persist its marker; here the marker *is* the
  // persisted selection, so remembering it for the life of the mount is enough.)
  //
  // The selection already on screen at mount was revealed when it was made, or
  // has been collapsed over since; either way it is recorded as seen rather than
  // acted on.
  const revealedFor = useRef(selectedFile);
  useEffect(() => {
    if (!selectedFile || revealedFor.current === selectedFile) return;
    revealedFor.current = selectedFile;
    setExpandedPaths((prev) => withAll(prev, collectPathPrefixes([selectedFile])));
  }, [selectedFile, setExpandedPaths]);

  const toggleDirectory = (path: string) => {
    setExpandedPaths((prev) => toggleInSet(prev, path));
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
    <div className={cn("flex h-full flex-col border-r border-border", className)}>
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {fileCount} file{fileCount !== 1 ? "s" : ""}{dirCount > 0 && `, ${dirCount} folder${
              dirCount !== 1 ? "s" : ""
            }`}
          </span>
        </div>
        <FilterInput value={filter} onChange={setFilter} placeholder="Filter files" />
      </div>
      <div className="flex-1 overflow-y-auto py-1">{renderTree(tree)}</div>
    </div>
  );
}