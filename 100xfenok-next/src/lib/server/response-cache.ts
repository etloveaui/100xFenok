const CACHE_ORIGIN = "https://100xfenok-cache.local";

type CacheState = "HIT" | "MISS";
type CloudflareCacheStorage = CacheStorage & {
  default?: Cache;
};

function getDefaultCache(): Cache | null {
  if (typeof caches === "undefined") {
    return null;
  }

  return (caches as CloudflareCacheStorage).default ?? null;
}

function toCacheRequest(cacheKey: string): Request {
  return new Request(
    `${CACHE_ORIGIN}/responses/${encodeURIComponent(cacheKey)}`,
    { method: "GET" },
  );
}

function cloneWithCacheState(response: Response, state: CacheState): Response {
  const headers = new Headers(response.headers);
  headers.set("X-100x-Cache", state);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function toStoredResponse(response: Response, ttlSeconds: number, preserveCacheControl: boolean): Response {
  const headers = new Headers(response.headers);
  if (!preserveCacheControl) headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
  headers.set("X-100x-Cache", "HIT");

  return new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function withResponseCache(
  cacheKey: string,
  ttlSeconds: number,
  loadResponse: () => Promise<Response>,
  options: {
    isCacheable?: (response: Response) => boolean;
    preserveCacheControl?: boolean;
  } = {},
): Promise<Response> {
  const cache = getDefaultCache();
  if (!cache) {
    return loadResponse();
  }

  const cacheRequest = toCacheRequest(cacheKey);

  try {
    const cached = await cache.match(cacheRequest);
    if (cached) {
      return cloneWithCacheState(cached, "HIT");
    }
  } catch {
    // Cache API misses should never break live data routes.
  }

  const response = await loadResponse();
  const cacheable = options.isCacheable ? options.isCacheable(response) : response.ok;
  if (!cacheable || response.headers.get("Cache-Control")?.includes("no-store")) {
    return response;
  }

  try {
    await cache.put(cacheRequest, toStoredResponse(response, ttlSeconds, options.preserveCacheControl === true));
  } catch {
    // Cache API writes are best-effort in local preview and production.
  }

  return cloneWithCacheState(response, "MISS");
}
