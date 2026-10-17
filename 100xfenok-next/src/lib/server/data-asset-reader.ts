import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ENROLLED_PATHS,
  ENROLLED_PREFIXES,
  familyForPath,
  handleCloudDataPlaneAsset,
  isEnrolledPath,
} from "../../../scripts/cloud-data-plane/cloud-data-plane-worker-read.mjs";
import { PRIVATE_PUBLIC_PATHS } from "../../../scripts/cloud-data-plane/cloud-data-plane-routing-authority.mjs";
import { createCloudflareCloudDataPlane } from "../../../scripts/cloud-data-plane/cloud-data-plane-cloudflare-adapter.mjs";
import { listGenerationAssets, resolveGenerationAsset, sha256Bytes, validateActivePointer, validateGenerationManifest } from "../../../scripts/cloud-data-plane/cloud-data-plane-generation.mjs";
import {
  readDataShardRecord,
  resolveLegacyDataShard,
} from "../public-data-binary-shard.mjs";

/** Enrolled data reads the active generation; other config retains local/ASSETS lookup. */

const PUBLIC_DATA_ROOT = path.join(process.cwd(), "public", "data");

export type DataAssetReadSource = "filesystem" | "data-plane" | "assets";

export type DataAssetReadResult =
  | { kind: "ok"; raw: string; source: DataAssetReadSource }
  | { kind: "unavailable"; reason: string };

export type CloudGenerationAssetReadResult =
  | {
      kind: "ok";
      raw: string;
      bytes: ArrayBuffer;
      source: "data-plane";
      generationId: string;
      sourceAsOf: string | null;
      publishedAt: string;
    }
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

