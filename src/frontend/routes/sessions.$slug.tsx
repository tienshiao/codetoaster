import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useSession } from "../SessionContext";
import { parseSessionSlug, buildSessionSlug } from "../utils/slug";
import { SessionLayout } from "../App";

export const Route = createFileRoute("/sessions/$slug")({
  component: SessionComponent,
});

function SessionComponent() {
  const { slug } = Route.useParams();
  const { sessions, currentSessionId, attachSession, isConnected } =
    useSession();
  const navigate = useNavigate();
  const lastSlugRef = useRef<string | null>(null);

  // Attach to session when slug changes
  useEffect(() => {
    if (!isConnected) return;
    if (slug === lastSlugRef.current) return;
    lastSlugRef.current = slug;

    const { id } = parseSessionSlug(slug);
    attachSession(id);
  }, [slug, isConnected, attachSession]);

  // When current session is removed, navigate to next session or /
  useEffect(() => {
    if (!isConnected) return;

    const { id } = parseSessionSlug(slug);
    const sessionExists = sessions.some((s) => s.id === id);

    if (!sessionExists && sessions.length > 0) {
      const next = sessions[0]!;
      navigate({
        to: "/sessions/$slug",
        params: { slug: buildSessionSlug(next) },
        replace: true,
      });
    } else if (!sessionExists && sessions.length === 0) {
      navigate({ to: "/", replace: true });
    }
  }, [sessions, slug, isConnected, navigate]);

  return <SessionLayout />;
}
