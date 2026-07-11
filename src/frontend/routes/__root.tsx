import { createRootRoute, Outlet } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../query-client";
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
        <SessionProvider>
          <SidebarProvider className="h-[var(--app-height,100svh)] min-h-0">
            <Outlet />
            <CommandPalette />
            <TabSwitcher />
            <Toaster />
          </SidebarProvider>
        </SessionProvider>
      </TerminalThemeProvider>
    </QueryClientProvider>
  );
}
