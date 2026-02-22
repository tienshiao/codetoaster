import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { EllipsisVertical, Pencil, Plus, X } from "lucide-react";
import { buildSessionSlug } from "./utils/slug";
import { StatusDot } from "./components/StatusDot";
import { SessionRenameDialog } from "./components/SessionRenameDialog";
import { useDragReorder } from "./hooks/use-drag-reorder";
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
import type { SessionInfo } from "./SessionContext";

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
  const { getDragProps, isDropTarget, isDropTargetAfterLast } = useDragReorder(sessions, onReorder);

  const renameSession = renameSessionId
    ? sessions.find((s) => s.id === renameSessionId) ?? null
    : null;

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
                  {...getDragProps(session, index)}
                >
                  {isDropTarget(index, session.id) && (
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
                        onClick={() => setRenameSessionId(session.id)}
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
                  {isDropTargetAfterLast(index, session.id) && (
                    <div className="h-0.5 bg-blue-500 rounded mx-2" />
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SessionRenameDialog
        session={renameSession}
        onRename={onRenameSession}
        onClose={() => setRenameSessionId(null)}
      />
    </Sidebar>
  );
}
