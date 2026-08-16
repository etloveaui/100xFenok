import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  handleCloudDataPlaneAsset,
} from "../../../../scripts/lib/cloud-data-plane-worker-read.mjs";

/**
 * Unified data-asset reader — first slice (no production cutover).
 *
 * Reads one normalized public data path with a fixed source order:
 *   1. local filesystem (public/data) first;
 *   2. cloud data plane, delegating to handleCloudDataPlaneAsset with a GET
 *      Request so manifest-path/family/integrity has ONE implementation —
 *      only an `ok` Response is accepted (the handler itself falls through
 *      for non-enrolled paths, missing bindings, or integrity failure);
 *   3. ASSETS last-known-good fetch fallback (existing lazy
 *      getCloudflareContext behavior preserved);
 *   4. typed `unavailable` — never a fabricated 200.
 *
 * `env` may be injected for tests; when absent, the ASSETS/plane bindings are
 * resolved lazily via @opennextjs/cloudflare exactly as the legacy
 * readPublicDataFile fallback did, so production behavior is unchanged.
 */

const PUBLIC_DATA_ROOT = path.join(process.cwd(), "public", "data");

export type DataAssetReadSource = "filesystem" | "data-plane" | "assets";

export type DataAssetReadResult =
  | { kind: "ok"; raw: string; source: DataAssetReadSource }
  | { kind: "unavailable"; reason: string };

/** Minimal env shape; only the two plane bindings gate the plane tier. */
export type DataAssetReaderEnv = {
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  DATA_PLANE_BUCKET?: unknown;
  CLOUD_DATA_PLANE_COORDINATOR?: unknown;
};

/**
 * Normalize once and reject, aligned with the worker fail-closed boundary
 * (cloud-data-plane-worker-read.mjs familyForPath): duplicate empty segments,
 * encoded separators, dot segments, trailing slash, null and backslash are all
 * REJECTED — nothing is silently collapsed.
 */
export function normalizeDataAssetPublicPath(value: string): string | null {
  if (typeof value !== "string" || value.length === 0) return null;

  // Reject encoded separators/traversal/question-mark/hash before decoding
  // (fail closed): %2f slash, %5c backslash, %00 null, %3f '?', %23 '#'.
  if (/%2f|%5c|%00|%3f|%23/i.test(value)) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  if (decoded.includes("\0")) return null;
  if (decoded.includes("\\")) return null;
  // Raw '?'/'#' would become query/fragment once the caller builds a URL;
  // reject both raw and (already) encoded forms so a normalized path can
  // never carry a query or fragment.
  if (decoded.includes("?") || decoded.includes("#")) return null;
  if (!decoded.startsWith("/data/")) return null;
  if (decoded.endsWith("/")) return null;

  const relative = decoded.slice("/data/".length);
  if (relative.length === 0) return null;
  const segments = relative.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }

  return decoded;
}

/** Relative path under public/data for a normalized `/data/...` public path. */
function publicDataRelativePath(publicPath: string): string {
  return publicPath.slice("/data/".length);
}

/** Lazily resolve Cloudflare bindings when none were injected (production). */
async function resolveRuntimeEnv(injected: DataAssetReaderEnv): Promise<DataAssetReaderEnv> {
  if (
    injected.ASSETS !== undefined
    || injected.DATA_PLANE_BUCKET !== undefined
    || injected.CLOUD_DATA_PLANE_COORDINATOR !== undefined
  ) {
    return injected;
  }
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    // The generated CloudflareEnv type can lag wrangler.jsonc bindings between
    // type-generation runs. Narrow through this reader's runtime contract so
    // the checked-in binding configuration remains the source of truth.
    const runtimeEnv = env as unknown as DataAssetReaderEnv;
    return {
      ASSETS: runtimeEnv.ASSETS,
      DATA_PLANE_BUCKET: runtimeEnv.DATA_PLANE_BUCKET,
      CLOUD_DATA_PLANE_COORDINATOR: runtimeEnv.CLOUD_DATA_PLANE_COORDINATOR,
    };
  } catch {
    return {};
  }
}

