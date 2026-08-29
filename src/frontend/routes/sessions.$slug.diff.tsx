import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { DiffView } from "../DiffView";
import { useSession } from "../SessionContext";
import { parseSessionSlug } from "../utils/slug";

export const Route = createFileRoute("/sessions/$slug/diff")({
  component: DiffRoute,
});

function DiffRoute() {
  const { slug } = Route.useParams();
  const { id } = parseSessionSlug(slug);
  const navigate = useNavigate();
  const { handleSendMessage, terminalRef } = useSession();

  const handleSubmit = useCallback(
    (promptText: string) => {
      // Addressed explicitly: since one client can hold several PTYs, the
      // server no longer has a notion of "the client's session" to fall back
      // on, and an unaddressed input is dropped.
      handleSendMessage({ type: "input", ptyId: id, data: promptText });
      navigate({
        to: "/sessions/$slug",
        params: { slug },
      });
      // Focus terminal after navigation
      setTimeout(() => terminalRef.current?.focus(), 100);
    },
    [handleSendMessage, id, navigate, slug, terminalRef]
  );

  // key by session id: without it the component survives $slug-only route
  // changes and one session's view state would bleed into the next
  return <DiffView key={id} sessionId={id} onSubmit={handleSubmit} />;
}
