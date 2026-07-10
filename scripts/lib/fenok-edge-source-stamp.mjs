export const FENOK_EDGE_SOURCE_AS_OF_IDS = Object.freeze([
  "krx_issuer_daily_latest_full_proof",
  "us_finra_flow_proxy",
  "us_occ_options_proxy",
  "us_class_yf_daily_source",
  "asia_ex_taiwan_yf_daily_source",
]);

function normalizeIsoDate(value) {
  const text = String(value ?? "").trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function recomputeFenokEdgeSourceAsOf(index) {
  const sources = Array.isArray(index?.source_availability?.sources)
    ? index.source_availability.sources
    : [];
  const sourceById = new Map(sources.map((row) => [row?.id, row]));
  const inputs = FENOK_EDGE_SOURCE_AS_OF_IDS.map((id) => ({
    id,
    source_date: normalizeIsoDate(sourceById.get(id)?.source_date),
  }));
  const dates = inputs.map((row) => row.source_date);

  index.source_as_of_inputs = inputs;
  index.source_as_of = dates.some((date) => !date)
    ? null
    : [...dates].sort()[0] ?? null;
  return index;
}
