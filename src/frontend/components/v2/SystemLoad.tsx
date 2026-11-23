import { cn } from "@/frontend/lib/utils";
import { Fact, HoverCardShell } from "./HoverCardParts";
import { cpuLabel, isHighLoad, loadPaths, windowLabel, type LoadPoint } from "./load-chart";

/**
 * How hard the daemon's machine is working, at the foot of the right rail
 * (TASK-149): a sparkline and a percentage always on screen, and on hover or
 * focus a card charting the last few minutes beside the load averages.
 *
 * Plain data in, like every v2 component: the shell does not know there is a
 * socket.
 */

export interface SystemLoadReading extends LoadPoint {
  /** 1, 5 and 15-minute load averages. */
  load: readonly [number, number, number];
  cores: number;
}

export interface SystemLoadIndicatorProps {
  /** Oldest first. Empty until the daemon has said anything. */
  samples: readonly SystemLoadReading[];
  /** The daemon's tick, which is what tells a gap from a sample on its way. */
  intervalMs: number;
  /** How many ticks the daemon keeps: the chart's window. */
  capacity: number;
  /** Controlled open state for the card. Only tests pass this. */
  open?: boolean;
  className?: string;
}

/** The sparkline's width in ticks: under a minute at the daemon's two
 * seconds, which is "what just happened" rather than the card's trend. */
const SPARK_TICKS = 24;
const SPARK = { width: 24, height: 12 };
/** The card's panel is `w-72` with `p-3` and a hairline border: 262px inside. */
const CHART = { width: 260, height: 72, gutter: 30 };

/** Two missed ticks and a half is a gap, not jitter. */
const gapFor = (intervalMs: number) => intervalMs * 2.5;

function Sparkline({
  samples,
  intervalMs,
  high,
}: {
  samples: readonly SystemLoadReading[];
  intervalMs: number;
  high: boolean;
}) {
  const end = samples.at(-1)?.at ?? 0;
  const { lines, areas } = loadPaths(samples.slice(-SPARK_TICKS - 1), {
    ...SPARK,
    start: end - SPARK_TICKS * intervalMs,
    end,
    maxGapMs: gapFor(intervalMs),
  });
  const tone = high ? "warning" : "busy";
  return (
    <svg
      width={SPARK.width}
      height={SPARK.height}
      viewBox={`0 0 ${SPARK.width} ${SPARK.height}`}
      aria-hidden="true"
      className="block flex-none overflow-visible"
    >
      {/* The frame the line moves in, so an idle machine is a line along the
          floor of something rather than a line alone. */}
      <rect
        x={0.5}
        y={0.5}
        width={SPARK.width - 1}
        height={SPARK.height - 1}
        rx={1.5}
        className="fill-none stroke-border"
      />
      {areas.map((d) => (
        <path
          key={d}
          d={d}
          fillOpacity={0.18}
          className={tone === "warning" ? "fill-warning" : "fill-state-busy"}
        />
      ))}
      {lines.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          strokeWidth={1.25}
          strokeLinejoin="round"
          strokeLinecap="round"
          className={tone === "warning" ? "stroke-warning" : "stroke-state-busy"}
        />
      ))}
    </svg>
  );
}

