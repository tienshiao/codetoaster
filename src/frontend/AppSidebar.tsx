import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, EllipsisVertical, FolderPlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { buildSessionSlug } from "./utils/slug";
import { StatusDot } from "./components/StatusDot";
import { RenameDialog } from "./components/RenameDialog";
import { ProjectDialog } from "./components/ProjectDialog";
import { SettingsFooter } from "./components/SettingsDialog";
import { TerminalPreview } from "./components/TerminalPreview";
import { useSidebarDrag } from "./hooks/use-sidebar-drag";
import { useTerminalPreview } from "./hooks/use-terminal-preview";
import { useTerminalTheme } from "./hooks/use-terminal-theme";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import type { SessionInfo, ProjectInfo } from "./SessionContext";

function projectColorVars(color: string): React.CSSProperties | undefined {
  if (!color) return undefined;
  return {
    "--project-bg": `color-mix(in srgb, ${color} 8%, transparent)`,
    "--sidebar-accent": `color-mix(in srgb, ${color} 18%, transparent)`,
  } as React.CSSProperties;
}

interface AppSidebarProps {
  sessions: SessionInfo[];
  projects: ProjectInfo[];
  currentSessionId: string | null;
  isConnected: boolean;
  sessionActivity: Record<string, boolean>;
  lastActivityAt: React.RefObject<Record<string, number>>;
  onNewTab: (projectId?: string) => void;
  onCloseTab: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onReorder: (projects: Array<{ id: string; sessionIds: string[] }>) => void;
  onAcknowledge: (id: string) => void;
  onCreateProject: (name: string, initialPath: string, color: string) => void;
  onUpdateProject: (id: string, name: string, initialPath: string, color: string) => void;
  onDeleteProject: (id: string) => void;
  onFocusTerminal: () => void;
}

