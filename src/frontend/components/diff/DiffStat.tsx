import type { FileDiff } from "../../types/diff";

// The identical green "+additions" / red "-deletions" span pair used across the
// diff and git views. Callers keep their own wrapper (spacing / text-size
// differs per site); only these two inner spans are shared.
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <>
      <span className="text-green-500">+{additions}</span>
      <span className="text-red-500">-{deletions}</span>
    </>
  );
}

// Sum additions/deletions across a set of file diffs.
export function sumDiffStats(files: FileDiff[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { additions, deletions };
}
