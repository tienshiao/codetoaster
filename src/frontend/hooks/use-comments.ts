import { useState, useCallback, useMemo } from "react";
import type { LineComment } from "../types/diff";

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for insecure contexts where crypto.randomUUID is unavailable
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function useComments() {
  const [comments, setComments] = useState<Map<string, LineComment>>(new Map());
  const [activeCommentLines, setActiveCommentLines] = useState<Set<string>>(new Set());
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const getCommentKey = useCallback((filePath: string, lineNumber: number, lineType: string) => {
    return `${filePath}:${lineNumber}:${lineType}`;
  }, []);

  const getFileCommentKey = useCallback((filePath: string) => {
    return `${filePath}:file-level`;
  }, []);

  const openComment = useCallback((filePath: string, lineNumber: number, lineType: string) => {
    const key = getCommentKey(filePath, lineNumber, lineType);
    const existingComment = comments.get(key);
    if (existingComment) {
      // Edit existing comment instead of opening blank input
      setActiveCommentLines((prev) => new Set(prev).add(key));
      setEditingCommentId(existingComment.id);
    } else {
      setActiveCommentLines((prev) => new Set(prev).add(key));
    }
    setDeleteConfirmId(null);
  }, [getCommentKey, comments]);

  const openFileComment = useCallback((filePath: string) => {
    const key = getFileCommentKey(filePath);
    const existingComment = comments.get(key);
    if (existingComment) {
      // Edit existing comment instead of opening blank input
      setActiveCommentLines((prev) => new Set(prev).add(key));
      setEditingCommentId(existingComment.id);
    } else {
      setActiveCommentLines((prev) => new Set(prev).add(key));
    }
    setDeleteConfirmId(null);
  }, [getFileCommentKey, comments]);

  const saveComment = useCallback((
    filePath: string,
    lineNumber: number,
    lineType: 'addition' | 'deletion' | 'context',
    hunkIndex: number,
    content: string
  ) => {
    const key = getCommentKey(filePath, lineNumber, lineType);

    setComments((prev) => {
      const existingComment = prev.get(key);
      const now = Date.now();

      const comment: LineComment = {
        id: existingComment?.id || generateUUID(),
        filePath,
        lineNumber,
        lineType,
        hunkIndex,
        content,
        createdAt: existingComment?.createdAt || now,
        updatedAt: now,
      };

      const next = new Map(prev);
      next.set(key, comment);
      return next;
    });

    setActiveCommentLines((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setEditingCommentId(null);
  }, [getCommentKey]);

  const saveFileComment = useCallback((
    filePath: string,
    content: string
  ) => {
    const key = getFileCommentKey(filePath);

    setComments((prev) => {
      const existingComment = prev.get(key);
      const now = Date.now();

      const comment: LineComment = {
        id: existingComment?.id || generateUUID(),
        filePath,
        lineType: 'file',
        content,
        createdAt: existingComment?.createdAt || now,
        updatedAt: now,
      };

      const next = new Map(prev);
      next.set(key, comment);
      return next;
    });

    setActiveCommentLines((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setEditingCommentId(null);
  }, [getFileCommentKey]);

  const cancelComment = useCallback((commentKey: string) => {
    setActiveCommentLines((prev) => {
      const next = new Set(prev);
      next.delete(commentKey);
      return next;
    });
    setEditingCommentId(null);
  }, []);

  const editComment = useCallback((commentKey: string) => {
    const comment = comments.get(commentKey);
    if (comment) {
      setActiveCommentLines((prev) => new Set(prev).add(commentKey));
      setEditingCommentId(comment.id);
      setDeleteConfirmId(null);
    }
  }, [comments]);

  const requestDelete = useCallback((commentId: string) => {
    setDeleteConfirmId(commentId);
  }, []);

  const confirmDelete = useCallback((commentKey: string) => {
    setComments((prev) => {
      const next = new Map(prev);
      next.delete(commentKey);
      return next;
    });
    setDeleteConfirmId(null);
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteConfirmId(null);
  }, []);

  const fileCommentCounts = useMemo((): Map<string, number> => {
    const counts = new Map<string, number>();
    comments.forEach((comment) => {
      const current = counts.get(comment.filePath) || 0;
      counts.set(comment.filePath, current + 1);
    });
    return counts;
  }, [comments]);

  return {
    comments,
    activeCommentLines,
    editingCommentId,
    deleteConfirmId,
    getCommentKey,
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
    fileCommentCounts,
  };
}

export type UseCommentsReturn = ReturnType<typeof useComments>;
