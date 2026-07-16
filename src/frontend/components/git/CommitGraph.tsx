import { memo } from "react";
import type { GraphRow } from "../../utils/commitGraph";

// Mid-tone hues that read on both dark and light backgrounds. Lane i uses
// palette[i % 8]; edges are colored by their non-dot lane, own-lane segments
// and the dot by row.lane.
const PALETTE = [
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#a78bfa",
  "#fb7185",
  "#2dd4bf",
  "#fb923c",
  "#818cf8",
];

function color(i: number): string {
  return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length]!;
}

// Uniform visible-lane cap so text columns align across rows. Lanes at or past
// this cap draw in the last visible column instead of clipping out of the SVG.
const MAX_VISIBLE_LANES = 12;
const COL_WIDTH = 12;

interface CommitGraphProps {
  row: GraphRow;
  height: number;
  /** Max laneCount across all loaded rows — fixes the cell width uniformly. */
  globalLanes: number;
}

export const CommitGraph = memo(function CommitGraph({
  row,
  height,
  globalLanes,
}: CommitGraphProps) {
  const cols = Math.min(Math.max(globalLanes, 1), MAX_VISIBLE_LANES);
  const width = cols * COL_WIDTH;
  // Clamp the drawing coordinate to the last visible column so lanes >= the cap
  // stay inside the SVG (converging on that column) rather than clipping away.
  const x = (i: number) => Math.min(i, MAX_VISIBLE_LANES - 1) * COL_WIDTH + COL_WIDTH / 2;
  const midY = height / 2;

  // Rounded elbow between two lane columns. Control points sit at (from,y2) and
  // (to,y1) so the curve leaves y1 and meets y2 with vertical tangents at both
  // row boundaries (no kink against the vertical segments above/below).
  const elbow = (from: number, to: number, y1: number, y2: number) =>
    `M ${x(from)} ${y1} C ${x(from)} ${y2}, ${x(to)} ${y1}, ${x(to)} ${y2}`;

  // When the dot's own lane is clamped into the shared last column, draw the dot
  // and its own-lane segments dimmed so the overflow reads as distinct from a
  // real lane sitting in that column.
  const dotClamped = row.lane >= MAX_VISIBLE_LANES;
  const dotOpacity = dotClamped ? 0.5 : 1;

  const lines: React.ReactNode[] = [];

  // Pass-through lanes: a straight vertical line, no dot interaction.
  for (const i of row.passThrough) {
    lines.push(
      <line
        key={`p${i}`}
        x1={x(i)}
        y1={0}
        x2={x(i)}
        y2={height}
        stroke={color(i)}
        strokeWidth={1.5}
      />,
    );
  }

  // Top edges: lanes entering the dot from above.
  for (const j of row.edgesTop) {
    if (j === row.lane) {
      lines.push(
        <line
          key={`t${j}`}
          x1={x(j)}
          y1={0}
          x2={x(j)}
          y2={midY}
          stroke={color(row.lane)}
          strokeWidth={1.5}
          opacity={dotOpacity}
        />,
      );
    } else {
      // Rounded elbow: (x(j),0) → (x(lane),midY), controls (x(j),midY) & (x(lane),0).
      lines.push(
        <path
          key={`t${j}`}
          d={elbow(j, row.lane, 0, midY)}
          fill="none"
          stroke={color(j)}
          strokeWidth={1.5}
        />,
      );
    }
  }

  // Bottom edges: lanes leaving the dot downward (one per parent).
  for (const m of row.edgesBottom) {
    if (m === row.lane) {
      lines.push(
        <line
          key={`b${m}`}
          x1={x(row.lane)}
          y1={midY}
          x2={x(row.lane)}
          y2={height}
          stroke={color(row.lane)}
          strokeWidth={1.5}
          opacity={dotOpacity}
        />,
      );
    } else {
      // Mirror elbow: controls sit below the start and above the end so the
      // curve leaves the dot and meets the row boundary vertically — matching
      // the vertical tangents of whatever continues in the next row (no kink).
      lines.push(
        <path
          key={`b${m}`}
          d={elbow(row.lane, m, midY, height)}
          fill="none"
          stroke={color(m)}
          strokeWidth={1.5}
        />,
      );
    }
  }

  return (
    <svg
      width={width}
      height={height}
      className="shrink-0 overflow-hidden"
      style={{ width, height }}
    >
      {lines}
      {/* Dot: lane color fill, background-tinted stroke for separation. */}
      <circle
        cx={x(row.lane)}
        cy={midY}
        r={3}
        fill={color(row.lane)}
        stroke="var(--background)"
        strokeWidth={1.5}
        opacity={dotOpacity}
      />
    </svg>
  );
});
