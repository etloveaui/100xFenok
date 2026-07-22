import { defineCloudflareConfig, type OpenNextConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default {
  ...defineCloudflareConfig({
    incrementalCache: staticAssetsIncrementalCache,
    tagCache: "dummy",
    queue: "direct",
    cachePurge: "dummy",
    enableCacheInterception: true,
  }),
  // Without this, OpenNext shells `npm run build` (buildNextApp.js:11) and
  // re-executes the whole sync-static + edge-bundle + routes + tokens chain that
  // cf:build:steps has just finished running. Point it at the bare Next build.
  // The three guarded *:steps scripts stay byte-identical on purpose:
  // test-data-supply-policy-registry.mjs:51-62 requires each of them to carry
  // qa:data-supply-policy-registry, sync-static and qa:routes inline, and an
  // earlier attempt to extract that chain took the pipeline down.
  // Failure mode is benign — if buildCommand ever stops taking effect the nested
  // chain simply runs again and we lose the saving, nothing breaks.
  buildCommand: "npm run cf:build:next",
} satisfies OpenNextConfig;
