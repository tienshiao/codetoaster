import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, EllipsisVertical, FolderPlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { buildSessionSlug } from "./utils/slug";
import { StatusDot } from "./components/StatusDot";
import { RenameDialog } from "./components/RenameDialog";
import { SettingsFooter } from "./components/SettingsDialog";
import { useSidebarDrag } from "./hooks/use-sidebar-drag";
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
  Collapsible,
  CollapsibleContent,
} from "./components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Button } from "./components/ui/button";
import type { SessionInfo, FolderInfo } from "./SessionContext";

interface AppSidebarProps {
  sessions: SessionInfo[];
  folders: FolderInfo[];
  currentSessionId: string | null;
  isConnected: boolean;
  sessionActivity: Record<string, boolean>;
  onNewTab: (folderId?: string) => void;
  onCloseTab: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onReorder: (folders: Array<{ id: string; sessionIds: string[] }>) => void;
  onAcknowledge: (id: string) => void;
  onNewFolder: () => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
}

export function AppSidebar({
  sessions,
  folders,
  currentSessionId,
  isConnected,
  sessionActivity,
  onNewTab,
  onCloseTab,
  onRenameSession,
  onReorder,
  onAcknowledge,
  onNewFolder,
  onRenameFolder,
  onDeleteFolder,
}: AppSidebarProps) {
  const { setOpenMobile, isMobile } = useSidebar();
  const [renameTarget, setRenameTarget] = useState<{ type: "session" | "folder"; id: string } | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const {
    getFolderDragProps,
    getSessionDragProps,
    getSessionDropIndicator,
    getSessionDropIndicatorAfterLast,
    getFolderDropIndicator,
    getFolderDropIndicatorAfterLast,
    isFolderDropTarget,
  } = useSidebarDrag(folders, onReorder);

  const sessionMap = useMemo(
    () => new Map(sessions.map((s) => [s.id, s])),
    [sessions],
  );

  const renameItem = useMemo(() => {
    if (!renameTarget) return null;
    if (renameTarget.type === "session") {
      const s = sessionMap.get(renameTarget.id);
      return s ? { id: s.id, name: s.name } : null;
    }
    const f = folders.find((f) => f.id === renameTarget.id);
    return f ? { id: f.id, name: f.name } : null;
  }, [renameTarget, sessionMap, folders]);

  const toggleFolder = (folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  return (
    <Sidebar>
      <SidebarHeader className="flex-row items-center justify-between px-4 py-3 h-10 text-xs font-semibold uppercase tracking-wide text-zinc-500 border-b border-sidebar-border">
        CodeToaster
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="size-6 text-zinc-500" title="New Folder" onClick={onNewFolder}>
            <FolderPlus className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-6 text-zinc-500" title="New Session" onClick={() => onNewTab()}>
            <Plus className="size-4" />
          </Button>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {folders.map((folder, folderIndex) => {
          const isCollapsed = collapsedFolders.has(folder.id);
          return (
            <div key={folder.id}>
              {getFolderDropIndicator(folderIndex) && (
                <div className="h-0.5 bg-blue-500 rounded mx-2" />
              )}
              <Collapsible
                open={!isCollapsed}
              >
                <SidebarGroup className={`p-0 ${isFolderDropTarget(folder.id) ? "ring-1 ring-blue-500 rounded-md" : ""}`}>
                  <div
                    className="group/folder flex items-center gap-1 h-8 px-2 text-xs font-semibold text-zinc-500 hover:bg-sidebar-accent cursor-pointer select-none"
                    {...getFolderDragProps(folder.id, folderIndex)}
                    onClick={() => toggleFolder(folder.id)}
                  >
                    <ChevronRight className={`size-3.5 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                    <span className="flex-1 truncate">{folder.name}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="p-0.5 rounded opacity-0 group-hover/folder:opacity-100 hover:bg-sidebar-accent"
                          onClick={(e) => e.stopPropagation()}
                          draggable={false}
                        >
                          <EllipsisVertical className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                        <DropdownMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
                          <DropdownMenuItem onClick={() => onNewTab(folder.id)}>
                            <Plus />
                            New Session
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRenameTarget({ type: "folder", id: folder.id })}>
                            <Pencil />
                            Rename Folder
                          </DropdownMenuItem>
                          {folder.id !== "general" && (
                            <DropdownMenuItem onClick={() => onDeleteFolder(folder.id)}>
                              <Trash2 />
                              Delete Folder
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                  </div>
                  <CollapsibleContent>
                    <SidebarMenu className="gap-0">
                      {folder.sessionIds.map((sessionId, indexInFolder) => {
                        const session = sessionMap.get(sessionId);
                        if (!session) return null;
                        const isActive = session.id === currentSessionId;
                        return (
                          <SidebarMenuItem
                            key={session.id}
                            {...getSessionDragProps(session.id, folder.id, indexInFolder)}
                          >
                            {getSessionDropIndicator(folder.id, indexInFolder) && (
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
                                  onClick={() => setRenameTarget({ type: "session", id: session.id })}
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
                            {getSessionDropIndicatorAfterLast(folder.id) &&
                              indexInFolder === folder.sessionIds.length - 1 && (
                              <div className="h-0.5 bg-blue-500 rounded mx-2" />
                            )}
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </CollapsibleContent>
                </SidebarGroup>
              </Collapsible>
              {getFolderDropIndicatorAfterLast() && folderIndex === folders.length - 1 && (
                <div className="h-0.5 bg-blue-500 rounded mx-2" />
              )}
            </div>
          );
        })}
      </SidebarContent>

      <SettingsFooter />

      <RenameDialog
        item={renameItem}
        title={renameTarget?.type === "folder" ? "Rename Folder" : "Rename Session"}
        onRename={(id, name) => {
          if (renameTarget?.type === "folder") {
            onRenameFolder(id, name);
          } else {
            onRenameSession(id, name);
          }
        }}
        onClose={() => setRenameTarget(null)}
      />
    </Sidebar>
  );
}

