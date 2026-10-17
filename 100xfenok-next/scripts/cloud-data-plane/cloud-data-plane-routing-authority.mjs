// Single source of truth for the selective Cloudflare asset-to-Worker boundary.
//
// Private deny paths are derived from the generated registry output, with the
// isolated Griffin exception kept explicit. Public Worker-first families are
// derived from the generated enrollment authority so a newly enrolled family
// cannot silently bypass the data-plane read path or its fallback contract.

import {
  PLANE_ENROLLMENT_EXACT,
  PLANE_ENROLLMENT_PRIVATE_DENY,
  PLANE_ENROLLMENT_PREFIXES,
} from "./cloud-data-plane-enrollment.generated.mjs";

const EXPLICIT_PRIVATE_PATH_VALUES = Object.freeze([
  "/data/admin/data-supply-detection-floor.json",
  "/data/admin/fenok-edge-etf-daily1y-fetchable-plan.json",
  "/data/admin/fenok-edge-etf-daily1y-readiness.json",
  "/data/admin/fenok-etf-core-daily-basket.json",
  "/data/admin/fenok-s0-finra-occ-mapping-ledger.json",
  "/data/admin/fenok-s1-stock-public-promotion-dry-run.json",
  "/data/admin/slickcharts-composite-recovery/index.json",
  "/data/admin/slickcharts-daily-delivery/index.json",
  "/data/admin/slickcharts-daily-delivery/keys/currency.json",
  "/data/admin/slickcharts-daily-delivery/keys/gainers.json",
  "/data/admin/slickcharts-daily-delivery/keys/losers.json",
  "/data/admin/slickcharts-daily-delivery/keys/mortgage.json",
  "/data/admin/slickcharts-daily-delivery/keys/treasury.json",
  "/data/admin/slickcharts-daily-delivery/lkg/currency.json",
  "/data/admin/slickcharts-daily-delivery/lkg/gainers.json",
  "/data/admin/slickcharts-daily-delivery/lkg/losers.json",
  "/data/admin/slickcharts-daily-delivery/lkg/mortgage.json",
  "/data/admin/slickcharts-daily-delivery/lkg/treasury.json",
  "/data/computed/etf_action_index.json",
  "/data/computed/fenok_etf_signals.json",
  "/data/computed/fenok_flow_proxies.json",
  "/data/computed/fenok_flow_proxies_history.json",
  "/data/computed/fenok_occ_options_volume.json",
  "/data/computed/fenok_occ_options_volume_history.json",
  "/data/computed/fenok_signal_lens_proxies.json",
  "/data/computed/fenok_signal_lens_proxies_history.json",
  "/data/computed/fenok_signal_lens_proxies_summary.json",
  "/data/computed/fenok_signals.json",
  "/data/computed/fenok_social_attention_proxy.json",
  "/data/computed/fenok_social_attention_proxy_history.json",
  // Keep retained source and recovery snapshots off the public asset route.
  "/data/admin/apewisdom_attention/index.json",
  "/data/admin/apewisdom_attention/lkg/social_attention_proxy.json",
  "/data/admin/damodaran/current/damodaran.json",
  "/data/admin/damodaran/history.json",
  "/data/admin/damodaran/index.json",
  "/data/admin/damodaran/lkg/damodaran.json",
  "/data/admin/damodaran/owner-guard.json",
  "/data/admin/earnings_overview/refresh-summary.json",
  "/data/admin/edgar_filings/current/edgar_filings.json",
  "/data/admin/edgar_filings/index.json",
  "/data/admin/finra_short_volume/current/regsho_daily.json",
  "/data/admin/finra_short_volume/history/regsho_daily.json",
  "/data/admin/finra_short_volume/index.json",
  "/data/admin/finra_short_volume/lkg/regsho_daily.json",
  "/data/admin/krx/index.json",
  "/data/admin/krx/lkg/bridge.json",
  "/data/admin/occ_options_volume/current/occ_options_volume.json",
  "/data/admin/occ_options_volume/index.json",
  "/data/admin/occ_options_volume/lkg/occ_options_volume.json",
  "/data/admin/yahoo-hourly-ticker/index.json",
  "/data/admin/yahoo-hourly-ticker/keys/SOXL.json",
  "/data/admin/yahoo-hourly-ticker/keys/TQQQ.json",
  "/data/admin/yahoo-hourly-ticker/lkg/SOXL.json",
  "/data/admin/yahoo-hourly-ticker/lkg/TQQQ.json",
  "/data/admin/yahoo-hourly-ticker/promotion-contracts/SOXL.json",
  "/data/admin/yahoo-hourly-ticker/promotion-contracts/TQQQ.json",
  "/data/admin/yahoo_private_options/index.json",
  "/data/admin/yahoo_private_options/lkg/availability.json",
  "/data/damodaran/archives/ctryprem00.xls",
  "/data/damodaran/archives/ctryprem01.xls",
  "/data/damodaran/archives/ctryprem02.xls",
  "/data/damodaran/archives/ctryprem03.xls",
  "/data/damodaran/archives/ctryprem04.xls",
  "/data/damodaran/archives/ctryprem05.xls",
  "/data/damodaran/archives/ctryprem06.xls",
  "/data/damodaran/archives/ctryprem07.xls",
  "/data/damodaran/archives/ctryprem08.xls",
  "/data/damodaran/archives/ctryprem09.xls",
  "/data/damodaran/archives/ctryprem10.xls",
  "/data/damodaran/archives/ctryprem11.xls",
  "/data/damodaran/archives/ctryprem12.xls",
  "/data/damodaran/archives/ctryprem13.xls",
  "/data/damodaran/archives/ctryprem14.xls",
  "/data/damodaran/archives/ctryprem15.xls",
  "/data/damodaran/archives/ctryprem16.xls",
  "/data/damodaran/archives/ctryprem17.xls",
  "/data/damodaran/archives/ctryprem18.xls",
  "/data/damodaran/archives/ctryprem19.xls",
  "/data/damodaran/archives/ctryprem20.xls",
  "/data/damodaran/archives/ctryprem21.xls",
  "/data/damodaran/archives/ctryprem22.xls",
  "/data/damodaran/archives/ctryprem23.xlsx",
  "/data/damodaran/archives/ctryprem24.xls",
  "/data/damodaran/archives/receipt.json",
  "/data/edgar-korean-summaries/ops/8k-earnings-targets.json",
  "/data/edgar-korean-summaries/ops/batch-skip-log.jsonl",
  "/data/edgar/company_tickers.json",
  "/data/edgar/r1-panel/dei-refetch-receipt.json",
  "/data/edgar/r1-panel/duration-refetch-receipt.json",
  "/data/edgar/r1-panel/price-fetch-receipt.json",
  "/data/edgar/r1-panel/primary-e-fetch-receipt.json",
  "/data/edgar/r1-panel/sic-fetch-receipt.json",
  "/data/edgar/r2-panel/dividend-fetch-receipt.json",
  "/data/edgar/r3-panel/r3-dividend-fetch-receipt.json",
  "/data/edgar/r3-panel/r3-price-fetch-receipt.json",
  "/data/edgar/rim-dow/AAPL.json",
  "/data/edgar/rim-dow/AMGN.json",
  "/data/edgar/rim-dow/AMZN.json",
  "/data/edgar/rim-dow/AXP.json",
  "/data/edgar/rim-dow/BA.json",
  "/data/edgar/rim-dow/CAT.json",
  "/data/edgar/rim-dow/CRM.json",
  "/data/edgar/rim-dow/CSCO.json",
  "/data/edgar/rim-dow/CVX.json",
  "/data/edgar/rim-dow/DIS.json",
  "/data/edgar/rim-dow/GOOGL.json",
  "/data/edgar/rim-dow/GS.json",
  "/data/edgar/rim-dow/HD.json",
  "/data/edgar/rim-dow/HON.json",
  "/data/edgar/rim-dow/IBM.json",
  "/data/edgar/rim-dow/JNJ.json",
  "/data/edgar/rim-dow/JPM.json",
  "/data/edgar/rim-dow/KO.json",
  "/data/edgar/rim-dow/MCD.json",
  "/data/edgar/rim-dow/MMM.json",
  "/data/edgar/rim-dow/MRK.json",
  "/data/edgar/rim-dow/MSFT.json",
  "/data/edgar/rim-dow/NKE.json",
  "/data/edgar/rim-dow/NVDA.json",
  "/data/edgar/rim-dow/PG.json",
  "/data/edgar/rim-dow/SHW.json",
  "/data/edgar/rim-dow/TRV.json",
  "/data/edgar/rim-dow/UNH.json",
  "/data/edgar/rim-dow/V.json",
  "/data/edgar/rim-dow/WMT.json",
  "/data/sec-13f/investors/griffin.json",
  "/data/admin/nasdaq_giw_sox/history/constituents.json",
  "/data/admin/sentiment/source-observations/crypto.json",
  "/data/admin/us-indices-daily/index.json",
  "/data/admin/us-indices-daily/keys/nasdaq.json",
  "/data/admin/us-indices-daily/keys/nasdaq100.json",
  "/data/admin/us-indices-daily/keys/sox.json",
  "/data/admin/us-indices-daily/keys/sp500.json",
  "/data/admin/us-indices-daily/lkg/nasdaq.json",
  "/data/admin/us-indices-daily/lkg/nasdaq100.json",
  "/data/admin/us-indices-daily/lkg/sox.json",
  "/data/admin/us-indices-daily/lkg/sp500.json",
  "/data/admin/us-indices-daily/parity-report.json",
  "/data/admin/us-indices-daily/persistence.json",
  "/data/admin/us-indices-daily/promotion-contracts/nasdaq.json",
  "/data/admin/us-indices-daily/promotion-contracts/nasdaq100.json",
  "/data/admin/us-indices-daily/promotion-contracts/sox.json",
  "/data/admin/us-indices-daily/promotion-contracts/sp500.json",
  "/data/admin/us-indices-daily/shadow/nasdaq.json",
  "/data/admin/us-indices-daily/shadow/sp500.json",
]);
export const PRIVATE_PUBLIC_PATH_VALUES = Object.freeze([
  ...new Set([...PLANE_ENROLLMENT_PRIVATE_DENY, ...EXPLICIT_PRIVATE_PATH_VALUES]),
].sort());
const PRIVATE_PUBLIC_PATH_SET = new Set(PRIVATE_PUBLIC_PATH_VALUES);

