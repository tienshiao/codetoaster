import { createFileRoute } from "@tanstack/react-router";
import { FileView } from "../FileView";
import { parseSessionSlug } from "../utils/slug";

export const Route = createFileRoute("/sessions/$slug/file")({
  component: FileRoute,
  validateSearch: (search: Record<string, unknown>): { file?: string } => ({
    file: typeof search.file === "string" && search.file ? search.file : undefined,
  }),
});

function FileRoute() {
  const { slug } = Route.useParams();
  const { file } = Route.useSearch();
  const { id } = parseSessionSlug(slug);
  return <FileView sessionId={id} file={file} />;
}
