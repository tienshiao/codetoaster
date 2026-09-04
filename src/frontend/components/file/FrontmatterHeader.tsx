import { Fragment } from "react";
import { Badge } from "@/frontend/components/v2";
import type { FrontmatterEntry, FrontmatterValue } from "@/types/frontmatter";

/**
 * A markdown file's frontmatter, above the body it belongs to (TASK-87).
 *
 * Part of the scrolled document rather than a sticky bar: it is the head of the
 * file, not a chrome affordance, and a task's status and labels are what a
 * reader wants first — but only first.
 *
 * The values arrive shaped by the server (there is no YAML parser in this
 * bundle), so this is a `switch` over kinds and nothing more.
 */
function ValueCell({ value }: { value: FrontmatterValue }) {
  switch (value.kind) {
    case "text":
      return <>{value.text}</>;
    case "scalar":
      return <span className="font-mono">{value.text}</span>;
    case "list":
      return (
        <span className="flex flex-wrap gap-1">
          {value.items.map((item, i) => (
            <Badge key={`${i}-${item}`} tone="neutral" mono={false}>
              {item}
            </Badge>
          ))}
        </span>
      );
    case "empty":
      // A dash, not an empty cell: the key was written, and a blank would read
      // as something failing to render.
      return <span className="text-subtle-foreground">—</span>;
    case "block":
      return (
        <pre className="text-xs">
          <code>{value.yaml}</code>
        </pre>
      );
  }
}

export function FrontmatterHeader({ entries }: { entries: FrontmatterEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div className="max-w-3xl px-6 pt-4">
      {/* `items-baseline` rather than a hand-tuned offset: the key is a smaller
          face than its value, and baseline is the only alignment that stays
          right when a value is a badge row or a code block. */}
      <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-4 gap-y-1 mb-4 pb-4 border-b border-border">
        {entries.map((entry) => (
          <Fragment key={entry.key}>
            <dt className="font-mono text-micro tracking-mono text-muted-foreground">{entry.key}</dt>
            <dd className="text-sm">
              <ValueCell value={entry.value} />
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}