function Chart({
  samples,
  intervalMs,
  windowMs,
}: {
  samples: readonly SystemLoadReading[];
  intervalMs: number;
  windowMs: number;
}) {
  const plotWidth = CHART.width - CHART.gutter;
  const end = samples.at(-1)?.at ?? 0;
  const { lines, areas, last } = loadPaths(samples, {
    width: plotWidth,
    height: CHART.height,
    start: end - windowMs,
    end,
    maxGapMs: gapFor(intervalMs),
  });
  const measured = samples.map((s) => s.cpu).filter((c): c is number => c !== null);
  const summary = measured.length
    ? `CPU over the last ${windowLabel(windowMs)}: low ${cpuLabel(Math.min(...measured))}, ` +
      `peak ${cpuLabel(Math.max(...measured))}, now ${cpuLabel(samples.at(-1)?.cpu)}`
    : `CPU over the last ${windowLabel(windowMs)}: no readings yet`;
  // Gridlines at 0, 50 and 100 on a fixed scale; labelled in the gutter so
  // the line never runs under its own axis text.
  const grid = [100, 50, 0].map((pct) => ({
    pct,
    y: Math.round((CHART.height - (pct / 100) * CHART.height) * 10) / 10,
  }));

  return (
    <div className="flex flex-col gap-1">
      <svg
        role="img"
        aria-label={summary}
        width={CHART.width}
        height={CHART.height}
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        className="block overflow-visible"
      >
        {grid.map(({ pct, y }) => (
          <g key={pct}>
            <line
              x1={CHART.gutter}
              x2={CHART.width}
              y1={y}
              y2={y}
              strokeWidth={1}
              className="stroke-border"
              shapeRendering="crispEdges"
            />
            <text
              x={CHART.gutter - 6}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-subtle-foreground font-mono text-micro tracking-mono"
            >
              {pct}%
            </text>
          </g>
        ))}
        <g transform={`translate(${CHART.gutter} 0)`}>
          {areas.map((d) => (
            <path key={d} d={d} fillOpacity={0.12} className="fill-state-busy" />
          ))}
          {lines.map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="stroke-state-busy"
            />
          ))}
          {last ? (
            <circle
              cx={last.x}
              cy={last.y}
              r={4}
              strokeWidth={2}
              className="fill-state-busy stroke-pane"
            />
          ) : null}
        </g>
      </svg>
      <div
        className="flex justify-between font-mono text-micro tracking-mono text-subtle-foreground"
        style={{ paddingLeft: CHART.gutter }}
      >
        <span>{windowLabel(windowMs)} ago</span>
        <span>now</span>
      </div>
    </div>
  );
}

function Card({
  samples,
  intervalMs,
  capacity,
}: Pick<SystemLoadIndicatorProps, "samples" | "intervalMs" | "capacity">) {
  const latest = samples.at(-1);
  const measured = samples.map((s) => s.cpu).filter((c): c is number => c !== null);
  const peak = measured.length ? Math.max(...measured) : null;
  const high = isHighLoad(latest?.cpu);

  return (
    <>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 font-medium">System load</span>
        <span className={cn("font-mono tracking-mono", high && "font-semibold")}>
          {cpuLabel(latest?.cpu)} CPU{high ? " · high" : ""}
        </span>
      </div>
      <Chart samples={samples} intervalMs={intervalMs} windowMs={capacity * intervalMs} />
      <dl className="flex flex-col gap-1 text-micro">
        <Fact label="Peak">{cpuLabel(peak)}</Fact>
        <Fact label="Load">
          {latest ? (
            <>
              <span className="font-mono tracking-mono">
                {latest.load.map((n) => n.toFixed(2)).join(" / ")}
              </span>
              <span className="text-subtle-foreground"> · 1, 5, 15 min</span>
            </>
          ) : (
            "–"
          )}
        </Fact>
        <Fact label="Cores">{latest ? latest.cores : "–"}</Fact>
      </dl>
    </>
  );
}

/**
 * The rail's last row. A `meter`, focusable so the card is reachable from the
 * keyboard, and not a button: there is nothing to press.
 *
 * High load is said three ways, so colour is never the only one: the
 * sparkline and frame turn to the warning tone, the figure is boxed and set
 * bold, and the meter's value text reads "high".
 */
export function SystemLoadIndicator({
  samples,
  intervalMs,
  capacity,
  open,
  className,
}: SystemLoadIndicatorProps) {
  const latest = samples.at(-1);
  const cpu = latest?.cpu ?? null;
  const high = isHighLoad(cpu);
  const valueText =
    cpu === null ? "CPU not measured yet" : `CPU ${cpuLabel(cpu)}${high ? ", high" : ""}`;

  return (
    <HoverCardShell
      open={open}
      side="left"
      align="end"
      openOnFocus
      card={<Card samples={samples} intervalMs={intervalMs} capacity={capacity} />}
    >
      <div
        role="meter"
        tabIndex={0}
        aria-label="System load"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={cpu ?? undefined}
        aria-valuetext={valueText}
        data-high={high || undefined}
        className={cn(
          "flex w-full flex-none cursor-default flex-col items-center gap-1 py-1.5",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
          className,
        )}
      >
        <Sparkline samples={samples} intervalMs={intervalMs} high={high} />
        <span
          className={cn(
            "rounded-sm px-0.5 font-mono text-micro leading-none tracking-mono tabular-nums",
            // The box and the weight are the non-colour half of "high".
            high
              ? "font-semibold text-foreground outline outline-1 outline-warning"
              : "text-muted-foreground",
          )}
        >
          {cpuLabel(cpu)}
        </span>
      </div>
    </HoverCardShell>
  );
}
