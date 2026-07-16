import { createFileRoute } from "@tanstack/react-router";
import { GitView } from "../components/git/GitView";
import { parseSessionSlug } from "../utils/slug";
import type { GitViewMode } from "../types/git";

export const Route = createFileRoute("/sessions/$slug/git")({
  component: GitRoute,
  validateSearch: (
    search: Record<string, unknown>,
  ): { commit?: string; mode?: GitViewMode; file?: string } => ({
    commit: typeof search.commit === "string" && search.commit ? search.commit : undefined,
    mode:
      search.mode === "commit" || search.mode === "changes" || search.mode === "tree"
        ? search.mode
        : undefined,
    file: typeof search.file === "string" && search.file ? search.file : undefined,
  }),
});

function GitRoute() {
  const { slug } = Route.useParams();
  const { id } = parseSessionSlug(slug);

  // key by session id: without it the component survives $slug-only route
  // changes and one session's view state would bleed into the next
  return <GitView key={id} sessionId={id} />;
}
