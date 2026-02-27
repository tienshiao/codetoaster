import { useRef } from "react";
import { Upload } from "lucide-react";
import { StatusDot } from "./components/StatusDot";
import { Button } from "./components/ui/button";
import { SidebarTrigger, useSidebar } from "./components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { useSession } from "./SessionContext";

interface TopBarProps {
  isConnected: boolean;
  isExited: boolean;
  isActive: boolean;
  hasNotification: boolean;
  hasSession: boolean;
  name: string | undefined;
  title: string | undefined;
  onUpload?: (files: File[]) => void;
  onFocusTerminal?: () => void;
  activeTab?: "terminal" | "diff";
  onTabChange?: (tab: "terminal" | "diff") => void;
}

export function TopBar({ isConnected, isExited, isActive, hasNotification, hasSession, name, title, onUpload, onFocusTerminal, activeTab = "terminal", onTabChange }: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { open, openMobile, isMobile } = useSidebar();
  const { sessions } = useSession();
  const sidebarClosed = isMobile ? !openMobile : !open;
  const hasAnyNotification = sessions.some(s => s.hasNotification);

  return (
    <div className="flex items-center gap-2 px-3 h-10 min-h-10 bg-sidebar border-b border-sidebar-border text-xs text-muted-foreground">
      <div className="relative -ml-1 size-7">
        <SidebarTrigger className="absolute inset-0" />
        {sidebarClosed && hasAnyNotification && (
          <span className="absolute top-0 right-1 pointer-events-none">
            <StatusDot isConnected hasNotification isExited={false} isActive={false} />
          </span>
        )}
      </div>
      {hasSession && <StatusDot isConnected={isConnected} isExited={isExited} isActive={isActive} hasNotification={hasNotification} />}
      {name && <span className="shrink-0">{name}</span>}
      {name && title && <span className="text-muted-foreground/50">—</span>}
      {title && <span className="truncate">{title}</span>}
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
            <Tabs value={activeTab} onValueChange={(v) => onTabChange?.(v as "terminal" | "diff")} className="flex-row">
              <TabsList className="h-7">
                <TabsTrigger value="terminal" className="text-xs px-2.5 py-0.5 h-5">Terminal</TabsTrigger>
                <TabsTrigger value="diff" className="text-xs px-2.5 py-0.5 h-5">Diff</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </>
      )}
    </div>
  );
}
