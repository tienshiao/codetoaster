import { compareTreeSiblings } from "./sortFiles";
import type { GitRef } from "../types/git";

export interface RefTreeNode {
  name: string; // segment, e.g. "foo"
  path: string; // full prefix, e.g. "feature/foo"
  ref?: GitRef; // set on leaves
  children: RefTreeNode[];
}

// Interim build node: a Map child index keeps insertion O(1) per segment
// (an array find is quadratic in folder width — thousands of remote branches
// under one folder made that measurably janky per filter keystroke).
interface BuildNode {
  name: string;
  path: string;
  ref?: GitRef;
  children: Map<string, BuildNode>;
}

/** Split each ref name on "/" and nest the segments into a folder tree.
 * git's directory/file conflict rule guarantees refs/heads/foo and
 * refs/heads/foo/bar cannot coexist, and for-each-ref emits each ref once,
 * so within one section a node is cleanly either a folder or a leaf. */
export function buildRefTree(refs: GitRef[]): RefTreeNode[] {
  const root: BuildNode = { name: "", path: "", children: new Map() };

  for (const ref of refs) {
    const parts = ref.name.split("/");
    let current = root;
    let path = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      path = path === "" ? part : `${path}/${part}`;
      let child = current.children.get(part);
      if (!child) {
        child = { name: part, path, children: new Map() };
        current.children.set(part, child);
      }
      if (i === parts.length - 1) child.ref = ref;
      current = child;
    }
  }

  return finalize(root);
}

// Convert the Map-indexed build nodes to render nodes, sorting each sibling
// list in place (freshly allocated here, so mutation is safe).
function finalize(node: BuildNode): RefTreeNode[] {
  const nodes: RefTreeNode[] = [];
  for (const child of node.children.values()) {
    nodes.push({ name: child.name, path: child.path, ref: child.ref, children: finalize(child) });
  }
  nodes.sort((a, b) => compareTreeSiblings(isRefFolder(a), isRefFolder(b), a.name, b.name));
  return nodes;
}

/** A node is a folder when it holds children; leaves have none. */
export function isRefFolder(node: RefTreeNode): boolean {
  return node.children.length > 0;
}

/** Count of descendant leaf refs under a node (the node itself if it's a leaf). */
export function countRefs(node: RefTreeNode): number {
  if (!isRefFolder(node)) return node.ref !== undefined ? 1 : 0;
  return node.children.reduce((sum, child) => sum + countRefs(child), 0);
}
