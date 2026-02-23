import { useRef } from "react";
import { Upload } from "lucide-react";
import { StatusDot } from "./components/StatusDot";
import { Button } from "./components/ui/button";
import { SidebarTrigger } from "./components/ui/sidebar";

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
}

export function TopBar({ isConnected, isExited, isActive, hasNotification, hasSession, name, title, onUpload, onFocusTerminal }: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-2 px-3 h-10 min-h-10 bg-sidebar border-b border-sidebar-border text-xs text-muted-foreground">
      <SidebarTrigger className="-ml-1" />
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
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7 text-muted-foreground"
            onClick={() => {
              fileInputRef.current?.click();
              window.addEventListener("focus", () => setTimeout(() => onFocusTerminal?.(), 0), { once: true });
            }}
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}
