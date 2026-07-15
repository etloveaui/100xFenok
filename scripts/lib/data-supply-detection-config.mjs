import { createHash } from "node:crypto";

const LANE_IDS = Object.freeze([
  "fred_macro",
  "fred_banking",
  "fred_yardeni",
  "fdic_tier1",
  "treasury_tga",
  "yahoo_ticker_macro",
  "sentiment",
  "slickcharts",
  "edgar_filings",
  "sec_13f",
  "finra_short_volume",
  "occ_options_volume",
  "apewisdom_attention",
  "gdelt_news_tone",
]);

const LIVE_LANE_IDS = Object.freeze([
  "fred_macro",
  "fred_banking",
  "fred_yardeni",
  "fdic_tier1",
  "treasury_tga",
  "yahoo_ticker_macro",
  "sentiment",
  "slickcharts",
  "edgar_filings",
  "finra_short_volume",
  "occ_options_volume",
]);
const LIVE_LANE_ID_SET = new Set(LIVE_LANE_IDS);

const MEMBER_IDS = Object.freeze([
  "fred_macro",
  "fred_banking",
  "fred_yardeni",
  "fdic_tier1",
  "treasury_tga",
  "yahoo_ticker_macro",
  "sentiment",
  "daily",
  "weekly",
  "monthly",
  "history",
  "symbols",
  "edgar_filings",
  "sec_13f",
  "finra_short_volume",
  "occ_options_volume",
  "apewisdom_attention",
  "gdelt_news_tone",
]);

const SLICKCHARTS_MEMBER_IDS = Object.freeze([
  "daily",
  "weekly",
  "monthly",
  "history",
  "symbols",
]);

const OWNERLESS_LANE_IDS = Object.freeze([
  "sec_13f",
  "apewisdom_attention",
  "gdelt_news_tone",
]);

const IDENTIFIER_RE = /^[a-z][a-z0-9_]{0,63}$/;
const WORKFLOW_RE = /^\.github\/workflows\/[a-z0-9][a-z0-9._-]*\.ya?ml$/;
const POINTER_RE = /^(?:\/(?:[^~/]|~0|~1)*)*$/;
const CRON_RE = /^[0-9*,/-]+(?: [0-9*,/-]+){4}$/;
const ASSERTION_KINDS = new Set([
  "required_pointer",
  "type",
  "enum",
  "min_rows",
  "exact",
  "min_keys",
  "non_empty_series",
]);
const JSON_TYPES = new Set(["array", "boolean", "null", "number", "object", "string"]);
const FOLDS = new Set(["oldest", "latest", "member_worst"]);
const UNITS = new Set(["hours", "calendar_days", "business_days", "due_window"]);
const VISIBILITIES = new Set(["public_safe_aggregate", "admin_only"]);
const CALENDAR_IDS = new Set(["utc", "us_federal_business", "us_trading"]);
const SOURCE_FORMATS = new Set(["date", "rfc3339", "yyyymmdd", "unix_seconds"]);
const SOURCE_SELECTOR_KINDS = new Set(["pointer", "max_array_field", "max_object_series_field", "max_object_field", "max_quarter", "not_applicable"]);
const CADENCE_DECLARATION_KINDS = new Set(["github_workflow", "owner_contract", "payload_field"]);
const OWNER_CONTRACT_RE = /^[a-z][a-z0-9._:/-]{2,127}$/;

function artifact(id, path, { schemaVersion = null, sourceSelector, assertions, selection = path.includes("*") ? "all" : "single" }) {
  return {
    id,
    path,
    selection,
    schema_version: schemaVersion,
    source_selector: sourceSelector,
    assertions,
  };
}

function schemaVersion(pointer, value) {
  return { pointer, value };
}

function pointerSource(pointer, format) {
  return { kind: "pointer", pointer, format };
}

function maxArrayFieldSource(pointer, field, format) {
  return { kind: "max_array_field", pointer, field, format };
}

function maxObjectSeriesFieldSource(pointer, field, format) {
  return { kind: "max_object_series_field", pointer, field, format };
}

function maxObjectFieldSource(pointer, field, format) {
  return { kind: "max_object_field", pointer, field, format };
}

function maxQuarterSource(pointer) {
  return { kind: "max_quarter", pointer };
}

function notApplicableSource() {
  return { kind: "not_applicable" };
}

function typeAssertion(id, pointer, expected) {
  return { id, kind: "type", pointer, expected };
}

function requiredAssertion(id, pointer) {
  return { id, kind: "required_pointer", pointer };
}

function minRowsAssertion(id, pointer, min = 1) {
  return { id, kind: "min_rows", pointer, min };
}

function minKeysAssertion(id, pointer, min = 1) {
  return { id, kind: "min_keys", pointer, min };
}

function exactAssertion(id, pointer, value) {
  return { id, kind: "exact", pointer, value };
}

function nonEmptySeriesAssertion(id, pointer) {
  return { id, kind: "non_empty_series", pointer };
}

function member(
  id,
  workflow,
  schedule,
  artifactContracts,
  cadenceCalendar = workflow === null ? null : "utc",
  cadenceDeclaration = workflow === null ? null : { kind: "github_workflow", evidence: workflow },
) {
  return {
    id,
    workflow,
    schedule,
    cadence_calendar: cadenceCalendar,
    cadence_declaration: cadenceDeclaration,
    artifact_contracts: artifactContracts,
  };
}

function endpoint(endpointFamily, assertionId = null, pointer = null, expected = null) {
  const artifactOnly = assertionId === null;
  return {
    endpoint_family: endpointFamily,
    probe_mode: artifactOnly ? "artifact_only" : "injected_post_fetch",
    assertions: artifactOnly ? [] : [{ id: assertionId, kind: "type", pointer, expected }],
  };
}

