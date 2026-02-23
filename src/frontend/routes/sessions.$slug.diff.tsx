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
      handleSendMessage({ type: "input", data: promptText });
      navigate({
        to: "/sessions/$slug",
        params: { slug },
      });
      // Focus terminal after navigation
      setTimeout(() => terminalRef.current?.focus(), 100);
    },
    [handleSendMessage, navigate, slug, terminalRef]
  );

  return <DiffView sessionId={id} onSubmit={handleSubmit} />;
}
