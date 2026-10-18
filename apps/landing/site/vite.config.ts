// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

// FITWELL_STATIC=1 (npm run build:static) builds the page as plain files for the fitwell-landing
// Cloudflare site: the one route is prerendered, and images come from the PNGs next to each
// *.png.asset.json instead of Lovable's asset host (/__l5e/...), which only exists on Lovable.
const staticBuild = process.env["FITWELL_STATIC"] === "1";

const ASSET_PREFIX = "\0fitwell-asset:";

function localLovableAssets(): Plugin {
  // Virtual module id -> the PNG it stands for. The ids must not end in .json, or Vite's JSON loader takes them.
  const pngs = new Map<string, string>();
  return {
    name: "fitwell-local-lovable-assets",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith(".png.asset.json")) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved) return null;
      const id = `${ASSET_PREFIX}${pngs.size}`;
      pngs.set(id, resolved.id.replace(/\.asset\.json$/, ""));
      return id;
    },
    load(id) {
      const png = pngs.get(id);
      if (!png) return null;
      return `import url from ${JSON.stringify(png)};\nexport default { url };\n`;
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    ...(staticBuild && { prerender: { enabled: true, crawlLinks: false } }),
  },
  ...(staticBuild && { vite: { plugins: [localLovableAssets()] } }),
});
