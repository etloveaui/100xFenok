// @ts-expect-error `cloudflare:workers` is provided by the workerd runtime.
import { DurableObject } from "cloudflare:workers";
import handler from "./.open-next/worker.js";
import {
  handleMonaVnextProfileCoordinatorRequest,
  type WindDownReviewCoordinatorEnv,
  type WindDownReviewCoordinatorState,
} from "./src/features/mona-vnext/memory/learningProfileCoordinator";

const worker = {
  fetch: handler.fetch,
};

export default worker;

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
