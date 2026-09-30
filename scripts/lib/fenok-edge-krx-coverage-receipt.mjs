const KRX_COVERAGE_MARKETS = Object.freeze(["KRX", "KOSDAQ"]);

function validIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeKrxCoverageCode(value) {
  return String(value ?? "").replace(/[^0-9A-Z]/giu, "").slice(0, 6).toUpperCase();
}

export function activeKrxUniverseCodes(rows) {
  return new Set((Array.isArray(rows) ? rows : [])
    .filter((row) => KRX_COVERAGE_MARKETS.includes(row?.market))
    .map((row) => normalizeKrxCoverageCode(row?.ticker_normalized ?? row?.ticker))
    .filter(Boolean));
}

function codesByMarket(rows) {
  return Object.fromEntries(KRX_COVERAGE_MARKETS.map((market) => [market,
    activeKrxUniverseCodes((Array.isArray(rows) ? rows : []).filter((row) => row?.market === market)),
  ]));
}

function normalizeIssuerMasterCode(row) {
  for (const value of [row?.ISU_SRT_CD, row?.ISU_CD, row?.ISU_CODE, row?.SHORT_CODE]) {
    const raw = String(value ?? "").trim().toUpperCase();
    if (/^[0-9A-Z]{6}$/u.test(raw)) return raw;
    if (/^KR[0-9A-Z]{10}$/u.test(raw)) return raw.slice(3, 9);
  }
  return "";
}

export function currentListedKrxUniverseRows({ activeUniverseRows, issuerMasterRowsByMarket }) {
  const listed = Object.fromEntries(KRX_COVERAGE_MARKETS.map((market) => [market,
    new Set((issuerMasterRowsByMarket?.[market] ?? []).map(normalizeIssuerMasterCode).filter(Boolean)),
  ]));
  if (KRX_COVERAGE_MARKETS.some((market) => listed[market].size === 0)) return null;
  return (Array.isArray(activeUniverseRows) ? activeUniverseRows : []).filter((row) =>
    listed[row?.market]?.has(normalizeKrxCoverageCode(row?.ticker_normalized ?? row?.ticker)));
}

// Counts describe the source-date snapshot measured by the producer. No issuer
// rows or codes leave the private acquisition lane.
export function buildKrxIssuerDailyCoverage({
  sourceDate, activeUniverseRows, sourceActiveUniverseRows = activeUniverseRows,
  coveredCodesByMarket, listingBasis = "current_krx_issuer_master",
}) {
  if (!validIsoDate(sourceDate)) return null;
  const eligible = codesByMarket(activeUniverseRows);
  const source = codesByMarket(sourceActiveUniverseRows);
  const marketCoverage = Object.fromEntries(KRX_COVERAGE_MARKETS.map((market) => {
    const covered = new Set((coveredCodesByMarket?.[market] instanceof Set
      ? [...coveredCodesByMarket[market]] : coveredCodesByMarket?.[market] ?? []).map(normalizeKrxCoverageCode).filter(Boolean));
    const count = [...eligible[market]].filter((code) => covered.has(code)).length;
    return [market, { covered_count: count, denominator: eligible[market].size, missing_count: eligible[market].size - count }];
  }));
  const markets = Object.fromEntries(KRX_COVERAGE_MARKETS.map((market) => [market, {
    source_denominator: source[market].size,
    eligible_denominator: eligible[market].size,
    excluded_count: [...source[market]].filter((code) => !eligible[market].has(code)).length,
  }]));
  const sum = (rows, field) => KRX_COVERAGE_MARKETS.reduce((total, market) => total + rows[market][field], 0);
  const coveredCount = sum(marketCoverage, "covered_count");
  const denominator = sum(marketCoverage, "denominator");
  return {
    source_date: sourceDate,
    covered_count: coveredCount,
    denominator,
    missing_count: denominator - coveredCount,
    market_coverage: marketCoverage,
    listing_status_filter: {
      basis: listingBasis,
      source_denominator: sum(markets, "source_denominator"),
      eligible_denominator: denominator,
      excluded_count: sum(markets, "excluded_count"),
      markets,
    },
    status: denominator > 0 && coveredCount === denominator ? "ready" : "partial",
    raw_public: false,
    per_issuer_rows: false,
  };
}
