import type { FileDiff } from "../types/diff";

/** Symbol key used to mark leaf nodes in the file tree. */
export const FILE_KEY = Symbol.for("file");

export type FileTreeNode = { [FILE_KEY]?: FileDiff } & Record<string, FileTreeNode>;

/**
 * Sort files in directory-first, alphabetical order.
 * Directories sort before files at each level, case-insensitive.
 */
export function sortFiles(files: FileDiff[]): FileDiff[] {
  return [...files].sort((a, b) => {
    const aParts = a.newPath.toLowerCase().split("/");
    const bParts = b.newPath.toLowerCase().split("/");
    for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
      const aIsLast = i === aParts.length - 1;
      const bIsLast = i === bParts.length - 1;
      if (aIsLast !== bIsLast) return aIsLast ? 1 : -1; // dirs before files
      const cmp = aParts[i].localeCompare(bParts[i], undefined, { sensitivity: "base" });
      if (cmp !== 0) return cmp;
    }
    return aParts.length - bParts.length;
  });
}

/**
 * Build a nested tree structure from a flat list of files.
 * Leaf nodes have a FILE_KEY symbol pointing to the FileDiff.
 */
export function buildTree(files: FileDiff[]): FileTreeNode {
  const tree: FileTreeNode = {};
  files.forEach((file) => {
    const parts = file.newPath.split("/");
    let current: FileTreeNode = tree;
    parts.forEach((part, idx) => {
      if (!current[part]) {
        current[part] = idx === parts.length - 1 ? { [FILE_KEY]: file } : {};
      }
      current = current[part];
    });
  });
  return tree;
}
