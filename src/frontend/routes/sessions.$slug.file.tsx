import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
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
  const navigate = useNavigate();

  // The ?file= search param is the single source of truth for the selection
  const handleSelectFile = useCallback(
    (path: string | null) => {
      navigate({
        to: "/sessions/$slug/file",
        params: { slug },
        search: { file: path ?? undefined },
        replace: true,
      });
    },
    [navigate, slug],
  );

  // key by session id: without it the component survives $slug-only route
  // changes and one session's view state would bleed into the next
  return <FileView key={id} sessionId={id} file={file} onSelectFile={handleSelectFile} />;
}
