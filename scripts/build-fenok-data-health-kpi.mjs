#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA_ROOT = path.join(ROOT, "data");
const PUBLIC_DATA_ROOT = path.join(ROOT, "100xfenok-next", "public", "data");
const SCHEMA_VERSION = "fenok-data-health-kpi/v1";

const REQUIRED_RIM_INDICES = ["SPX", "NDX", "KOSPI", "SOX"];

function readJson(relPath, root = DATA_ROOT) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relPath), "utf8"));
  } catch {
    return null;
  }
}

function readText(relPath, root = ROOT) {
  try {
    return fs.readFileSync(path.join(root, relPath), "utf8");
  } catch {
    return "";
  }
}

function exists(relPath, root = ROOT) {
  return fs.existsSync(path.join(root, relPath));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return value === true;
}

function dateOnly(value) {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

function statusLabel(status) {
  return {
    ready: "정상",
    warning: "주의",
    blocked: "차단",
    unavailable: "없음",
  }[status] || "점검";
}

function check(id, label, ok, detail, extra = {}) {
  const status = ok ? "ready" : "blocked";
  return { id, label, status, status_label: statusLabel(status), detail, ...extra };
}

function warningCheck(id, label, detail, extra = {}) {
  return { id, label, status: "warning", status_label: statusLabel("warning"), detail, ...extra };
}

function laneStatus(checks) {
  if (checks.some((item) => item.status === "blocked" || item.status === "unavailable")) return "blocked";
  if (checks.some((item) => item.status === "warning")) return "warning";
  return "ready";
}

function lane(id, label, checks, { required = true, counts = {}, details = {}, asOf = null } = {}) {
  const status = laneStatus(checks.filter((item) => item.required !== false));
  return {
    id,
    label,
    status,
    status_label: statusLabel(status),
    required,
    as_of: asOf,
    counts,
    details,
    checks,
  };
}

function trackById(coverageIndex, id) {
  return (coverageIndex?.public_scoring_readiness?.tracks || []).find((item) => item?.id === id) || null;
}

function allRequirementsReady(requirements) {
  return ["source_available", "normalized", "joined_to_target_universe", "scored", "public", "daily", "gated"]
    .every((key) => requirements?.[key] === true);
}

function compactEvidenceCheck(item) {
  return {
    id: item?.id ?? null,
    status: item?.status ?? null,
    source_date: item?.source_date ?? item?.latest_source_date ?? null,
    age_days: typeof item?.age_days === "number" ? item.age_days : null,
    max_age_days: typeof item?.max_age_days === "number" ? item.max_age_days : null,
    covered_count: typeof item?.covered_count === "number" ? item.covered_count : null,
    denominator: typeof item?.denominator === "number" ? item.denominator : null,
    missing_count: typeof item?.missing_count === "number" ? item.missing_count : null,
  };
}

function buildStockS0Lane(coverageIndex) {
  const track = trackById(coverageIndex, "active_stock_scoring_current");
  const evidence = track?.blocking_evidence || {};
  const evidenceChecks = (evidence.checks || []).map(compactEvidenceCheck);
  const readinessChecks = evidenceChecks.map((item) => check(
    item.id || "source_check",
    item.id || "source check",
    item.status === "ready" && item.missing_count === 0,
    `${number(item.covered_count).toLocaleString("ko-KR")} / ${number(item.denominator).toLocaleString("ko-KR")} · ${dateOnly(item.source_date) || "-"}`,
    item,
  ));
  return lane("stock_s0_active_daily_gate", "S0 active stocks daily gate", [
    check("requirements_complete", "PUBLIC+DAILY+GATED", allRequirementsReady(track?.requirements), track?.stage || "missing"),
    check("daily_ready", "daily ready", bool(evidence.daily_ready), "all active stock source lanes fresh"),
    check("gated_ready", "gated ready", bool(evidence.gated_ready), "gate blockers empty"),
    check("blockers_empty", "blockers", (evidence.blockers || []).length === 0, `${(evidence.blockers || []).length} blockers`),
    ...readinessChecks,
  ], {
    counts: {
      active_total: number(coverageIndex?.active_scoring_universe?.total),
      by_market: coverageIndex?.active_scoring_universe?.by_market || [],
      buckets: coverageIndex?.active_scoring_universe?.buckets || {},
      denominator: number(track?.denominator),
    },
    asOf: coverageIndex?.generated_at ?? null,
  });
}

function buildStockS1Lane(coverageIndex) {
  const track = trackById(coverageIndex, "expanded_stock_candidates");
  const promotion = track?.promotion_gate_readiness || {};
  const counts = promotion.counts || {};
  const denominator = number(counts.denominator || track?.denominator);
  const closedCount = number(counts.current_public_plus_blocked);
  return lane("stock_s1_candidate_gate", "S1 candidate promotion gate", [
    check("requirements_complete", "PUBLIC+DAILY+GATED with blocked ledger", allRequirementsReady(track?.requirements), track?.stage || "missing"),
    check("artifact_present", "promotion artifact", bool(promotion.artifact_present), promotion.artifact_generated_at || "missing"),
    check("gap_partition_closed", "public plus blocked equals denominator", denominator > 0 && closedCount === denominator, `${closedCount.toLocaleString("ko-KR")} / ${denominator.toLocaleString("ko-KR")}`),
    check("promotion_queue_empty", "promotion queue", number(counts.promotion_rows) === 0, `${number(counts.promotion_rows)} rows`),
    check("blockers_empty", "gate blockers", (promotion.blockers || []).length === 0, `${(promotion.blockers || []).length} blockers`),
  ], {
    counts: {
      denominator,
      current_public_stock: number(counts.current_public_stock),
      s1_gap_total: number(counts.s1_gap_total),
      promotion_count: number(counts.promotion_rows),
      blocked_excluded_count: number(counts.blocked_excluded_rows),
      current_public_plus_blocked: closedCount,
    },
    asOf: promotion.artifact_generated_at || coverageIndex?.generated_at || null,
  });
}

function buildEtfLane(coverageIndex, etfDaily1y, etfFetchablePlan, etfCoreBasket) {
  const track = trackById(coverageIndex, "etf_scoring_lane");
  const counts = track?.evidence_based_readiness?.counts || {};
  const daily = etfDaily1y?.daily_1y_readiness || {};
  const core = etfCoreBasket?.readiness || {};
  const routeText = readText("100xfenok-next/src/app/api/data/fenok-etf-signals/[ticker]/route.ts");
  const staleRouteCaveat = /not PUBLIC\/DAILY\/GATED/i.test(routeText);
  return lane("etf_public_and_daily_gate", "ETF public scoring and daily gate", [
    check("requirements_complete", "PUBLIC+DAILY+GATED", allRequirementsReady(track?.requirements), track?.stage || "missing"),
    check("coverage_gate_ok", "coverage-index ETF gate", bool(track?.evidence_based_readiness?.gate_ok ?? track?.public_done_claim_allowed), track?.readiness_status || "missing"),
    check("fetchable_daily_1y_gap_zero", "daily 1Y fetchable gap", number(counts.fetchable_daily_1y_gap ?? daily.daily_1y_fetchable) === 0, `${number(counts.fetchable_daily_1y_gap ?? daily.daily_1y_fetchable)} fetchable`),
    check("fetchable_plan_empty", "exact fetchable plan", number(etfFetchablePlan?.counts?.fetchable) === 0 && (etfFetchablePlan?.tickers || []).length === 0, `${number(etfFetchablePlan?.counts?.fetchable)} fetchable`),
    check("core_basket_ready", "ETF core daily basket", bool(core.core_daily_basket_ready) && number(core.stale_selected_count) === 0 && number(core.selected_count) >= number(core.min_selected_count), `${number(core.fresh_selected_count)} fresh / ${number(core.selected_count)} selected`),
    check("route_caveat_consistent", "ETF API public label", !staleRouteCaveat, staleRouteCaveat ? "route still says not PUBLIC/DAILY/GATED" : "route caveat matches ready public lane"),
  ], {
    counts: {
      eligible_etf_count: number(counts.eligible_etf_count || track?.denominator),
      scored_public_etf: number(counts.scored_public_etf),
      fetchable_daily_1y_gap: number(counts.fetchable_daily_1y_gap ?? daily.daily_1y_fetchable),
      inception_limited_daily_1y_gap: number(counts.inception_limited_daily_1y_gap ?? daily.inception_limited_daily_1y_gap),
      terminal_limited_daily_1y_gap: number(counts.terminal_limited_daily_1y_gap ?? daily.terminal_limited_daily_1y_gap),
      core_selected_count: number(core.selected_count),
      core_fresh_selected_count: number(core.fresh_selected_count),
      core_stale_selected_count: number(core.stale_selected_count),
    },
    details: {
      full_daily_1y_diagnostic_service_gate: etfDaily1y?.raw_policy?.service_gate === true,
      exact_plan_batch_count: number(etfFetchablePlan?.bounded_batches?.batch_count),
    },
    asOf: etfDaily1y?.generated_at || coverageIndex?.generated_at || null,
  });
}

function buildRimLane(rimInputs) {
  const indexRows = Object.entries(rimInputs?.indices || {}).map(([id, item]) => {
    const blockers = Array.isArray(item?.blockers) ? item.blockers : [];
    return {
      id,
      role: item?.role ?? null,
      public_status: item?.public_status ?? null,
      forecast_status: item?.derived?.forecast_grid_v1?.public_status ?? null,
      blocker_count: blockers.length,
      required: REQUIRED_RIM_INDICES.includes(id),
    };
  });
  const checks = REQUIRED_RIM_INDICES.map((id) => {
    const item = rimInputs?.indices?.[id];
    const blockers = Array.isArray(item?.blockers) ? item.blockers : [];
    return check(
      `rim_${id.toLowerCase()}_ready`,
      `${id} RIM input`,
      item?.public_status === "ready_inputs_and_forecast_grid" && blockers.length === 0,
      item?.derived?.forecast_grid_v1?.public_status || item?.public_status || "missing",
      { index_id: id, role: item?.role ?? null, blocker_count: blockers.length },
    );
  });
  const ccmp = rimInputs?.indices?.CCMP;
  if (ccmp) {
    checks.push(warningCheck("rim_ccmp_input_only", "CCMP public card", "CCMP remains input-only/blocked for public result cards", {
      required: false,
      blocker_count: (ccmp.blockers || []).length,
      public_status: ccmp.public_status,
    }));
  }
  return lane("rim_inputs", "RIM inputs", checks, {
    counts: {
      required_ready: checks.filter((item) => item.required !== false && item.status === "ready").length,
      required_total: REQUIRED_RIM_INDICES.length,
      indices: indexRows,
    },
    details: {
      output_scope: rimInputs?.output_scope ?? null,
      no_public_single_target: rimInputs?.policy?.no_public_single_target === true,
      public_mirror_policy: rimInputs?.public_mirror_policy ?? null,
    },
    asOf: rimInputs?.generated_at ?? null,
  });
}

function buildProductSurfaceLane(productCoverage) {
  const totals = productCoverage?.totals || {};
  return lane("product_surface_freshness", "Product surface freshness", [
    check("surface_payload_present", "product-surface-coverage", Boolean(productCoverage), productCoverage?.generated_at || "missing"),
    check("no_stale_surfaces", "stale surfaces", number(totals.stale) === 0, `${number(totals.stale)} stale`),
    check("no_unavailable_surfaces", "unavailable surfaces", number(totals.unavailable) === 0, `${number(totals.unavailable)} unavailable`),
    check("no_error_surfaces", "error surfaces", number(totals.error) === 0, `${number(totals.error)} error`),
  ], {
    counts: {
      surfaces: number(totals.surfaces),
      ready: number(totals.ready),
      partial: number(totals.partial),
      pending: number(totals.pending),
      stale: number(totals.stale),
      unavailable: number(totals.unavailable),
      error: number(totals.error),
    },
    asOf: productCoverage?.generated_at ?? null,
  });
}

function buildFinraOccLane(ledger) {
  const counts = ledger?.counts || {};
  const publicLedgerExists = exists("data/admin/fenok-s0-finra-occ-mapping-ledger.json", PUBLIC_DATA_ROOT);
  return lane("finra_occ_plain_us_and_mapping_policy", "FINRA/OCC source gate", [
    check("ledger_acceptance", "ledger acceptance", ledger?.source_audit?.acceptance_ok === true, ledger?.generated_at || "missing"),
    check("finra_plain_us_ready", "plain US FINRA", number(counts.plain_us_finra_source_ready) === number(counts.plain_us_finra_denominator), `${number(counts.plain_us_finra_source_ready)} / ${number(counts.plain_us_finra_denominator)}`),
    check("occ_plain_us_ready", "plain US OCC", number(counts.plain_us_occ_source_ready) === number(counts.plain_us_occ_denominator), `${number(counts.plain_us_occ_source_ready)} / ${number(counts.plain_us_occ_denominator)}`),
    check("non_plain_not_service_blocker", "non-plain policy", ledger?.service_boundary?.active_s0_daily_source_gate_blocker === false, ledger?.service_boundary?.reason || "missing"),
    check("ledger_private_only", "ledger public mirror", !publicLedgerExists && ledger?.raw_policy?.admin_local_only === true, publicLedgerExists ? "public mirror exists" : "admin-local only"),
  ], {
    counts: {
      active_us_total: number(counts.active_us_total),
      plain_us_finra_denominator: number(counts.plain_us_finra_denominator),
      plain_us_finra_source_ready: number(counts.plain_us_finra_source_ready),
      plain_us_occ_denominator: number(counts.plain_us_occ_denominator),
      plain_us_occ_source_ready: number(counts.plain_us_occ_source_ready),
      non_plain_daily_ready: number(counts.finra_excluded_us_class_or_non_plain_daily_ready || counts.occ_excluded_us_class_or_non_plain_daily_ready),
      mapping_required_count: number(counts.finra_mapping_required_missing_row) + number(counts.occ_non_plain_mapping_required) + number(counts.occ_class_share_normalization_required),
    },
    details: {
      source_dates: ledger?.source_audit?.source_dates ?? null,
      action_policy: ledger?.action_policy ?? [],
    },
    asOf: ledger?.generated_at ?? null,
  });
}

function workflowCheck(file, token) {
  return readText(file).includes(token);
}

function buildAutomationLane() {
  return lane("automation_contract", "Daily automation and deploy gates", [
    check("sync_static_builds_kpi", "sync-static KPI build", workflowCheck("100xfenok-next/package.json", "build:fenok-data-health-kpi"), "package script wiring"),
    check("sync_static_checks_kpi", "sync-static KPI check", workflowCheck("100xfenok-next/package.json", "qa:fenok-data-health-kpi"), "package gate wiring"),
    check("update_manifest_rebuilds_kpi", "manifest reconciliation", workflowCheck(".github/workflows/update-manifest.yml", "build:fenok-data-health-kpi"), "update-manifest rebuild path"),
    check("deploy_worker_checks_kpi", "Worker deploy gate", workflowCheck(".github/workflows/deploy-worker.yml", "qa:fenok-data-health-kpi"), "deploy prebuild gate"),
    check("deploy_worker_smokes_kpi", "Worker live KPI smoke", workflowCheck(".github/workflows/deploy-worker.yml", "Smoke data health KPI"), "deploy post-smoke contract"),
    check("yf_daily_no_default_cap", "YF daily stock shards no silent cap", workflowCheck(".github/workflows/fetch-yf-finance.yml", 'INPUT_LIMIT="${YF_DAILY_STOCK_LIMIT:-}"'), "future active universe expansion does not silently fall outside freshness"),
    check("stockanalysis_daily1y_scheduled", "StockAnalysis daily-1Y schedule", workflowCheck(".github/workflows/fetch-stockanalysis.yml", "50 22 * * 1-5") && workflowCheck(".github/workflows/fetch-stockanalysis.yml", "daily_1y"), "weekday catch-up lane"),
    check("edge_daily_dispatches_manifest", "Edge daily manifest dispatch", workflowCheck(".github/workflows/fenok-edge-daily.yml", "gh workflow run update-manifest.yml"), "manifest/RIM/deploy chain"),
    check("krx_daily_dispatches_manifest", "KRX daily manifest dispatch", workflowCheck(".github/workflows/fenok-edge-krx-daily.yml", "gh workflow run update-manifest.yml"), "manifest/RIM/deploy chain"),
  ], {
    details: {
      credential_dependent_for_build: false,
      github_api_polling_required: false,
      deploy_secret_required_only_for_wrangler: true,
    },
    asOf: new Date().toISOString(),
  });
}

function buildPublicMirrorLane(rimInputs) {
  const rimPublicText = readText("data/computed/rim-index/inputs.json", PUBLIC_DATA_ROOT);
  const coveragePublicText = readText("data/admin/fenok-edge-coverage-index.json", PUBLIC_DATA_ROOT);
  const forbidden = ["_private/", "\"private_manifest_file\"", "\"manifest_file\""];
  const publicText = `${rimPublicText}\n${coveragePublicText}`;
  return lane("public_mirror_safety", "Public mirror safety", [
    check("kpi_public_mirror", "KPI public mirror", true, "root and public KPI are written together"),
    check("rim_public_private_paths_redacted", "RIM private paths", !forbidden.some((token) => rimPublicText.includes(token)), "public RIM mirror token scan"),
    check("coverage_public_private_paths_absent", "coverage private paths", !forbidden.some((token) => coveragePublicText.includes(token)), "public coverage mirror token scan"),
    check("forbidden_tokens_absent", "forbidden public tokens", !forbidden.some((token) => publicText.includes(token)), "aggregate public token scan"),
  ], {
    details: {
      rim_public_mirror_policy: rimInputs?.public_mirror_policy ?? null,
      full_finra_occ_ledger_public: exists("data/admin/fenok-s0-finra-occ-mapping-ledger.json", PUBLIC_DATA_ROOT),
      full_etf_daily1y_readiness_public: exists("data/admin/fenok-edge-etf-daily1y-readiness.json", PUBLIC_DATA_ROOT),
    },
  });
}

function summarize(lanes) {
  const totals = lanes.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    if (item.required !== false && item.status !== "ready") acc.required_not_ready += 1;
    return acc;
  }, { lanes: lanes.length, ready: 0, warning: 0, blocked: 0, unavailable: 0, required_not_ready: 0 });
  const overallStatus = totals.required_not_ready > 0 ? "blocked" : "ready";
  return { overallStatus, totals };
}

