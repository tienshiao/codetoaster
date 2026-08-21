export type { SyntaxTokenType } from '../../types/highlight';
import type { SyntaxTokenType } from '../../types/highlight';

export interface TextSegment {
  text: string;
  highlighted: boolean;
  syntaxType?: SyntaxTokenType;
}

export interface DiffLine {
  type: "context" | "addition" | "deletion" | "hunk-header";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
  segments?: TextSegment[];
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  status?: "added" | "deleted" | "modified" | "renamed" | "copied";
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isBinary?: boolean;
  isImage?: boolean;
}

export interface HunkExpansionState {
  beforeLines: DiffLine[];
  afterLines: DiffLine[];
  canExpandBefore: boolean;
  canExpandAfter: boolean;
}

export interface LineComment {
  id: string;
  filePath: string;
  lineNumber?: number;
  lineType?: 'addition' | 'deletion' | 'context' | 'file';
  hunkIndex?: number;
  content: string;
  createdAt: number;
  updatedAt: number;
}