export function normalizeGenerationManifestPath(value: string): string | null {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/")) return null;
  if (/[?#%\\\u0000-\u001f\u007f]/u.test(value)) return null;
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  if (segments[0] === "data" && segments.length > 1) return value;
  if (
    segments[0] === "public"
    && (segments[1] === "data" || segments[1] === "generated")
    && segments.length > 2
  ) return value;
  return null;
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

export async function readPrivateCloudGenerationAsset(
  input: {
    family: "stockanalysis-etf-detail";
    manifestPath: string;
  },
  injectedEnv: DataAssetReaderEnv = {},
): Promise<CloudGenerationAssetReadResult> {
  const manifestPath = normalizeGenerationManifestPath(input.manifestPath);
  if (
    manifestPath === null
    || typeof input.family !== "string"
    || input.family !== "stockanalysis-etf-detail"
    || !(/^(?:data\/stockanalysis\/etfs\/[A-Z0-9][A-Z0-9.-]{0,19}|data\/computed\/data-supply\/etf-detail\/(?:enrollment|index|index-shards\/[0-9]{2}|payloads\/[A-Z0-9][A-Z0-9.-]{0,19}))\.json$/.test(manifestPath))
  ) return { kind: "unavailable", reason: "INVALID_GENERATION_ASSET_REQUEST" };

  const env = await resolveRuntimeEnv(injectedEnv);
  if (env.DATA_PLANE_BUCKET === undefined || env.CLOUD_DATA_PLANE_COORDINATOR === undefined) {
    return { kind: "unavailable", reason: "DATA_PLANE_BINDINGS_UNAVAILABLE" };
  }
  try {
    const plane = createCloudflareCloudDataPlane({
      r2Bucket: env.DATA_PLANE_BUCKET,
      coordinatorNamespace: env.CLOUD_DATA_PLANE_COORDINATOR,
      coordinatorName: input.family,
    });
    const resolved = await resolveGenerationAsset({
      assetPath: manifestPath,
      expectedPrivacyClass: "private",
      pointerStore: plane.pointerStore,
      objectStore: plane.objectStore,
      manifestCacheScope: env.DATA_PLANE_BUCKET,
    });
    if (
      resolved?.kind !== "ok"
      || !(resolved.bytes instanceof Uint8Array)
      || typeof resolved.generation_id !== "string"
      || typeof resolved.published_at !== "string"
      || (resolved.source_as_of !== null && resolved.source_as_of !== undefined
        && typeof resolved.source_as_of !== "string")
    ) {
      return { kind: "unavailable", reason: resolved?.reason ?? "DATA_PLANE_ASSET_NOT_ENROLLED" };
    }
    const bytes = new ArrayBuffer(resolved.bytes.byteLength);
    new Uint8Array(bytes).set(resolved.bytes);
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return {
      kind: "ok",
      raw,
      bytes,
      source: "data-plane",
      generationId: resolved.generation_id,
      sourceAsOf: resolved.source_as_of ?? null,
      publishedAt: resolved.published_at,
    };
  } catch {
    return { kind: "unavailable", reason: "DATA_PLANE_INTEGRITY_UNAVAILABLE" };
  }
}

export type DataAssetListEntry = {
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
};

/** List enrolled assets from verified active manifests; null leaves config listing unchanged. */
export async function listDataAssets(
  publicBasePath: string,
  injectedEnv: DataAssetReaderEnv = {},
  recursive = false,
): Promise<{ kind: "ok"; entries: DataAssetListEntry[] } | { kind: "unavailable"; reason: string } | null> {
  const base = publicBasePath === "/data" ? publicBasePath : normalizeDataAssetPublicPath(publicBasePath);
  if (base === null) return { kind: "unavailable", reason: "INVALID_DATA_DIRECTORY" };
  const prefix = `${base}/`;
  const families = new Set<string>();
  for (const [publicPath, family] of ENROLLED_PATHS) {
    if (publicPath.startsWith(prefix) && (recursive || !publicPath.slice(prefix.length).includes("/"))) {
      families.add(family);
    }
  }
  for (const enrollment of ENROLLED_PREFIXES) {
    if (prefix.startsWith(enrollment.prefix) || (recursive && enrollment.prefix.startsWith(prefix))) {
      families.add(enrollment.family);
    }
  }
  if (families.size === 0) return null;
  const env = await resolveRuntimeEnv(injectedEnv);
  if (!env.DATA_PLANE_BUCKET || !env.CLOUD_DATA_PLANE_COORDINATOR) {
    return { kind: "unavailable", reason: "DATA_PLANE_BINDINGS_UNAVAILABLE" };
  }
  try {
    const entries: DataAssetListEntry[] = [];
    for (const family of families) {
      const plane = createCloudflareCloudDataPlane({
        r2Bucket: env.DATA_PLANE_BUCKET,
        coordinatorNamespace: env.CLOUD_DATA_PLANE_COORDINATOR,
        coordinatorName: family,
      });
      const pointer = await plane.pointerStore.get();
      if (!pointer) return { kind: "unavailable", reason: "ACTIVE_POINTER_UNAVAILABLE" };
      validateActivePointer(pointer);
      const bytes = await plane.objectStore.get(pointer.active.manifest_key);
      if (!(bytes instanceof Uint8Array) || sha256Bytes(bytes) !== pointer.active.manifest_sha256) {
        return { kind: "unavailable", reason: "MANIFEST_INTEGRITY_UNAVAILABLE" };
      }
      const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      const summary = validateGenerationManifest(manifest);
      if (summary.generation_id !== pointer.active.generation_id
        || summary.manifest_sha256 !== pointer.active.manifest_sha256
        || manifest.source_sha !== pointer.source_sha) {
        return { kind: "unavailable", reason: "MANIFEST_CROSS_BIND_INVALID" };
      }
      for (const asset of await listGenerationAssets({ manifest, objectStore: plane.objectStore })) {
        if (asset.privacy_class !== "public" || !asset.path.startsWith(`public${prefix}`)) continue;
        const publicPath = asset.path.slice("public".length);
        const name = publicPath.slice(prefix.length);
        if (!name || (!recursive && name.includes("/")) || familyForPath(publicPath) !== family
          || PRIVATE_PUBLIC_PATHS.has(publicPath)) continue;
        entries.push({ name: name.split("/").at(-1)!, path: publicPath, sizeBytes: asset.bytes, updatedAt: asset.source_as_of ?? "" });
      }
    }
    return { kind: "ok", entries: entries.sort((a, b) => a.path.localeCompare(b.path)) };
  } catch {
    return { kind: "unavailable", reason: "DATA_PLANE_INTEGRITY_UNAVAILABLE" };
  }
}

async function readFromCloudDataPlane(
  publicPath: string,
  env: DataAssetReaderEnv,
): Promise<DataAssetReadResult | null> {
  if (!isEnrolledPath(publicPath)) return null;
  try {
    const request = new Request(new URL(publicPath, "https://assets.local"), { method: "GET" });
    const response = await handleCloudDataPlaneAsset(request, env as unknown as Record<string, unknown>);
    if (!response || !response.ok) return { kind: "unavailable", reason: "DATA_PLANE_UNAVAILABLE" };
    return { kind: "ok", raw: await response.text(), source: "data-plane" };
  } catch {
    return { kind: "unavailable", reason: "DATA_PLANE_UNAVAILABLE" };
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
    if (response.status === 404) {
      try {
        await response.body?.cancel();
      } catch {
        // The missing legacy asset is already known; continue to its packed form.
      }
      const packed = await readPackedPublicDataAsset(publicPath, env.ASSETS);
      return packed === null ? null : { kind: "ok", raw: packed, source: "assets" };
    }
    if (!response.ok) return null;
    return { kind: "ok", raw: await response.text(), source: "assets" };
  } catch {
    return null;
  }
}

/** Read one legacy JSON URL from its emitted binary bucket after its flat asset misses. */
export async function readPackedPublicDataAsset(
  publicPath: string,
  assets: DataAssetReaderEnv["ASSETS"],
): Promise<string | null> {
  if (!assets) return null;
  const descriptor = await resolveLegacyDataShard(publicPath);
  if (!descriptor) return null;

  const response = await assets.fetch(
    new Request(new URL(descriptor.bucketPath, "https://assets.local"), { method: "GET" }),
  );
  if (response.status === 404) {
    try {
      await response.body?.cancel();
    } catch {
      // No packed object is equivalent to the existing unavailable result.
    }
    return null;
  }
  if (response.status !== 200 || !response.body) {
    try {
      await response.body?.cancel();
    } catch {
      // Preserve the caller's existing unavailable contract.
    }
    throw new Error("DATA_ASSET_SHARD_UNAVAILABLE");
  }

  const record = await readDataShardRecord(response.body, descriptor.stem);
  if (!record) return null;
  return new TextDecoder("utf-8", { fatal: true }).decode(record.bytes);
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

  if (PRIVATE_PUBLIC_PATHS.has(normalized)) {
    return { kind: "unavailable", reason: "PRIVATE_GENERATION_ASSET" };
  }
  if (isEnrolledPath(normalized)) {
    try {
      const env = await seam.resolveEnv(injectedEnv);
      return await seam.readPlane(normalized, env)
        ?? { kind: "unavailable", reason: "DATA_PLANE_UNAVAILABLE" };
    } catch {
      return { kind: "unavailable", reason: "DATA_PLANE_UNAVAILABLE" };
    }
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
