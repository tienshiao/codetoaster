import { createRootRoute, Outlet } from "@tanstack/react-router";
import { SessionProvider } from "../SessionContext";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <SessionProvider>
      <Outlet />
    </SessionProvider>
  );
}
