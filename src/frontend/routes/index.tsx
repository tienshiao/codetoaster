import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSession } from "../SessionContext";
import { buildSessionSlug } from "../utils/slug";
import { SessionLayout } from "../App";

export const Route = createFileRoute("/")({
  component: IndexComponent,
});

function IndexComponent() {
  const { sessions, isConnected } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (isConnected && sessions.length > 0) {
      const first = sessions[0]!;
      navigate({
        to: "/sessions/$slug",
        params: { slug: buildSessionSlug(first) },
        replace: true,
      });
    }
  }, [isConnected, sessions, navigate]);

  return <SessionLayout />;
}
