// Enrolled public paths serve only the verified active generation.
// A missing binding, pointer, manifest or payload returns HTTP 503; only
// non-enrolled paths decline to the existing asset/configuration reader.

import { resolvePublicAsset } from "./cloud-data-plane-generation.mjs";
import { createCloudflareCloudDataPlane } from "./cloud-data-plane-cloudflare-adapter.mjs";
import {
  PLANE_ENROLLMENT_EXACT,
  PLANE_ENROLLMENT_PREFIXES,
} from "./cloud-data-plane-enrollment.generated.mjs";

export const ENROLLED_PATHS = new Map(PLANE_ENROLLMENT_EXACT);
export const ENROLLED_PREFIXES = PLANE_ENROLLMENT_PREFIXES;

// The repository publishes these files under `public/`, and the generation
// manifest records that same path. The URL drops the prefix, so the mapping
// back is explicit rather than implied.
function manifestPathFor(pathname) {
  return `public${pathname}`;
}

export function isEnrolledPath(pathname) {
  return familyForPath(pathname) !== null;
}

export function familyForPath(pathname) {
  const exact = ENROLLED_PATHS.get(pathname);
  if (exact !== undefined) return exact;
  for (const { prefix, family: candidate } of ENROLLED_PREFIXES) {
    if (!pathname.startsWith(prefix)) continue;
    const remainder = pathname.slice(prefix.length);
    if (remainder.length === 0) continue;
    if (remainder.endsWith("/")) continue;
    if (remainder.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
      continue;
    }
    return candidate;
  }
  return null;
}

export async function handleCloudDataPlaneAsset(request, env) {
  let url;
  let pathname;
  try {
    url = new URL(request.url);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const family = familyForPath(pathname);
  if (family === null) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD", "cache-control": "no-store" } });
  }
  const unavailable = () => new Response(request.method === "HEAD" ? null : '{"error":"DATA_PLANE_UNAVAILABLE"}', {
    status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
  if (!env?.DATA_PLANE_BUCKET || !env?.CLOUD_DATA_PLANE_COORDINATOR) return unavailable();

  let resolved;
  try {
    const plane = createCloudflareCloudDataPlane({
      r2Bucket: env.DATA_PLANE_BUCKET,
      coordinatorNamespace: env.CLOUD_DATA_PLANE_COORDINATOR,
      coordinatorName: family,
    });
    resolved = await resolvePublicAsset({
      publicPath: manifestPathFor(pathname),
      pointerStore: plane.pointerStore,
      objectStore: plane.objectStore,
      manifestCacheScope: env.DATA_PLANE_BUCKET,
    });
  } catch {
    return unavailable();
  }
  if (resolved?.kind === "not_found") {
    return new Response(request.method === "HEAD" ? null : '{"error":"DATA_PLANE_ASSET_NOT_FOUND"}', {
      status: 404, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  if (resolved?.kind !== "ok") return unavailable();

  const etag = `"${resolved.generation_id}"`;
  const headers = {
    "content-type": resolved.content_type,
    // Reads are the only free-tier axis that can bind, so every response is
    // explicitly cacheable. The window is short because this data refreshes
    // during the day; correctness of freshness beats a higher hit rate.
    "cache-control": "public, max-age=300, s-maxage=300",
    etag,
    "x-data-plane-generation": resolved.generation_id,
    "x-data-plane-source-as-of": resolved.source_as_of ?? "unknown",
    "x-data-plane-published-at": resolved.published_at,
  };

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : resolved.bytes, {
    status: 200,
    headers,
  });
}
