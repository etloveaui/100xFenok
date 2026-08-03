// @ts-expect-error `cloudflare:workers` is provided by the workerd runtime.
import { DurableObject } from "cloudflare:workers";
import handler from "./.open-next/worker.js";
// Plain-JS data-plane modules, shared byte-for-byte with the node publisher so
// the Worker and CI cannot drift into two different contracts.
import { handleCloudDataPlaneRequest } from "../scripts/lib/cloud-data-plane-worker-route.mjs";
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
