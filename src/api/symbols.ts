import { resolveSessionGitRoot } from "./utils";
import { lookupSymbol, searchSymbolNames } from "../lib/symbols/store";

export const symbolRoutes = {
  // Fuzzy/prefix search over symbol names (the palette "Find Symbol…" flow).
  // Registered before the exact route below; the extra path segment keeps them
  // from colliding.
  "/api/sessions/:id/symbols/search": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const q = new URL(req.url).searchParams.get("q") ?? "";
        const search = await searchSymbolNames(dir, q);
        return Response.json(search);
      } catch (error) {
        return Response.json(
          { error: "Failed to search symbols", message: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    },
  },

  // Exact-name lookup (the click-to-go-to-definition popover).
  "/api/sessions/:id/symbols": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveSessionGitRoot(req.params.id);
        if ("error" in result) return result.error;
        const { dir } = result;

        const name = new URL(req.url).searchParams.get("name");
        if (!name) {
          return Response.json({ error: "Missing name parameter" }, { status: 400 });
        }

        const lookup = await lookupSymbol(dir, name);
        return Response.json(lookup);
      } catch (error) {
        return Response.json(
          { error: "Failed to look up symbol", message: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    },
  },
} as const;
