import { createRootRoute, Outlet } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../query-client";
import { PtyProvider } from "../PtyContext";
import { TaskProvider } from "../TaskContext";
import { TerminalThemeProvider } from "../hooks/use-terminal-theme";
import { useTheme } from "../hooks/use-theme";
import { Toaster } from "../components/ui/sonner";
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
          {/* One subscriber to the one socket, which is what lets the store
              own the notification sound and the `acknowledge` that answers one:
              with the v1 adapter also subscribed, each fired twice. */}
          <TaskProvider>
            {/* Was v1's `SidebarProvider`, which by the end was a div with a
                height: `AppShell` owns both its sidebars and nothing consumed
                the context. These are the classes it resolved to. */}
            <div className="flex min-h-0 w-full h-[var(--app-height,100svh)]">
              <Outlet />
              {/* No command palette here: v1's was mounted at the root and
                  typed off the session routes, and went with them. The v2 one
                  is a sibling of `TaskShell`, which is where the layout and
                  the keymap it acts on already are (TASK-35). */}
              <Toaster />
            </div>
          </TaskProvider>
        </PtyProvider>
      </TerminalThemeProvider>
    </QueryClientProvider>
  );
}
