// @ts-expect-error `cloudflare:workers` is provided by the workerd runtime.
import { DurableObject } from "cloudflare:workers";
import handler from "./.open-next/worker.js";
// Plain-JS data-plane modules, shared byte-for-byte with the node publisher so
// the Worker and CI cannot drift into two different contracts.
import { handleCloudDataPlaneRequest } from "../scripts/lib/cloud-data-plane-worker-route.mjs";
import { handleCloudDataPlaneAsset, isEnrolledPath } from "../scripts/lib/cloud-data-plane-worker-read.mjs";
import {
  handleMonaVnextProfileCoordinatorRequest,
  type WindDownReviewCoordinatorEnv,
  type WindDownReviewCoordinatorState,
} from "./src/features/mona-vnext/memory/learningProfileCoordinator";

// Defense in depth for canonical-only payloads: the source/public projection
// contract keeps this file out of the bundle, while this edge guard prevents
// any stale asset, cache entry, or future fallback from making it public.
const PRIVATE_PUBLIC_PATHS = new Set([
  "/data/sec-13f/investors/griffin.json",
  "/data/computed/sec13f_bridge_index.json",
]);

const worker = {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);
    if (PRIVATE_PUBLIC_PATHS.has(url.pathname)) {
      return new Response(null, {
        status: 404,
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }

    // The data-plane door is answered before the application handler, so
    // Next middleware and rate limits never see it and it cannot be cached.
    const routed = await handleCloudDataPlaneRequest(request, env);
    if (routed) return routed;

    const assets = (env as { ASSETS?: { fetch: (request: Request) => Promise<Response> } })?.ASSETS;

    // run_worker_first routes every /data/* request to this Worker before the
    // asset worker. Enrolled assets are served from the published generation
    // when it resolves cleanly; every other data path (and every unhealthy
    // plane outcome) must still fall back to the bundled copy, exactly as the
    // asset worker would have served it before run_worker_first. Only a true
    // asset miss (404 from ASSETS) falls through to the application handler.
    if (url.pathname.startsWith("/data/")) {
      if (isEnrolledPath(url.pathname)) {
        const served = await handleCloudDataPlaneAsset(request, env);
        if (served) return served;
      }
      if (assets) {
        const bundled = await assets.fetch(request);
        if (bundled.status !== 404) return bundled;
      }
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;

export { CloudDataPlaneCoordinator } from "../scripts/lib/cloud-data-plane-coordinator.mjs";

// Preserve any OpenNext-provided DO exports when the generated cache strategy
// changes independently of this application-owned coordinator.
export {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";

export class WindDownReviewCoordinator extends DurableObject {
  private readonly coordinatorState: WindDownReviewCoordinatorState;
  private readonly coordinatorEnv: WindDownReviewCoordinatorEnv;

  constructor(ctx: WindDownReviewCoordinatorState, env: WindDownReviewCoordinatorEnv) {
    super(ctx, env);
    this.coordinatorState = ctx;
    this.coordinatorEnv = env;
  }

  async fetch(request: Request) {
    return this.coordinatorState.blockConcurrencyWhile(() =>
      handleMonaVnextProfileCoordinatorRequest(
        this.coordinatorState,
        this.coordinatorEnv,
        request,
      ),
    );
  }
}
