import {
  buildUnavailableEtfRepresentation,
  mergeEtfDataSupply,
  type EtfDetailResolution,
} from "./data-supply-etf-detail";

export const STOCKANALYSIS_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
} as const;

export const DATA_SUPPLY_NEGATIVE_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=15, s-maxage=60",
  "X-100x-Data-Supply-SLO": "typed-unavailable",
} as const;

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return Response.json(body, { status, headers });
}

export function buildEtfResponse(resolution: EtfDetailResolution, ticker: string): Response {
  if ((resolution.kind === "selected" || resolution.kind === "unavailable")
      && resolution.dataSupply.security_lifecycle) {
    return json({
      error: resolution.dataSupply.security_lifecycle.status === "renamed"
        ? "DATA_SUPPLY_SECURITY_RENAMED" : "DATA_SUPPLY_SECURITY_CLOSED",
      ticker,
      data_supply: resolution.dataSupply,
      ...(resolution.kind === "selected" ? { retained_payload: resolution.payload } : {}),
    }, 410, STOCKANALYSIS_CACHE_HEADERS);
  }
  if (resolution.kind === "selected") {
    return json(mergeEtfDataSupply(resolution.payload, resolution.dataSupply), 200, STOCKANALYSIS_CACHE_HEADERS);
  }
  if (resolution.kind === "shard") {
    return new Response(resolution.document.raw, {
      headers: { ...STOCKANALYSIS_CACHE_HEADERS, "Content-Type": "application/json" },
    });
  }
  if (resolution.kind === "unavailable") {
    return json(buildUnavailableEtfRepresentation(ticker, resolution.dataSupply).body,
      503, DATA_SUPPLY_NEGATIVE_CACHE_HEADERS);
  }
  if (resolution.kind === "shard_unavailable") {
    return json({ error: "STOCKANALYSIS_ETF_SHARD_UNAVAILABLE", ticker },
      503, { "Cache-Control": "no-store" });
  }
  if (resolution.kind === "error") {
    return json({ error: resolution.code, ticker }, 503, { "Cache-Control": "no-store" });
  }
  return json({ error: "STOCKANALYSIS_ASSET_NOT_FOUND", assetType: "etfs", ticker },
    404, { "Cache-Control": "no-store" });
}