function freshness({ fold, unit, calendar, maxStaleness, duePolicy }) {
  const base = {
    observation_basis: "attempt_observed_at",
    fold,
    unit,
    calendar,
  };
  if (unit === "due_window") return { ...base, due_policy: duePolicy };
  return { ...base, max_staleness: maxStaleness };
}

function lane({
  id,
  label,
  ownerWorkflow,
  monitoringMode = "post_fetch_artifact",
  members,
  endpointContract,
  freshnessPolicy,
  affectedSurfaceIds,
  visibility = "public_safe_aggregate",
}) {
  const enforcement = LIVE_LANE_ID_SET.has(id) ? "live" : "shadow";
  const sourceBasis = [...new Set(members.flatMap((memberValue) => memberValue.artifact_contracts
    .map((contract) => contract.source_selector.pointer)
    .filter((pointer) => typeof pointer === "string")))];
  return {
    id,
    label,
    enabled: true,
    owner_workflow: ownerWorkflow,
    monitoring_mode: monitoringMode,
    producer_members: members,
    endpoint_contract: endpointContract,
    freshness: { ...freshnessPolicy, source_basis: sourceBasis },
    affected_surface_ids: affectedSurfaceIds,
    visibility,
    enforcement,
    kpi_required: enforcement === "live",
  };
}