function buildPayload() {
  const coverageIndex = readJson("admin/fenok-edge-coverage-index.json");
  const rimInputs = readJson("computed/rim-index/inputs.json", PUBLIC_DATA_ROOT) || readJson("computed/rim-index/inputs.json");
  const productCoverage = readJson("admin/product-surface-coverage.json");
  const finraOccLedger = readJson("admin/fenok-s0-finra-occ-mapping-ledger.json");
  const etfDaily1y = readJson("admin/fenok-edge-etf-daily1y-readiness.json");
  const etfFetchablePlan = readJson("admin/fenok-edge-etf-daily1y-fetchable-plan.json");
  const etfCoreBasket = readJson("admin/fenok-etf-core-daily-basket.json");

  const lanes = [
    buildStockS0Lane(coverageIndex),
    buildStockS1Lane(coverageIndex),
    buildEtfLane(coverageIndex, etfDaily1y, etfFetchablePlan, etfCoreBasket),
    buildRimLane(rimInputs),
    buildProductSurfaceLane(productCoverage),
    buildFinraOccLane(finraOccLedger),
    buildAutomationLane(),
    buildPublicMirrorLane(rimInputs),
  ];
  const { overallStatus, totals } = summarize(lanes);
  const nonReadyChecks = lanes.flatMap((item) => (item.checks || [])
    .filter((entry) => entry.status !== "ready")
    .map((entry) => ({
      lane_id: item.id,
      check_id: entry.id,
      status: entry.status,
      label: entry.label,
      detail: entry.detail,
      required: entry.required !== false && item.required !== false,
    })));

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    status: overallStatus,
    status_label: statusLabel(overallStatus),
    purpose: "Admin-safe service data health KPI: current data freshness, daily gates, public mirror safety, and automation contracts.",
    raw_policy: {
      public_mirror_allowed: true,
      raw_rows_included: false,
      private_artifact_paths_included: false,
      private_ledgers_included: false,
      source_artifacts_are_referenced_by_id_only: true,
    },
    source_artifacts: [
      { id: "fenok_edge_coverage_index", generated_at: coverageIndex?.generated_at ?? null, public_mirror: true, public_safe: true },
      { id: "rim_index_inputs", generated_at: rimInputs?.generated_at ?? null, public_mirror: true, public_safe: true },
      { id: "product_surface_coverage", generated_at: productCoverage?.generated_at ?? null, public_mirror: true, public_safe: true },
      { id: "s0_finra_occ_mapping_ledger", generated_at: finraOccLedger?.generated_at ?? null, public_mirror: false, public_safe: false },
      { id: "etf_daily1y_readiness_admin", generated_at: etfDaily1y?.generated_at ?? null, public_mirror: false, public_safe: false },
      { id: "etf_core_daily_basket_admin", generated_at: etfCoreBasket?.generated_at ?? null, public_mirror: false, public_safe: false },
    ],
    totals,
    lanes,
    non_ready_checks: nonReadyChecks.slice(0, 25),
  };
}

function writeJson(relPath, payload, roots) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  for (const root of roots) {
    const outPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, body, "utf8");
  }
}

const payload = buildPayload();
writeJson("admin/fenok-data-health-kpi.json", payload, [DATA_ROOT, PUBLIC_DATA_ROOT]);

console.log(JSON.stringify({
  ok: payload.status === "ready",
  status: payload.status,
  generated_at: payload.generated_at,
  lanes: payload.totals.lanes,
  non_ready_checks: payload.non_ready_checks.length,
}, null, 2));
