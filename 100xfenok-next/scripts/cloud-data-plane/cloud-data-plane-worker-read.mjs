// Serve an enrolled public asset from the cloud data plane, or decline.
//
// The safety property this module exists to hold: **only a fully resolved,
// integrity-checked payload is ever served from here.** Every other outcome —
// no pointer, a manifest that does not bind, a payload whose hash disagrees, a
// path that is not enrolled, a binding that is missing, an exception of any
// kind — returns null, and the caller falls through to `env.ASSETS.fetch`,
// which serves the copy published through git. That copy is the last known
// good, so a broken data plane degrades to the previous behaviour instead of
// to an error.
//
// Serving a typed "unavailable" body with HTTP 200 would be the dangerous
// failure: downstream consumers parse these files, and a 200 carrying a shape
// they do not expect silently zeroes derived signals rather than failing loudly.
// That is why `unavailable` is a fall-through here, never a response.

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
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  const family = familyForPath(url.pathname);
  if (family === null) return null;
  if (!env?.DATA_PLANE_BUCKET || !env?.CLOUD_DATA_PLANE_COORDINATOR) return null;

  let resolved;
  try {
    const plane = createCloudflareCloudDataPlane({
      r2Bucket: env.DATA_PLANE_BUCKET,
      coordinatorNamespace: env.CLOUD_DATA_PLANE_COORDINATOR,
      coordinatorName: family,
    });
    resolved = await resolvePublicAsset({
      publicPath: manifestPathFor(url.pathname),
      pointerStore: plane.pointerStore,
      objectStore: plane.objectStore,
    });
  } catch {
    return null;
  }
  if (resolved?.kind !== "ok") return null;

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
