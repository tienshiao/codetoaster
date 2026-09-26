import { rootRoutes } from "./utils";
import { lookupSymbol, searchSymbolNames } from "../lib/symbols/store";

export const symbolRoutes = {
  // Fuzzy/prefix search over symbol names (the palette "Find Symbol…" flow).
  // Registered before the exact route below; the extra path segment keeps them
  // from colliding.
  ...rootRoutes("symbols/search", {
    async GET({ repoRoot: dir }, req) {
      try {
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
  }),

  // Exact-name lookup (the click-to-go-to-definition popover).
  ...rootRoutes("symbols", {
    async GET({ repoRoot: dir }, req) {
      try {
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
  }),
};
