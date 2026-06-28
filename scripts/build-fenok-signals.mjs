import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const publicDataRoot = path.join(repoRoot, "100xfenok-next", "public", "data");

const FORMULA_VERSION = "fenok-native-signals-v0.1.1";
const CONTRACT_DOC = "docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md";
const PUBLIC_SURFACE_STATUS = "phase_a_stock_signal_lens_approved_summary_public";
const SOURCE_FILE = "computed/stock_action_index.json";
const OUTPUT_FILE = "computed/fenok_signals.json";
const SUMMARY_OUTPUT_FILE = "computed/fenok_signals_summary.json";
const NATIVE_SIGNAL_KEYS = ["profitability", "growth", "technical_flow", "upside_downside", "market_similarity"];
const CONVICTION_SIGNAL_KEYS = ["profitability", "growth", "technical_flow", "upside_downside"];

const HORIZON_WEIGHTS = [
  ["fy1", 0.5],
  ["fy2", 0.3],
  ["fy3", 0.2],
];

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(dataRoot, relPath), "utf8"));
}

function ensureDir(absPath) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
}

function writeJson(relPath, payload, roots, options = {}) {
  const indent = options.compact ? 0 : 2;
  const body = `${JSON.stringify(payload, null, indent)}\n`;
  for (const root of roots) {
    const abs = path.join(root, relPath);
    ensureDir(abs);
    fs.writeFileSync(abs, body, "utf8");
  }
}

function writeJsonToRoot(relPath, payload, options = {}) {
  writeJson(relPath, payload, [dataRoot], options);
}

function writeJsonToBoth(relPath, payload, options = {}) {
  writeJson(relPath, payload, [dataRoot, publicDataRoot], options);
}

