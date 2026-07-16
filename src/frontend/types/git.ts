import type { FileDiff } from "./diff";

export interface GitLogCommit {
  hash: string;
  parents: string[];
  refs: string[];
  author: string;
  email: string;
  date: number;
  subject: string;
}

export interface GitLogPage {
  commits: GitLogCommit[];
  hasMore: boolean;
  /** Present only on until= responses: whether the target sha was located. */
  found?: boolean;
}

export interface GitRef {
  name: string;
  sha: string;
}

export interface GitRefsResponse {
  head: { ref: string | null; sha: string };
  branches: GitRef[];
  remotes: GitRef[];
  tags: GitRef[];
  hash: string;
}

export interface GitCommitMeta {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  authoredAt: number;
  committer: string;
  committedAt: number;
  refs: string[];
  message: string;
}

export interface GitCommitResponse {
  meta: GitCommitMeta;
  diff: string;
  hash: string;
}

export interface GitCommitData {
  meta: GitCommitMeta;
  files: FileDiff[];
}

export type GitViewMode = "commit" | "changes" | "tree";
