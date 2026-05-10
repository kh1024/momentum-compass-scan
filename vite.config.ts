// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Build-time guard: scan `src/routes/` and fail fast if two route files
 * resolve to the same URL path (e.g. `/api-health` vs `/api/health`,
 * `/users.ts` vs `/users/index.ts`). Catches the class of duplicate-id
 * errors that previously broke the production build.
 */
function duplicateRouteCheck(): Plugin {
  const ROOT = join(process.cwd(), "src/routes");
  return {
    name: "lovable:duplicate-route-check",
    apply: () => true,
    buildStart() {
      const seen = new Map<string, string[]>();
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) { walk(full); continue; }
          if (!/\.(ts|tsx|js|jsx)$/.test(entry)) continue;
          if (entry.startsWith("__root.") || entry === "routeTree.gen.ts") continue;

          const rel = relative(ROOT, full).replace(/\\/g, "/");
          const noExt = rel.replace(/\.(ts|tsx|js|jsx)$/, "");
          // Normalise to a URL path the way TanStack file-routing does:
          //   - dot-separated segments → slashes
          //   - trailing /index → ""
          //   - $param → :param (purely for collision keying)
          //   - escaped [.] → literal "."
          const url = "/" + noExt
              .replace(/\[\.\]/g, "\u0001")
              .replace(/\./g, "/")
              .replace(/\u0001/g, ".")
              .replace(/\/index$/, "")
              .replace(/\$([A-Za-z0-9_]+)/g, ":$1")
              .replace(/^\/+/, "");
          const key = url.replace(/\/+$/, "") || "/";
          const list = seen.get(key) ?? [];
          list.push(rel);
          seen.set(key, list);
        }
      };
      walk(ROOT);

      const dupes = [...seen.entries()].filter(([, files]) => files.length > 1);
      if (dupes.length > 0) {
        const detail = dupes
          .map(([url, files]) => `  ${url}\n    ← ${files.join("\n    ← ")}`)
          .join("\n");
        const msg = `Duplicate route paths detected — multiple files resolve to the same URL:\n${detail}`;
        this.error(msg);
      }
    },
  };
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [duplicateRouteCheck()],
  },
});
