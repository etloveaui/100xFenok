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

const worker = {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // The data-plane door is answered before the application handler, so
    // Next middleware and rate limits never see it and it cannot be cached.
    const routed = await handleCloudDataPlaneRequest(request, env);
    if (routed) return routed;

    // Enrolled data assets are served from the published generation when it
    // resolves cleanly, and from the bundled copy otherwise. Declining is the
    // whole safety story: the bundled copy is the last known good, so a broken
    // data plane degrades to today's behaviour instead of to an error or, worse,
    // a 200 carrying a shape consumers do not expect.
    if (isEnrolledPath(new URL(request.url).pathname)) {
      const served = await handleCloudDataPlaneAsset(request, env);
      if (served) return served;
      const assets = (env as { ASSETS?: { fetch: (request: Request) => Promise<Response> } })?.ASSETS;
      if (assets) return assets.fetch(request);
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
