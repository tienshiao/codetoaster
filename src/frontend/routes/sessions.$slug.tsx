import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useSession } from "../SessionContext";
import { parseSessionSlug } from "../utils/slug";
import { sessionDisplayName } from "../../lib/xtmux/naming";
import { SessionLayout } from "../App";

export const Route = createFileRoute("/sessions/$slug")({
  component: SessionComponent,
});

function SessionComponent() {
  const { slug } = Route.useParams();
  const { sessions, currentSessionId, attachSession, isConnected, sessionsLoaded } =
    useSession();
  const lastSlugRef = useRef<string | null>(null);

  // Update page title based on current session
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  useEffect(() => {
    // Same projection the sidebar uses, so a rename wins over the terminal
    // title here too rather than the tab disagreeing with every other surface.
    const label = currentSession ? sessionDisplayName(currentSession) : undefined;
    document.title = label ? `${label} — CodeToaster` : "CodeToaster";
  }, [currentSession?.title, currentSession?.name, currentSession?.nameSource]);

  // Attach to session when slug changes (only if session exists)
  useEffect(() => {
    if (!isConnected || !sessionsLoaded) return;
    if (slug === lastSlugRef.current) return;

    const { id } = parseSessionSlug(slug);
    const sessionExists = sessions.some((s) => s.id === id);
    if (!sessionExists) return;

    lastSlugRef.current = slug;
    attachSession(id);
  }, [slug, isConnected, sessionsLoaded, sessions, attachSession]);

  // Reset lastSlugRef when slug changes so re-attach works after navigating away and back
  useEffect(() => {
    lastSlugRef.current = null;
  }, [slug]);

  const { id } = parseSessionSlug(slug);
  const sessionExists = sessions.some((s) => s.id === id);
  const showNotFound = isConnected && sessionsLoaded && !sessionExists;

  return (
    <SessionLayout showNotFound={showNotFound}>
      <Outlet />
    </SessionLayout>
  );
}
