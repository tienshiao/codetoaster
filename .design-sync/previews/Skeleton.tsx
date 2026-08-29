// NOTE ON SIZING: ds-bundle's Tailwind CSS is compiled by package-build, which
// subagents may not run, so a width utility this repo does not already use
// (w-20, w-24, w-40 …) has no rule and the bar collapses to nothing. Skeleton
// is *entirely* sized by utilities, so every bar below is sized with an inline
// style instead; the component still supplies its own bg-accent / pulse / radius.
import { Skeleton } from "codetoaster";

const Bar = ({ w, h = 12, r }: { w: number | string; h?: number; r?: string }) => (
  <Skeleton style={{ width: w, height: h, borderRadius: r }} />
);

const Dot = ({ s = 8 }: { s?: number }) => (
  <Skeleton className="shrink-0 rounded-full" style={{ width: s, height: s }} />
);

/**
 * The sidebar while the session list is still coming over the socket: a status
 * dot and a label per row, grouped under a project heading.
 */
export const SessionListLoading = () => (
  <div
    className="overflow-hidden rounded-lg border border-border bg-sidebar"
    style={{ width: 256 }}
  >
    <div className="flex items-center border-b border-sidebar-border px-3" style={{ height: 40 }}>
      <Bar w={96} h={10} />
    </div>
    <div className="flex flex-col gap-3 p-2">
      {[
        { label: 76, rows: [128, 96, 144] },
        { label: 62, rows: [112, 84] },
      ].map((group, gi) => (
        <div key={gi} className="flex flex-col gap-0.5">
          <div className="px-2" style={{ paddingBottom: 6 }}>
            <Bar w={group.label} h={8} />
          </div>
          {group.rows.map((w, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md px-2" style={{ height: 32 }}>
              <Dot />
              <Bar w={w} h={13} />
            </div>
          ))}
        </div>
      ))}
    </div>
  </div>
);

/**
 * The file browser while the repo tree is being walked — indentation carries
 * the shape of the tree even before the names arrive.
 */
export const FileTreeLoading = () => (
  <div className="rounded-lg border border-border bg-background p-2" style={{ width: 288 }}>
    {[
      { indent: 0, w: 84 },
      { indent: 1, w: 64 },
      { indent: 2, w: 116 },
      { indent: 2, w: 96 },
      { indent: 2, w: 132 },
      { indent: 1, w: 56 },
      { indent: 2, w: 104 },
      { indent: 0, w: 76 },
    ].map((r, i) => (
      <div
        key={i}
        className="flex items-center gap-2"
        style={{ height: 28, paddingLeft: r.indent * 16 + 4 }}
      >
        <Skeleton className="shrink-0" style={{ width: 14, height: 14, borderRadius: 3 }} />
        <Bar w={r.w} h={11} />
      </div>
    ))}
  </div>
);

/**
 * The review pane before a diff resolves: the file header with its stat, then
 * hunk lines behind a line-number gutter.
 */
export const DiffLoading = () => (
  <div
    className="overflow-hidden rounded-lg border border-border bg-background"
    style={{ width: 520 }}
  >
    {/* The real DiffFile header is `bg-muted`, but `--muted` and `--accent`
        are the same token, so a Skeleton laid on it is invisible — the header
        would capture as an empty grey band. The loading header therefore sits
        on the card background with a rule under it. */}
    <div className="flex items-center justify-between border-b border-border px-3 py-2">
      <Bar w={192} h={13} />
      <Bar w={56} h={11} />
    </div>
    <div className="flex flex-col py-2" style={{ gap: 7 }}>
      {[288, 384, 224, 336, 160, 256, 352, 208].map((w, i) => (
        <div key={i} className="flex items-center gap-3 px-3">
          <Bar w={22} h={11} />
          <Bar w={w} h={11} />
        </div>
      ))}
    </div>
  </div>
);

/**
 * The git history list before `/git/log` answers — graph rail, subject line,
 * author/date line, and the abbreviated sha on the right.
 */
export const CommitListLoading = () => (
  <div className="rounded-lg border border-border bg-background p-3" style={{ width: 460 }}>
    {[256, 192, 288, 224].map((w, i) => (
      <div key={i} className="flex items-start gap-3 py-2">
        <div className="flex flex-col items-center gap-1" style={{ paddingTop: 4 }}>
          <Dot s={10} />
          <Skeleton style={{ width: 2, height: 26 }} />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Bar w={w} h={13} />
          <Bar w={160} h={9} />
        </div>
        <Bar w={56} h={11} />
      </div>
    ))}
  </div>
);
