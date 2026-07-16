import { useMemo } from "react";
import { cn } from "../../lib/utils";
import type { GitRefsResponse } from "../../types/git";

type RefKind = "head" | "branch" | "remote" | "tag" | "unknown";

export interface RefSets {
  branches: Set<string>;
  remotes: Set<string>;
  tags: Set<string>;
  headBranch: string | null;
}

/** Classification sets for RefChip, referentially stable per refs response. */
export function useRefSets(refsData: GitRefsResponse | undefined): RefSets {
  return useMemo(
    () => ({
      branches: new Set(refsData?.branches.map((b) => b.name) ?? []),
      remotes: new Set(refsData?.remotes.map((r) => r.name) ?? []),
      tags: new Set(refsData?.tags.map((t) => t.name) ?? []),
      headBranch: refsData?.head.ref ?? null,
    }),
    [refsData],
  );
}

/** Refs to display for a commit: drops the literal "HEAD" pseudo-ref when a
 * current branch exists to carry the head styling, but keeps it when detached
 * (headBranch null) so the checked-out commit stays marked. */
export function displayRefs(refs: string[], refSets: RefSets): string[] {
  return refSets.headBranch == null ? refs : refs.filter((ref) => ref !== "HEAD");
}

function classifyRef(name: string, sets: RefSets): RefKind {
  if (name === "HEAD") return "head"; // bare "HEAD" decoration = detached checkout
  if (sets.branches.has(name)) return name === sets.headBranch ? "head" : "branch";
  if (sets.remotes.has(name)) return "remote";
  if (sets.tags.has(name)) return "tag";
  return "unknown";
}

const REF_VARIANT: Record<RefKind, string> = {
  head: "bg-primary text-primary-foreground font-semibold",
  branch: "bg-primary/15 text-primary",
  remote: "bg-muted text-muted-foreground",
  tag: "bg-amber-500/15 text-amber-500",
  unknown: "bg-muted text-muted-foreground",
};

/** Ref decoration chip, colored by kind (HEAD / branch / remote / tag). */
export function RefChip({
  name,
  refSets,
  className,
}: {
  name: string;
  refSets: RefSets;
  className?: string;
}) {
  return (
    <span
      title={name}
      className={cn(
        "px-1.5 py-0.5 rounded text-[10px] font-medium",
        REF_VARIANT[classifyRef(name, refSets)],
        className,
      )}
    >
      {name}
    </span>
  );
}
