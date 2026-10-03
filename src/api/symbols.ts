import { gitSpawn, rootRoutes, SHA_RE } from "./utils";
import { lookupSymbol, searchSymbolNames } from "../lib/symbols/store";
import { lookupCommitSymbol } from "../lib/symbols/commitSource";

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
        const url = new URL(req.url);
        const name = url.searchParams.get("name");
        if (!name) {
          return Response.json({ error: "Missing name parameter" }, { status: 400 });
        }

        // `sha` scopes the lookup to one commit's files — a commit's File Tree
        // (TASK-127), where the working tree's index would name files and
        // lines that commit does not have.
        const sha = url.searchParams.get("sha");
        if (sha === null) return Response.json(await lookupSymbol(dir, name));
        if (!SHA_RE.test(sha)) {
          return Response.json({ error: "Invalid sha" }, { status: 400 });
        }
        // Resolved to the full hash, which is what the index is cached by: an
        // abbreviation would otherwise build a second index of the same commit.
        const verify = await gitSpawn(dir, ["rev-parse", "--verify", `${sha}^{commit}`]);
        if (verify.exitCode !== 0) {
          return Response.json({ error: "Commit not found" }, { status: 404 });
        }
        const lookup = await lookupCommitSymbol(dir, verify.stdout.trim(), name);
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
