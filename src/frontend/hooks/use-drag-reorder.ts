import { useState, useRef, useCallback, type DragEvent } from "react";

interface DragProps {
  draggable: true;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
  style: { opacity?: number };
}

export function useDragReorder<T extends { id: string }>(
  items: T[],
  onReorder: (ids: string[]) => void,
) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragImageRef = useRef<HTMLDivElement | null>(null);

  const cleanupDragImage = useCallback(() => {
    if (dragImageRef.current) {
      dragImageRef.current.remove();
      dragImageRef.current = null;
    }
  }, []);

  const getDragProps = useCallback(
    (item: T, index: number): DragProps => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        setDraggedId(item.id);
        e.dataTransfer.effectAllowed = "move";

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
      },
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = e.currentTarget.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        setDropIndex(e.clientY < midY ? index : index + 1);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (draggedId && dropIndex !== null) {
          const fromIndex = items.findIndex((s) => s.id === draggedId);
          if (fromIndex !== -1 && fromIndex !== dropIndex && fromIndex !== dropIndex - 1) {
            const newOrder = items.map((s) => s.id);
            newOrder.splice(fromIndex, 1);
            const insertAt = dropIndex > fromIndex ? dropIndex - 1 : dropIndex;
            newOrder.splice(insertAt, 0, draggedId);
            onReorder(newOrder);
          }
        }
        setDraggedId(null);
        setDropIndex(null);
      },
      onDragEnd: () => {
        setDraggedId(null);
        setDropIndex(null);
        cleanupDragImage();
      },
      style: { opacity: draggedId === item.id ? 0.4 : undefined },
    }),
    [items, draggedId, dropIndex, onReorder, cleanupDragImage],
  );

  const isDropTarget = useCallback(
    (index: number, id: string) =>
      dropIndex === index && draggedId !== null && draggedId !== id,
    [dropIndex, draggedId],
  );

  const isDropTargetAfterLast = useCallback(
    (index: number, id: string) =>
      dropIndex === items.length &&
      index === items.length - 1 &&
      draggedId !== null &&
      draggedId !== id,
    [dropIndex, draggedId, items.length],
  );

  return { getDragProps, isDropTarget, isDropTargetAfterLast };
}
