import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { EllipsisVertical, Pencil, Plus, X } from "lucide-react";
import { buildSessionSlug } from "./utils/slug";
import { StatusDot } from "./components/StatusDot";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";

export interface SessionInfo {
  id: string;
  name: string;
  title?: string;
  createdAt: number;
  size: { cols: number; rows: number };
  clientCount: number;
  exited?: boolean;
  hasNotification?: boolean;
}

interface AppSidebarProps {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  isConnected: boolean;
  sessionActivity: Record<string, boolean>;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onReorder: (sessionIds: string[]) => void;
  onAcknowledge: (id: string) => void;
}

export function AppSidebar({
  sessions,
  currentSessionId,
  isConnected,
  sessionActivity,
  onNewTab,
  onCloseTab,
  onRenameSession,
  onReorder,
  onAcknowledge,
}: AppSidebarProps) {
  const { setOpenMobile, isMobile } = useSidebar();
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragImageRef = useRef<HTMLDivElement | null>(null);

  const cleanupDragImage = useCallback(() => {
    if (dragImageRef.current) {
      dragImageRef.current.remove();
      dragImageRef.current = null;
    }
  }, []);

  const renameSession = renameSessionId
    ? sessions.find((s) => s.id === renameSessionId)
    : null;

  useEffect(() => {
    if (renameSessionId) {
      // Focus after dialog animation
      setTimeout(() => renameInputRef.current?.select(), 0);
    }
  }, [renameSessionId]);

  const handleRenameSubmit = () => {
    const trimmed = renameName.trim();
    if (renameSessionId && trimmed && trimmed !== renameSession?.name) {
      onRenameSession(renameSessionId, trimmed);
    }
    setRenameSessionId(null);
  };

  return (
    <Sidebar>
      <SidebarHeader className="flex-row items-center justify-between px-4 py-3 h-10 text-xs font-semibold uppercase tracking-wide text-zinc-500 border-b border-sidebar-border">
        CodeToaster
        <Button variant="ghost" size="icon" className="size-6 text-zinc-500" onClick={onNewTab} title="New Session">
          <Plus className="size-4" />
        </Button>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="p-0">
          <SidebarMenu className="gap-0">
            {sessions.map((session, index) => {
              const isActive = session.id === currentSessionId;
              return (
                <SidebarMenuItem
                  key={session.id}
                  draggable
                  onDragStart={(e) => {
                    setDraggedId(session.id);
                    e.dataTransfer.effectAllowed = "move";

                    cleanupDragImage();
                    const clone = e.currentTarget.cloneNode(true) as HTMLDivElement;
                    Object.assign(clone.style, {
                      position: "fixed",
                      top: "-1000px",
                      left: "-1000px",
                      width: `${e.currentTarget.offsetWidth}px`,
                      background: "hsl(240 6% 20%)",
                      borderRadius: "6px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                      pointerEvents: "none",
                      opacity: "1",
                    });
                    document.body.appendChild(clone);
                    dragImageRef.current = clone;

                    const rect = e.currentTarget.getBoundingClientRect();
                    const offsetX = e.clientX - rect.left;
                    const offsetY = e.clientY - rect.top;
                    e.dataTransfer.setDragImage(clone, offsetX, offsetY);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const rect = e.currentTarget.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    setDropIndex(e.clientY < midY ? index : index + 1);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedId && dropIndex !== null) {
                      const fromIndex = sessions.findIndex((s) => s.id === draggedId);
                      if (fromIndex !== -1 && fromIndex !== dropIndex && fromIndex !== dropIndex - 1) {
                        const newOrder = sessions.map((s) => s.id);
                        newOrder.splice(fromIndex, 1);
                        const insertAt = dropIndex > fromIndex ? dropIndex - 1 : dropIndex;
                        newOrder.splice(insertAt, 0, draggedId);
                        onReorder(newOrder);
                      }
                    }
                    setDraggedId(null);
                    setDropIndex(null);
                  }}
                  onDragEnd={() => {
                    setDraggedId(null);
                    setDropIndex(null);
                    cleanupDragImage();
                  }}
                  style={{ opacity: draggedId === session.id ? 0.4 : undefined }}
                >
                  {dropIndex === index && draggedId && draggedId !== session.id && (
                    <div className="h-0.5 bg-blue-500 rounded mx-2" />
                  )}
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    className="rounded-none py-2.5 h-auto items-start"
                    tooltip={session.name}
                  >
                    <Link
                      draggable={false}
                      to="/sessions/$slug"
                      params={{ slug: buildSessionSlug(session) }}
                      onClick={() => {
                        if (isActive) {
                          onAcknowledge?.(session.id);
                        }
                        if (isMobile) {
                          setOpenMobile(false);
                        }
                      }}
                    >
                      <StatusDot
                        isConnected={isConnected}
                        isExited={!!session.exited}
                        isActive={sessionActivity[session.id] ?? false}
                        hasNotification={session.hasNotification ?? false}
                        className="translate-y-[6px]"
                      />
                      <span className="flex flex-col overflow-hidden flex-1">
                        <span className="text-[13px] overflow-hidden text-ellipsis whitespace-nowrap">
                          {session.name}
                        </span>
                        <span className="text-[11px] text-zinc-500 overflow-hidden text-ellipsis whitespace-nowrap">
                          {session.title || "\u00A0"}
                        </span>
                      </span>
                    </Link>
                  </SidebarMenuButton>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuAction showOnHover draggable={false}>
                        <EllipsisVertical />
                      </SidebarMenuAction>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        onClick={() => {
                          setRenameName(session.name);
                          setRenameSessionId(session.id);
                        }}
                      >
                        <Pencil />
                        Rename Session
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onCloseTab(session.id)}
                      >
                        <X />
                        Close Session
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {dropIndex === sessions.length && index === sessions.length - 1 && draggedId && draggedId !== session.id && (
                    <div className="h-0.5 bg-blue-500 rounded mx-2" />
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <Dialog
        open={renameSessionId !== null}
        onOpenChange={(open) => { if (!open) setRenameSessionId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Session</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRenameSubmit();
            }}
          >
            <Input
              ref={renameInputRef}
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              placeholder="Session name"
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setRenameSessionId(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!renameName.trim()}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Sidebar>
  );
}
