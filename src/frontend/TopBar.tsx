import { useRef } from "react";
import { Upload, GitBranch, Terminal, FileDiff, Files } from "lucide-react";
import { StatusDot } from "./components/StatusDot";
import { Button } from "./components/ui/button";
import { SidebarTrigger, useSidebar } from "./components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { useSession } from "./SessionContext";
import type { TabType } from "./types/tab";

interface TopBarProps {
  isConnected: boolean;
  isExited: boolean;
  isActive: boolean;
  hasNotification: boolean;
  hasSession: boolean;
  name: string | undefined;
  label: string | undefined;
  onUpload?: (files: File[]) => void;
  onFocusTerminal?: () => void;
  activeTab?: TabType;
  onTabChange?: (tab: TabType) => void;
}

export function TopBar({ isConnected, isExited, isActive, hasNotification, hasSession, name, label, onUpload, onFocusTerminal, activeTab = "terminal", onTabChange }: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { open, openMobile, isMobile } = useSidebar();
  const { sessions } = useSession();
  const sidebarClosed = isMobile ? !openMobile : !open;
  const hasAnyNotification = sessions.some(s => s.hasNotification);

  return (
    <div
      className="flex items-center gap-2 px-3 h-10 min-h-10 bg-sidebar border-b border-sidebar-border text-xs text-muted-foreground"
    >
      <div className="relative -ml-1 size-7">
        <SidebarTrigger className="absolute inset-0" />
        {sidebarClosed && hasAnyNotification && (
          <span className="absolute top-0 right-1 pointer-events-none">
            <StatusDot isConnected hasNotification isExited={false} isActive={false} />
          </span>
        )}
      </div>
      {hasSession && <StatusDot isConnected={isConnected} isExited={isExited} isActive={isActive} hasNotification={hasNotification} />}
      {label && <span className="truncate">{label}</span>}
      {/* The stable "<dir> · <branch>" name, kept alongside a live title so the
          session stays placeable when its program renames it. */}
      {label && name && label !== name && (
        <>
          <span className="text-muted-foreground/50">—</span>
          <span className="shrink-0">{name}</span>
        </>
      )}
      {hasSession && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) onUpload?.(files);
              e.target.value = "";
            }}
          />
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => {
                fileInputRef.current?.click();
                window.addEventListener("focus", () => setTimeout(() => onFocusTerminal?.(), 0), { once: true });
              }}
            >
              <Upload className="h-3.5 w-3.5" />
            </Button>
            <Tabs value={activeTab} onValueChange={(v) => onTabChange?.(v as TabType)} className="flex-row">
              <TabsList className="h-7">
                <TabsTrigger value="terminal" className="text-xs px-2.5 py-0.5 h-5 gap-1">
                  <Terminal className="h-3 w-3" /> Terminal
                </TabsTrigger>
                <TabsTrigger value="diff" className="text-xs px-2.5 py-0.5 h-5 gap-1">
                  <FileDiff className="h-3 w-3" /> Diff
                </TabsTrigger>
                <TabsTrigger value="file" className="text-xs px-2.5 py-0.5 h-5 gap-1">
                  <Files className="h-3 w-3" /> Files
                </TabsTrigger>
                <TabsTrigger value="git" className="text-xs px-2.5 py-0.5 h-5 gap-1">
                  <GitBranch className="h-3 w-3" /> Git
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </>
      )}
    </div>
  );
}
