// @ts-expect-error `cloudflare:workers` is provided by the workerd runtime.
import { DurableObject } from "cloudflare:workers";
import handler from "./.open-next/worker.js";
// Plain-JS data-plane modules, shared byte-for-byte with the node publisher so
// the Worker and CI cannot drift into two different contracts.
import { handleCloudDataPlaneRequest } from "../scripts/lib/cloud-data-plane-worker-route.mjs";
import { handleCloudDataPlaneAsset, isEnrolledPath } from "./scripts/cloud-data-plane/cloud-data-plane-worker-read.mjs";
import { PRIVATE_PUBLIC_PATHS } from "./scripts/cloud-data-plane/cloud-data-plane-routing-authority.mjs";
import {
  handleMonaVnextProfileCoordinatorRequest,
  type WindDownReviewCoordinatorEnv,
  type WindDownReviewCoordinatorState,
} from "./src/features/mona-vnext/memory/learningProfileCoordinator";
import {
  UserStoreCore,
  type UserProfile,
  type UserSettings,
  type StoredPersonalData,
} from "./src/lib/server/userStore";
import {
  UserRegistryCore,
  UserRegistrySqlStorage,
  UserRegistryMemoryStorage,
  type UserRegistryEntry,
  type UserRegistryStats,
} from "./src/lib/server/userRegistry";
import {
  gateMode,
  isGated,
  verifyRequestToken,
} from "./src/lib/server/closed-site";
import { resolveCurrentSession } from "./src/lib/server/authSession";

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

    const mode = gateMode(env);
    if (isGated(request, mode)) {
      if (url.pathname.startsWith("/data/") || url.pathname.startsWith("/api/data/")) {
        const verifyToken = (env as Record<string, unknown> | undefined)?.FENOK_VERIFY_TOKEN as
          | string
          | undefined;
        const hasVerify = await verifyRequestToken(request, verifyToken);
        if (!hasVerify) {
          let session = null;
          try {
            session = await resolveCurrentSession(request, env);
          } catch {
            session = null;
          }
          if (!session) {
            return new Response(JSON.stringify({ ok: false, error: "login required" }), {
              status: 401,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
              },
            });
          }
        }
      }
    }

    const assets = (env as { ASSETS?: { fetch: (request: Request) => Promise<Response> } })?.ASSETS;

    // Selective run_worker_first routes public data families and isolated
    // private deny paths to this Worker before the asset worker. Enrolled
    // assets are served from the published generation when they resolve
    // cleanly; every unhealthy plane outcome still falls back to the bundled
    // copy, exactly as the asset worker would have served it before enrollment.
    // Only a true asset miss (404 from ASSETS) falls through to the application
    // handler.
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
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/recovery-copy/")) {
      const digest = /^\/recovery-copy\/([a-f0-9]{64})$/.exec(pathname)?.[1];
      const actualId = (this.coordinatorState as WindDownReviewCoordinatorState & {
        id?: { toString(): string };
      }).id;
      const namespace = (this.coordinatorEnv as WindDownReviewCoordinatorEnv & {
        WINDDOWN_REVIEW_COORDINATOR?: { idFromName(name: string): { toString(): string } };
      }).WINDDOWN_REVIEW_COORDINATOR;
      if (
        !digest || !actualId || !namespace
        || actualId.toString() !== namespace.idFromName(`recoverycopy:${digest}`).toString()
      ) {
        return new Response(JSON.stringify({ error: "WINDDOWN_RECOVERY_TARGET_UNSAFE" }), {
          status: 403,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
    }
    return this.coordinatorState.blockConcurrencyWhile(() =>
      handleMonaVnextProfileCoordinatorRequest(
        this.coordinatorState,
        this.coordinatorEnv,
        request,
      ),
    );
  }
}

