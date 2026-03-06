import { createFileRoute } from "@tanstack/react-router";
import { FileView } from "../FileView";
import { parseSessionSlug } from "../utils/slug";

export const Route = createFileRoute("/sessions/$slug/file")({
  component: FileRoute,
});

function FileRoute() {
  const { slug } = Route.useParams();
  const { id } = parseSessionSlug(slug);
  return <FileView sessionId={id} />;
}