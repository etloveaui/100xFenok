#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(REPO, "data");
const FIN = path.join(DATA, "yf/finance");
const MEMBERSHIP = path.join(DATA, "computed/stock_action_index.json");
const BENCHMARK = path.join(DATA, "benchmarks/us.json");
const OUTPUT = path.join(DATA, "computed/fenok-rim/input-diagnostics.json");
const TARGET_DATE = "2025-12-05";

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const hashFile = (p) => sha256(fs.readFileSync(p));
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const norm = (s) => String(s ?? "").trim().toUpperCase().replaceAll("-", ".");
const pct = (x) => Number.isFinite(x) ? x * 100 : null;
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const files = fs.readdirSync(FIN).filter((f) => f.endsWith(".json")).sort();

function loadTicker(canonical) {
  const candidates = [canonical, canonical.replaceAll(".", "-"), canonical.replaceAll(".", "")];
  for (const c of candidates) {
    const p = path.join(FIN, `${c}.json`);
    if (fs.existsSync(p)) return { path: p, data: readJson(p), source_file: path.relative(REPO, p) };
  }
  return null;
}

function extract(canonical) {
  const loaded = loadTicker(canonical);
  const base = { ticker: canonical, source_file: loaded?.source_file ?? null, reason: null, exchange: null, latest_balance_date: null, equity: null, shares: null, eps_fy1: null, eps_0y: null, analysts_fy1: null, trailing_net_income: null };
  if (!loaded) return { ...base, reason: "no_file" };
  const d = loaded.data?.data ?? {};
  base.exchange = d.info?.exchange ?? null;
  const bs = d.balance_sheet;
  if (!bs || typeof bs !== "object" || !Object.keys(bs).length) return { ...base, reason: "no_balance_sheet" };
  const date = Object.keys(bs).sort().at(-1); const latest = bs[date]; const equity = latest?.["Stockholders Equity"];
  if (!finite(equity) || equity < 0) return { ...base, latest_balance_date: date, reason: "bad_equity" };
  base.latest_balance_date = date; base.equity = equity;
  let shares = d.info?.sharesOutstanding;
  if (!finite(shares) || shares <= 0) shares = latest?.["Ordinary Shares Number"];
  if (!finite(shares) || shares <= 0) return { ...base, reason: "no_shares" };
  base.shares = shares;
  const estimates = d.earnings_estimate;
  if (!Array.isArray(estimates) || !estimates.length) return { ...base, reason: "no_earnings_estimate" };
  const fy1 = estimates.find((e) => e._index === "+1y"); const cy = estimates.find((e) => e._index === "0y");
  if (!fy1 || !finite(fy1.avg)) return { ...base, reason: "no_annual_fy1" };
  base.eps_fy1 = fy1.avg; base.eps_0y = finite(cy?.avg) ? cy.avg : null; base.analysts_fy1 = fy1.numberOfAnalysts ?? null;
  const income = d.income_statement;
  if (income && typeof income === "object" && Object.keys(income).length) {
    const incomeDate = Object.keys(income).sort().at(-1); const ni = income[incomeDate]?.["Net Income"];
    if (finite(ni)) base.trailing_net_income = ni;
  }
  return base;
}

function membersFromIndex(indexData) {
  const out = new Set();
  for (const row of indexData.rows ?? []) for (const w of row.indexWeights ?? []) if (w.index === indexData.index) out.add(norm(row.symbol ?? row.ticker_normalized));
  return [...out].sort();
}
function score(requested) {
  const rows = requested.map(extract); const included = rows.filter((r) => !r.reason);
  const excluded = rows.filter((r) => r.reason);
  const sum = (field, transform = (r) => r[field]) => included.reduce((n, r) => n + (finite(transform(r)) ? transform(r) : 0), 0);
  const trail = included.filter((r) => finite(r.trailing_net_income));
  const sumEq = sum("equity"); const fy1Ni = sum("eps_fy1", (r) => r.eps_fy1 * r.shares); const cyNi = sum("eps_0y", (r) => r.eps_0y * r.shares);
  const sumTrailNi = trail.reduce((n, r) => n + r.trailing_net_income, 0); const sumTrailEq = trail.reduce((n, r) => n + r.equity, 0);
  return { status: "local_diagnostic_only", production_eligible: false, requested_tickers: requested, included_tickers: included.map((r) => r.ticker), excluded_tickers: excluded.map((r) => ({ ticker: r.ticker, reason: r.reason })), reason_counts: Object.fromEntries(Object.entries(Object.groupBy(excluded, (r) => r.reason)).map(([k, v]) => [k, v.length])), included_count: included.length, requested_count: requested.length, sums: { equity: sumEq, fy1_net_income: fy1Ni, current_net_income: cyNi, trailing_net_income: sumTrailNi, trailing_equity: sumTrailEq }, roe: { fy1_plus_1y: sumEq ? fy1Ni / sumEq : null, current_0y: sumEq ? cyNi / sumEq : null, trailing: sumTrailEq ? sumTrailNi / sumTrailEq : null, trailing_included_count: trail.length }, source_dates: [...new Set(included.map((r) => r.latest_balance_date).filter(Boolean))].sort(), finance_rows: included };
}

