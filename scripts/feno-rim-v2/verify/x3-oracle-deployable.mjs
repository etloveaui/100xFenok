#!/usr/bin/env node

// FENO RIM v2 — X3: Oracle versus Deployable (contract section 6, X3).
//
// The question every earlier experiment confounded: is the FORMULA unable to
// rank returns, or is the DATA needed to feed it unavailable at origin time?
//
//   Oracle      residual income built from REALISED future book and earnings.
//               Deliberate look-ahead. Never a production input. It measures
//               only the ceiling the formula could reach if forecasting were
//               perfect. If the Oracle fails, no forecast data can rescue it.
//   Deployable  strictly facts filed at or before the origin, plus the
//               mean-reversion rule declared in x3-criteria.mjs before any
//               result existed.
//
// Both arms value the same 30 constituents at the same 34 origins, aggregate
// cap-weighted, and are scored against the same subsequent 36-month annualised
// dividend-adjusted total return the E2 artifact already carries. Same basket,
// same origins, same target - so X3 is comparable to E1/E2 rather than a new
// universe.
//
// Criteria are consumed fail-closed: if x3-success-criteria.json is missing or
// its sha does not match the module, this refuses to run.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { criteriaSha256, X3_CRITERIA } from "../x3-criteria.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DAY = 86_400_000;
const HORIZON_YEARS = 3;
const FADE_YEARS = 3;          // ROE fades to the trailing median over the horizon
const TERMINAL_YEARS = 10;     // residual income decays linearly to zero after the horizon

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const round6 = (x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null);

// --- statistics, written here rather than imported ---------------------------

function rankOf(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k][1]] = shared;
    i = j + 1;
  }
  return ranks;
}

