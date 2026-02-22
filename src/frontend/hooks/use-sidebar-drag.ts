import { useState, useRef, useCallback, type DragEvent } from "react";
import type { FolderInfo } from "../SessionContext";

type DragItemType = "session" | "folder";

interface DragState {
  type: DragItemType;
  id: string;
  sourceFolderId?: string;
}

interface DropTarget {
  type: "session" | "folder";
  folderId: string;
  index: number; // index within folder for sessions, folder index for folders
}

interface DragProps {
  draggable: true;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
  style: { opacity?: number };
}

export function useSidebarDrag(
  folders: FolderInfo[],
  onReorder: (folders: Array<{ id: string; sessionIds: string[] }>) => void,
) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragImageRef = useRef<HTMLDivElement | null>(null);

  const cleanupDragImage = useCallback(() => {
    if (dragImageRef.current) {
      dragImageRef.current.remove();
      dragImageRef.current = null;
    }
  }, []);

  const createDragImage = useCallback((e: DragEvent) => {
    cleanupDragImage();
    const target = e.currentTarget as HTMLElement;
    const clone = target.cloneNode(true) as HTMLDivElement;
    Object.assign(clone.style, {
      position: "fixed",
      top: "-1000px",
      left: "-1000px",
      width: `${target.offsetWidth}px`,
      background: "hsl(240 6% 20%)",
      borderRadius: "6px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      pointerEvents: "none",
      opacity: "1",
    });
    document.body.appendChild(clone);
    dragImageRef.current = clone;

    const rect = target.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    e.dataTransfer.setDragImage(clone, offsetX, offsetY);
  }, [cleanupDragImage]);

  const commitReorder = useCallback((newFolders: FolderInfo[]) => {
    onReorder(newFolders.map((f) => ({ id: f.id, sessionIds: [...f.sessionIds] })));
  }, [onReorder]);

  const endDrag = useCallback(() => {
    setDragState(null);
    setDropTarget(null);
    cleanupDragImage();
  }, [cleanupDragImage]);

  const getFolderDragProps = useCallback(
    (folderId: string, folderIndex: number): DragProps => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        setDragState({ type: "folder", id: folderId });
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `folder:${folderId}`);
        createDragImage(e);
      },
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragState?.type === "folder") {
          const rect = e.currentTarget.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const idx = e.clientY < midY ? folderIndex : folderIndex + 1;
          setDropTarget({ type: "folder", folderId, index: idx });
        } else if (dragState?.type === "session") {
          // Dragging a session over a folder header — drop at end of folder
          setDropTarget({ type: "session", folderId, index: -1 });
        }
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (!dragState || !dropTarget) { endDrag(); return; }

        if (dragState.type === "folder" && dropTarget.type === "folder") {
          const fromIndex = folders.findIndex((f) => f.id === dragState.id);
          if (fromIndex === -1) { endDrag(); return; }
          let toIndex = dropTarget.index;
          if (fromIndex === toIndex || fromIndex === toIndex - 1) { endDrag(); return; }
          const newFolders = [...folders];
          const [moved] = newFolders.splice(fromIndex, 1);
          if (toIndex > fromIndex) toIndex--;
          newFolders.splice(toIndex, 0, moved!);
          commitReorder(newFolders);
        } else if (dragState.type === "session") {
          // Session dropped on folder header — move to end of folder
          const newFolders = folders.map((f) => ({
            ...f,
            sessionIds: f.sessionIds.filter((sid) => sid !== dragState.id),
          }));
          const targetFolder = newFolders.find((f) => f.id === dropTarget.folderId);
          if (targetFolder) {
            targetFolder.sessionIds.push(dragState.id);
          }
          commitReorder(newFolders);
        }
        endDrag();
      },
      onDragEnd: endDrag,
      style: { opacity: dragState?.type === "folder" && dragState.id === folderId ? 0.4 : undefined },
    }),
    [folders, dragState, dropTarget, createDragImage, commitReorder, endDrag],
  );

  const getSessionDragProps = useCallback(
    (sessionId: string, folderId: string, indexInFolder: number): DragProps => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.stopPropagation();
        setDragState({ type: "session", id: sessionId, sourceFolderId: folderId });
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `session:${sessionId}`);
        createDragImage(e);
      },
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (dragState?.type === "session") {
          const rect = e.currentTarget.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const idx = e.clientY < midY ? indexInFolder : indexInFolder + 1;
          setDropTarget({ type: "session", folderId, index: idx });
        }
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!dragState || dragState.type !== "session" || !dropTarget) { endDrag(); return; }

        const newFolders = folders.map((f) => ({
          ...f,
          sessionIds: f.sessionIds.filter((sid) => sid !== dragState.id),
        }));

        const targetFolder = newFolders.find((f) => f.id === dropTarget.folderId);
        if (targetFolder) {
          const insertIdx = dropTarget.index === -1 ? targetFolder.sessionIds.length : dropTarget.index;
          targetFolder.sessionIds.splice(insertIdx, 0, dragState.id);
        }
        commitReorder(newFolders);
        endDrag();
      },
      onDragEnd: endDrag,
      style: { opacity: dragState?.type === "session" && dragState.id === sessionId ? 0.4 : undefined },
    }),
    [folders, dragState, dropTarget, createDragImage, commitReorder, endDrag],
  );

  const getSessionDropIndicator = useCallback(
    (folderId: string, indexInFolder: number): boolean => {
      if (!dragState || dragState.type !== "session" || !dropTarget) return false;
      if (dropTarget.type !== "session") return false;
      if (dropTarget.folderId !== folderId) return false;
      if (dropTarget.index !== indexInFolder) return false;
      // Don't show indicator at the dragged item's current position
      if (dragState.sourceFolderId === folderId) {
        const folder = folders.find((f) => f.id === folderId);
        if (folder) {
          const currentIdx = folder.sessionIds.indexOf(dragState.id);
          if (currentIdx === indexInFolder || currentIdx === indexInFolder - 1) return false;
        }
      }
      return true;
    },
    [dragState, dropTarget, folders],
  );

  const getSessionDropIndicatorAfterLast = useCallback(
    (folderId: string): boolean => {
      if (!dragState || dragState.type !== "session" || !dropTarget) return false;
      if (dropTarget.type !== "session") return false;
      if (dropTarget.folderId !== folderId) return false;
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return false;
      if (dropTarget.index !== folder.sessionIds.length) return false;
      // Don't show if dragged item is already at end
      if (dragState.sourceFolderId === folderId) {
        const currentIdx = folder.sessionIds.indexOf(dragState.id);
        if (currentIdx === folder.sessionIds.length - 1) return false;
      }
      return true;
    },
    [dragState, dropTarget, folders],
  );

  const getFolderDropIndicator = useCallback(
    (folderIndex: number): boolean => {
      if (!dragState || dragState.type !== "folder" || !dropTarget) return false;
      if (dropTarget.type !== "folder") return false;
      if (dropTarget.index !== folderIndex) return false;
      const fromIndex = folders.findIndex((f) => f.id === dragState.id);
      if (fromIndex === folderIndex || fromIndex === folderIndex - 1) return false;
      return true;
    },
    [dragState, dropTarget, folders],
  );

  const isFolderDropTarget = useCallback(
    (folderId: string): boolean => {
      if (!dragState || dragState.type !== "session" || !dropTarget) return false;
      if (dropTarget.folderId !== folderId || dropTarget.index !== -1) return false;
      // Don't highlight if it's already the only session in this folder
      if (dragState.sourceFolderId === folderId) {
        const folder = folders.find((f) => f.id === folderId);
        if (folder && folder.sessionIds.length === 1) return false;
      }
      return true;
    },
    [dragState, dropTarget, folders],
  );

  const getFolderDropIndicatorAfterLast = useCallback(
    (): boolean => {
      if (!dragState || dragState.type !== "folder" || !dropTarget) return false;
      if (dropTarget.type !== "folder") return false;
      if (dropTarget.index !== folders.length) return false;
      const fromIndex = folders.findIndex((f) => f.id === dragState.id);
      if (fromIndex === folders.length - 1) return false;
      return true;
    },
    [dragState, dropTarget, folders],
  );

  return {
    getFolderDragProps,
    getSessionDragProps,
    getSessionDropIndicator,
    getSessionDropIndicatorAfterLast,
    getFolderDropIndicator,
    getFolderDropIndicatorAfterLast,
    isFolderDropTarget,
    dragType: dragState?.type ?? null,
  };
}
