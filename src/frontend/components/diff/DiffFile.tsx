import React, { useMemo } from "react";
import { ChevronDown, ChevronRight, ChevronUp, MessageCircle, MessageSquare, MessageSquarePlus, MoreHorizontal } from "lucide-react";
import { CommentInput } from "./CommentInput";
import { CommentDisplay } from "./CommentDisplay";
import { ImageDiff } from "./ImageDiff";
import type { FileDiff, DiffHunk, HunkExpansionState, DiffLine, LineComment } from "../../types/diff";
import type { UseCommentsReturn } from "../../hooks/use-comments";

interface DiffFileProps {
  file: FileDiff;
  isExpanded: boolean;
  onToggle: () => void;
  hunkExpansions: Map<string, HunkExpansionState>;
  onExpandContext: (
    filePath: string,
    hunkIndex: number,
    direction: "before" | "after",
    hunk: DiffHunk,
    prevHunk: DiffHunk | null,
    nextHunk: DiffHunk | null
  ) => void;
  commentState: UseCommentsReturn;
  sessionId?: string;
}

function ExpandButton({
  direction,
  onClick,
  disabled,
}: {
  direction: "before" | "after";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <tr
      className="group cursor-pointer hover:bg-accent/30"
      onClick={disabled ? undefined : onClick}
      title={direction === "before" ? "Load previous lines" : "Load next lines"}
    >
      <td className="w-[1px] whitespace-nowrap px-2 text-right text-xs text-muted-foreground select-none border-r border-border" colSpan={2}>
        <span className="inline-flex items-center justify-center">
          {direction === "before" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </td>
      <td className="px-4 text-xs text-muted-foreground">
        <span>...</span>
      </td>
    </tr>
  );
}

interface ContextLineProps {
  line: DiffLine;
  filePath: string;
  hunkIndex: number;
  commentKey: string;
  comment?: LineComment;
  isActive: boolean;
  isEditing: boolean;
  isDeleteConfirm: boolean;
  onOpenComment: () => void;
  onSaveComment: (content: string) => void;
  onCancelComment: () => void;
  onEditComment: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

function ContextLine({
  line,
  commentKey,
  comment,
  isActive,
  isEditing,
  isDeleteConfirm,
  onOpenComment,
  onSaveComment,
  onCancelComment,
  onEditComment,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: ContextLineProps) {
  return (
    <>
      <tr className="diff-line group">
        <td className="w-[1px] whitespace-nowrap px-2 text-right text-xs text-muted-foreground/50 select-none border-r border-border">
          {line.oldLineNum ?? ""}
        </td>
        <td className="w-[1px] whitespace-nowrap px-2 text-right text-xs text-muted-foreground/50 select-none border-r border-border">
          {line.newLineNum ?? ""}
        </td>
        <td className="px-1 font-mono text-xs whitespace-pre relative">
          <button
            className="absolute left-0 top-0 h-full w-6 flex items-center justify-center opacity-0 group-hover:opacity-100 text-accent-foreground bg-blue-500/80 hover:bg-blue-500 rounded-r-sm"
            onClick={(e) => {
              e.stopPropagation();
              onOpenComment();
            }}
            title="Add comment"
          >
            <MessageSquarePlus size={13} />
          </button>
          <span className="text-muted-foreground/40 select-none px-1"> </span>
          <span>
            {line.segments ? (
              line.segments.map((seg, i) => {
                const className = seg.syntaxType ? `syntax-${seg.syntaxType}` : undefined;
                return (
                  <span key={i} className={className}>
                    {seg.text}
                  </span>
                );
              })
            ) : (
              line.content
            )}
          </span>
        </td>
      </tr>
      {comment && !isActive && (
        <CommentDisplay
          comment={comment}
          commentKey={commentKey}
          onEdit={onEditComment}
          onRequestDelete={onRequestDelete}
          onConfirmDelete={onConfirmDelete}
          onCancelDelete={onCancelDelete}
          isDeleteConfirm={isDeleteConfirm}
        />
      )}
      {isActive && (
        <CommentInput
          initialContent={isEditing ? comment?.content : undefined}
          onSave={onSaveComment}
          onCancel={onCancelComment}
        />
      )}
    </>
  );
}

export function DiffFile({
  file,
  isExpanded,
  onToggle,
  hunkExpansions,
  onExpandContext,
  commentState,
  sessionId,
}: DiffFileProps) {
  const {
    comments,
    activeCommentLines,
    editingCommentId,
    deleteConfirmId,
    getFileCommentKey,
    openComment,
    openFileComment,
    saveComment,
    saveFileComment,
    cancelComment,
    editComment,
    requestDelete,
    confirmDelete,
    cancelDelete,
  } = commentState;

  const total = file.additions + file.deletions;
  const additionWidth = total > 0 ? (file.additions / total) * 100 : 0;

  const filePath = file.newPath;

  const fileCommentCount = useMemo(() => {
    let count = 0;
    comments.forEach((c) => { if (c.filePath === filePath) count++; });
    return count;
  }, [comments, filePath]);

  const getCommentKey = (lineNumber: number, lineType: string) => {
    return `${filePath}:${lineNumber}:${lineType}`;
  };

  const shouldShowExpandBefore = (hunkIndex: number, hunk: DiffHunk) => {
    const prevHunk = hunkIndex > 0 ? file.hunks[hunkIndex - 1] : null;
    const expansionKey = `${filePath}:${hunkIndex}`;
    const expansion = hunkExpansions.get(expansionKey);

    if (!prevHunk && hunk.newStart <= 1) return false;

    const loadedBeforeCount = expansion?.beforeLines.length || 0;
    const effectiveStart = hunk.newStart - loadedBeforeCount;

    if (prevHunk) {
      const prevExpansionKey = `${filePath}:${hunkIndex - 1}`;
      const prevExpansion = hunkExpansions.get(prevExpansionKey);
      const prevLoadedAfterCount = prevExpansion?.afterLines.length || 0;
      const prevHunkEnd = prevHunk.newStart + prevHunk.newCount - 1;
      const prevEffectiveEnd = prevHunkEnd + prevLoadedAfterCount;
      if (effectiveStart <= prevEffectiveEnd + 1) return false;
    } else {
      if (effectiveStart <= 1) return false;
    }

    if (expansion && !expansion.canExpandBefore) return false;
    return true;
  };

  const shouldShowExpandAfter = (hunkIndex: number, hunk: DiffHunk) => {
    const nextHunk = hunkIndex < file.hunks.length - 1 ? file.hunks[hunkIndex + 1] : null;
    const expansionKey = `${filePath}:${hunkIndex}`;
    const expansion = hunkExpansions.get(expansionKey);

    const loadedAfterCount = expansion?.afterLines.length || 0;
    const hunkEnd = hunk.newStart + hunk.newCount - 1;
    const effectiveEnd = hunkEnd + loadedAfterCount;

    if (nextHunk) {
      const nextExpansionKey = `${filePath}:${hunkIndex + 1}`;
      const nextExpansion = hunkExpansions.get(nextExpansionKey);
      const nextLoadedBeforeCount = nextExpansion?.beforeLines.length || 0;
      const nextEffectiveStart = nextHunk.newStart - nextLoadedBeforeCount;
      if (effectiveEnd + 1 >= nextEffectiveStart) return false;
    }

    if (expansion && !expansion.canExpandAfter) return false;
    return true;
  };

  return (
    <div className={`border-x border-b border-border ${!isExpanded ? 'opacity-75' : ''}`}>
      {/* File header */}
      <div
        className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-muted cursor-pointer hover:bg-accent text-sm border-t border-b border-border"
        onClick={onToggle}
      >
        <span className="shrink-0 text-muted-foreground">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        {/* Change indicator bar */}
        <span className="shrink-0 flex w-12 h-2 rounded-full overflow-hidden bg-muted">
          <span className="bg-green-500 h-full" style={{ width: `${additionWidth}%` }} />
          <span className="bg-red-500 h-full" style={{ width: `${100 - additionWidth}%` }} />
        </span>
        <span className="truncate font-mono text-xs">{file.newPath}</span>
        <span className="ml-auto flex items-center gap-2 shrink-0 text-xs">
          <span className="text-green-500">+{file.additions}</span>
          <span className="text-red-500">-{file.deletions}</span>
          {fileCommentCount > 0 && (
            <span className="flex items-center gap-0.5 text-blue-400">
              <MessageCircle size={12} /> {fileCommentCount}
            </span>
          )}
        </span>
        <button
          className="shrink-0 flex items-center gap-1 text-xs font-sans text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-accent"
          onClick={(e) => {
            e.stopPropagation();
            openFileComment(filePath);
          }}
          title="Add comment on file"
        >
          <MessageSquare size={12} />
        </button>
      </div>

      {/* File-level comment section */}
      {isExpanded && (() => {
        const fileCommentKey = getFileCommentKey(filePath);
        const fileComment = comments.get(fileCommentKey);
        const isFileCommentActive = activeCommentLines.has(fileCommentKey);
        const isFileCommentEditing = isFileCommentActive && editingCommentId !== null;
        const isFileCommentDeleteConfirm = fileComment && deleteConfirmId === fileComment.id;

        if (!fileComment && !isFileCommentActive) return null;

        return (
          <div className="border-b border-border">
            {fileComment && !isFileCommentActive && (
              <CommentDisplay
                comment={fileComment}
                commentKey={fileCommentKey}
                onEdit={() => editComment(fileCommentKey)}
                onRequestDelete={() => requestDelete(fileComment.id)}
                onConfirmDelete={() => confirmDelete(fileCommentKey)}
                onCancelDelete={cancelDelete}
                isDeleteConfirm={!!isFileCommentDeleteConfirm}
                variant="file"
              />
            )}
            {isFileCommentActive && (
              <CommentInput
                initialContent={isFileCommentEditing ? fileComment?.content : undefined}
                onSave={(content) => saveFileComment(filePath, content)}
                onCancel={() => cancelComment(fileCommentKey)}
                variant="file"
              />
            )}
          </div>
        );
      })()}

      {/* Image diff */}
      {isExpanded && file.isImage && sessionId && (
        <ImageDiff file={file} sessionId={sessionId} />
      )}

      {/* Diff content */}
      {isExpanded && !file.isImage && (
        <div className="overflow-x-auto @container">
          {file.hunks.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground italic">
              {file.isBinary ? "Binary file" : "Empty file"}
            </div>
          ) : (
            <table className="w-full border-collapse font-mono text-xs">
              <tbody>
                {file.hunks.map((hunk, hunkIdx) => {
                  const prevHunk: DiffHunk | null = hunkIdx > 0 ? file.hunks[hunkIdx - 1]! : null;
                  const nextHunk: DiffHunk | null = hunkIdx < file.hunks.length - 1 ? file.hunks[hunkIdx + 1]! : null;
                  const expansionKey = `${filePath}:${hunkIdx}`;
                  const expansion = hunkExpansions.get(expansionKey);

                  const showExpandBefore = shouldShowExpandBefore(hunkIdx, hunk);
                  const showExpandAfter = shouldShowExpandAfter(hunkIdx, hunk);

                  return (
                    <React.Fragment key={hunkIdx}>
                      {showExpandBefore && (
                        <ExpandButton
                          direction="before"
                          onClick={() => onExpandContext(filePath, hunkIdx, "before", hunk, prevHunk, nextHunk)}
                        />
                      )}

                      {expansion?.beforeLines.map((line, lineIdx) => {
                        const lineNum = line.newLineNum!;
                        const commentKey = getCommentKey(lineNum, "context");
                        const comment = comments.get(commentKey);
                        const isActive = activeCommentLines.has(commentKey);
                        const isEditing = isActive && editingCommentId !== null;
                        const isDeleteConfirm = comment && deleteConfirmId === comment.id;

                        return (
                          <ContextLine
                            key={`before-${hunkIdx}-${lineIdx}`}
                            line={line}
                            filePath={filePath}
                            hunkIndex={hunkIdx}
                            commentKey={commentKey}
                            comment={comment}
                            isActive={isActive}
                            isEditing={isEditing}
                            isDeleteConfirm={!!isDeleteConfirm}
                            onOpenComment={() => openComment(filePath, lineNum, "context")}
                            onSaveComment={(content) => saveComment(filePath, lineNum, "context", hunkIdx, content)}
                            onCancelComment={() => cancelComment(commentKey)}
                            onEditComment={() => editComment(commentKey)}
                            onRequestDelete={() => comment && requestDelete(comment.id)}
                            onConfirmDelete={() => confirmDelete(commentKey)}
                            onCancelDelete={cancelDelete}
                          />
                        );
                      })}

                      {hunk.lines.map((line, lineIdx) => {
                        if (line.type === "hunk-header") {
                          return (
                            <tr
                              key={`${hunkIdx}-${lineIdx}`}
                              className="bg-blue-500/5"
                            >
                              <td className="w-[1px] whitespace-nowrap px-2 text-right text-xs text-muted-foreground/50 select-none border-r border-border" colSpan={2}>
                                <span className="inline-flex items-center justify-center text-muted-foreground/30">
                                  <MoreHorizontal size={14} />
                                </span>
                              </td>
                              <td className="px-4 text-xs text-blue-400/80">
                                <span>
                                  @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                                </span>
                                <span className="text-muted-foreground/50 ml-2">{line.content}</span>
                              </td>
                            </tr>
                          );
                        }

                        const lineType = line.type as 'addition' | 'deletion' | 'context';
                        const lineNum = line.newLineNum ?? line.oldLineNum;
                        const commentKey = lineNum ? getCommentKey(lineNum, lineType) : null;
                        const comment = commentKey ? comments.get(commentKey) : undefined;
                        const isActive = commentKey ? activeCommentLines.has(commentKey) : false;
                        const isEditing = isActive && editingCommentId !== null;
                        const isDeleteConfirm = comment && deleteConfirmId === comment.id;

                        const lineBgClass =
                          line.type === "addition" ? "bg-green-500/10" :
                          line.type === "deletion" ? "bg-red-500/10" : "";

                        return (
                          <React.Fragment key={`${hunkIdx}-${lineIdx}`}>
                            <tr className={`diff-line group ${lineBgClass}`}>
                              <td className="w-[1px] whitespace-nowrap px-2 text-right text-xs text-muted-foreground/50 select-none border-r border-border">
                                {line.oldLineNum ?? ""}
                              </td>
                              <td className="w-[1px] whitespace-nowrap px-2 text-right text-xs text-muted-foreground/50 select-none border-r border-border">
                                {line.newLineNum ?? ""}
                              </td>
                              <td className="px-1 whitespace-pre relative">
                                {lineNum && (
                                  <button
                                    className="absolute left-0 top-0 h-full w-6 flex items-center justify-center opacity-0 group-hover:opacity-100 text-accent-foreground bg-blue-500/80 hover:bg-blue-500 rounded-r-sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openComment(filePath, lineNum, lineType);
                                    }}
                                    title="Add comment"
                                  >
                                    <MessageSquarePlus size={13} />
                                  </button>
                                )}
                                <span className={`select-none px-1 ${
                                  line.type === "addition" ? "text-green-500/50" :
                                  line.type === "deletion" ? "text-red-500/50" :
                                  "text-muted-foreground/40"
                                }`}>
                                  {line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " "}
                                </span>
                                <span>
                                  {line.segments ? (
                                    line.segments.map((seg, i) => {
                                      const classes: string[] = [];
                                      if (seg.highlighted) {
                                        classes.push(`word-highlight-${line.type}`);
                                      }
                                      if (seg.syntaxType) {
                                        classes.push(`syntax-${seg.syntaxType}`);
                                      }
                                      return (
                                        <span
                                          key={i}
                                          className={classes.join(' ') || undefined}
                                        >
                                          {seg.text}
                                        </span>
                                      );
                                    })
                                  ) : (
                                    line.content
                                  )}
                                </span>
                              </td>
                            </tr>
                            {comment && !isActive && commentKey && (
                              <CommentDisplay
                                comment={comment}
                                commentKey={commentKey}
                                onEdit={() => editComment(commentKey)}
                                onRequestDelete={() => requestDelete(comment.id)}
                                onConfirmDelete={() => confirmDelete(commentKey)}
                                onCancelDelete={cancelDelete}
                                isDeleteConfirm={!!isDeleteConfirm}
                              />
                            )}
                            {isActive && commentKey && lineNum && (
                              <CommentInput
                                initialContent={isEditing ? comment?.content : undefined}
                                onSave={(content) => saveComment(filePath, lineNum, lineType, hunkIdx, content)}
                                onCancel={() => cancelComment(commentKey)}
                              />
                            )}
                          </React.Fragment>
                        );
                      })}

                      {expansion?.afterLines.map((line, lineIdx) => {
                        const lineNum = line.newLineNum!;
                        const commentKey = getCommentKey(lineNum, "context");
                        const comment = comments.get(commentKey);
                        const isActive = activeCommentLines.has(commentKey);
                        const isEditing = isActive && editingCommentId !== null;
                        const isDeleteConfirm = comment && deleteConfirmId === comment.id;

                        return (
                          <ContextLine
                            key={`after-${hunkIdx}-${lineIdx}`}
                            line={line}
                            filePath={filePath}
                            hunkIndex={hunkIdx}
                            commentKey={commentKey}
                            comment={comment}
                            isActive={isActive}
                            isEditing={isEditing}
                            isDeleteConfirm={!!isDeleteConfirm}
                            onOpenComment={() => openComment(filePath, lineNum, "context")}
                            onSaveComment={(content) => saveComment(filePath, lineNum, "context", hunkIdx, content)}
                            onCancelComment={() => cancelComment(commentKey)}
                            onEditComment={() => editComment(commentKey)}
                            onRequestDelete={() => comment && requestDelete(comment.id)}
                            onConfirmDelete={() => confirmDelete(commentKey)}
                            onCancelDelete={cancelDelete}
                          />
                        );
                      })}

                      {showExpandAfter && (
                        <ExpandButton
                          direction="after"
                          onClick={() => onExpandContext(filePath, hunkIdx, "after", hunk, prevHunk, nextHunk)}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
