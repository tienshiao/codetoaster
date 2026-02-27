import { useState, useRef, useCallback, type DragEvent } from "react";
import type { ProjectInfo } from "../SessionContext";

type DragItemType = "session" | "project";

interface DragState {
  type: DragItemType;
  id: string;
  sourceProjectId?: string;
}

interface DropTarget {
  type: "session" | "project";
  projectId: string;
  index: number; // index within project for sessions, project index for projects
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

  const commitReorder = useCallback((newProjects: ProjectInfo[]) => {
    onReorder(newProjects.map((p) => ({ id: p.id, sessionIds: [...p.sessionIds] })));
  }, [onReorder]);

  const endDrag = useCallback(() => {
    setDragState(null);
    setDropTarget(null);
    cleanupDragImage();
  }, [cleanupDragImage]);

  const getProjectDragProps = useCallback(
    (projectId: string, projectIndex: number): DragProps => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        setDragState({ type: "project", id: projectId });
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `project:${projectId}`);
        createDragImage(e);
      },
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragState?.type === "project") {
          const rect = e.currentTarget.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const idx = e.clientY < midY ? projectIndex : projectIndex + 1;
          setDropTarget({ type: "project", projectId, index: idx });
        }
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (!dragState || !dropTarget) { endDrag(); return; }

        if (dragState.type === "project" && dropTarget.type === "project") {
          const fromIndex = projects.findIndex((p) => p.id === dragState.id);
          if (fromIndex === -1) { endDrag(); return; }
          let toIndex = dropTarget.index;
          if (fromIndex === toIndex || fromIndex === toIndex - 1) { endDrag(); return; }
          const newProjects = [...projects];
          const [moved] = newProjects.splice(fromIndex, 1);
          if (toIndex > fromIndex) toIndex--;
          newProjects.splice(toIndex, 0, moved!);
          commitReorder(newProjects);
        }
        endDrag();
      },
      onDragEnd: endDrag,
      style: { opacity: dragState?.type === "project" && dragState.id === projectId ? 0.4 : undefined },
    }),
    [projects, dragState, dropTarget, createDragImage, commitReorder, endDrag],
  );

  const getSessionDragProps = useCallback(
    (sessionId: string, projectId: string, indexInProject: number): DragProps => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.stopPropagation();
        setDragState({ type: "session", id: sessionId, sourceProjectId: projectId });
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `session:${sessionId}`);
        createDragImage(e);
      },
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (dragState?.type === "session" && projectId === dragState.sourceProjectId) {
          const rect = e.currentTarget.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const idx = e.clientY < midY ? indexInProject : indexInProject + 1;
          setDropTarget({ type: "session", projectId, index: idx });
        }
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!dragState || dragState.type !== "session" || !dropTarget) { endDrag(); return; }

        const newProjects = projects.map((p) => ({
          ...p,
          sessionIds: p.sessionIds.filter((sid) => sid !== dragState.id),
        }));

        const targetProject = newProjects.find((p) => p.id === dropTarget.projectId);
        if (targetProject) {
          const insertIdx = dropTarget.index === -1 ? targetProject.sessionIds.length : dropTarget.index;
          targetProject.sessionIds.splice(insertIdx, 0, dragState.id);
        }
        commitReorder(newProjects);
        endDrag();
      },
      onDragEnd: endDrag,
      style: { opacity: dragState?.type === "session" && dragState.id === sessionId ? 0.4 : undefined },
    }),
    [projects, dragState, dropTarget, createDragImage, commitReorder, endDrag],
  );

  const getSessionDropIndicator = useCallback(
    (projectId: string, indexInProject: number): boolean => {
      if (!dragState || dragState.type !== "session" || !dropTarget) return false;
      if (dropTarget.type !== "session") return false;
      if (dropTarget.projectId !== projectId) return false;
      if (dropTarget.index !== indexInProject) return false;
      // Don't show indicator at the dragged item's current position
      if (dragState.sourceProjectId === projectId) {
        const project = projects.find((p) => p.id === projectId);
        if (project) {
          const currentIdx = project.sessionIds.indexOf(dragState.id);
          if (currentIdx === indexInProject || currentIdx === indexInProject - 1) return false;
        }
      }
      return true;
    },
    [dragState, dropTarget, projects],
  );

  const getSessionDropIndicatorAfterLast = useCallback(
    (projectId: string): boolean => {
      if (!dragState || dragState.type !== "session" || !dropTarget) return false;
      if (dropTarget.type !== "session") return false;
      if (dropTarget.projectId !== projectId) return false;
      const project = projects.find((p) => p.id === projectId);
      if (!project) return false;
      if (dropTarget.index !== project.sessionIds.length) return false;
      // Don't show if dragged item is already at end
      if (dragState.sourceProjectId === projectId) {
        const currentIdx = project.sessionIds.indexOf(dragState.id);
        if (currentIdx === project.sessionIds.length - 1) return false;
      }
      return true;
    },
    [dragState, dropTarget, projects],
  );

  const getProjectDropIndicator = useCallback(
    (projectIndex: number): boolean => {
      if (!dragState || dragState.type !== "project" || !dropTarget) return false;
      if (dropTarget.type !== "project") return false;
      if (dropTarget.index !== projectIndex) return false;
      const fromIndex = projects.findIndex((p) => p.id === dragState.id);
      if (fromIndex === projectIndex || fromIndex === projectIndex - 1) return false;
      return true;
    },
    [dragState, dropTarget, projects],
  );

  const getProjectDropIndicatorAfterLast = useCallback(
    (): boolean => {
      if (!dragState || dragState.type !== "project" || !dropTarget) return false;
      if (dropTarget.type !== "project") return false;
      if (dropTarget.index !== projects.length) return false;
      const fromIndex = projects.findIndex((p) => p.id === dragState.id);
      if (fromIndex === projects.length - 1) return false;
      return true;
    },
    [dragState, dropTarget, projects],
  );

  return {
    getProjectDragProps,
    getSessionDragProps,
    getSessionDropIndicator,
    getSessionDropIndicatorAfterLast,
    getProjectDropIndicator,
    getProjectDropIndicatorAfterLast,
    dragType: dragState?.type ?? null,
  };
}
