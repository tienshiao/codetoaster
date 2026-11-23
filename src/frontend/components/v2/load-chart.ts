/**
 * The geometry of the system-load chart and sparkline (TASK-149), apart from
 * the components so it can be tested as arithmetic.
 */

/** A CPU reading at a time. Restated rather than imported from the wire, so
 * the design system can draw from fixture data as readily as from a socket. */
export interface LoadPoint {
  at: number;
  /** 0–100, or null for an interval that could not be measured. */
  cpu: number | null;
}

/** At or over this the indicator says "high" in more than colour. Eighty,
 * because a machine that busy is one where a new build or agent will be felt;
 * below it there is headroom and nothing to point at. */
export const HIGH_LOAD = 80;

/** On the figure as shown, so "80%" is never drawn both ways: 79.6 rounds to
 * the threshold it is printed as. */
export function isHighLoad(cpu: number | null | undefined): boolean {
  return cpu != null && Math.round(cpu) >= HIGH_LOAD;
}

/** The samples inside the window ending at the newest one: what the chart
 * plots, and so the only ones a peak or a low may be taken over. The ring
 * reaches further back than the window after a sleep. */
export function inWindow<T extends LoadPoint>(points: readonly T[], windowMs: number): T[] {
  const end = points.at(-1)?.at;
  if (end === undefined) return [];
  return points.filter((p) => p.at >= end - windowMs);
}

export interface PlotBox {
  width: number;
  height: number;
  /** The time at the left edge and the right edge. */
  start: number;
  end: number;
  /** Two neighbours further apart than this are not joined: the daemon was
   * stopped or the machine slept, and a straight line across would invent the
   * load in between. */
  maxGapMs: number;
}

export interface LoadPaths {
  /** One polyline per unbroken run. */
  lines: string[];
  /** The same runs closed down to the baseline, for the wash under them. */
  areas: string[];
  /** The newest plotted point, for the end dot. */
  last: { x: number; y: number } | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Paths for CPU % over [start, end] on a fixed 0–100 scale.
 *
 * Fixed rather than fitted to the data: a scale that zoomed into 3–7% would
 * draw an idle machine as a mountain range. Points outside the window are
 * left out, a null breaks the run, and so does a gap wider than `maxGapMs`.
 * A run of one point draws no line — there is nothing to join — but still
 * counts as the last point if it is the newest.
 */
export function loadPaths(points: readonly LoadPoint[], box: PlotBox): LoadPaths {
  const { width, height, start, end, maxGapMs } = box;
  const span = Math.max(1, end - start);
  const x = (at: number) => r1(((at - start) / span) * width);
  const y = (cpu: number) => r1(height - (Math.min(100, Math.max(0, cpu)) / 100) * height);

  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  let prevAt: number | null = null;
  for (const p of points) {
    if (p.at < start || p.at > end) continue;
    if (p.cpu === null || (prevAt !== null && p.at - prevAt > maxGapMs)) {
      if (run.length) runs.push(run);
      run = [];
    }
    prevAt = p.at;
    if (p.cpu !== null) run.push({ x: x(p.at), y: y(p.cpu) });
  }
  if (run.length) runs.push(run);

  const lines: string[] = [];
  const areas: string[] = [];
  for (const r of runs) {
    if (r.length < 2) continue;
    const pts = r.map((p) => `${p.x},${p.y}`).join(" L");
    lines.push(`M${pts}`);
    areas.push(`M${r[0]!.x},${height} L${pts} L${r.at(-1)!.x},${height} Z`);
  }
  const lastRun = runs.at(-1);
  // Only when the newest reading is itself a number: after a null the line
  // has stopped, and a dot back on the last good point would claim it is now.
  const newest = points.at(-1);
  const last = newest && newest.cpu !== null && lastRun ? lastRun.at(-1)! : null;
  return { lines, areas, last };
}

/** "10 min", "90 s": a window's length as the card's axis names it. */
export function windowLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 120) return `${s} s`;
  return `${Math.round(s / 60)} min`;
}

/** A CPU reading as text: whole percent, or a dash for "not measured". */
export function cpuLabel(cpu: number | null | undefined): string {
  return cpu == null ? "–" : `${Math.round(cpu)}%`;
}