async function readFromCloudDataPlane(
  publicPath: string,
  env: DataAssetReaderEnv,
): Promise<DataAssetReadResult | null> {
  if (env.DATA_PLANE_BUCKET === undefined || env.CLOUD_DATA_PLANE_COORDINATOR === undefined) {
    return null;
  }
  try {
    const request = new Request(new URL(publicPath, "https://assets.local"), { method: "GET" });
    // One implementation for enrolment/family/integrity: the handler returns
    // null for non-enrolled or unhealthy outcomes and only ever serves an
    // integrity-verified ok Response.
    const response = await handleCloudDataPlaneAsset(request, env as unknown as Record<string, unknown>);
    if (!response || !response.ok) return null;
    return { kind: "ok", raw: await response.text(), source: "data-plane" };
  } catch {
    return null;
  }
}

async function readFromAssets(
  publicPath: string,
  env: DataAssetReaderEnv,
): Promise<DataAssetReadResult | null> {
  if (!env.ASSETS) return null;
  try {
    const response = await env.ASSETS.fetch(
      new Request(new URL(publicPath, "https://assets.local")),
    );
    if (!response.ok) return null;
    return { kind: "ok", raw: await response.text(), source: "assets" };
  } catch {
    return null;
  }
}

/**
 * Dependency-injection seam used by the public `readDataAsset` and by the
 * orchestration test. Kept internal; the public API stays `readDataAsset`.
 */
export type DataAssetReaderSeam = {
  readLocalFile: (absPath: string) => Promise<string | null>;
  resolveEnv: (injected: DataAssetReaderEnv) => Promise<DataAssetReaderEnv>;
  readPlane: (publicPath: string, env: DataAssetReaderEnv) => Promise<DataAssetReadResult | null>;
  readAssets: (publicPath: string, env: DataAssetReaderEnv) => Promise<DataAssetReadResult | null>;
};

const defaultSeam: DataAssetReaderSeam = {
  readLocalFile: async (absPath) => {
    try {
      return await readFile(absPath, "utf-8");
    } catch {
      return null;
    }
  },
  resolveEnv: resolveRuntimeEnv,
  readPlane: readFromCloudDataPlane,
  readAssets: readFromAssets,
};

/**
 * Read a public data asset with the fixed source order above.
 * `env` is optional: injected for tests, or resolved lazily in production.
 */
export async function readDataAsset(
  publicPath: string,
  injectedEnv: DataAssetReaderEnv = {},
): Promise<DataAssetReadResult> {
  return readDataAssetWithDeps(publicPath, injectedEnv, defaultSeam);
}

/** Internal orchestration with a replaceable seam (single source order). */
export async function readDataAssetWithDeps(
  publicPath: string,
  injectedEnv: DataAssetReaderEnv,
  seam: DataAssetReaderSeam,
): Promise<DataAssetReadResult> {
  const normalized = normalizeDataAssetPublicPath(publicPath);
  if (normalized === null) {
    return { kind: "unavailable", reason: "INVALID_PUBLIC_PATH" };
  }

  // 1) Local filesystem first — same file the previous reader served.
  const local = await seam.readLocalFile(
    path.join(PUBLIC_DATA_ROOT, publicDataRelativePath(normalized)),
  );
  if (local !== null) return { kind: "ok", raw: local, source: "filesystem" };

  const env = await seam.resolveEnv(injectedEnv);

  // 2) Cloud data plane (delegated; ok Response only) — before ASSETS.
  const fromPlane = await seam.readPlane(normalized, env);
  if (fromPlane) return fromPlane;

  // 3) ASSETS last-known-good.
  const fromAssets = await seam.readAssets(normalized, env);
  if (fromAssets) return fromAssets;

  // 4) Typed unavailable — never a fabricated 200.
  return { kind: "unavailable", reason: "DATA_ASSET_UNAVAILABLE" };
}
