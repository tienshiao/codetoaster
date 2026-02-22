import { Link } from "@tanstack/react-router";
import { EllipsisVertical, Plus, X } from "lucide-react";
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
  onAcknowledge: (id: string) => void;
}

export function AppSidebar({
  sessions,
  currentSessionId,
  isConnected,
  sessionActivity,
  onNewTab,
  onCloseTab,
  onAcknowledge,
}: AppSidebarProps) {
  const { setOpenMobile, isMobile } = useSidebar();

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
            {sessions.map((session) => {
              const isActive = session.id === currentSessionId;
              return (
                <SidebarMenuItem key={session.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    className="rounded-none py-2.5 h-auto items-start"
                    tooltip={session.name}
                  >
                    <Link
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
                      <SidebarMenuAction showOnHover>
                        <EllipsisVertical />
                      </SidebarMenuAction>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        onClick={() => onCloseTab(session.id)}
                      >
                        <X />
                        Close Session
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
