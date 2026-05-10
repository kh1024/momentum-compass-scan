#!/usr/bin/env node
/**
 * Clean stale generated route artefacts before each build.
 *
 * The TanStack Router Vite plugin regenerates `src/routeTree.gen.ts` (and
 * any sibling .gen.* files) on every build. If an old generated file is left
 * behind from a previous build — especially after route files were renamed
 * or deleted — it can re-introduce duplicate `*_RouteImport` / `*Route`
 * declarations and break the production build with errors like
 * "The symbol X has already been declared".
 *
 * This script wipes those generated files so the plugin always starts from
 * a clean slate. Hand-authored files in `src/routes/` are never touched.
 */
import { rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const TARGETS = [
  join(SRC, "routeTree.gen.ts"),
  join(SRC, "routeTree.gen.tsx"),
  join(SRC, "routeTree.gen.js"),
];

function findGeneratedRouteFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      // Don't recurse into node_modules or build output.
      if (name === "node_modules" || name === "dist" || name === ".vinxi") continue;
      out.push(...findGeneratedRouteFiles(full));
      continue;
    }
    if (/\.gen\.(ts|tsx|js)$/.test(name) && /route/i.test(name)) out.push(full);
  }
  return out;
}

const targets = new Set([...TARGETS, ...findGeneratedRouteFiles(SRC)]);

let removed = 0;
for (const file of targets) {
  if (!existsSync(file)) continue;
  rmSync(file, { force: true });
  console.log(`[clean-routes] removed ${file.replace(ROOT + "/", "")}`);
  removed += 1;
}
if (removed === 0) console.log("[clean-routes] no stale route files found.");