export class UserStore extends DurableObject {
  private readonly core: UserStoreCore;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.core = new UserStoreCore(ctx, env);
  }

  async getProfile(): Promise<UserProfile | null> {
    return this.core.getProfile();
  }

  async saveProfile(profile: Omit<UserProfile, "createdAt" | "updatedAt">): Promise<UserProfile> {
    return this.core.saveProfile(profile);
  }

  async mintToken(deviceHint?: string, now?: number): Promise<{ token: string; expiresAt: number }> {
    return this.core.mintToken(deviceHint, now);
  }

  async verifyToken(secret: string, now?: number): Promise<boolean> {
    return this.core.verifyToken(secret, now);
  }

  async revokeToken(secret: string): Promise<boolean> {
    return this.core.revokeToken(secret);
  }

  async revokeAll(): Promise<void> {
    return this.core.revokeAll();
  }

  async listTokens() {
    return this.core.listTokens();
  }

  async getSettings(): Promise<UserSettings> {
    return this.core.getSettings();
  }

  async updateSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
    return this.core.updateSettings(settings);
  }

  async getStoreData(key: string): Promise<StoredPersonalData | null> {
    return this.core.getStoreData(key);
  }

  async setStoreData(key: string, value: unknown, updatedAt?: number): Promise<StoredPersonalData> {
    return this.core.setStoreData(key, value, updatedAt);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.replace(/^\//, "");
    if (request.method === "GET" && action === "profile") {
      const profile = await this.getProfile();
      return Response.json({ ok: true, profile });
    }
    if (request.method === "POST" && action === "saveProfile") {
      const body = (await request.json()) as Omit<UserProfile, "createdAt" | "updatedAt">;
      const profile = await this.saveProfile(body);
      return Response.json({ ok: true, profile });
    }
    if (request.method === "POST" && action === "mintToken") {
      const body = (await request.json()) as { deviceHint?: string; now?: number };
      const result = await this.mintToken(body.deviceHint, body.now);
      return Response.json({ ok: true, ...result });
    }
    if (request.method === "POST" && action === "verifyToken") {
      const body = (await request.json()) as { secret: string; now?: number };
      const valid = await this.verifyToken(body.secret, body.now);
      return Response.json({ ok: true, valid });
    }
    if (request.method === "POST" && action === "revokeToken") {
      const body = (await request.json()) as { secret: string };
      const ok = await this.revokeToken(body.secret);
      return Response.json({ ok });
    }
    if (request.method === "POST" && action === "revokeAll") {
      await this.revokeAll();
      return Response.json({ ok: true });
    }
    if (request.method === "GET" && action === "settings") {
      const settings = await this.getSettings();
      return Response.json({ ok: true, settings });
    }
    if (request.method === "POST" && action === "updateSettings") {
      const body = (await request.json()) as Partial<UserSettings>;
      const settings = await this.updateSettings(body);
      return Response.json({ ok: true, settings });
    }
    if (request.method === "GET" && action.startsWith("store/")) {
      const key = action.slice("store/".length);
      const data = await this.getStoreData(key);
      return Response.json({ ok: true, data });
    }
    if (request.method === "POST" && action.startsWith("store/")) {
      const key = action.slice("store/".length);
      const body = (await request.json()) as { value: unknown; updatedAt?: number };
      const data = await this.setStoreData(key, body.value, body.updatedAt);
      return Response.json({ ok: true, data });
    }
    return new Response("Not found", { status: 404 });
  }
}

export class UserRegistry extends DurableObject {
  private readonly core: UserRegistryCore;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    const storage = (ctx.storage as unknown as { sql?: unknown })?.sql
      ? new UserRegistrySqlStorage((ctx.storage as unknown as { sql: any }).sql)
      : new UserRegistryMemoryStorage();
    this.core = new UserRegistryCore(storage, env);
  }

  async upsert(params: {
    sub: string;
    email: string;
    name: string;
    picture?: string;
    device?: string;
    now?: number;
  }): Promise<{ user: UserRegistryEntry; isNew: boolean }> {
    return this.core.upsert(params);
  }

  async ping(sub: string, now?: number): Promise<boolean> {
    return this.core.ping(sub, now);
  }

  async isBlocked(sub: string): Promise<boolean> {
    return this.core.isBlocked(sub);
  }

  async setBlocked(sub: string, blocked: boolean): Promise<boolean> {
    return this.core.setBlocked(sub, blocked);
  }

  async listUsers(): Promise<UserRegistryEntry[]> {
    return this.core.listUsers();
  }

  async getStats(now?: number): Promise<UserRegistryStats> {
    return this.core.getStats(now);
  }

  async revokeAll(sub: string): Promise<boolean> {
    return this.core.revokeAll(sub);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.replace(/^\//, "");
    if (request.method === "POST" && action === "upsert") {
      const body = (await request.json()) as {
        sub: string;
        email: string;
        name: string;
        picture?: string;
        device?: string;
        now?: number;
      };
      const result = await this.upsert(body);
      return Response.json({ ok: true, ...result });
    }
    if (request.method === "POST" && action === "ping") {
      const body = (await request.json()) as { sub: string; now?: number };
      const ok = await this.ping(body.sub, body.now);
      return Response.json({ ok });
    }
    if (request.method === "POST" && action === "isBlocked") {
      const body = (await request.json()) as { sub: string };
      const blocked = await this.isBlocked(body.sub);
      return Response.json({ ok: true, blocked });
    }
    if (request.method === "POST" && action === "setBlocked") {
      const body = (await request.json()) as { sub: string; blocked: boolean };
      const ok = await this.setBlocked(body.sub, body.blocked);
      return Response.json({ ok });
    }
    if (request.method === "GET" && action === "listUsers") {
      const users = await this.listUsers();
      return Response.json({ ok: true, users });
    }
    if (request.method === "GET" && action === "getStats") {
      const stats = await this.getStats();
      return Response.json({ ok: true, stats });
    }
    if (request.method === "POST" && action === "revokeAll") {
      const body = (await request.json()) as { sub: string };
      const ok = await this.revokeAll(body.sub);
      return Response.json({ ok });
    }
    return new Response("Not found", { status: 404 });
  }
}


