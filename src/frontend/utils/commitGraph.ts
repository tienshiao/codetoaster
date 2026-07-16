/**
 * Commit-graph lane assignment.
 *
 * Consumes commits in topological order (children before parents — the order
 * `git log --topo-order` emits) and assigns each commit a lane (column) plus
 * the edge segments to draw in its row. Processing is strictly top-down and
 * incremental: appending older pages continues from the returned state, so a
 * contiguously-paginated list always produces the same graph as a single run.
 *
 * Lane model: each active lane holds the commit hash it expects next (the
 * parent that some already-drawn commit connects down to). When a commit is
 * reached, every lane expecting it converges on its dot; its first parent
 * continues in its own lane, additional parents fork into existing lanes that
 * already expect them or into the leftmost free lane. Closed lanes become
 * free slots and are reused; lanes never shift left, keeping geometry stable.
 */

export interface GraphRow {
  /** Column of this commit's dot. */
  lane: number;
  /** Lanes entering the dot from the row's top edge (lanes that expected this commit). */
  edgesTop: number[];
  /** Lanes leaving the dot to the row's bottom edge (one per parent). */
  edgesBottom: number[];
  /** Lanes drawing straight vertical lines through this row, no dot interaction. */
  passThrough: number[];
  /** Number of visually occupied columns in this row (for cell width). */
  laneCount: number;
}

export interface GraphState {
  /** Expected next hash per lane; null = free slot. No trailing nulls. */
  lanes: (string | null)[];
}

export interface GraphInput {
  hash: string;
  parents: string[];
}

function firstFree(lanes: (string | null)[]): number {
  const i = lanes.indexOf(null);
  return i === -1 ? lanes.length : i;
}

export function assignLanes(
  commits: GraphInput[],
  state?: GraphState,
): { rows: GraphRow[]; state: GraphState } {
  const lanes: (string | null)[] = state ? [...state.lanes] : [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    // Lanes that were waiting for this commit converge on its dot.
    const edgesTop: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.hash) edgesTop.push(i);
    }

    let lane: number;
    if (edgesTop.length > 0) {
      // Leftmost expecting lane keeps the commit; the rest merge in and close.
      lane = edgesTop[0]!;
      for (const j of edgesTop) {
        if (j !== lane) lanes[j] = null;
      }
    } else {
      // Nothing expected this commit (a ref tip): open the leftmost free lane.
      lane = firstFree(lanes);
      if (lane === lanes.length) lanes.push(null);
    }

    // Lanes still holding an expectation continue straight through this row.
    // Computed before parent allocation so newly opened lanes (which have no
    // presence above this row) are excluded; a lane receiving a fork edge
    // below is correctly both passThrough and an edgesBottom target.
    const passThrough: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] !== null) passThrough.push(i);
    }

    const edgesBottom: number[] = [];
    const [firstParent, ...restParents] = commit.parents;
    // First parent continues in the commit's own lane; no parent closes it.
    lanes[lane] = firstParent ?? null;
    if (firstParent) edgesBottom.push(lane);

    for (const parent of restParents) {
      // Fork into a lane that already expects this parent, if any — the two
      // histories share the connection and merge visually at the parent's row.
      // Skip lanes already targeted this row: duplicate parent hashes (valid
      // via `git commit-tree -p X -p X`) would otherwise emit the same edge
      // twice (duplicate React keys downstream).
      const existing = lanes.indexOf(parent);
      if (existing !== -1) {
        if (!edgesBottom.includes(existing)) edgesBottom.push(existing);
        continue;
      }
      const free = firstFree(lanes);
      if (free === lanes.length) lanes.push(parent);
      else lanes[free] = parent;
      edgesBottom.push(free);
    }

    let maxIndex = lane;
    for (const i of edgesTop) maxIndex = Math.max(maxIndex, i);
    for (const i of edgesBottom) maxIndex = Math.max(maxIndex, i);
    for (const i of passThrough) maxIndex = Math.max(maxIndex, i);

    rows.push({ lane, edgesTop, edgesBottom, passThrough, laneCount: maxIndex + 1 });
  }

  // Keep the state canonical so equal histories yield identical state objects.
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

  return { rows, state: { lanes } };
}