function feedRow(section, benchmark) {
  const rows = benchmark.sections?.[section]?.data ?? []; if (!rows.length) return null;
  const near = rows.reduce((best, row) => Math.abs(Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${TARGET_DATE}T00:00:00Z`)) < Math.abs(Date.parse(`${best.date}T00:00:00Z`) - Date.parse(`${TARGET_DATE}T00:00:00Z`)) ? row : best, rows[0]);
  const latest = rows.at(-1); const map = (r) => ({ date: r.date, px_last: r.px_last, pbr: r.px_to_book_ratio, book: finite(r.px_last) && finite(r.px_to_book_ratio) && r.px_to_book_ratio > 0 ? r.px_last / r.px_to_book_ratio : null });
  return { latest: map(latest), near_target: map(near) };
}
function crossCheck(group, feed) {
  if (!feed) return { status: "blocked_no_feed_section" };
  const eq = group.included_tickers.reduce((n, t) => n + (group.finance_rows.find((r) => r.ticker === t)?.equity ?? 0), 0);
  const mcapRows = group.finance_rows.map((r) => { const d = readJson(path.join(REPO, r.source_file)).data; const mc = d.info?.marketCap ?? d.fast_info?.marketCap; return finite(mc) && mc > 0 ? mc : null; }).filter(finite);
  const sumMcap = mcapRows.reduce((a, b) => a + b, 0); const aggPbr = eq > 0 ? sumMcap / eq : null; const feedPbr = feed.latest.pbr;
  return { status: "post_hoc_anchor_comparison", target_date: TARGET_DATE, feed_latest: feed.latest, feed_near_target: feed.near_target, aggregate_equity: eq, aggregate_market_cap: sumMcap, market_cap_included_count: mcapRows.length, aggregate_pbr: aggPbr, feed_latest_pbr_divergence_pct: finite(aggPbr) && finite(feedPbr) ? (aggPbr - feedPbr) / feedPbr * 100 : null };
}

function build() {
  const membershipData = readJson(MEMBERSHIP); const benchmarkData = readJson(BENCHMARK);
  const indexSets = {}; for (const index of ["sp500", "nasdaq100"]) indexSets[index] = membersFromIndex({ rows: membershipData.rows, index });
  const allNasdaq = files.map((f) => norm(f.slice(0, -5))).filter((t) => ["NMS", "NGM", "NCM"].includes(extract(t).exchange));
  indexSets.ccmp_proxy = [...new Set(allNasdaq)].sort();
  const diagnostics = {}; for (const [index, requested] of Object.entries(indexSets)) diagnostics[index] = score(requested);
  const feeds = Object.fromEntries(["sp500", "nasdaq100", "nasdaq_composite", "russell2000"].map((s) => [s, feedRow(s, benchmarkData)]));
  diagnostics.sp500.aggregate_pbr_cross_check = crossCheck(diagnostics.sp500, feeds.sp500); diagnostics.nasdaq100.aggregate_pbr_cross_check = crossCheck(diagnostics.nasdaq100, feeds.nasdaq100);
  diagnostics.ccmp_proxy.status = "local_diagnostic_only_partial_proxy"; diagnostics.ccmp_proxy.membership_basis = "all local finance files with exchange NMS/NGM/NCM; not index membership"; diagnostics.russell2000 = { status: "local_diagnostic_only_unavailable", production_eligible: false, requested_count: 0, requested_tickers: [], included_tickers: [], excluded_tickers: [], reason_counts: { missing_membership_key: 1 } };
  const usedRows = new Map(); for (const row of Object.values(diagnostics).flatMap((g) => g.finance_rows ?? [])) usedRows.set(row.ticker, row); const tuples = [...usedRows.values()].sort((a, b) => a.ticker.localeCompare(b.ticker)).map((r) => ({ ticker: r.ticker, source_file: r.source_file, source_sha256: hashFile(path.join(REPO, r.source_file)), latest_balance_date: r.latest_balance_date, equity: r.equity, shares: r.shares, eps_fy1: r.eps_fy1, eps_0y: r.eps_0y, trailing_net_income: r.trailing_net_income })); const tupleHash = sha256(Buffer.from(JSON.stringify(tuples)));
  return { schema_version: "fenok-rim-input-diagnostics/v1", status: "local_diagnostic_only", production_eligible: false, comparison_status: "post_hoc_anchor_comparison", source_vintage: { membership_source_date: membershipData.source_date ?? null, membership_generated_at: membershipData.generated_at ?? null, benchmark_metadata: benchmarkData.metadata ?? null, target_date: TARGET_DATE }, inputs: { membership: { path: path.relative(REPO, MEMBERSHIP), sha256: hashFile(MEMBERSHIP) }, benchmark: { path: path.relative(REPO, BENCHMARK), sha256: hashFile(BENCHMARK) }, finance_tuple_aggregate: { tuple_count: tuples.length, sha256: tupleHash } }, diagnostics, limitations: ["local inputs only", "current membership and latest balance-sheet dates are post-hoc diagnostics", "CCMP is an exchange proxy, not dated index membership", "Russell membership is unavailable", "no production or public-reproducibility claim"] };
}

const args = process.argv.slice(2); const out = args.includes("--output") ? path.resolve(args[args.indexOf("--output") + 1]) : OUTPUT; const result = build(); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify({ output: path.relative(REPO, out), status: result.status, production_eligible: result.production_eligible }));
