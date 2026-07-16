import { test, expect } from "bun:test";
import { assignLanes, type GraphInput } from "./commitGraph";

function c(hash: string, ...parents: string[]): GraphInput {
  return { hash, parents };
}

test("linear history stays in lane 0", () => {
  const { rows, state } = assignLanes([c("a", "b"), c("b", "c"), c("c")]);
  expect(rows).toEqual([
    { lane: 0, edgesTop: [], edgesBottom: [0], passThrough: [], laneCount: 1 },
    { lane: 0, edgesTop: [0], edgesBottom: [0], passThrough: [], laneCount: 1 },
    { lane: 0, edgesTop: [0], edgesBottom: [], passThrough: [], laneCount: 1 },
  ]);
  expect(state.lanes).toEqual([]);
});

test("branch and merge diamond", () => {
  // m merges a (first parent) and b; both descend from r.
  const { rows } = assignLanes([c("m", "a", "b"), c("a", "r"), c("b", "r"), c("r")]);
  // m: dot in lane 0, forks to lanes 0 (a) and 1 (b)
  expect(rows[0]).toEqual({ lane: 0, edgesTop: [], edgesBottom: [0, 1], passThrough: [], laneCount: 2 });
  // a: continues lane 0 toward r; b's lane passes through
  expect(rows[1]).toEqual({ lane: 0, edgesTop: [0], edgesBottom: [0], passThrough: [1], laneCount: 2 });
  // b: continues lane 1 toward r; a→r line passes through in lane 0
  expect(rows[2]).toEqual({ lane: 1, edgesTop: [1], edgesBottom: [1], passThrough: [0], laneCount: 2 });
  // r: both lanes converge; lane 1 closes
  expect(rows[3]).toEqual({ lane: 0, edgesTop: [0, 1], edgesBottom: [], passThrough: [], laneCount: 2 });
});

test("octopus merge forks one lane per parent", () => {
  const { rows } = assignLanes([c("m", "a", "b", "x")]);
  expect(rows[0]).toEqual({ lane: 0, edgesTop: [], edgesBottom: [0, 1, 2], passThrough: [], laneCount: 3 });
});

test("second parent reuses a lane that already expects it", () => {
  // m1 and m2 both merge x as their second parent: m2 forks into m1's
  // existing x-lane instead of opening a third lane.
  const { rows } = assignLanes([c("m1", "a", "x"), c("m2", "b", "x")]);
  expect(rows[0]!.edgesBottom).toEqual([0, 1]);
  expect(rows[1]).toEqual({ lane: 2, edgesTop: [], edgesBottom: [2, 1], passThrough: [0, 1], laneCount: 3 });
});

test("independent root closes its lane; freed slots are reused", () => {
  const { rows } = assignLanes([
    c("m", "a", "b"), // lanes: a=0, b=1
    c("a"),           // root: lane 0 closes
    c("tip", "b2"),   // new tip reuses freed lane 0
  ]);
  expect(rows[1]).toEqual({ lane: 0, edgesTop: [0], edgesBottom: [], passThrough: [1], laneCount: 2 });
  expect(rows[2]).toEqual({ lane: 0, edgesTop: [], edgesBottom: [0], passThrough: [1], laneCount: 2 });
});

test("multiple lanes converging on one commit close all but the leftmost", () => {
  const { rows, state } = assignLanes([
    c("m", "a", "r"), // lane 0 → a, lane 1 → r
    c("a", "r"),      // lane 0 → r; both lanes now expect r
    c("r"),           // converge in lane 0; lane 1 closes
  ]);
  expect(rows[2]).toEqual({ lane: 0, edgesTop: [0, 1], edgesBottom: [], passThrough: [], laneCount: 2 });
  expect(state.lanes).toEqual([]);
});

test("incremental chunked processing matches a single full run", () => {
  const history: GraphInput[] = [
    c("h", "g", "f"),
    c("g", "e"),
    c("f", "e"),
    c("e", "d", "c"),
    c("d", "b"),
    c("c", "b"),
    c("b", "a"),
    c("a"),
  ];
  const full = assignLanes(history);
  for (const split of [1, 3, 5, 7]) {
    const first = assignLanes(history.slice(0, split));
    const second = assignLanes(history.slice(split), first.state);
    expect([...first.rows, ...second.rows]).toEqual(full.rows);
    expect(second.state).toEqual(full.state);
  }
});

test("disconnected histories (git log --all) each get their own lanes", () => {
  const { rows } = assignLanes([
    c("x2", "x1"), // repo A tip
    c("y2", "y1"), // repo B tip → lane 1
    c("x1"),
    c("y1"),
  ]);
  expect(rows[0]!.lane).toBe(0);
  expect(rows[1]).toEqual({ lane: 1, edgesTop: [], edgesBottom: [1], passThrough: [0], laneCount: 2 });
  expect(rows[2]).toEqual({ lane: 0, edgesTop: [0], edgesBottom: [], passThrough: [1], laneCount: 2 });
  // y1 converges in lane 1; freed lane 0 is not disturbed
  expect(rows[3]).toEqual({ lane: 1, edgesTop: [1], edgesBottom: [], passThrough: [], laneCount: 2 });
});

test("duplicate parent hashes emit a single edge, not duplicates", () => {
  const { rows } = assignLanes([c("m", "x", "x")]);
  expect(rows[0]!.edgesBottom).toEqual([0]);
  // Triple-duplicate second parents collapse the same way.
  const { rows: rows2 } = assignLanes([c("n", "a", "x", "x")]);
  expect(rows2[0]!.edgesBottom).toEqual([0, 1]);
});

test("root commit as a lone tip opens and closes a lane in one row", () => {
  const { rows, state } = assignLanes([c("only")]);
  expect(rows[0]).toEqual({ lane: 0, edgesTop: [], edgesBottom: [], passThrough: [], laneCount: 1 });
  expect(state.lanes).toEqual([]);
});