// Non-data-plane static assets that must still be forced through the Worker.
// Cloudflare's asset layer serves any path matching a file in the assets
// directory directly, bypassing every Next.js middleware check, unless that
// path is enrolled here. Every admin asset is gated by the admin session
// middleware, not the data-plane authority above, so the admin tree is
// enrolled explicitly rather than through the generated enrollment registry.
export const EXPLICIT_WORKER_FIRST_PATH_VALUES = Object.freeze([
  "/admin/*",
]);

// Keep the mutating Set private to this module. Callers receive a frozen
// authority with the one operation the Worker needs, so the deny boundary
// cannot be changed by a consumer at runtime.
export const PRIVATE_PUBLIC_PATHS = Object.freeze({
  has(pathname) {
    try { return PRIVATE_PUBLIC_PATH_SET.has(decodeURIComponent(pathname)); }
    catch { return false; }
  },
});

function familyRootPattern(pathname, label) {
  const match = /^\/data\/([^/]+)(?:\/|$)/u.exec(pathname);
  if (!match) throw new Error(`invalid ${label} enrollment path: ${pathname}`);
  return pathname === `/data/${match[1]}` ? pathname : `/data/${match[1]}/*`;
}

function coversPath(pattern, pathname) {
  return pattern.endsWith("*")
    ? pathname.startsWith(pattern.slice(0, -1))
    : pattern === pathname;
}