function spearman(xs, ys) {
  if (xs.length < 3) return null;
  const rx = rankOf(xs);
  const ry = rankOf(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = rx[i] - mx;
    const b = ry[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx === 0 || dy === 0 ? null : num / Math.sqrt(dx * dy);
}

// Moving-block bootstrap. Overlapping 36-month evaluation windows make adjacent
// quarterly origins dependent, so resampling single origins would understate
// the interval badly. Seeded, so the CI is reproducible.
function blockBootstrapCI(xs, ys, { blocks = 12, reps = 2000, seed = 539363334 } = {}) {
  if (xs.length < 4) return null;
  let state = seed >>> 0;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const n = xs.length;
  const size = Math.max(1, Math.min(blocks, n));
  const draws = [];
  for (let r = 0; r < reps; r += 1) {
    const bx = [];
    const by = [];
    while (bx.length < n) {
      const start = Math.floor(rand() * n);
      for (let k = 0; k < size && bx.length < n; k += 1) {
        const idx = (start + k) % n;
        bx.push(xs[idx]);
        by.push(ys[idx]);
      }
    }
    const rho = spearman(bx, by);
    if (rho !== null) draws.push(rho);
  }
  if (!draws.length) return null;
  draws.sort((a, b) => a - b);
  return {
    mean: round6(draws.reduce((a, b) => a + b, 0) / draws.length),
    ci_lower: round6(draws[Math.floor(draws.length * 0.025)]),
    ci_upper: round6(draws[Math.floor(draws.length * 0.975)]),
    ci_level: 0.95,
    n,
    reps: draws.length,
    block_size_quarters: size,
    seed,
    method: "moving_block_bootstrap_36m",
  };
}

// --- EDGAR facts -------------------------------------------------------------

const BOOK_CONCEPTS = ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"];
const EARN_CONCEPTS = ["NetIncomeLoss", "ProfitLoss"];

/** Earliest-filed value per fiscal period end, so restatements never leak back. */
function earliestByEnd(facts) {
  const byEnd = new Map();
  for (const f of facts) {
    if (!f?.end || !Number.isFinite(f.val) || !f.filed) continue;
    const prior = byEnd.get(f.end);
    if (!prior || f.filed < prior.filed) byEnd.set(f.end, f);
  }
  return [...byEnd.values()].sort((a, b) => (a.end < b.end ? -1 : 1));
}

/** Twelve-month-span earnings only: an FY tag alone is unusable (restated comparatives). */
function annualEarnings(concepts) {
  const rows = [];
  for (const c of EARN_CONCEPTS) {
    for (const f of concepts[c] ?? []) {
      if (!f?.start || !f?.end || !Number.isFinite(f.val) || !f.filed) continue;
      if (ms(f.end) - ms(f.start) < 360 * DAY) continue;
      rows.push(f);
    }
  }
  return earliestByEnd(rows);
}

function annualBook(concepts) {
  const rows = [];
  for (const c of BOOK_CONCEPTS) for (const f of concepts[c] ?? []) rows.push(f);
  return earliestByEnd(rows);
}

/** Realised value at or after a target date — the Oracle's look-ahead reach. */
function firstAtOrAfter(rows, targetIso) {
  for (const r of rows) if (r.end >= targetIso) return r;
  return null;
}

// --- the two value paths -----------------------------------------------------

/**
 * Residual income value from an explicit (book, earnings) path.
 *   RI_k = earnings_k - Ke * book_(k-1)
 *   V    = book_0 + sum RI_k/(1+Ke)^k + terminal
 * Terminal decays RI linearly to zero over TERMINAL_YEARS, the same shape the
 * engine's Terminal B uses, so the two arms are not separated by terminal
 * choice.
 */
function residualIncomeValue(book0, path, ke) {
  if (!(book0 > 0) || !(ke > 0) || !path.length) return null;
  let value = book0;
  let prevBook = book0;
  let lastRi = null;
  for (let k = 0; k < path.length; k += 1) {
    const { earnings, book } = path[k];
    if (!Number.isFinite(earnings) || !Number.isFinite(book)) return null;
    const ri = earnings - ke * prevBook;
    value += ri / (1 + ke) ** (k + 1);
    prevBook = book;
    lastRi = ri;
  }
  if (lastRi !== null) {
    const n = path.length;
    for (let k = 1; k <= TERMINAL_YEARS; k += 1) {
      const decayed = lastRi * ((TERMINAL_YEARS - k) / TERMINAL_YEARS);
      value += decayed / (1 + ke) ** (n + k);
    }
  }
  return value;
}

/** Oracle: the realised future, taken from filings dated after the origin. */
function oraclePath(concepts, originIso) {
  const books = annualBook(concepts);
  const earns = annualEarnings(concepts);
  const path = [];
  for (let y = 1; y <= HORIZON_YEARS; y += 1) {
    const target = iso(ms(originIso) + y * 365.25 * DAY);
    const b = firstAtOrAfter(books, target);
    const e = firstAtOrAfter(earns, target);
    if (!b || !e) return null;
    path.push({ earnings: e.val, book: b.val });
  }
  return path;
}

/**
 * Deployable: only what was filed by the origin, plus the pre-declared rule -
 * ROE fades linearly from the origin's realised ROE toward the constituent's
 * own trailing median ROE, and book rolls forward by retained earnings.
 */
function deployablePath(member) {
  const { book, roe, roe_band: band } = member;
  if (!(book > 0) || !Number.isFinite(roe)) return null;
  const target = Number.isFinite(band?.low) && Number.isFinite(band?.high)
    ? (band.low + band.high) / 2
    : roe;
  const path = [];
  let prevBook = book;
  for (let y = 1; y <= HORIZON_YEARS; y += 1) {
    const w = Math.min(1, y / FADE_YEARS);
    const roeY = roe + (target - roe) * w;
    const earnings = roeY * prevBook;
    // No payout series at constituent level; retained-earnings roll-forward is
    // the declared rule and is applied identically at every origin.
    const nextBook = prevBook + earnings;
    path.push({ earnings, book: nextBook });
    prevBook = nextBook;
  }
  return path;
}

// --- main --------------------------------------------------------------------

function main() {
  const criteriaPath = path.join(ROOT, "data/computed/feno-rim-v2/x3-success-criteria.json");
  if (!fs.existsSync(criteriaPath)) {
    throw new Error("x3: frozen criteria absent — refusing to compute a result before its criteria exist");
  }
  const onDisk = JSON.parse(fs.readFileSync(criteriaPath, "utf8"));
  if (onDisk.criteria_sha256 !== criteriaSha256()) {
    throw new Error("x3: criteria sha mismatch — the frozen block changed after it was written");
  }

  const panel = readJson("data/computed/feno-rim-v2/e2-basket-panel.json");
  const scoring = readJson("data/computed/feno-rim-v2/e2-research-scoring.json");
  const audit = readJson("data/computed/feno-rim-v2/E1_E2_FORENSIC_AUDIT.json");
  const rates = readJson("data/macro/fred-banking-daily.json").series.DGS10;
  const erp = readJson("data/computed/feno-rim-v2/erp-archive-restoration.json");

  const returnByOrigin = new Map(scoring.per_origin_rows.map((r) => [r.as_of, r.return_annualised]));
  const windowComplete = new Set(
    audit.p0_adjudications.p0_3_baseline_truncation.evidence.e2_baseline_windows.window_rows_per_origin
      .filter((w) => w.years >= 9.5)
      .map((w) => w.as_of),
  );

  const erpObs = erp.observations
    .map((o) => ({ t: ms(o.first_knowable), us: o.us_erp }))
    .sort((a, b) => a.t - b.t);

  const concepts = new Map();
  for (const file of fs.readdirSync(path.join(ROOT, "data/edgar/rim-dow"))) {
    if (!file.endsWith(".json") || file.startsWith("e2-")) continue;
    const doc = readJson(`data/edgar/rim-dow/${file}`);
    if (doc?.concepts) concepts.set(doc.symbol ?? file.replace(/\.json$/, ""), doc.concepts);
  }

  const rows = [];
  for (const origin of panel.origin_rows) {
    const asOf = origin.as_of;
    const ret = returnByOrigin.get(asOf);
    if (!Number.isFinite(ret)) continue;

    let rate = null;
    for (const r of rates) {
      if (r.date <= asOf) rate = r;
      else break;
    }
    const priorErp = erpObs.filter((o) => o.t <= ms(asOf)).at(-1);
    if (!rate || !priorErp) continue;
    const ke = rate.value * 0.01 + priorErp.us;

    let oracleCap = 0;
    let deployCap = 0;
    let capTotal = 0;
    let oracleOk = 0;
    let deployOk = 0;
    for (const m of origin.members) {
      if (!m.ok || !(m.mc > 0) || !(m.book > 0) || !(m.price > 0) || !(m.shares > 0)) continue;
      capTotal += m.mc;
      const c = concepts.get(m.symbol);
      const oPath = c ? oraclePath(c, asOf) : null;
      const oV = oPath ? residualIncomeValue(m.book, oPath, ke) : null;
      if (Number.isFinite(oV) && oV > 0) {
        oracleCap += oV;
        oracleOk += 1;
      }
      const dPath = deployablePath(m);
      const dV = dPath ? residualIncomeValue(m.book, dPath, ke) : null;
      if (Number.isFinite(dV) && dV > 0) {
        deployCap += dV;
        deployOk += 1;
      }
    }
    if (capTotal <= 0 || oracleOk < 20 || deployOk < 20) continue;

    rows.push({
      as_of: asOf,
      ke: round6(ke),
      members_oracle: oracleOk,
      members_deployable: deployOk,
      vp_oracle: round6(oracleCap / capTotal),
      vp_deployable: round6(deployCap / capTotal),
      return_annualised: round6(ret),
      window_complete: windowComplete.has(asOf),
    });
  }

  const score = (subset, key) => {
    const xs = subset.map((r) => r[key]);
    const ys = subset.map((r) => r.return_annualised);
    const rho = spearman(xs, ys);
    return { spearman_rho: round6(rho), rho_ci: blockBootstrapCI(xs, ys), n: subset.length };
  };

  const all = rows;
  const complete = rows.filter((r) => r.window_complete);
  const sets = {
    all_origins: {
      n: all.length,
      oracle: score(all, "vp_oracle"),
      deployable: score(all, "vp_deployable"),
    },
    window_complete: {
      n: complete.length,
      oracle: score(complete, "vp_oracle"),
      deployable: score(complete, "vp_deployable"),
    },
  };

  // Verdict resolved mechanically from the frozen bar.
  const passes = (block) =>
    block.spearman_rho !== null
    && block.spearman_rho > 0
    && block.rho_ci
    && block.rho_ci.ci_lower > 0;
  const decisive = sets.window_complete;
  const oraclePass = passes(decisive.oracle);
  const deployPass = passes(decisive.deployable);
  const matrixKey = `${oraclePass ? "oracle_pass" : "oracle_fail"}_${deployPass ? "deployable_pass" : "deployable_fail"}`;

  const body = {
    schema_version: "feno_rim_v2_x3_oracle_deployable.v1",
    phase: "X3",
    contract_ref: X3_CRITERIA.contract_ref,
    research_only: true,
    promotion: null,
    criteria_sha256: onDisk.criteria_sha256,
    lookahead_disclosure:
      "the oracle arm uses realised post-origin filings on purpose; it is never a production input and measures the formula's ceiling only",
    basket: panel.basket,
    horizon_years: HORIZON_YEARS,
    terminal_years: TERMINAL_YEARS,
    origin_rows: rows,
    origin_sets: sets,
    verdict: {
      decisive_origin_set: "window_complete",
      oracle_passes: oraclePass,
      deployable_passes: deployPass,
      matrix_key: matrixKey,
      conclusion: X3_CRITERIA.decision_matrix[matrixKey],
      bar: X3_CRITERIA.success_bar.rule,
    },
    generated_at: new Date().toISOString(),
  };
  body.scoring_sha256 = crypto
    .createHash("sha256")
    .update(JSON.stringify({ ...body, generated_at: undefined }))
    .digest("hex");

  const out = path.join(ROOT, "data/computed/feno-rim-v2/RIM_ORACLE_DEPLOYABLE_COMPARISON.json");
  fs.writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`);

  console.log(`X3 origins scored: ${rows.length} (window-complete ${complete.length})`);
  for (const [name, s] of Object.entries(sets)) {
    for (const arm of ["oracle", "deployable"]) {
      const b = s[arm];
      console.log(
        `  ${name.padEnd(16)} ${arm.padEnd(11)} rho ${String(b.spearman_rho).padStart(9)}  CI [${b.rho_ci?.ci_lower}, ${b.rho_ci?.ci_upper}]  n=${b.n}`,
      );
    }
  }
  console.log(`verdict: ${body.verdict.matrix_key} -> ${body.verdict.conclusion}`);
  console.log(`written: ${out}`);
}

main();
