// Context scaffolding for previews, exported THROUGH the bundle on purpose.
//
// Several app components read React context (terminal theme, router, react-query).
// A preview cannot supply that context by importing the provider from
// node_modules: the bundle inlines its own copy of @tanstack/react-router and
// react-query, so the preview's provider would be a DIFFERENT module instance and
// the component would still see no context ("Invariant failed: Could not find a
// nearest match!"). Bundling these wrappers alongside the components makes both
// sides share one instance.
//
// This module is preview infrastructure, not part of the design system's API.
// It ships no component cards - componentSrcMap decides those.

import { useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

export { TerminalThemeProvider } from "../src/frontend/hooks/use-terminal-theme";
// SessionProvider drives sessions over a WebSocket. It never connects in a preview
// (no server), but it mounts and supplies context, which is what the consumers need.
export { SessionProvider } from "../src/frontend/SessionContext";
// NOTE: @tanstack/react-query and @tanstack/react-router reach previews via
// cfg.extraEntries, which merges them onto window.CodeToaster AND redirects bare
// imports of those specifiers to the bundle's instance. That is what keeps React
// context identity intact; re-exporting them here as well would be a second path
// to the same bindings.

/** Seed entries are [queryKey, data] pairs matching the hook's own query key. */
export function PreviewQuery({
  seed,
  children,
}: {
  seed?: [readonly unknown[], unknown][];
  children: ReactNode;
}) {
  const [client] = useState(() => {
    const c = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    for (const [key, data] of seed ?? []) c.setQueryData(key as never, data);
    return c;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Memory router whose index route renders the story, so useNavigate/useParams resolve. */
export function PreviewRouter({ children }: { children: ReactNode }) {
  const router = useMemo(() => {
    const root = createRootRoute();
    const index = createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <>{children}</>,
    });
    return createRouter({
      routeTree: root.addChildren([index]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
  }, [children]);
  return <RouterProvider router={router} />;
}
