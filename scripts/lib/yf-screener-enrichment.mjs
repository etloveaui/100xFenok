const YF_SCHEMA_VERSION = "yf-finance/v2";

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sourceDate(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))$/);
  if (!match) return null;

  const date = match[1];
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return null;
  if (text !== date && !Number.isFinite(new Date(text).getTime())) return null;
  return date;
}

export function extractYfForwardEnrichment(symbol, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payload.schema_version !== YF_SCHEMA_VERSION) return null;
  if (String(payload.ticker ?? "").trim().toUpperCase() !== String(symbol).trim().toUpperCase()) return null;

  const info = payload.data?.info;
  if (!info || typeof info !== "object" || Array.isArray(info)) return null;
  const currency = typeof info.currency === "string" ? info.currency.trim().toUpperCase() : "";

  return {
    peForward: finiteNumber(info.forwardPE),
    // The existing screener renders epsForward as USD. Keep non-USD EPS null
    // until the consumer carries native-currency metadata end to end.
    epsForward: currency === "USD" ? finiteNumber(info.forwardEps) : undefined,
    sourceAsOf: sourceDate(payload.source_as_of),
  };
}

export function applyYfForwardFallback(primary, yfEnrichment) {
  const primaryPe = finiteNumber(primary?.peForward);
  const primaryEps = finiteNumber(primary?.epsForward);
  const yfPe = finiteNumber(yfEnrichment?.peForward);
  const yfEps = finiteNumber(yfEnrichment?.epsForward);

  return {
    peForward: primaryPe ?? yfPe,
    epsForward: primaryEps ?? yfEps,
    peForwardSource: primaryPe !== undefined ? "slickcharts" : yfPe !== undefined ? "yf" : null,
    epsForwardSource: primaryEps !== undefined ? "slickcharts" : yfEps !== undefined ? "yf" : null,
    yfFallbackUsed: (primaryPe === undefined && yfPe !== undefined) || (primaryEps === undefined && yfEps !== undefined),
  };
}