export function deriveWorkerFirstPatterns(
  exact = PLANE_ENROLLMENT_EXACT,
  prefixes = PLANE_ENROLLMENT_PREFIXES,
) {
  const familyPatterns = new Set();
  for (const [pathname] of exact) familyPatterns.add(familyRootPattern(pathname, "exact"));
  for (const { prefix } of prefixes) familyPatterns.add(familyRootPattern(prefix, "prefix"));

  const sortedFamilies = [...familyPatterns].sort();
  const isolatedPrivatePaths = [...new Set(PRIVATE_PUBLIC_PATH_VALUES
    .filter((pathname) => !sortedFamilies.some((pattern) => coversPath(pattern, pathname)))
    .map((pathname) => pathname.startsWith("/data/edgar/rim-dow/")
      ? "/data/edgar/rim-dow/*" : pathname))].sort();
  const isolatedWorkerFirstPaths = EXPLICIT_WORKER_FIRST_PATH_VALUES
    .filter((pattern) => !sortedFamilies.some((familyPattern) => coversPath(familyPattern, pattern)))
    .sort();
  return Object.freeze([...sortedFamilies, ...isolatedPrivatePaths, ...isolatedWorkerFirstPaths]);
}

export const FINAL_WORKER_FIRST_PATTERNS = deriveWorkerFirstPatterns();
