export const MARKET_FACTS_SHARD_COUNT = 1024;
export const MARKET_FACTS_SHARD_ALGORITHM = "fnv1a32-utf16-v1";

/**
 * Stable market-facts shard contract (v1):
 * 1. Trim the ticker, remove one leading "$", and uppercase it.
 * 2. Run 32-bit FNV-1a over each JavaScript UTF-16 code unit, applying
 *    Math.imul(hash, 0x01000193) and unsigned coercion after every unit.
 * 3. Select `hash & 1023` and encode it as zero-padded four-digit decimal.
 *
 * The mapping depends only on the canonical ticker, never universe contents.
 */
export function marketFactsTickerKey(value) {
  const ticker = String(value ?? "").trim().replace(/^\$/, "").toUpperCase();
  if (!ticker) throw new Error("market-facts ticker must not be empty");
  return ticker;
}

export function marketFactsShardId(value) {
  const ticker = marketFactsTickerKey(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < ticker.length; index += 1) {
    hash ^= ticker.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash & (MARKET_FACTS_SHARD_COUNT - 1);
}

export function marketFactsShardFileNameForId(shardId) {
  if (!Number.isInteger(shardId) || shardId < 0 || shardId >= MARKET_FACTS_SHARD_COUNT) {
    throw new RangeError(`market-facts shard id out of range: ${shardId}`);
  }
  return `${String(shardId).padStart(4, "0")}.json`;
}

export function marketFactsShardFileName(value) {
  return marketFactsShardFileNameForId(marketFactsShardId(value));
}

export function marketFactsShardUrl(value) {
  return `/data/computed/market_facts/shards/${marketFactsShardFileName(value)}`;
}

export function marketFactsFromShard(shard, value) {
  if (!shard || typeof shard !== "object" || Array.isArray(shard)) return null;
  const payload = shard[marketFactsTickerKey(value)];
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
}

/**
 * Fetch exactly one deterministic shard. A missing shard/ticker is unavailable;
 * transport and server errors remain failures for the caller to surface.
 */
export async function fetchMarketFactsFromShard(value, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  const response = await fetchImpl(marketFactsShardUrl(value), options.requestInit);
  if (response?.status === 404) return null;
  if (!response?.ok) {
    throw new Error(`market-facts shard request failed with status ${response?.status ?? "unknown"}`);
  }
  return marketFactsFromShard(await response.json(), value);
}
