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
    if (!isConnected) return;
    // A task with something behind it, not simply the first row. Opening a
    // suspended task resumes it (§6), and this navigation is not the user
    // asking for that: after a restart `reconcileOnBoot` suspends every task,
    // so landing on "/" would spawn a `claude --resume` for whichever task
    // happens to sort first — on every page load, and on every `bun --hot`
    // reload — and would take back the process the idle harvester had just
    // reclaimed. Suspended tasks are in the sidebar, one click away, which is
    // where resuming one belongs.
    const first = sessions.find((s) => s.lifecycle !== "suspended");
    if (!first) return;
    navigate({
      to: "/sessions/$slug",
      params: { slug: buildSessionSlug(first) },
      replace: true,
    });
  }, [isConnected, sessions, navigate]);

  return <SessionLayout />;
}
