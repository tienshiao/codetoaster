import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sessions/$slug/")({
  component: () => null,
});
