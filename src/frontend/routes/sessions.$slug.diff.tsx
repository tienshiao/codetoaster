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
  const { handleSendMessage, terminalRef, sessions } = useSession();
  // Read, not assumed from the task id: input is addressed by terminal, and a
  // task's PTY only happens to share its id today. Since one client can hold
  // several PTYs, the server has no notion of "the client's session" to fall
  // back on, and an input naming the wrong id is dropped.
  const ptyId = sessions.find((s) => s.id === id)?.ptyId ?? null;

  const handleSubmit = useCallback(
    (promptText: string): boolean => {
      // No terminal, no delivery. Said out loud so the caller keeps the
      // review: a task whose agent has exited has no PTY, and silently
      // swallowing the prompt while the comments were cleared threw the whole
      // review away with nothing to show for it.
      if (!ptyId) return false;
      handleSendMessage({ type: "input", ptyId, data: promptText });
      navigate({
        to: "/sessions/$slug",
        params: { slug },
      });
      // Focus terminal after navigation
      setTimeout(() => terminalRef.current?.focus(), 100);
      return true;
    },
    [handleSendMessage, ptyId, navigate, slug, terminalRef]
  );

  // key by session id: without it the component survives $slug-only route
  // changes and one session's view state would bleed into the next
  return <DiffView key={id} sessionId={id} onSubmit={handleSubmit} />;
}