function removePublicFile(relPath) {
  const abs = path.join(publicDataRoot, relPath);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function num(value) {
  return finite(value) ? value : null;
}

function round(value, digits = 4) {
  return finite(value) ? Number(value.toFixed(digits)) : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function weightedAverage(block, metric) {
  let numerator = 0;
  let denominator = 0;
  for (const [horizon, weight] of HORIZON_WEIGHTS) {
    const value = num(block?.[metric]?.[horizon]);
    if (value === null) continue;
    numerator += value * weight;
    denominator += weight;
  }
  return denominator > 0 ? round(numerator / denominator, 4) : null;
}

function revisionScore(revision) {
  if (!revision || typeof revision !== "object") return null;
  if (revision.direction === "up") return 80 + clamp(num(revision.change1w) ?? 0, 0, 20);
  if (revision.direction === "down") return 20 - clamp(Math.abs(num(revision.change1w) ?? 0), 0, 20);
  return 50;
}

function momentumConsistency(row) {
  const values = [num(row.return12m), num(row.ret1y), num(row.slickReturn?.latestReturn)].filter((value) => value !== null);
  if (values.length < 2) return null;
  const positives = values.filter((value) => value > 0).length;
  const negatives = values.filter((value) => value < 0).length;
  if (positives === values.length) return 80;
  if (negatives === values.length) return 20;
  return 50;
}

function lowerBound(values, target) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(values, target) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function percentileRank(values, value, { higherIsBetter = true, rawRank = false } = {}) {
  if (!finite(value) || values.length === 0) return null;
  if (values.length === 1) return 50;
  const lower = lowerBound(values, value);
  const upper = upperBound(values, value);
  const midpoint = (lower + upper - 1) / 2;
  const rank = clamp((midpoint / (values.length - 1)) * 100);
  if (rawRank) return round(rank, 2);
  return round(higherIsBetter ? rank : 100 - rank, 2);
}

function metricValue(row, key) {
  switch (key) {
    case "gross_margin_avg":
      return weightedAverage(row.profitabilitySnapshot, "grossMargin");
    case "operating_margin_avg":
      return weightedAverage(row.profitabilitySnapshot, "operatingMargin");
    case "roe_avg":
      return weightedAverage(row.profitabilitySnapshot, "roe");
    case "revenue_growth_avg":
      return weightedAverage(row.estimateSnapshot, "revenueGrowth");
    case "eps_growth_avg":
      return weightedAverage(row.estimateSnapshot, "epsGrowth");
    case "forward_eps_growth_span": {
      const fy1 = num(row.estimateSnapshot?.forwardEps?.fy1);
      const fy3 = num(row.estimateSnapshot?.forwardEps?.fy3);
      return fy1 !== null && fy1 !== 0 && fy3 !== null ? round(((fy3 - fy1) / Math.abs(fy1)) * 100, 4) : null;
    }
    case "return12m":
      return num(row.return12m);
    case "ret1y":
      return num(row.ret1y);
    case "slick_latest_return":
      return num(row.slickReturn?.latestReturn);
    case "negative_return12m": {
      const value = num(row.return12m);
      return value === null ? null : -value;
    }
    case "forward_pe":
      return num(row.peForward ?? row.estimateSnapshot?.forwardPe?.fy1 ?? row.per);
    case "per_band_pct":
      return num(row.perBandPct);
    case "valuation_room": {
      const band = num(row.perBandPct);
      return band === null ? null : 1 - band;
    }
    case "log_market_cap": {
      const marketCap = num(row.marketCap);
      return marketCap !== null && marketCap > 0 ? Math.log10(marketCap) : null;
    }
    default:
      return null;
  }
}

const METRIC_DEFS = [
  { key: "gross_margin_avg", higherIsBetter: true },
  { key: "operating_margin_avg", higherIsBetter: true },
  { key: "roe_avg", higherIsBetter: true },
  { key: "revenue_growth_avg", higherIsBetter: true },
  { key: "eps_growth_avg", higherIsBetter: true },
  { key: "forward_eps_growth_span", higherIsBetter: true },
  { key: "return12m", higherIsBetter: true },
  { key: "ret1y", higherIsBetter: true },
  { key: "slick_latest_return", higherIsBetter: true },
  { key: "negative_return12m", higherIsBetter: true },
  { key: "forward_pe", higherIsBetter: false },
  { key: "per_band_pct", higherIsBetter: false },
  { key: "valuation_room", higherIsBetter: true },
  { key: "log_market_cap", higherIsBetter: true },
];

function peerKeys(row) {
  const scope = row.marketScope ?? "unknown";
  const sector = row.canonicalSector ?? "Other";
  return [
    { key: `scope:${scope}|sector:${sector}`, min: 12, label: "market_sector" },
    { key: `scope:${scope}`, min: 35, label: "market_scope" },
    { key: "all", min: 1, label: "global" },
  ];
}

function buildMetricStats(rows) {
  const stats = new Map();
  for (const def of METRIC_DEFS) {
    const groups = new Map();
    for (const row of rows) {
      const value = metricValue(row, def.key);
      if (!finite(value)) continue;
      const scope = row.marketScope ?? "unknown";
      const sector = row.canonicalSector ?? "Other";
      for (const key of [`scope:${scope}|sector:${sector}`, `scope:${scope}`, "all"]) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(value);
      }
    }
    for (const values of groups.values()) values.sort((a, b) => a - b);
    stats.set(def.key, { ...def, groups });
  }
  return stats;
}

function metricComponent(stats, row, key, options = {}) {
  const def = stats.get(key);
  const value = metricValue(row, key);
  if (!def || !finite(value)) return null;
  for (const peerKey of peerKeys(row)) {
    const values = def.groups.get(peerKey.key) ?? [];
    if (values.length < peerKey.min) continue;
    return {
      value: round(value, 4),
      score: percentileRank(values, value, {
        higherIsBetter: options.rawRank ? true : (options.higherIsBetter ?? def.higherIsBetter),
        rawRank: Boolean(options.rawRank),
      }),
      peer_group: peerKey.label,
      peer_count: values.length,
    };
  }
  return null;
}

function customComponent(value, score) {
  if (!finite(score)) return null;
  return {
    value: finite(value) ? round(value, 4) : null,
    score: round(clamp(score), 2),
    peer_group: "rule",
    peer_count: null,
  };
}

function scoreFromComponents(componentDefs) {
  let scoreNumerator = 0;
  let presentWeight = 0;
  let totalWeight = 0;
  const components = {};
  for (const item of componentDefs) {
    totalWeight += item.weight;
    if (!item.component || !finite(item.component.score)) {
      components[item.key] = null;
      continue;
    }
    scoreNumerator += item.component.score * item.weight;
    presentWeight += item.weight;
    components[item.key] = item.component;
  }

  return {
    score: presentWeight > 0 ? round(scoreNumerator / presentWeight, 2) : null,
    coverage_ratio: totalWeight > 0 ? round(presentWeight / totalWeight, 4) : 0,
    components,
  };
}

function confidenceFromCoverage(coverageRatio, baseCoverage = 1) {
  const blended = (coverageRatio * 0.7) + ((num(baseCoverage) ?? 0) * 0.3);
  if (blended >= 0.75) return "high";
  if (blended >= 0.5) return "medium";
  return "low";
}

function directionFromScore(score) {
  if (!finite(score)) return "unavailable";
  if (score >= 70) return "strong";
  if (score >= 55) return "constructive";
  if (score >= 45) return "neutral";
  if (score >= 30) return "weak";
  return "stressed";
}

function buildProfitabilitySignal(stats, row) {
  const result = scoreFromComponents([
    { key: "gross_margin_avg", weight: 0.25, component: metricComponent(stats, row, "gross_margin_avg") },
    { key: "operating_margin_avg", weight: 0.4, component: metricComponent(stats, row, "operating_margin_avg") },
    { key: "roe_avg", weight: 0.35, component: metricComponent(stats, row, "roe_avg") },
  ]);
  return {
    score_0_100: result.score,
    direction: directionFromScore(result.score),
    coverage_ratio: result.coverage_ratio,
    confidence: confidenceFromCoverage(result.coverage_ratio, row.coverageRatio),
    components: result.components,
  };
}

function buildGrowthSignal(stats, row) {
  const revision = revisionScore(row.revision);
  const result = scoreFromComponents([
    { key: "revenue_growth_avg", weight: 0.35, component: metricComponent(stats, row, "revenue_growth_avg") },
    { key: "eps_growth_avg", weight: 0.4, component: metricComponent(stats, row, "eps_growth_avg") },
    { key: "forward_eps_growth_span", weight: 0.15, component: metricComponent(stats, row, "forward_eps_growth_span") },
    { key: "revision_direction", weight: 0.1, component: customComponent(row.revision?.change1w, revision) },
  ]);
  return {
    score_0_100: result.score,
    direction: directionFromScore(result.score),
    coverage_ratio: result.coverage_ratio,
    confidence: confidenceFromCoverage(result.coverage_ratio, row.coverageRatio),
    components: result.components,
  };
}

function buildTechnicalSignal(stats, row) {
  const consistency = momentumConsistency(row);
  const result = scoreFromComponents([
    { key: "return12m", weight: 0.45, component: metricComponent(stats, row, "return12m") },
    { key: "ret1y", weight: 0.25, component: metricComponent(stats, row, "ret1y") },
    { key: "slick_latest_return", weight: 0.2, component: metricComponent(stats, row, "slick_latest_return") },
    { key: "momentum_consistency", weight: 0.1, component: customComponent(null, consistency) },
  ]);
  return {
    score_0_100: result.score,
    direction: directionFromScore(result.score),
    coverage_ratio: result.coverage_ratio,
    confidence: confidenceFromCoverage(result.coverage_ratio, row.coverageRatio),
    components: result.components,
  };
}

function buildUpsideDownsideSignal(stats, row, profitability, growth, technical) {
  const revision = revisionScore(row.revision);
  const upside = scoreFromComponents([
    { key: "valuation_room", weight: 0.3, component: metricComponent(stats, row, "valuation_room") },
    { key: "forward_pe_discount", weight: 0.2, component: metricComponent(stats, row, "forward_pe") },
    { key: "growth_support", weight: 0.25, component: customComponent(null, growth.score_0_100) },
    { key: "technical_confirmation", weight: 0.15, component: customComponent(null, technical.score_0_100) },
    { key: "revision_support", weight: 0.1, component: customComponent(row.revision?.change1w, revision) },
  ]);
  const downsideRevision = revision === null ? null : 100 - revision;
  const downside = scoreFromComponents([
    { key: "valuation_crowding", weight: 0.3, component: metricComponent(stats, row, "per_band_pct", { higherIsBetter: true }) },
    { key: "forward_pe_pressure", weight: 0.2, component: metricComponent(stats, row, "forward_pe", { higherIsBetter: true }) },
    { key: "negative_momentum", weight: 0.2, component: metricComponent(stats, row, "negative_return12m") },
    { key: "profitability_gap", weight: 0.15, component: customComponent(null, profitability.score_0_100 === null ? null : 100 - profitability.score_0_100) },
    { key: "revision_pressure", weight: 0.15, component: customComponent(row.revision?.change1w, downsideRevision) },
  ]);

  const netScore = finite(upside.score) && finite(downside.score) ? round(clamp(50 + ((upside.score - downside.score) / 2)), 2) : null;
  let direction = "unavailable";
  if (finite(upside.score) && finite(downside.score)) {
    if (upside.score >= 65 && upside.score - downside.score >= 15) direction = "upside_bias";
    else if (downside.score >= 65 && downside.score - upside.score >= 15) direction = "downside_bias";
    else direction = "balanced";
  }

  const coverageRatio = round((upside.coverage_ratio + downside.coverage_ratio) / 2, 4);
  return {
    score_0_100: netScore,
    direction,
    coverage_ratio: coverageRatio,
    confidence: confidenceFromCoverage(coverageRatio, row.coverageRatio),
    upside_score_0_100: upside.score,
    downside_score_0_100: downside.score,
    components: {
      upside: upside.components,
      downside: downside.components,
    },
  };
}

function rawRankComponent(stats, row, key) {
  return metricComponent(stats, row, key, { rawRank: true });
}

function buildVector(stats, row, signals) {
  const features = {
    market_cap_rank: rawRankComponent(stats, row, "log_market_cap")?.score,
    forward_pe_rank: rawRankComponent(stats, row, "forward_pe")?.score,
    per_band_rank: rawRankComponent(stats, row, "per_band_pct")?.score,
    profitability_score: signals.profitability.score_0_100,
    growth_score: signals.growth.score_0_100,
    technical_flow_score: signals.technical_flow.score_0_100,
    return12m_rank: rawRankComponent(stats, row, "return12m")?.score,
  };
  return Object.fromEntries(
    Object.entries(features)
      .filter(([, value]) => finite(value))
      .map(([key, value]) => [key, round(value / 100, 4)]),
  );
}

function similarity(a, b) {
  const common = Object.keys(a).filter((key) => finite(a[key]) && finite(b[key]));
  if (common.length < 4) return null;
  const meanSquaredDistance = common.reduce((sum, key) => sum + ((a[key] - b[key]) ** 2), 0) / common.length;
  const distance = Math.sqrt(meanSquaredDistance);
  return {
    score: round(clamp((1 - distance) * 100), 2),
    shared_feature_count: common.length,
  };
}

function candidatePeers(rows, row) {
  let candidates = rows.filter(
    (other) =>
      other.symbol !== row.symbol &&
      other.marketScope === row.marketScope &&
      other.canonicalSector === row.canonicalSector,
  );
  let peerGroup = "market_sector";
  if (candidates.length < 10) {
    candidates = rows.filter((other) => other.symbol !== row.symbol && other.marketScope === row.marketScope);
    peerGroup = "market_scope";
  }
  if (candidates.length < 10) {
    candidates = rows.filter((other) => other.symbol !== row.symbol);
    peerGroup = "global";
  }
  return { candidates, peerGroup };
}

function buildMarketSimilaritySignals(rows, vectors, resultRows) {
  const bySymbol = new Map(resultRows.map((row) => [row.ticker, row]));
  for (const row of rows) {
    const current = bySymbol.get(row.symbol);
    const vector = vectors.get(row.symbol) ?? {};
    const { candidates, peerGroup } = candidatePeers(rows, row);
    const peers = candidates
      .map((other) => {
        const sim = similarity(vector, vectors.get(other.symbol) ?? {});
        return sim
          ? {
              ticker: other.symbol,
              company: other.company ?? other.symbol,
              market_scope: other.marketScope ?? null,
              canonical_sector: other.canonicalSector ?? null,
              similarity_score: sim.score,
              shared_feature_count: sim.shared_feature_count,
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity_score - a.similarity_score || a.ticker.localeCompare(b.ticker))
      .slice(0, 5);

    const featureCoverage = Object.keys(vector).length / 7;
    const peerCoverage = Math.min(1, candidates.length / 20);
    const coverageRatio = round(featureCoverage * peerCoverage, 4);
    const score = peers.length > 0 ? round(peers.slice(0, 3).reduce((sum, peer) => sum + peer.similarity_score, 0) / Math.min(3, peers.length), 2) : null;

    current.signals.market_similarity = {
      score_0_100: score,
      direction: score === null ? "unavailable" : "peer_comparable",
      coverage_ratio: coverageRatio,
      confidence: confidenceFromCoverage(coverageRatio, row.coverageRatio),
      peer_group: peerGroup,
      peer_count: candidates.length,
      vector_feature_count: Object.keys(vector).length,
      nearest_peers: peers,
    };
  }
}

function compactSignalCoverage(signals) {
  const entries = Object.values(signals);
  const available = entries.filter((signal) => finite(signal?.score_0_100));
  return {
    available_signal_count: available.length,
    coverage_ratio: round(entries.reduce((sum, signal) => sum + (num(signal?.coverage_ratio) ?? 0), 0) / entries.length, 4),
  };
}

function buildConvictionComposite(signals) {
  const presentScores = CONVICTION_SIGNAL_KEYS
    .map((key) => signals?.[key]?.score_0_100)
    .filter(finite);
  const convictionScore = presentScores.length >= 3
    ? round(presentScores.reduce((sum, score) => sum + score, 0) / presentScores.length, 2)
    : null;

  if (convictionScore !== null && convictionScore >= 70) return { convictionScore, convictionCall: "concentrated" };
  if (convictionScore !== null && convictionScore <= 40) return { convictionScore, convictionCall: "diluted" };
  return { convictionScore, convictionCall: "mixed" };
}

function buildFenokSignalsSummary(fenokSignals) {
  const fields = [
    "ticker",
    "company",
    "marketScope",
    "canonicalSector",
    "asOf",
    "confidence",
    "coverageRatio",
    "profitabilityScore",
    "profitabilityDirection",
    "growthScore",
    "growthDirection",
    "technicalFlowScore",
    "technicalFlowDirection",
    "upsideDownsideScore",
    "upsideDownsideDirection",
    "marketSimilarityScore",
    "marketSimilarityDirection",
    "convictionScore",
    "convictionCall",
  ];

  return {
    schema_version: 1,
    generated_at: fenokSignals.generated_at,
    source_file: OUTPUT_FILE,
    formula_version: fenokSignals.formula_version,
    contract_doc: CONTRACT_DOC,
    public_surface_status: PUBLIC_SURFACE_STATUS,
    fields,
    coverage: {
      row_count: fenokSignals.coverage.row_count,
      signal_counts: fenokSignals.coverage.signal_counts,
      confidence_counts: fenokSignals.coverage.confidence_counts,
      market_scope_counts: fenokSignals.coverage.market_scope_counts,
    },
    rows: fenokSignals.rows.map((row) => {
      const conviction = buildConvictionComposite(row.signals);
      return [
        row.ticker,
        row.company,
        row.market_scope,
        row.canonical_sector,
        row.as_of,
        row.confidence,
        row.coverage_ratio,
        row.signals.profitability?.score_0_100 ?? null,
        row.signals.profitability?.direction ?? "unavailable",
        row.signals.growth?.score_0_100 ?? null,
        row.signals.growth?.direction ?? "unavailable",
        row.signals.technical_flow?.score_0_100 ?? null,
        row.signals.technical_flow?.direction ?? "unavailable",
        row.signals.upside_downside?.score_0_100 ?? null,
        row.signals.upside_downside?.direction ?? "unavailable",
        row.signals.market_similarity?.score_0_100 ?? null,
        row.signals.market_similarity?.direction ?? "unavailable",
        conviction.convictionScore,
        conviction.convictionCall,
      ];
    }),
  };
}

function buildFenokSignals(stockActionIndex) {
  const rows = Array.isArray(stockActionIndex.rows) ? stockActionIndex.rows : [];
  const stats = buildMetricStats(rows);
  const generatedAt = new Date().toISOString();
  const vectors = new Map();

  const resultRows = rows.map((row) => {
    const profitability = buildProfitabilitySignal(stats, row);
    const growth = buildGrowthSignal(stats, row);
    const technicalFlow = buildTechnicalSignal(stats, row);
    const upsideDownside = buildUpsideDownsideSignal(stats, row, profitability, growth, technicalFlow);
    const signals = {
      profitability,
      growth,
      technical_flow: technicalFlow,
      upside_downside: upsideDownside,
      market_similarity: null,
    };
    const nativeCoverage = compactSignalCoverage(signals);
    vectors.set(row.symbol, buildVector(stats, row, signals));

    return {
      ticker: row.symbol,
      ticker_normalized: row.ticker_normalized ?? null,
      company: row.company ?? row.symbol,
      market_scope: row.marketScope ?? null,
      market: row.market ?? null,
      canonical_sector: row.canonicalSector ?? null,
      as_of: stockActionIndex.generated_at ?? generatedAt,
      formula_version: FORMULA_VERSION,
      confidence: confidenceFromCoverage(nativeCoverage.coverage_ratio, row.coverageRatio),
      coverage_ratio: nativeCoverage.coverage_ratio,
      source_families: [
        "computed/stock_action_index.json",
        "global-scouter/stocks/detail/*.json",
        "global-scouter/core/revision_movers.json",
        "yf/quarter_closes.json",
        "slickcharts/stocks-returns.json",
      ],
      stock_action_context: {
        action_score: num(row.actionScore),
        signal_score: num(row.signalScore),
        coverage_ratio: num(row.coverageRatio),
        confidence_label: row.confidenceLabel ?? null,
        action_bucket: row.actionBucket ?? null,
      },
      signals,
    };
  });

  buildMarketSimilaritySignals(rows, vectors, resultRows);
  for (const row of resultRows) {
    const nativeCoverage = compactSignalCoverage(row.signals);
    row.coverage_ratio = nativeCoverage.coverage_ratio;
    row.confidence = confidenceFromCoverage(row.coverage_ratio, row.stock_action_context.coverage_ratio);
  }

  const signalKeys = NATIVE_SIGNAL_KEYS;
  return {
    schema_version: 1,
    generated_at: generatedAt,
    source_file: SOURCE_FILE,
    source_generated_at: stockActionIndex.generated_at ?? null,
    source_score_contract: stockActionIndex.score_contract?.version ?? null,
    formula_version: FORMULA_VERSION,
    contract_doc: CONTRACT_DOC,
    public_surface_status: PUBLIC_SURFACE_STATUS,
    raw_policy: {
      external_collection: false,
      full_public_mirror: false,
      third_party_raw_public: false,
      public_payload: SUMMARY_OUTPUT_FILE,
    },
    signal_keys: signalKeys,
    missing_class_a_inputs: {
      analyst_target_upside: "not_present_in_stock_action_index; upside_downside v0 uses valuation band, forward PE, growth, revision, and momentum proxies",
      true_volume_flow: "not_present_in_stock_action_index; technical_flow v0 uses return and revision proxies",
      short_pressure: "source_contract_pending; excluded from Class A native v0",
      options_flow: "source_contract_pending; excluded from Class A native v0",
      dark_pool_ats: "source_contract_pending; excluded from Class A native v0",
      social_news: "source_contract_pending; excluded from Class A native v0",
    },
    coverage: {
      row_count: resultRows.length,
      signal_counts: Object.fromEntries(
        signalKeys.map((key) => [
          key,
          resultRows.filter((row) => finite(row.signals?.[key]?.score_0_100)).length,
        ]),
      ),
      confidence_counts: resultRows.reduce((acc, row) => {
        acc[row.confidence] = (acc[row.confidence] ?? 0) + 1;
        return acc;
      }, {}),
      market_scope_counts: resultRows.reduce((acc, row) => {
        const key = row.market_scope ?? "unknown";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    },
    rows: resultRows.sort((a, b) => b.coverage_ratio - a.coverage_ratio || a.ticker.localeCompare(b.ticker)),
  };
}

function main() {
  const stockActionIndex = readJson(SOURCE_FILE);
  const fenokSignals = buildFenokSignals(stockActionIndex);
  writeJsonToRoot(OUTPUT_FILE, fenokSignals);
  removePublicFile(OUTPUT_FILE);

  const fenokSignalsSummary = buildFenokSignalsSummary(fenokSignals);
  writeJsonToBoth(SUMMARY_OUTPUT_FILE, fenokSignalsSummary, { compact: true });

  console.log(JSON.stringify({
    generated_at: fenokSignals.generated_at,
    rows: fenokSignals.rows.length,
    signal_counts: fenokSignals.coverage.signal_counts,
    confidence_counts: fenokSignals.coverage.confidence_counts,
    output: OUTPUT_FILE,
    summary_output: SUMMARY_OUTPUT_FILE,
    summary_bytes: Buffer.byteLength(`${JSON.stringify(fenokSignalsSummary)}\n`, "utf8"),
  }, null, 2));
}

main();