export function AppSidebar({
  sessions,
  projects,
  currentSessionId,
  isConnected,
  sessionActivity,
  lastActivityAt,
  onNewTab,
  onCloseTab,
  onRenameSession,
  onReorder,
  onAcknowledge,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onFocusTerminal,
}: AppSidebarProps) {
  const { setOpenMobile, isMobile } = useSidebar();
  const { theme, themeName } = useTerminalTheme();
  const { fetchPreview, getPreview } = useTerminalPreview(sessions, theme, themeName, lastActivityAt);
  const [renameTarget, setRenameTarget] = useState<{ type: "session"; id: string } | null>(null);
  const [projectDialogState, setProjectDialogState] = useState<{ mode: "create" | "edit"; project: ProjectInfo | null } | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const {
    getProjectDragProps,
    getSessionDragProps,
    getSessionDropIndicator,
    getSessionDropIndicatorAfterLast,
    getProjectDropIndicator,
    getProjectDropIndicatorAfterLast,
  } = useSidebarDrag(projects, onReorder);

  const sessionMap = useMemo(
    () => new Map(sessions.map((s) => [s.id, s])),
    [sessions],
  );

  const renameItem = useMemo(() => {
    if (!renameTarget) return null;
    const s = sessionMap.get(renameTarget.id);
    return s ? { id: s.id, name: s.name } : null;
  }, [renameTarget, sessionMap]);

  const toggleProject = (projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const handleNewSession = () => {
    // If only General exists, create directly
    if (projects.length <= 1) {
      onNewTab();
    }
    // Otherwise the dropdown handles it (see JSX below)
  };

  return (
    <Sidebar>
      <SidebarHeader className="flex-row items-center justify-between px-3 py-0 h-10 text-xs font-semibold uppercase tracking-wide text-zinc-500 border-b border-sidebar-border">
        CodeToaster
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="size-5 text-zinc-500" title="New Project" onClick={() => setProjectDialogState({ mode: "create", project: null })}>
            <FolderPlus className="size-4" />
          </Button>
          {projects.length <= 1 ? (
            <Button variant="ghost" size="icon" className="size-5 text-zinc-500" title="New Session" onClick={() => onNewTab()}>
              <Plus className="size-4" />
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-5 text-zinc-500" title="New Session">
                  <Plus className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {projects.map((project) => (
                  <DropdownMenuItem key={project.id} onClick={() => onNewTab(project.id)}>
                    {project.color ? (
                      <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
                    ) : (
                      <span className="size-2.5 shrink-0" />
                    )}
                    {project.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {projects.map((project, projectIndex) => {
          const isCollapsed = collapsedProjects.has(project.id);
          return (
            <div key={project.id}>
              {getProjectDropIndicator(projectIndex) && (
                <div className="h-0.5 bg-blue-500 rounded mx-2" />
              )}
              <Collapsible
                open={!isCollapsed}
              >
                <SidebarGroup className="p-0" style={projectColorVars(project.color)}>
                  <div
                    className={`group/project relative flex items-center gap-1 h-8 px-2 pr-8 text-xs font-semibold text-zinc-500 hover:bg-sidebar-accent select-none ${project.color ? "project-tint" : ""}`}
                    {...getProjectDragProps(project.id, projectIndex)}
                    style={getProjectDragProps(project.id, projectIndex).style}
                  >
                    <button
                      className="flex items-center gap-1 flex-1 min-w-0 cursor-pointer text-left"
                      onClick={() => toggleProject(project.id)}
                    >
                      <ChevronRight className={`size-3.5 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                      <span className="flex-1 truncate">{project.name}</span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="absolute right-3 top-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-zinc-500 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0"
                          draggable={false}
                        >
                          <EllipsisVertical />
                        </button>
                      </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => onNewTab(project.id)}>
                            <Plus />
                            New Session
                          </DropdownMenuItem>
                          {project.id !== "general" && (
                            <DropdownMenuItem onClick={() => setProjectDialogState({ mode: "edit", project })}>
                              <Pencil />
                              Edit Project
                            </DropdownMenuItem>
                          )}
                          {project.id !== "general" && (
                            <DropdownMenuItem onClick={() => setDeleteProjectTarget(project.id)}>
                              <Trash2 />
                              Delete Project
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                  </div>
                  <CollapsibleContent>
                    <SidebarMenu className="gap-0">
                      {project.sessionIds.map((sessionId, indexInProject) => {
                        const session = sessionMap.get(sessionId);
                        if (!session) return null;
                        const isActive = session.id === currentSessionId;
                        return (
                          <SidebarMenuItem
                            key={session.id}
                            className={project.color ? "project-tint" : ""}
                            {...getSessionDragProps(session.id, project.id, indexInProject)}
                          >
                            {getSessionDropIndicator(project.id, indexInProject) && (
                              <div className="h-0.5 bg-blue-500 rounded mx-2" />
                            )}
                            <TerminalPreview
                              sessionId={session.id}
                              fetchPreview={fetchPreview}
                              getPreview={getPreview}
                            >
                              <SidebarMenuButton
                                asChild
                                isActive={isActive}
                                className="rounded-none py-2.5 h-auto items-start"
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
                                    onFocusTerminal();
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
                            </TerminalPreview>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <SidebarMenuAction className="right-3 text-zinc-500" draggable={false}>
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
                            {getSessionDropIndicatorAfterLast(project.id) &&
                              indexInProject === project.sessionIds.length - 1 && (
                              <div className="h-0.5 bg-blue-500 rounded mx-2" />
                            )}
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </CollapsibleContent>
                </SidebarGroup>
              </Collapsible>
              {getProjectDropIndicatorAfterLast() && projectIndex === projects.length - 1 && (
                <div className="h-0.5 bg-blue-500 rounded mx-2" />
              )}
            </div>
          );
        })}
      </SidebarContent>

      <SettingsFooter />

      <AlertDialog
        open={deleteProjectTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteProjectTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              "{projects.find((p) => p.id === deleteProjectTarget)?.name ?? "Project"}" will be deleted and its sessions will be moved to General.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteProjectTarget) {
                  onDeleteProject(deleteProjectTarget);
                }
                setDeleteProjectTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProjectDialog
        mode={projectDialogState?.mode ?? "create"}
        project={projectDialogState?.project ?? null}
        open={projectDialogState !== null}
        onSave={(name, initialPath, color) => {
          if (projectDialogState?.mode === "edit" && projectDialogState.project) {
            onUpdateProject(projectDialogState.project.id, name, initialPath, color);
          } else {
            onCreateProject(name, initialPath, color);
          }
        }}
        onClose={() => setProjectDialogState(null)}
      />

      <RenameDialog
        item={renameItem}
        title="Rename Session"
        onRename={(id, name) => {
          onRenameSession(id, name);
        }}
        onClose={() => setRenameTarget(null)}
      />
    </Sidebar>
  );
}
