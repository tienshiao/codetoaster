import { memo, useMemo, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface TablePreviewProps {
  /** Parsed rows; the first is the header. */
  rows: string[][];
  /** Filled with the scroll container, so FileContent's scroll restore works
   * the same for the table as for every other view. The container is rendered
   * here, not by FileContent: a parent's ref is attached only after this
   * component's layout effects run, so the virtualizer would first look for
   * its scroll element, find none, and render no rows. */
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll?: (top: number) => void;
  /** Wrap cell text instead of truncating it; rows then grow to fit. */
  wrap: boolean;
}

const ROW_HEIGHT = 24;
// Rows looked at when sizing columns and guessing alignment. Enough to be
// representative; bounded so a 100k-row file does not scan every cell.
const SAMPLE_ROWS = 200;
const MIN_COL_CH = 4;
const MAX_COL_CH = 48;

const NUMERIC = /^[-+]?[$€£]?(\d[\d,_]*)?(\.\d+)?([eE][-+]?\d+)?%?$/;

interface ColumnLayout {
  template: string;
  numeric: boolean[];
}

/** Column widths in `ch` from the longest sampled cell (header included), and
 * which columns are numbers throughout the sample, which right-align. */
function layoutColumns(rows: string[][], columnCount: number, gutterCh: number): ColumnLayout {
  const widths = new Array<number>(columnCount).fill(MIN_COL_CH);
  const numeric = new Array<boolean>(columnCount).fill(true);
  const seen = new Array<boolean>(columnCount).fill(false);
  const end = Math.min(rows.length, SAMPLE_ROWS + 1);
  for (let r = 0; r < end; r++) {
    const row = rows[r]!;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]!;
      if (cell.length > widths[c]!) widths[c] = Math.min(cell.length, MAX_COL_CH);
      if (r === 0 || cell === "") continue;
      seen[c] = true;
      if (numeric[c] && !(NUMERIC.test(cell) && /\d/.test(cell))) numeric[c] = false;
    }
  }
  // 2ch of padding, and 1ch of slack for the border and the bold header face,
  // either of which would otherwise truncate a cell sized exactly to fit.
  const cols = widths.map((w) => `${w + 3}ch`).join(" ");
  return {
    template: `${gutterCh}ch ${cols}`,
    numeric: numeric.map((n, c) => n && seen[c]!),
  };
}

/**
 * CSV/TSV as a table: a sticky header row, a sticky row-number gutter, and a
 * virtualized body so a file of any length renders only what is on screen.
 *
 * Every row shares one grid template, so header and body columns line up
 * without a <table> (whose layout cannot be virtualized). Rows shorter than the
 * widest row get empty cells; the grid is sized to the widest row, so a longer
 * one never spills.
 */
export const TablePreview = memo(function TablePreview({ rows, scrollRef, onScroll, wrap }: TablePreviewProps) {
  const header = rows[0] ?? [];
  const bodyCount = Math.max(0, rows.length - 1);

  const columnCount = useMemo(() => rows.reduce((max, row) => Math.max(max, row.length), 0), [rows]);
  const gutterCh = String(bodyCount).length + 2;
  const { template, numeric } = useMemo(
    () => layoutColumns(rows, columnCount, gutterCh),
    [rows, columnCount, gutterCh],
  );

  const virtualizer = useVirtualizer({
    count: bodyCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm italic text-muted-foreground">
        Empty file
      </div>
    );
  }

  const cellText = wrap ? "whitespace-pre-wrap break-words" : "truncate whitespace-nowrap";

  const renderCells = (row: string[], cellClass: string) =>
    Array.from({ length: columnCount }, (_, c) => {
      const value = row[c] ?? "";
      return (
        <div
          key={c}
          role="cell"
          title={wrap ? undefined : value}
          className={`${cellClass} ${cellText} border-r border-border px-[1ch] ${numeric[c] ? "text-right tabular-nums" : ""}`}
        >
          {value}
        </div>
      );
    });

  return (
    <div ref={scrollRef} className="overflow-auto h-full" onScroll={(e) => onScroll?.(e.currentTarget.scrollTop)}>
      <div role="table" aria-rowcount={rows.length} className="min-w-fit font-mono text-xs">
        <div
          role="row"
          className="sticky top-0 z-20 grid border-b border-border-strong bg-chrome font-semibold"
          style={{ gridTemplateColumns: template }}
        >
          <div className="sticky left-0 z-10 border-r border-border bg-chrome" />
          {renderCells(header, "py-1")}
        </div>
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              role="row"
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 grid w-full border-b border-border hover:bg-hover"
              style={{ gridTemplateColumns: template, transform: `translateY(${item.start}px)` }}
            >
              <div className="sticky left-0 z-10 select-none border-r border-border bg-pane py-0.5 pr-[1ch] text-right text-muted-foreground/60">
                {item.index + 1}
              </div>
              {renderCells(rows[item.index + 1]!, "py-0.5")}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
