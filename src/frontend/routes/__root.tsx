import { createRootRoute, Outlet } from "@tanstack/react-router";
import { SessionProvider } from "../SessionContext";
import { TerminalThemeProvider } from "../hooks/use-terminal-theme";
import { useTheme } from "../hooks/use-theme";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  useTheme();

  return (
    <TerminalThemeProvider>
      <SessionProvider>
        <Outlet />
      </SessionProvider>
    </TerminalThemeProvider>
  );
}
