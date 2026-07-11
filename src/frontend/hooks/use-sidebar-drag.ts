import { useState, useRef, useCallback, type DragEvent } from "react";
import type { ProjectInfo } from "../SessionContext";

type DragItemType = "session" | "project";

interface DragState {
  type: DragItemType;
  id: string;
  sourceProjectId?: string;
}

type DropTarget =
  | { type: "project"; index: number }
  | {
      type: "session";
      projectId: string;
      index: number;
      // true when hovering the project header (append); shown as a header
      // highlight instead of a positional line indicator
      viaHeader: boolean;
    };

interface DragProps {
  draggable: true;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
  style: { opacity?: number };
}

interface DropZoneProps {
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

function insertIndexFromPointer(e: DragEvent, index: number): number {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? index : index + 1;
}

// Insert index into a list after the item at `from` has been removed
function adjustForRemoval(from: number, to: number): number {
  return to > from ? to - 1 : to;
}

function dropTargetsEqual(a: DropTarget, b: DropTarget): boolean {
  if (a.type === "project" && b.type === "project") return a.index === b.index;
  if (a.type === "session" && b.type === "session") {
    return a.projectId === b.projectId && a.index === b.index && a.viaHeader === b.viaHeader;
  }
  return false;
}

export function useSidebarDrag(
  projects: ProjectInfo[],
  onReorder: (projects: Array<{ id: string; sessionIds: string[] }>) => void,
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

  // Bail out when the target is unchanged so continuous dragover events
  // don't re-render the sidebar
  const updateDropTarget = useCallback((next: DropTarget) => {
    setDropTarget((prev) => (prev && dropTargetsEqual(prev, next) ? prev : next));
  }, []);

  const clearDropTarget = useCallback(() => {
    setDropTarget((prev) => (prev === null ? prev : null));
  }, []);

  const commitReorder = useCallback((newProjects: ProjectInfo[]) => {
    onReorder(newProjects.map((p) => ({ id: p.id, sessionIds: [...p.sessionIds] })));
  }, [onReorder]);

  const endDrag = useCallback(() => {
    setDragState(null);
    setDropTarget(null);
    cleanupDragImage();
  }, [cleanupDragImage]);

  const performDrop = useCallback(() => {
    if (!dragState || !dropTarget) {
      endDrag();
      return;
    }

    if (dragState.type === "project" && dropTarget.type === "project") {
      const fromIndex = projects.findIndex((p) => p.id === dragState.id);
      if (fromIndex === -1) { endDrag(); return; }
      const toIndex = adjustForRemoval(fromIndex, dropTarget.index);
      if (toIndex === fromIndex) { endDrag(); return; }
      const newProjects = [...projects];
      const [moved] = newProjects.splice(fromIndex, 1);
      newProjects.splice(toIndex, 0, moved!);
      commitReorder(newProjects);
    } else if (dragState.type === "session" && dropTarget.type === "session") {
      // Look up positions in the current list — a broadcast from another
      // client may have moved or removed the session since the drag started
      const sourceProject = projects.find((p) => p.sessionIds.includes(dragState.id));
      const targetProject = projects.find((p) => p.id === dropTarget.projectId);
      if (!sourceProject || !targetProject) { endDrag(); return; }
      let insertIdx = Math.min(dropTarget.index, targetProject.sessionIds.length);
      if (sourceProject.id === targetProject.id) {
        const origIdx = sourceProject.sessionIds.indexOf(dragState.id);
        insertIdx = adjustForRemoval(origIdx, insertIdx);
        if (insertIdx === origIdx) { endDrag(); return; }
      }
      const newProjects = projects.map((p) => ({
        ...p,
        sessionIds: p.sessionIds.filter((sid) => sid !== dragState.id),
      }));
      newProjects
        .find((p) => p.id === dropTarget.projectId)!
        .sessionIds.splice(insertIdx, 0, dragState.id);
      commitReorder(newProjects);
    }
    endDrag();
  }, [projects, dragState, dropTarget, commitReorder, endDrag]);

  // Attached to each project's wrapper (header + session list) so a project
  // drag can target anywhere in the group: top half → before, bottom → after
  const getProjectDropZoneProps = useCallback(
    (projectIndex: number): DropZoneProps => ({
      onDragOver: (e: DragEvent) => {
        if (dragState?.type !== "project") return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        updateDropTarget({ type: "project", index: insertIndexFromPointer(e, projectIndex) });
      },
      onDrop: (e: DragEvent) => {
        if (dragState?.type !== "project") return;
        e.preventDefault();
        performDrop();
      },
    }),
    [dragState, updateDropTarget, performDrop],
  );

  const getProjectDragProps = useCallback(
    (projectId: string): DragProps => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        setDropTarget(null);
        setDragState({ type: "project", id: projectId });
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `project:${projectId}`);
        createDragImage(e);
      },
      // Project drags fall through to the group drop zone; the header only
      // handles sessions dropping in (append to this project)
      onDragOver: (e: DragEvent) => {
        if (dragState?.type !== "session") {
          if (!dragState) e.preventDefault();
          return;
        }
        if (dragState.sourceProjectId === projectId) {
          // Dropping a session on its own header would be a no-op or an
          // accidental move-to-end; treat it as no target
          clearDropTarget();
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const sessionCount = projects.find((p) => p.id === projectId)?.sessionIds.length ?? 0;
        updateDropTarget({ type: "session", projectId, index: sessionCount, viaHeader: true });
      },
      onDrop: (e: DragEvent) => {
        if (!dragState) {
          // Swallow external drops (e.g. OS files) so the browser doesn't navigate
          e.preventDefault();
          return;
        }
        if (dragState.type !== "session") return;
        e.preventDefault();
        e.stopPropagation();
        performDrop();
      },
      onDragEnd: endDrag,
      style: { opacity: dragState?.type === "project" && dragState.id === projectId ? 0.4 : undefined },
    }),
    [projects, dragState, createDragImage, updateDropTarget, clearDropTarget, performDrop, endDrag],
  );

  const getSessionDragProps = useCallback(
    (sessionId: string, projectId: string, indexInProject: number): DragProps => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.stopPropagation();
        setDropTarget(null);
        setDragState({ type: "session", id: sessionId, sourceProjectId: projectId });
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `session:${sessionId}`);
        createDragImage(e);
      },
      // Project drags fall through to the group drop zone
      onDragOver: (e: DragEvent) => {
        if (dragState?.type !== "session") {
          if (!dragState) e.preventDefault();
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        updateDropTarget({
          type: "session",
          projectId,
          index: insertIndexFromPointer(e, indexInProject),
          viaHeader: false,
        });
      },
      onDrop: (e: DragEvent) => {
        if (!dragState) {
          e.preventDefault();
          return;
        }
        if (dragState.type !== "session") return;
        e.preventDefault();
        e.stopPropagation();
        performDrop();
      },
      onDragEnd: endDrag,
      style: { opacity: dragState?.type === "session" && dragState.id === sessionId ? 0.4 : undefined },
    }),
    [dragState, createDragImage, updateDropTarget, performDrop, endDrag],
  );

  // True when inserting at `index` would leave the dragged session where it is
  const isCurrentSessionPosition = useCallback(
    (sessionId: string, projectId: string, index: number): boolean => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return false;
      const currentIdx = project.sessionIds.indexOf(sessionId);
      return currentIdx !== -1 && (index === currentIdx || index === currentIdx + 1);
    },
    [projects],
  );

  const getSessionDropIndicator = useCallback(
    (projectId: string, indexInProject: number): boolean => {
      if (dragState?.type !== "session" || dropTarget?.type !== "session") return false;
      if (dropTarget.viaHeader) return false;
      if (dropTarget.projectId !== projectId || dropTarget.index !== indexInProject) return false;
      return !isCurrentSessionPosition(dragState.id, projectId, indexInProject);
    },
    [dragState, dropTarget, isCurrentSessionPosition],
  );

  const getSessionDropIndicatorAfterLast = useCallback(
    (projectId: string): boolean => {
      if (dragState?.type !== "session" || dropTarget?.type !== "session") return false;
      if (dropTarget.viaHeader) return false;
      if (dropTarget.projectId !== projectId) return false;
      const project = projects.find((p) => p.id === projectId);
      if (!project || dropTarget.index !== project.sessionIds.length) return false;
      return !isCurrentSessionPosition(dragState.id, projectId, project.sessionIds.length);
    },
    [dragState, dropTarget, projects, isCurrentSessionPosition],
  );

  // Highlight a project header while a session hovers it (covers collapsed
  // and empty projects, which render no session rows to indicate on)
  const isProjectDropTarget = useCallback(
    (projectId: string): boolean => {
      if (dragState?.type !== "session" || dropTarget?.type !== "session") return false;
      return dropTarget.viaHeader && dropTarget.projectId === projectId;
    },
    [dragState, dropTarget],
  );

  const getProjectDropIndicator = useCallback(
    (projectIndex: number): boolean => {
      if (dragState?.type !== "project" || dropTarget?.type !== "project") return false;
      if (dropTarget.index !== projectIndex) return false;
      const fromIndex = projects.findIndex((p) => p.id === dragState.id);
      return fromIndex !== projectIndex && fromIndex !== projectIndex - 1;
    },
    [dragState, dropTarget, projects],
  );

  const getProjectDropIndicatorAfterLast = useCallback(
    (): boolean => {
      if (dragState?.type !== "project" || dropTarget?.type !== "project") return false;
      if (dropTarget.index !== projects.length) return false;
      return projects.findIndex((p) => p.id === dragState.id) !== projects.length - 1;
    },
    [dragState, dropTarget, projects],
  );

  return {
    getProjectDropZoneProps,
    getProjectDragProps,
    getSessionDragProps,
    getSessionDropIndicator,
    getSessionDropIndicatorAfterLast,
    getProjectDropIndicator,
    getProjectDropIndicatorAfterLast,
    isProjectDropTarget,
  };
}