const config = {
  schema_version: "data-supply-detection-config/v1",
  enforcement: "shadow",
  logical_lane_count: 14,
  producer_member_count: 18,
  lanes: [
    lane({
      id: "fred_macro",
      label: "FRED macro series",
      ownerWorkflow: ".github/workflows/fetch-fred-macro.yml",
      members: [member("fred_macro", ".github/workflows/fetch-fred-macro.yml", ["0 8 * * *"], [
        artifact("fred_macro", "data/macro/fred-macro.json", {
          sourceSelector: maxObjectSeriesFieldSource("/series", "date", "date"),
          assertions: [
            typeAssertion("series_object", "/series", "object"),
            minKeysAssertion("series_count", "/series", 7),
            nonEmptySeriesAssertion("series_non_empty", "/series"),
            requiredAssertion("series_m2sl", "/series/M2SL"),
            requiredAssertion("series_walcl", "/series/WALCL"),
            requiredAssertion("series_rrpontsyd", "/series/RRPONTSYD"),
            requiredAssertion("series_sofr", "/series/SOFR"),
            requiredAssertion("series_iorb", "/series/IORB"),
            requiredAssertion("series_wresbal", "/series/WRESBAL"),
            requiredAssertion("series_gdp", "/series/GDP"),
          ],
        }),
      ])],
      endpointContract: endpoint("fred_api", "observations_array", "/observations", "array"),
      freshnessPolicy: freshness({ fold: "latest", unit: "hours", calendar: "utc", maxStaleness: 48 }),
      affectedSurfaceIds: ["macro_fred"],
    }),
    lane({
      id: "fred_banking",
      label: "FRED banking series",
      ownerWorkflow: ".github/workflows/fetch-fred-banking.yml",
      members: [member("fred_banking", ".github/workflows/fetch-fred-banking.yml", ["0 7 * * *"], [
        artifact("fred_banking_daily", "data/macro/fred-banking-daily.json", {
          sourceSelector: maxObjectSeriesFieldSource("/series", "date", "date"),
          assertions: [exactAssertion("type_daily", "/type", "daily"), typeAssertion("series_object", "/series", "object"), minKeysAssertion("series_count", "/series", 3), nonEmptySeriesAssertion("series_non_empty", "/series"), requiredAssertion("series_dgs10", "/series/DGS10"), requiredAssertion("series_hy_spread", "/series/BAMLH0A0HYM2"), requiredAssertion("series_korea_rate", "/series/IRLTLT01KRM156N")],
        }),
        artifact("fred_banking_weekly", "data/macro/fred-banking-weekly.json", {
          sourceSelector: maxObjectSeriesFieldSource("/series", "date", "date"),
          assertions: [exactAssertion("type_weekly", "/type", "weekly"), typeAssertion("series_object", "/series", "object"), minKeysAssertion("series_count", "/series", 2), nonEmptySeriesAssertion("series_non_empty", "/series"), requiredAssertion("series_totll", "/series/TOTLL"), requiredAssertion("series_deposits", "/series/DPSACBW027SBOG")],
        }),
        artifact("fred_banking_quarterly", "data/macro/fred-banking-quarterly.json", {
          sourceSelector: maxObjectSeriesFieldSource("/series", "date", "date"),
          assertions: [
            exactAssertion("type_quarterly", "/type", "quarterly"),
            typeAssertion("series_object", "/series", "object"),
            minKeysAssertion("series_count", "/series", 11),
            nonEmptySeriesAssertion("series_non_empty", "/series"),
            requiredAssertion("series_bogz", "/series/BOGZ1FL010000016Q"),
            requiredAssertion("series_coralacbn", "/series/CORALACBN"),
            requiredAssertion("series_corblacbs", "/series/CORBLACBS"),
            requiredAssertion("series_corcacbs", "/series/CORCACBS"),
            requiredAssertion("series_corccacbs", "/series/CORCCACBS"),
            requiredAssertion("series_corcrexfacbs", "/series/CORCREXFACBS"),
            requiredAssertion("series_dralacbn", "/series/DRALACBN"),
            requiredAssertion("series_drblacbs", "/series/DRBLACBS"),
            requiredAssertion("series_drcclacbs", "/series/DRCCLACBS"),
            requiredAssertion("series_drclacbs", "/series/DRCLACBS"),
            requiredAssertion("series_drcrelexfacbs", "/series/DRCRELEXFACBS"),
          ],
        }),
      ])],
      endpointContract: endpoint("fred_api", "observations_array", "/observations", "array"),
      freshnessPolicy: freshness({ fold: "oldest", unit: "calendar_days", calendar: "utc", maxStaleness: 120 }),
      affectedSurfaceIds: ["banking_liquidity", "rim_index_inputs"],
    }),
    lane({
      id: "fred_yardeni",
      label: "FRED Yardeni model",
      ownerWorkflow: ".github/workflows/fetch-fred-yardeni.yml",
      members: [member("fred_yardeni", ".github/workflows/fetch-fred-yardeni.yml", ["0 10 * * 6"], [
        artifact("fred_yardeni_model", "data/yardney/yardney_model.json", {
          schemaVersion: schemaVersion("/meta/public_schema_version", "yardney_model_public_v1"),
          sourceSelector: pointerSource("/meta/last_update/last_public_date", "date"),
          assertions: [
            exactAssertion("model_version", "/meta/model_version", "feno_yardeni_fred_v1"),
            typeAssertion("data_array", "/data", "array"),
            minRowsAssertion("data_non_empty", "/data"),
          ],
        }),
      ])],
      endpointContract: endpoint("fred_api", "observations_array", "/observations", "array"),
      freshnessPolicy: freshness({ fold: "latest", unit: "calendar_days", calendar: "utc", maxStaleness: 10 }),
      affectedSurfaceIds: ["yardeni_model"],
    }),
    lane({
      id: "fdic_tier1",
      label: "FDIC Tier 1 capital",
      ownerWorkflow: ".github/workflows/fetch-fdic.yml",
      members: [member("fdic_tier1", ".github/workflows/fetch-fdic.yml", ["0 6 1-7 * 1"], [
        artifact("fdic_tier1", "data/macro/fdic-tier1.json", {
          sourceSelector: maxArrayFieldSource("/data", "date", "date"),
          assertions: [exactAssertion("source_fdic", "/source", "FDIC"), typeAssertion("data_array", "/data", "array"), minRowsAssertion("data_non_empty", "/data")],
        }),
      ], "us_federal_business")],
      endpointContract: endpoint("fdic_bankfind", "bank_data_array", "/data", "array"),
      freshnessPolicy: freshness({
        fold: "latest",
        unit: "due_window",
        calendar: "us_federal_business",
        duePolicy: { kind: "source_date_plus_days", days: 120 },
      }),
      affectedSurfaceIds: ["banking_tier1"],
    }),
    lane({
      id: "treasury_tga",
      label: "US Treasury TGA",
      ownerWorkflow: ".github/workflows/fetch-treasury-tga.yml",
      members: [member("treasury_tga", ".github/workflows/fetch-treasury-tga.yml", ["0 */6 * * *"], [
        artifact("treasury_tga", "data/macro/tga.json", {
          sourceSelector: maxArrayFieldSource("/series", "date", "date"),
          assertions: [
            exactAssertion("source_treasury", "/source", "Treasury FiscalData"),
            typeAssertion("endpoint_string", "/endpoint", "string"),
            typeAssertion("series_array", "/series", "array"),
            minRowsAssertion("series_non_empty", "/series"),
          ],
        }),
      ])],
      endpointContract: endpoint("treasury_fiscal_data", "data_array", "/data", "array"),
      freshnessPolicy: freshness({ fold: "latest", unit: "business_days", calendar: "us_federal_business", maxStaleness: 2 }),
      affectedSurfaceIds: ["macro_tga"],
    }),
    lane({
      id: "yahoo_ticker_macro",
      label: "Yahoo macro tickers",
      ownerWorkflow: ".github/workflows/fetch-yahoo-ticker.yml",
      members: [member("yahoo_ticker_macro", ".github/workflows/fetch-yahoo-ticker.yml", ["5 * * * *"], [
        artifact("yahoo_ticker_macro", "data/macro/yahoo-ticker.json", {
          sourceSelector: maxObjectFieldSource("/tickers", "regularMarketTime", "unix_seconds"),
          assertions: [
            exactAssertion("source_yahoo", "/source", "ticker-api-worker (yahoo-finance origin)"),
            typeAssertion("endpoint_string", "/endpoint", "string"),
            typeAssertion("tickers_object", "/tickers", "object"),
            minKeysAssertion("tickers_non_empty", "/tickers"),
          ],
        }),
      ])],
      endpointContract: endpoint("yahoo_chart", "chart_result_array", "/chart/result", "array"),
      freshnessPolicy: freshness({ fold: "latest", unit: "hours", calendar: "utc", maxStaleness: 3 }),
      affectedSurfaceIds: ["macro_tickers"],
    }),
    lane({
      id: "sentiment",
      label: "Market sentiment",
      ownerWorkflow: ".github/workflows/fetch-sentiment.yml",
      members: [member("sentiment", ".github/workflows/fetch-sentiment.yml", ["0 22 * * 1-5"], [
        artifact("sentiment_vix", "data/sentiment/vix.json", {
          sourceSelector: maxArrayFieldSource("", "date", "date"),
          assertions: [typeAssertion("root_array", "", "array"), minRowsAssertion("vix_non_empty", "")],
        }),
      ], "us_trading")],
      endpointContract: endpoint("sentiment_sources", "series_array", "/series", "array"),
      freshnessPolicy: freshness({ fold: "latest", unit: "business_days", calendar: "us_trading", maxStaleness: 3 }),
      affectedSurfaceIds: ["sentiment_dashboard"],
    }),
    lane({
      id: "slickcharts",
      label: "SlickCharts composite",
      ownerWorkflow: null,
      monitoringMode: "composite",
      members: [
        member("daily", ".github/workflows/slickcharts-daily.yml", ["0 6 * * *"], [
          artifact("slickcharts_daily", "data/slickcharts/gainers.json", {
            sourceSelector: maxArrayFieldSource("/history", "date", "date"),
            assertions: [exactAssertion("source_slickcharts", "/source", "slickcharts"), typeAssertion("history_array", "/history", "array"), minRowsAssertion("history_non_empty", "/history")],
          }),
        ]),
        member("weekly", ".github/workflows/slickcharts-weekly.yml", ["0 7 * * 0"], [
          artifact("slickcharts_weekly", "data/slickcharts/sp500.json", {
            sourceSelector: notApplicableSource(),
            assertions: [exactAssertion("source_slickcharts", "/source", "slickcharts"), typeAssertion("count_number", "/count", "number"), typeAssertion("holdings_array", "/holdings", "array"), minRowsAssertion("holdings_non_empty", "/holdings")],
          }),
        ]),
        member("monthly", ".github/workflows/slickcharts-monthly.yml", ["0 8 1 * *"], [
          artifact("slickcharts_monthly", "data/slickcharts/sp500-returns.json", {
            sourceSelector: notApplicableSource(),
            assertions: [exactAssertion("source_slickcharts", "/source", "slickcharts"), typeAssertion("count_number", "/count", "number"), typeAssertion("returns_array", "/returns", "array"), minRowsAssertion("returns_non_empty", "/returns")],
          }),
        ]),
        member("history", ".github/workflows/slickcharts-history.yml", ["0 9 1 * *"], [
          artifact("slickcharts_history", "data/slickcharts/stocks-returns.json", {
            sourceSelector: notApplicableSource(),
            assertions: [exactAssertion("source_slickcharts", "/source", "slickcharts"), typeAssertion("count_number", "/count", "number"), typeAssertion("stocks_array", "/stocks", "array"), minRowsAssertion("stocks_non_empty", "/stocks")],
          }),
        ]),
        member("symbols", ".github/workflows/slickcharts-symbols.yml", ["30 7 * * 0"], [
          artifact("slickcharts_symbols", "data/slickcharts/symbols.json", {
            sourceSelector: maxArrayFieldSource("/history", "date", "date"),
            assertions: [exactAssertion("source_slickcharts", "/source", "slickcharts"), typeAssertion("history_array", "/history", "array"), minRowsAssertion("history_non_empty", "/history")],
          }),
        ]),
      ],
      endpointContract: endpoint("slickcharts_html", "table_rows", "/rows", "array"),
      freshnessPolicy: freshness({ fold: "member_worst", unit: "calendar_days", calendar: "utc", maxStaleness: 40 }),
      affectedSurfaceIds: ["slickcharts_discovery", "stock_signals"],
    }),
    lane({
      id: "edgar_filings",
      label: "SEC EDGAR filings",
      ownerWorkflow: ".github/workflows/fetch-edgar-filings.yml",
      members: [member("edgar_filings", ".github/workflows/fetch-edgar-filings.yml", ["40 0 * * 1"], [
        artifact("edgar_filings_index", "data/edgar-korean-summaries/index.json", {
          schemaVersion: schemaVersion("/schemaVersion", 1),
          sourceSelector: notApplicableSource(),
          assertions: [
            exactAssertion("artifact_type", "/artifactType", "edgar_korean_summary_index"),
            typeAssertion("tickers_array", "/tickers", "array"),
            minRowsAssertion("tickers_non_empty", "/tickers"),
            typeAssertion("by_ticker_object", "/byTicker", "object"),
            minKeysAssertion("by_ticker_non_empty", "/byTicker"),
          ],
        }),
        artifact("edgar_filings_by_ticker", "data/edgar-korean-summaries/by-ticker/*.json", {
          schemaVersion: schemaVersion("/schemaVersion", 1),
          sourceSelector: maxArrayFieldSource("/filings", "filingDate", "date"),
          assertions: [
            exactAssertion("artifact_type", "/artifactType", "edgar_korean_summary_ticker_manifest"),
            exactAssertion("source_edgar", "/source", "SEC EDGAR submissions and feno-edgar Korean summary artifacts"),
            typeAssertion("filings_array", "/filings", "array"),
            minRowsAssertion("filings_non_empty", "/filings"),
          ],
        }),
      ], "us_federal_business")],
      endpointContract: endpoint("sec_edgar", "recent_form_array", "/filings/recent/form", "array"),
      freshnessPolicy: freshness({
        fold: "latest",
        unit: "due_window",
        calendar: "us_federal_business",
        duePolicy: { kind: "poll_only" },
      }),
      affectedSurfaceIds: ["edgar_timeline"],
    }),
    lane({
      id: "sec_13f",
      label: "SEC 13F derivatives",
      ownerWorkflow: null,
      monitoringMode: "artifact_only",
      members: [member("sec_13f", null, [], [
        artifact("sec_13f_summary", "data/sec-13f/summary.json", {
          schemaVersion: schemaVersion("/metadata/version", "3.3.3"),
          sourceSelector: maxQuarterSource("/metadata/quarters_covered"),
          assertions: [
            typeAssertion("quarters_array", "/metadata/quarters_covered", "array"),
            minRowsAssertion("quarters_non_empty", "/metadata/quarters_covered"),
            typeAssertion("investors_object", "/investors", "object"),
            minKeysAssertion("investors_non_empty", "/investors"),
            typeAssertion("top_stocks_object", "/top_stocks", "object"),
            minKeysAssertion("top_stocks_non_empty", "/top_stocks"),
          ],
        }),
      ])],
      endpointContract: endpoint("sec_13f"),
      freshnessPolicy: freshness({
        fold: "latest",
        unit: "due_window",
        calendar: "us_federal_business",
        duePolicy: { kind: "source_date_plus_days", days: 45 },
      }),
      affectedSurfaceIds: ["sec_13f_analytics"],
      visibility: "admin_only",
    }),
    lane({
      id: "finra_short_volume",
      label: "FINRA short volume",
      ownerWorkflow: ".github/workflows/fenok-edge-daily.yml",
      members: [member("finra_short_volume", ".github/workflows/fenok-edge-daily.yml", ["30 0 * * 2-6"], [
        artifact("finra_flow_proxy", "data/computed/fenok_flow_proxies.json", {
          schemaVersion: schemaVersion("/schema_version", 1),
          sourceSelector: maxArrayFieldSource("/rows", "as_of", "date"),
          assertions: [exactAssertion("formula_version", "/formula_version", "fenok-flow-proxies-v0.1-finra-daily"), typeAssertion("rows_array", "/rows", "array"), minRowsAssertion("rows_non_empty", "/rows")],
        }),
      ], "us_trading")],
      endpointContract: endpoint("finra_regsho", "regsho_rows", "/rows", "array"),
      freshnessPolicy: freshness({ fold: "latest", unit: "business_days", calendar: "us_trading", maxStaleness: 3 }),
      affectedSurfaceIds: ["fenok_flow_proxies"],
      visibility: "admin_only",
    }),
    lane({
      id: "occ_options_volume",
      label: "OCC options volume",
      ownerWorkflow: ".github/workflows/fenok-edge-daily.yml",
      members: [member("occ_options_volume", ".github/workflows/fenok-edge-daily.yml", ["30 0 * * 2-6"], [
        artifact("occ_options_volume", "data/computed/fenok_occ_options_volume.json", {
          schemaVersion: schemaVersion("/schema_version", 1),
          sourceSelector: maxArrayFieldSource("/rows", "as_of", "date"),
          assertions: [exactAssertion("formula_version", "/formula_version", "fenok-occ-options-volume-v0.1"), typeAssertion("rows_array", "/rows", "array"), minRowsAssertion("rows_non_empty", "/rows")],
        }),
      ], "us_trading")],
      endpointContract: endpoint("occ_market_data", "csv_rows", "/rows", "array"),
      freshnessPolicy: freshness({ fold: "latest", unit: "business_days", calendar: "us_trading", maxStaleness: 3 }),
      affectedSurfaceIds: ["fenok_occ_options"],
      visibility: "admin_only",
    }),
    lane({
      id: "apewisdom_attention",
      label: "ApeWisdom attention",
      ownerWorkflow: null,
      monitoringMode: "artifact_only",
      members: [member("apewisdom_attention", null, [], [
        artifact("apewisdom_attention", "data/computed/fenok_social_attention_proxy.json", {
          schemaVersion: schemaVersion("/schema_version", 1),
          sourceSelector: pointerSource("/source/source_date", "yyyymmdd"),
          assertions: [typeAssertion("rows_array", "/rows", "array"), minRowsAssertion("rows_non_empty", "/rows")],
        }),
      ])],
      endpointContract: endpoint("apewisdom"),
      freshnessPolicy: freshness({
        fold: "latest",
        unit: "due_window",
        calendar: "utc",
        duePolicy: { kind: "unowned", age_unit: "calendar_days" },
      }),
      affectedSurfaceIds: ["fenok_social_attention"],
      visibility: "admin_only",
    }),
    lane({
      id: "gdelt_news_tone",
      label: "GDELT news tone",
      ownerWorkflow: null,
      monitoringMode: "artifact_only",
      members: [member("gdelt_news_tone", null, [], [
        artifact("gdelt_news_tone", "data/computed/fenok_news_tone_proxy.json", {
          schemaVersion: schemaVersion("/schema_version", 1),
          sourceSelector: maxArrayFieldSource("/rows", "as_of", "date"),
          assertions: [typeAssertion("rows_array", "/rows", "array"), minRowsAssertion("rows_non_empty", "/rows")],
        }),
      ])],
      endpointContract: endpoint("gdelt_doc"),
      freshnessPolicy: freshness({
        fold: "latest",
        unit: "due_window",
        calendar: "utc",
        duePolicy: { kind: "unowned", age_unit: "calendar_days" },
      }),
      affectedSurfaceIds: ["fenok_news_tone"],
      visibility: "admin_only",
    }),
  ],
};

