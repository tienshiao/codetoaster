import { createRootRoute, Outlet } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../query-client";
import { PtyProvider } from "../PtyContext";
import { TaskProvider } from "../TaskContext";
import { SessionProvider } from "../SessionContext";
import { TerminalThemeProvider } from "../hooks/use-terminal-theme";
import { useTheme } from "../hooks/use-theme";
import { Toaster } from "../components/ui/sonner";
import { CommandPalette } from "../components/CommandPalette";
import { TabSwitcher } from "../components/TabSwitcher";
import { SidebarProvider } from "../components/ui/sidebar";
import { useVisualViewportHeight } from "../hooks/use-visual-viewport";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  useTheme();
  useVisualViewportHeight();

  return (
    <QueryClientProvider client={queryClient}>
      <TerminalThemeProvider>
        {/* The socket lives here, above everything that talks to it: the task
            list and the terminals share one connection, and the router is what
            keeps a PTY's frames going to the one terminal showing it. */}
        <PtyProvider>
          {/* Both stores subscribe to the one socket. TaskProvider is the v2
              one; SessionProvider is the v1 adapter it replaces at TASK-28. */}
          <TaskProvider>
            <SessionProvider>
              <SidebarProvider className="h-[var(--app-height,100svh)] min-h-0">
                <Outlet />
                <CommandPalette />
                <TabSwitcher />
                <Toaster />
              </SidebarProvider>
            </SessionProvider>
          </TaskProvider>
        </PtyProvider>
      </TerminalThemeProvider>
    </QueryClientProvider>
  );
}
