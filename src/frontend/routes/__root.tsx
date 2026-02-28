import { createRootRoute, Outlet } from "@tanstack/react-router";
import { SessionProvider } from "../SessionContext";
import { TerminalThemeProvider } from "../hooks/use-terminal-theme";
import { useTheme } from "../hooks/use-theme";
import { Toaster } from "../components/ui/sonner";
import { CommandPalette } from "../components/CommandPalette";
import { TabSwitcher } from "../components/TabSwitcher";
import { SidebarProvider } from "../components/ui/sidebar";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  useTheme();

  return (
    <TerminalThemeProvider>
      <SessionProvider>
        <SidebarProvider className="h-svh">
          <Outlet />
          <CommandPalette />
          <TabSwitcher />
          <Toaster />
        </SidebarProvider>
      </SessionProvider>
    </TerminalThemeProvider>
  );
}
