import { BUILD_VERSION } from "../../generated/build-version";
import { readDataShardRecord, resolveLegacyDataShard } from "../public-data-binary-shard.mjs";
import {
  resolveDataSupplyEtfDetail,
  type EtfDetailResolverDependencies,
  type PublicJsonDocument,
} from "./data-supply-etf-detail";
import { buildEtfResponse } from "./data-supply-etf-response";
import { withResponseCache } from "./response-cache";

type Assets = { fetch(request: Request): Promise<Response> };
type NativeEnv = {
  ASSETS?: Assets;
  RL_API?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  DATA_SUPPLY_ANALYTICS?: {
    writeDataPoint(point: { indexes: string[]; blobs: string[]; doubles: number[] }): void;
  };
};
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };

const PATH = /^\/api\/data\/stockanalysis\/etfs\/([A-Z0-9][A-Z0-9.-]{0,19})$/;
const BOT_PATTERNS = [
  /\bClaudeBot\b/i, /\bClaude-Web\b/i, /\banthropic-ai\b/i,
  /\bGPTBot\b/i, /\bChatGPT-User\b/i, /\bOAI-SearchBot\b/i,
  /\bGoogle-Extended\b/i, /\bApplebot-Extended\b/i, /\bPerplexityBot\b/i,
  /\bCCBot\b/i, /\bBytespider\b/i, /\bAmazonbot\b/i,
  /\bFacebookBot\b/i, /\bDiffbot\b/i, /\bMetaExternalAgent\b/i,
  /\bAhrefsBot\b/i, /\bSemrushBot\b/i, /\bMJ12bot\b/i,
  /\bDotBot\b/i, /\bBLEXBot\b/i, /\bPetalBot\b/i,
  /\bBaiduspider\b/i, /\bYandexBot\b/i, /\bSogou\b/i,
  /\bAwario\b/i, /\bDataForSeoBot\b/i, /\bImagesiftBot\b/i,
  /\bomgili\b/i, /\bMeltwater\b/i, /\bSeznamBot\b/i, /\bSeekportBot\b/i,
];
const localLimits = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: Request): string {
  const direct = request.headers.get("cf-connecting-ip")?.trim();
  if (direct) return direct;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const material = [
    request.headers.get("host")?.trim() || "no-host",
    request.headers.get("user-agent")?.trim() || "no-user-agent",
    request.headers.get("accept-language")?.trim() || "no-language",
  ].join("|");
  let hash = 2166136261;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback:${(hash >>> 0).toString(36)}`;
}

async function apiRateAllowed(request: Request, env: NativeEnv): Promise<boolean> {
  const key = `api:data:${clientIp(request)}`;
  let bindingAllowed = true;
  try {
    if (env.RL_API) bindingAllowed = (await env.RL_API.limit({ key })).success;
  } catch {
    // Match middleware's isolate-local fallback when the binding fails.
  }
  const now = Date.now();
  if (localLimits.size >= 4096) {
    for (const [oldKey, entry] of localLimits) {
      if (entry.resetAt <= now) localLimits.delete(oldKey);
    }
    // The RL_API binding remains authoritative during a burst of distinct IPs.
    if (localLimits.size >= 8192) localLimits.delete(localLimits.keys().next().value!);
  }
  const current = localLimits.get(key);
  if (!current || current.resetAt <= now) {
    localLimits.set(key, { count: 1, resetAt: now + 60_000 });
    return bindingAllowed;
  }
  current.count += 1;
  return bindingAllowed && current.count <= 120;
}

const ROOT = "/data/computed/data-supply/etf-detail";
async function readDocument(assets: Assets, origin: string, pathname: string): Promise<PublicJsonDocument | null> {
  try {
    const response = await assets.fetch(new Request(new URL(pathname, origin), { method: "GET" }));
    let raw: string;
    if (response.status === 200) {
      raw = await response.text();
    } else if (response.status === 404) {
      await response.body?.cancel();
      const descriptor = await resolveLegacyDataShard(pathname);
      if (!descriptor) return null;
      const packed = await assets.fetch(new Request(new URL(descriptor.bucketPath, origin), { method: "GET" }));
      if (packed.status !== 200 || !packed.body) {
        await packed.body?.cancel();
        return null;
      }
      const record = await readDataShardRecord(packed.body, descriptor.stem);
      if (!record) return null;
      raw = new TextDecoder("utf-8", { fatal: true }).decode(record.bytes);
    } else {
      await response.body?.cancel();
      return null;
    }
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return { raw, value: value as Record<string, unknown> };
  } catch {
    return null;
  }
}

// The public enrollment is immutable for this Worker version. Failed reads stay retryable.
const enrollments = new WeakMap<Assets, Promise<PublicJsonDocument | null>>();
function readEnrollment(assets: Assets, origin: string): Promise<PublicJsonDocument | null> {
  const previous = enrollments.get(assets);
  if (previous) return previous;
  const pending = readDocument(assets, origin, `${ROOT}/enrollment.json`);
  enrollments.set(assets, pending);
  void pending.then((document) => {
    if (!document && enrollments.get(assets) === pending) enrollments.delete(assets);
  });
  return pending;
}

const nativeReaders = new WeakMap<Assets, Map<string, EtfDetailResolverDependencies>>();
function dependenciesFor(assets: Assets, origin: string): EtfDetailResolverDependencies {
  let byOrigin = nativeReaders.get(assets);
  if (!byOrigin) {
    byOrigin = new Map();
    nativeReaders.set(assets, byOrigin);
  }
  const existing = byOrigin.get(origin);
  if (existing) return existing;
  const read = (path: string) => readDocument(assets, origin, path);
  const dependencies: EtfDetailResolverDependencies = {
    readEnrollment: () => readEnrollment(assets, origin),
    readIndex: () => read(`${ROOT}/index.json`),
    readIndexShard: (id) => read(`${ROOT}/index-shards/${String(id).padStart(2, "0")}.json`),
    readProjectionPayload: (symbol) => read(`${ROOT}/payloads/${symbol}.json`),
    // Enrolled identifiers never enter the legacy static shard or private shadow branch.
    readPlanePayload: async () => ({ kind: "unavailable", reason: "not_requested" }),
    readShardPayload: async () => ({
      kind: "shard_integrity_unavailable", reason: "not_requested", manifestSha256: null, snapshotId: null,
    }),
    now: () => new Date(),
    cacheImmutableEnrollment: true,
  };
  byOrigin.set(origin, dependencies);
  return dependencies;
}

export async function handleNativeEtfDetail(
  request: Request,
  envValue: unknown,
  ctxValue: unknown,
): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const ticker = PATH.exec(url.pathname)?.[1];
  if (!ticker) return null;
  const env = envValue as NativeEnv;
  const assets = env?.ASSETS;
  if (!assets) return null;
  const dependencies = dependenciesFor(assets, url.origin);
  const enrollment = await dependencies.readEnrollment();
  if (!Array.isArray(enrollment?.value.tickers)
      || !Array.isArray(enrollment.value.index_shards)
      || !enrollment.value.tickers.includes(ticker)) return null;

  const userAgent = request.headers.get("user-agent");
  if (userAgent && BOT_PATTERNS.some((pattern) => pattern.test(userAgent))) {
    return new Response("Forbidden", { status: 403, headers: {
      "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow, noarchive",
    } });
  }
  if (!(await apiRateAllowed(request, env))) {
    return new Response("Too Many Requests", { status: 429, headers: {
      "Content-Type": "text/plain; charset=utf-8", "Retry-After": "60",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    } });
  }

  const response = await withResponseCache(`stockanalysis:etfs:${BUILD_VERSION}:${ticker}`, 300, async () => {
    const resolution = await resolveDataSupplyEtfDetail(ticker, dependencies);
    const built = buildEtfResponse(resolution, ticker);
    if (resolution.kind === "unavailable" && built.status === 503
        && built.headers.get("X-100x-Data-Supply-SLO") === "typed-unavailable") {
      const { recordTypedUnavailableResponse } = await import("./data-supply-etf-telemetry");
      recordTypedUnavailableResponse({
        ticker, cacheStatus: "MISS", stateObservedAt: resolution.stateObservedAt,
      }, () => ({ env, ctx: ctxValue as WorkerContext }));
    }
    return built;
  }, {
    isCacheable: (candidate) => candidate.ok
      || (candidate.status === 503 && candidate.headers.get("X-100x-Data-Supply-SLO") === "typed-unavailable"),
    preserveCacheControl: true,
  });
  return response;
}