function fail(message) {
  throw new TypeError(`invalid data-supply detection config: ${message}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, context) {
  if (!isPlainObject(value)) fail(`${context} must be a plain object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${context} keys must be exactly ${wanted.join(",")}`);
  }
}

function requireIdentifier(value, context) {
  if (typeof value !== "string" || !IDENTIFIER_RE.test(value)) fail(`${context} is not a canonical identifier`);
}

function requireString(value, context) {
  if (typeof value !== "string" || value.length === 0 || value.length > 160 || value.includes("\0")) {
    fail(`${context} must be a bounded non-empty string`);
  }
}

function requirePointer(value, context) {
  if (typeof value !== "string" || value.length > 160 || !POINTER_RE.test(value)) fail(`${context} is not a JSON pointer`);
}

function requireUniqueStrings(values, context, { identifiers = false, nonEmpty = true } = {}) {
  if (!Array.isArray(values) || (nonEmpty && values.length === 0)) fail(`${context} must be a non-empty array`);
  const seen = new Set();
  values.forEach((value, index) => {
    if (identifiers) requireIdentifier(value, `${context}[${index}]`);
    else requireString(value, `${context}[${index}]`);
    if (seen.has(value)) fail(`${context} contains duplicate ${value}`);
    seen.add(value);
  });
}

function validateAssertion(assertion, context) {
  if (!isPlainObject(assertion)) fail(`${context} must be an object`);
  requireIdentifier(assertion.id, `${context}.id`);
  if (!ASSERTION_KINDS.has(assertion.kind)) fail(`${context}.kind is unknown`);
  requirePointer(assertion.pointer, `${context}.pointer`);
  if (assertion.kind === "type") {
    exactKeys(assertion, ["id", "kind", "pointer", "expected"], context);
    if (!JSON_TYPES.has(assertion.expected)) fail(`${context}.expected is unknown`);
  } else if (assertion.kind === "enum") {
    exactKeys(assertion, ["id", "kind", "pointer", "values"], context);
    if (!Array.isArray(assertion.values) || assertion.values.length === 0) fail(`${context}.values must be non-empty`);
    canonicalJson(assertion.values);
  } else if (assertion.kind === "min_rows" || assertion.kind === "min_keys") {
    exactKeys(assertion, ["id", "kind", "pointer", "min"], context);
    if (!Number.isSafeInteger(assertion.min) || assertion.min < 1) fail(`${context}.min must be a positive integer`);
  } else if (assertion.kind === "exact") {
    exactKeys(assertion, ["id", "kind", "pointer", "value"], context);
    canonicalJson(assertion.value);
  } else {
    exactKeys(assertion, ["id", "kind", "pointer"], context);
  }
}

function validateSourceSelector(selector, context) {
  if (!isPlainObject(selector) || !SOURCE_SELECTOR_KINDS.has(selector.kind)) fail(`${context}.kind is invalid`);
  if (selector.kind === "not_applicable") {
    exactKeys(selector, ["kind"], context);
    return;
  }
  if (selector.kind === "max_quarter") {
    exactKeys(selector, ["kind", "pointer"], context);
    requirePointer(selector.pointer, `${context}.pointer`);
    return;
  }
  if (selector.kind === "pointer") exactKeys(selector, ["kind", "pointer", "format"], context);
  else exactKeys(selector, ["kind", "pointer", "field", "format"], context);
  requirePointer(selector.pointer, `${context}.pointer`);
  if (!SOURCE_FORMATS.has(selector.format)) fail(`${context}.format is invalid`);
  if (selector.kind !== "pointer") requireString(selector.field, `${context}.field`);
  if (selector.format === "unix_seconds" && selector.kind !== "max_object_field") fail(`${context}.unix_seconds requires max_object_field`);
}

function validateAssertions(assertions, context, { allowEmpty = false } = {}) {
  if (!Array.isArray(assertions) || (!allowEmpty && assertions.length === 0)) fail(`${context} must be an array`);
  const ids = new Set();
  assertions.forEach((assertion, index) => {
    validateAssertion(assertion, `${context}[${index}]`);
    if (ids.has(assertion.id)) fail(`${context} contains duplicate assertion ${assertion.id}`);
    ids.add(assertion.id);
  });
}

function validateArtifactContract(contract, context) {
  exactKeys(contract, ["id", "path", "selection", "schema_version", "source_selector", "assertions"], context);
  requireIdentifier(contract.id, `${context}.id`);
  requireString(contract.path, `${context}.path`);
  if (contract.path.startsWith("/") || contract.path.includes("\\") || contract.path.includes("**")) {
    fail(`${context}.path must be bounded and repository-relative`);
  }
  const components = contract.path.split("/");
  if (components.some((part) => part === "" || part === "." || part === "..")) fail(`${context}.path escapes or is not normalized`);
  if (components[0] !== "data") fail(`${context}.path must be under the allowlisted data root`);
  const wildcardComponents = components.filter((part) => part.includes("*"));
  if (wildcardComponents.length === 0) {
    if (contract.selection !== "single") fail(`${context}.selection must be single for a literal path`);
  } else {
    const leaf = components.at(-1);
    if (contract.selection !== "all" || wildcardComponents.length !== 1 || wildcardComponents[0] !== leaf
      || (leaf.match(/\*/g) ?? []).length !== 1 || !/^[A-Za-z0-9._-]*\*[A-Za-z0-9._-]*$/.test(leaf)) {
      fail(`${context}.glob must be one bounded final-component wildcard with selection all`);
    }
  }
  if (contract.schema_version !== null) {
    exactKeys(contract.schema_version, ["pointer", "value"], `${context}.schema_version`);
    requirePointer(contract.schema_version.pointer, `${context}.schema_version.pointer`);
    if (!(typeof contract.schema_version.value === "string" || Number.isFinite(contract.schema_version.value))) {
      fail(`${context}.schema_version.value is invalid`);
    }
  }
  validateSourceSelector(contract.source_selector, `${context}.source_selector`);
  validateAssertions(contract.assertions, `${context}.assertions`);
}

function validateMember(memberValue, context) {
  exactKeys(memberValue, ["id", "workflow", "schedule", "cadence_calendar", "cadence_declaration", "artifact_contracts"], context);
  requireIdentifier(memberValue.id, `${context}.id`);
  if (memberValue.workflow !== null && !WORKFLOW_RE.test(memberValue.workflow)) fail(`${context}.workflow is invalid`);
  if (memberValue.cadence_declaration !== null) {
    exactKeys(memberValue.cadence_declaration, ["kind", "evidence"], `${context}.cadence_declaration`);
    const { kind, evidence } = memberValue.cadence_declaration;
    if (!CADENCE_DECLARATION_KINDS.has(kind)) fail(`${context}.cadence_declaration.kind is invalid`);
    requireString(evidence, `${context}.cadence_declaration.evidence`);
    if (kind === "github_workflow" && (!WORKFLOW_RE.test(evidence) || evidence !== memberValue.workflow)) {
      fail(`${context}.cadence_declaration does not match its GitHub workflow`);
    }
    if (kind === "owner_contract" && !OWNER_CONTRACT_RE.test(evidence)) {
      fail(`${context}.cadence_declaration owner contract is invalid`);
    }
    if (kind === "payload_field" && (evidence === "" || !POINTER_RE.test(evidence))) {
      fail(`${context}.cadence_declaration payload pointer is invalid`);
    }
    if (kind !== "github_workflow" && memberValue.workflow !== null) {
      fail(`${context}.external cadence declaration contradicts GitHub workflow ownership`);
    }
  }
  if (memberValue.cadence_calendar !== null) {
    requireIdentifier(memberValue.cadence_calendar, `${context}.cadence_calendar`);
    if (!CALENDAR_IDS.has(memberValue.cadence_calendar)) fail(`${context}.cadence_calendar is unknown`);
  }
  if (!Array.isArray(memberValue.schedule)) fail(`${context}.schedule must be an array`);
  const schedules = new Set();
  memberValue.schedule.forEach((schedule, index) => {
    if (typeof schedule !== "string" || !CRON_RE.test(schedule)) fail(`${context}.schedule[${index}] is invalid`);
    if (schedules.has(schedule)) fail(`${context}.schedule contains duplicates`);
    schedules.add(schedule);
  });
  const hasDeclaredCadence = memberValue.cadence_declaration !== null;
  if (hasDeclaredCadence !== (memberValue.schedule.length > 0)) fail(`${context}.schedule contradicts cadence declaration`);
  if (hasDeclaredCadence !== (memberValue.cadence_calendar !== null)) fail(`${context}.cadence_calendar contradicts cadence declaration`);
  if ((memberValue.workflow !== null) !== (memberValue.cadence_declaration?.kind === "github_workflow")) {
    fail(`${context}.workflow contradicts cadence declaration provenance`);
  }
  if (!Array.isArray(memberValue.artifact_contracts) || memberValue.artifact_contracts.length === 0) {
    fail(`${context}.artifact_contracts must be non-empty`);
  }
  const contractIds = new Set();
  const contractPaths = new Set();
  memberValue.artifact_contracts.forEach((contract, index) => {
    validateArtifactContract(contract, `${context}.artifact_contracts[${index}]`);
    if (contractIds.has(contract.id) || contractPaths.has(contract.path)) fail(`${context} contains duplicate artifact contract`);
    contractIds.add(contract.id);
    contractPaths.add(contract.path);
  });
}

function validateEndpointContract(endpointValue, context, artifactOnly) {
  exactKeys(endpointValue, ["endpoint_family", "probe_mode", "assertions"], context);
  requireIdentifier(endpointValue.endpoint_family, `${context}.endpoint_family`);
  if (!new Set(["injected_post_fetch", "artifact_only"]).has(endpointValue.probe_mode)) fail(`${context}.probe_mode is invalid`);
  if (artifactOnly !== (endpointValue.probe_mode === "artifact_only")) fail(`${context}.probe_mode contradicts monitoring mode`);
  validateAssertions(endpointValue.assertions, `${context}.assertions`, { allowEmpty: artifactOnly });
  if (artifactOnly && endpointValue.assertions.length !== 0) fail(`${context}.assertions must be empty for artifact-only lanes`);
}

function validateFreshness(freshnessValue, context) {
  if (!isPlainObject(freshnessValue)) fail(`${context} must be an object`);
  if (freshnessValue.unit === "due_window") {
    exactKeys(freshnessValue, ["observation_basis", "source_basis", "fold", "unit", "calendar", "due_policy"], context);
  } else {
    exactKeys(freshnessValue, ["observation_basis", "source_basis", "fold", "unit", "calendar", "max_staleness"], context);
  }
  if (freshnessValue.observation_basis !== "attempt_observed_at") fail(`${context}.observation_basis is invalid`);
  if (!Array.isArray(freshnessValue.source_basis) || freshnessValue.source_basis.length === 0) fail(`${context}.source_basis must be non-empty`);
  const sourcePointers = new Set();
  freshnessValue.source_basis.forEach((pointer, index) => {
    requirePointer(pointer, `${context}.source_basis[${index}]`);
    if (sourcePointers.has(pointer)) fail(`${context}.source_basis contains duplicates`);
    sourcePointers.add(pointer);
  });
  if (!FOLDS.has(freshnessValue.fold)) fail(`${context}.fold is invalid`);
  if (!UNITS.has(freshnessValue.unit)) fail(`${context}.unit is invalid`);
  requireIdentifier(freshnessValue.calendar, `${context}.calendar`);
  if (!CALENDAR_IDS.has(freshnessValue.calendar)) fail(`${context}.calendar is unknown`);
  if (freshnessValue.unit !== "due_window") {
    if (!Number.isFinite(freshnessValue.max_staleness) || freshnessValue.max_staleness <= 0) {
      fail(`${context}.max_staleness must be positive`);
    }
    return;
  }
  if (!isPlainObject(freshnessValue.due_policy)) fail(`${context}.due_policy must be an object`);
  const kind = freshnessValue.due_policy.kind;
  if (kind === "source_date_plus_days") {
    exactKeys(freshnessValue.due_policy, ["kind", "days"], `${context}.due_policy`);
    if (!Number.isSafeInteger(freshnessValue.due_policy.days) || freshnessValue.due_policy.days < 1) {
      fail(`${context}.due_policy.days must be positive`);
    }
  } else if (kind === "poll_only") {
    exactKeys(freshnessValue.due_policy, ["kind"], `${context}.due_policy`);
  } else if (kind === "unowned") {
    exactKeys(freshnessValue.due_policy, ["kind", "age_unit"], `${context}.due_policy`);
    if (!new Set(["calendar_days", "business_days", "hours"]).has(freshnessValue.due_policy.age_unit)) fail(`${context}.due_policy.age_unit is invalid`);
  } else {
    fail(`${context}.due_policy.kind is invalid`);
  }
}

function validateLane(laneValue, index) {
  const context = `lanes[${index}]`;
  exactKeys(laneValue, [
    "id",
    "label",
    "enabled",
    "owner_workflow",
    "monitoring_mode",
    "producer_members",
    "endpoint_contract",
    "freshness",
    "affected_surface_ids",
    "visibility",
    "enforcement",
    "kpi_required",
  ], context);
  requireIdentifier(laneValue.id, `${context}.id`);
  requireString(laneValue.label, `${context}.label`);
  if (laneValue.enabled !== true) fail(`${context}.enabled must be true`);
  if (laneValue.owner_workflow !== null && !WORKFLOW_RE.test(laneValue.owner_workflow)) fail(`${context}.owner_workflow is invalid`);
  if (!new Set(["post_fetch_artifact", "artifact_only", "composite"]).has(laneValue.monitoring_mode)) {
    fail(`${context}.monitoring_mode is invalid`);
  }
  if (!Array.isArray(laneValue.producer_members) || laneValue.producer_members.length === 0) {
    fail(`${context}.producer_members must be non-empty`);
  }
  const memberIds = new Set();
  laneValue.producer_members.forEach((memberValue, memberIndex) => {
    validateMember(memberValue, `${context}.producer_members[${memberIndex}]`);
    if (memberIds.has(memberValue.id)) fail(`${context} has duplicate member ${memberValue.id}`);
    memberIds.add(memberValue.id);
  });
  const artifactOnly = laneValue.monitoring_mode === "artifact_only";
  validateEndpointContract(laneValue.endpoint_contract, `${context}.endpoint_contract`, artifactOnly);
  validateFreshness(laneValue.freshness, `${context}.freshness`);
  requireUniqueStrings(laneValue.affected_surface_ids, `${context}.affected_surface_ids`, { identifiers: true });
  if (!VISIBILITIES.has(laneValue.visibility)) fail(`${context}.visibility is invalid`);
  const expectedEnforcement = LIVE_LANE_ID_SET.has(laneValue.id) ? "live" : "shadow";
  if (laneValue.enforcement !== expectedEnforcement) fail(`${context}.enforcement must be ${expectedEnforcement}`);
  if (laneValue.kpi_required !== (expectedEnforcement === "live")) fail(`${context}.kpi_required contradicts lane enforcement`);

  const ownerless = OWNERLESS_LANE_IDS.includes(laneValue.id);
  if (ownerless) {
    if (laneValue.owner_workflow !== null || !artifactOnly) fail(`${context} must remain ownerless artifact-only`);
    if (laneValue.producer_members.some((memberValue) => memberValue.workflow !== null || memberValue.cadence_declaration !== null || memberValue.schedule.length !== 0)) {
      fail(`${context} fabricates an owner or cadence`);
    }
  } else if (laneValue.id === "slickcharts") {
    if (laneValue.owner_workflow !== null || laneValue.monitoring_mode !== "composite") fail(`${context} must be composite`);
    const actualIds = laneValue.producer_members.map((memberValue) => memberValue.id);
    if (canonicalJson(actualIds) !== canonicalJson(SLICKCHARTS_MEMBER_IDS)) fail(`${context} has the wrong five members`);
  } else {
    if (laneValue.monitoring_mode !== "post_fetch_artifact") fail(`${context} must have a post-fetch producer`);
    if (laneValue.producer_members.length !== 1 || laneValue.producer_members[0].id !== laneValue.id) {
      fail(`${context} must have exactly one canonical member`);
    }
    const onlyMember = laneValue.producer_members[0];
    if (onlyMember.cadence_declaration === null || laneValue.owner_workflow !== onlyMember.workflow) {
      fail(`${context} must have one evidence-backed cadence declaration`);
    }
  }
}

export function validateDetectionConfig(configValue) {
  exactKeys(configValue, ["schema_version", "enforcement", "logical_lane_count", "producer_member_count", "lanes"], "config");
  if (configValue.schema_version !== "data-supply-detection-config/v1") fail("schema_version is invalid");
  if (configValue.enforcement !== "shadow") fail("enforcement must be shadow");
  if (configValue.logical_lane_count !== 14 || configValue.producer_member_count !== 18) fail("denominator must be 14/18");
  if (!Array.isArray(configValue.lanes) || configValue.lanes.length !== 14) fail("lanes must contain exactly 14 rows");
  const laneIds = configValue.lanes.map((laneValue) => laneValue.id);
  if (canonicalJson(laneIds) !== canonicalJson(LANE_IDS)) fail("logical lane order or identity changed");
  configValue.lanes.forEach(validateLane);
  const artifactPaths = new Set();
  for (const laneValue of configValue.lanes) {
    for (const memberValue of laneValue.producer_members) {
      for (const contract of memberValue.artifact_contracts) {
        if (artifactPaths.has(contract.path)) fail(`duplicate artifact path ${contract.path}`);
        artifactPaths.add(contract.path);
      }
    }
  }
  const memberIds = configValue.lanes.flatMap((laneValue) => laneValue.producer_members.map((memberValue) => memberValue.id));
  if (memberIds.length !== 18 || new Set(memberIds).size !== 18 || canonicalJson(memberIds) !== canonicalJson(MEMBER_IDS)) {
    fail("producer member order or identity changed");
  }
  canonicalJson(configValue);
  return true;
}

function canonicalize(value, stack) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical JSON rejects non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (stack.has(value)) fail("canonical JSON rejects cycles");
    stack.add(value);
    const result = value.map((entry) => canonicalize(entry, stack));
    stack.delete(value);
    return result;
  }
  if (!isPlainObject(value)) fail("canonical JSON accepts plain JSON objects only");
  if (stack.has(value)) fail("canonical JSON rejects cycles");
  stack.add(value);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry === undefined || typeof entry === "function" || typeof entry === "symbol" || typeof entry === "bigint") {
      fail(`canonical JSON rejects non-JSON value at ${key}`);
    }
    result[key] = canonicalize(entry, stack);
  }
  stack.delete(value);
  return result;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value, new Set()));
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

validateDetectionConfig(config);

export const DATA_SUPPLY_DETECTION_CONFIG = deepFreeze(config);

export function configDigest() {
  validateDetectionConfig(DATA_SUPPLY_DETECTION_CONFIG);
  return createHash("sha256").update(canonicalJson(DATA_SUPPLY_DETECTION_CONFIG), "utf8").digest("hex");
}
