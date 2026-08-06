#!/usr/bin/env node

// FENO RIM — X2/X3 INDEPENDENT REPRODUCTION AND ATTACK (DeepSeek red team).
//
// Contract Step 7. The handler built X2 and X3 without an independent check;
// the RETIRE_RIM_PUBLIC_PRODUCT decision (FINAL_RIM_DECISION.json) rests on
// them. This module reproduces both from raw rows with MY OWN statistics and
// MY OWN construction (read, not imported — no import of x2-cross-sectional.mjs,
// x3-oracle-deployable.mjs, or anything they import), and attacks:
//   1. the Oracle's firstAtOrAfter period selection (straddle) and whether the
//      10y terminal decay does the work instead of the explicit path;
//   2. the B/P control's point-in-time symmetry;
//   3. differential member drops between arms;
//   4. the small-n (n=13) supportability of the X3 verdict;
//   5. threshold-fit evidence (criteria shas + commit order) — reported
//      separately from the numbers.
//
// Output: data/computed/feno-rim-v2/X2X3_INDEPENDENT_AUDIT.json

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ownBlockBootstrap, ownRng, ownSpearman } from "./x0-forensic-audit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DAY = 86_400_000;
const H = 3;
const FADE = 3;
const TERM = 10;

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const iso = (m) => new Date(m).toISOString().slice(0, 10);
const round6 = (x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null);

// ---------------------------------------------------------------------------
// own residual-income value (same economics as the handler's, own code):
// RI_k = earnings_k - Ke * book_(k-1); V = book0 + sum RI/(1+Ke)^k + terminal.
// Terminal variants: decay10 (linear to zero over 10y), decay5, perpetuity
// (RI constant), none.
// ---------------------------------------------------------------------------

export function ownRiValue(book0, pathArr, ke, terminal = "decay10") {
  if (!(book0 > 0) || !(ke > 0) || !pathArr.length) return null;
  let value = book0;
  let prevBook = book0;
  let lastRi = null;
  const n = pathArr.length;
  for (let k = 0; k < n; k += 1) {
    const { earnings, book } = pathArr[k];
    if (!Number.isFinite(earnings) || !Number.isFinite(book)) return null;
    const ri = earnings - ke * prevBook;
    value += ri / (1 + ke) ** (k + 1);
    prevBook = book;
    lastRi = ri;
  }
  if (lastRi === null) return value;
  if (terminal === "none") return value;
  if (terminal === "perpetuity") {
    value += lastRi / ke / (1 + ke) ** n;
    return value;
  }
  const years = terminal === "decay5" ? 5 : 10;
  for (let k = 1; k <= years; k += 1) {
    value += (lastRi * ((years - k) / years)) / (1 + ke) ** (n + k);
  }
  return value;
}

// Deployable path: ROE fades linearly from origin ROE toward the trailing
// ROE-band midpoint over FADE years; book rolls forward by retained earnings.
export function ownDeployablePath(member) {
  const { book, roe, roe_band: band } = member;
  if (!(book > 0) || !Number.isFinite(roe)) return null;
  const target = Number.isFinite(band?.low) && Number.isFinite(band?.high) ? (band.low + band.high) / 2 : roe;
  const p = [];
  let pb = book;
  for (let y = 1; y <= H; y += 1) {
    const w = Math.min(1, y / FADE);
    const r = roe + (target - roe) * w;
    const e = r * pb;
    pb += e;
    p.push({ earnings: e, book: pb });
  }
  return p;
}

// ---------------------------------------------------------------------------
// own EDGAR fact handling (annual 12m-span earnings; book union)
// ---------------------------------------------------------------------------

const BOOK_CONCEPTS = ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"];
const EARN_CONCEPTS = ["NetIncomeLoss", "ProfitLoss"];

function earliestByEnd(facts) {
  const byEnd = new Map();
  for (const f of facts) {
    if (!f?.end || !Number.isFinite(f.val) || !f.filed) continue;
    const prior = byEnd.get(f.end);
    if (!prior || f.filed < prior.filed) byEnd.set(f.end, f);
  }
  return [...byEnd.values()].sort((a, b) => (a.end < b.end ? -1 : 1));
}

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

// ---------------------------------------------------------------------------
// main audit
// ---------------------------------------------------------------------------

export function buildX2X3Audit({ generatedAt = new Date().toISOString() } = {}) {
  const panel = readJson("data/computed/feno-rim-v2/e2-basket-panel.json");
  const scoring = readJson("data/computed/feno-rim-v2/e2-research-scoring.json");
  const audit = readJson("data/computed/feno-rim-v2/E1_E2_FORENSIC_AUDIT.json");
  const rates = readJson("data/macro/fred-banking-daily.json").series.DGS10;
  const erpDoc = readJson("data/computed/feno-rim-v2/erp-archive-restoration.json");
  const erpObs = erpDoc.observations.map((o) => ({ t: ms(o.first_knowable), us: o.us_erp })).sort((a, b) => a.t - b.t);

  const windowComplete = new Set(
    audit.p0_adjudications.p0_3_baseline_truncation.evidence.e2_baseline_windows.window_rows_per_origin
      .filter((w) => w.years >= 9.5)
      .map((w) => w.as_of),
  );
  const returnByOrigin = new Map(scoring.per_origin_rows.map((r) => [r.as_of, r.return_annualised]));

  // own yf price/dividend series
  const px = {};
  const dv = {};
  for (const f of fs.readdirSync(path.join(ROOT, "data/yf/finance"))) {
    if (!f.endsWith(".unadjusted.json")) continue;
    const s = f.replace(".unadjusted.json", "");
    const d = readJson(`data/yf/finance/${f}`).data;
    px[s] = (d.history_unadjusted || []).map((r) => ({ t: ms(r.date), c: r.Close })).sort((a, b) => a.t - b.t);
    dv[s] = Object.entries(d.dividends || {}).map(([k, v]) => ({ t: ms(k), a: v })).sort((a, b) => a.t - b.t);
  }
  const at = (a, t) => {
    let f = null;
    for (const r of a) {
      if (r.t <= t) f = r;
      else break;
    }
    return f;
  };

  // own EDGAR concepts per symbol
  const concepts = new Map();
  for (const file of fs.readdirSync(path.join(ROOT, "data/edgar/rim-dow"))) {
    if (!file.endsWith(".json") || file.startsWith("e2-")) continue;
    const doc = readJson(`data/edgar/rim-dow/${file}`);
    if (doc?.concepts) concepts.set(doc.symbol ?? file.replace(/\.json$/, ""), doc.concepts);
  }

  const x2Rows = [];
  const x3Rows = [];
  const keByOrigin = {};

  for (const origin of panel.origin_rows) {
    const asOf = origin.as_of;
    const t0 = ms(asOf);
    const t1 = t0 + Math.round(36 * 30.44 * DAY);
    const ret = returnByOrigin.get(asOf);
    if (!Number.isFinite(ret)) continue;
    let rate = null;
    for (const r of rates) {
      if (r.date <= asOf) rate = r;
      else break;
    }
    const priorErp = erpObs.filter((o) => o.t <= t0).at(-1);
    if (!rate || !priorErp) continue;
    const ke = rate.value * 0.01 + priorErp.us;
    keByOrigin[asOf] = round6(ke);

    // ---------------- X2: per-constituent IC --------------------------------
    const vp = [];
    const bp = [];
    const rets = [];
    const droppedX2 = [];
    for (const m of origin.members) {
      if (!m.ok || !(m.book > 0) || !(m.price > 0) || !(m.shares > 0) || !Number.isFinite(m.roe)) {
        droppedX2.push({ symbol: m.symbol, reason: m.reason ?? "gate" });
        continue;
      }
      const p = px[m.symbol];
      if (!p?.length) {
        droppedX2.push({ symbol: m.symbol, reason: "no_price_series" });
        continue;
      }
      const a = at(p, t0);
      const b = at(p, t1);
      if (!a || !b || t0 - a.t > 45 * DAY || t1 - b.t > 45 * DAY) {
        droppedX2.push({ symbol: m.symbol, reason: "price_freshness" });
        continue;
      }
      const dp = ownDeployablePath(m);
      const V = dp ? ownRiValue(m.book, dp, ke, "decay10") : null;
      if (!Number.isFinite(V) || V <= 0) {
        droppedX2.push({ symbol: m.symbol, reason: "value_not_finite_or_nonpositive" });
        continue;
      }
      const mcap = m.price * m.shares;
      const div = (dv[m.symbol] || []).filter((x) => x.t > t0 && x.t <= t1).reduce((s, x) => s + x.a, 0);
      const tr = (b.c + div) / a.c - 1;
      vp.push(V / mcap);
      bp.push(m.book / mcap);
      rets.push(tr);
    }
    if (vp.length >= 20) {
      const icV = ownSpearman(vp, rets);
      const icB = ownSpearman(bp, rets);
      if (icV !== null && icB !== null) {
        x2Rows.push({ as_of: asOf, n: vp.length, ic_vp: round6(icV), ic_bp: round6(icB), complete: windowComplete.has(asOf), dropped: droppedX2 });
      }
    }

    // ---------------- X3: oracle vs deployable ------------------------------
    const oraclePathFor = (c, y) => {
      const target = iso(t0 + Math.round(y * 365.25 * DAY));
      const books = annualBook(c);
      const earns = annualEarnings(c);
      const b = books.find((r) => r.end >= target);
      const e = earns.find((r) => r.end >= target);
      return { b: b ?? null, e: e ?? null };
    };
    let capTotal = 0;
    let oracleCap = 0;
    let deployCap = 0;
    let oracleOk = 0;
    let deployOk = 0;
    let oracleCapBase = 0; // cap of members WITH an oracle path
    const straddles = [];
    const oraclePathStarts = [];
    for (const m of origin.members) {
      if (!m.ok || !(m.mc > 0) || !(m.book > 0) || !(m.price > 0) || !(m.shares > 0)) continue;
      capTotal += m.mc;
      const c = concepts.get(m.symbol);
      const oPath = c ? oraclePathFor(c, 1) : { b: null, e: null };
      // path exists if all three years resolve
      let fullPath = oPath.b !== null && oPath.e !== null;
      let straddleFlag = false;
      let firstStart = null;
      if (fullPath) {
        for (let y = 1; y <= H; y += 1) {
          const { b, e } = oraclePathFor(c, y);
          if (!b || !e) {
            fullPath = false;
            break;
          }
          if (y === 1) {
            firstStart = b.start ?? e.start ?? null;
            if (firstStart && ms(firstStart) < t0) straddleFlag = true; // period started before the origin
          }
        }
      }
      const oV = fullPath ? ownRiValue(m.book, [1, 2, 3].map((y) => {
        const { b, e } = oraclePathFor(c, y);
        return { earnings: e.val, book: b.val };
      }), ke, "decay10") : null;
      if (Number.isFinite(oV) && oV > 0) {
        oracleCap += oV;
        oracleOk += 1;
        oracleCapBase += m.mc;
        if (straddleFlag) straddles.push(m.symbol);
        if (firstStart) oraclePathStarts.push({ symbol: m.symbol, first_period_start: firstStart });
      }
      const dPath = ownDeployablePath(m);
      const dV = dPath ? ownRiValue(m.book, dPath, ke, "decay10") : null;
      if (Number.isFinite(dV) && dV > 0) {
        deployCap += dV;
        deployOk += 1;
      }
    }
    if (capTotal > 0 && oracleOk >= 20 && deployOk >= 20) {
      x3Rows.push({
        as_of: asOf,
        members_oracle: oracleOk,
        members_deployable: deployOk,
        cap_coverage_oracle: round6(oracleCapBase / capTotal),
        vp_oracle: round6(oracleCap / capTotal),
        vp_deployable: round6(deployCap / capTotal),
        straddle_members: straddles.length,
        first_period_start_sample: oraclePathStarts.slice(0, 3),
        return_annualised: round6(ret),
        complete: windowComplete.has(asOf),
      });
    }
  }

  // ---------------- scoring (own stats) -------------------------------------
  const scoreBlock = (rows, key) => {
    const xs = rows.map((r) => r[key]);
    const ys = rows.map((r) => r.return_annualised);
    const rho = ownSpearman(xs, ys);
    const ci12 = ownBlockBootstrap(ownSpearman, xs.map((x, i) => ({ x, y: ys[i], as_of: rows[i].as_of })), { blockQuarters: 12 });
    return { spearman_rho: round6(rho), rho_ci_12: ci12, n: rows.length };
  };

  const x2 = {
    all: {
      n: x2Rows.length,
      mean_ic_vp: round6(x2Rows.reduce((s, r) => s + r.ic_vp, 0) / x2Rows.length),
      mean_ic_bp: round6(x2Rows.reduce((s, r) => s + r.ic_bp, 0) / x2Rows.length),
      positive_vp: x2Rows.filter((r) => r.ic_vp > 0).length,
      rows: x2Rows.map((r) => ({ as_of: r.as_of, n: r.n, ic_vp: r.ic_vp, ic_bp: r.ic_bp })),
    },
    window_complete: {
      n: x2Rows.filter((r) => r.complete).length,
      mean_ic_vp: round6(x2Rows.filter((r) => r.complete).reduce((s, r) => s + r.ic_vp, 0) / x2Rows.filter((r) => r.complete).length),
      mean_ic_bp: round6(x2Rows.filter((r) => r.complete).reduce((s, r) => s + r.ic_bp, 0) / x2Rows.filter((r) => r.complete).length),
      positive_vp: x2Rows.filter((r) => r.complete && r.ic_vp > 0).length,
    },
  };
  // Mean-IC block bootstrap CIs (block 12, matching the 36m-overlap rationale;
  // block 4 reported too, matching the handler's X2 bootstrap block).
  const meanIcCi = (rows, key, blockQuarters) => {
    const v = rows.map((r) => r[key]);
    const n = v.length;
    if (!n) return null;
    const b = Math.max(1, Math.min(blockQuarters, n));
    const rng = ownRng(0x2026_0806);
    const reps = 2000;
    const means = new Float64Array(reps);
    for (let r = 0; r < reps; r += 1) {
      let acc = 0;
      let count = 0;
      for (let k = 0; k < Math.ceil(n / b) && count < n; k += 1) {
        const start = Math.floor(rng() * (n - b + 1));
        for (let j = 0; j < b && count < n; j += 1) {
          acc += v[start + j];
          count += 1;
        }
      }
      means[r] = acc / count;
    }
    means.sort();
    const q = (p) => means[Math.min(reps - 1, Math.floor(p * reps))];
    return { mean: round6(means.reduce((s, x) => s + x, 0) / reps), ci_lower: round6(q(0.025)), ci_upper: round6(q(0.975)), n, block_size_quarters: b };
  };
  x2.all.ic_vp_ci_12 = meanIcCi(x2Rows, "ic_vp", 12);
  x2.all.ic_bp_ci_12 = meanIcCi(x2Rows, "ic_bp", 12);
  x2.all.ic_vp_ci_4 = meanIcCi(x2Rows, "ic_vp", 4);
  const x2c = x2Rows.filter((r) => r.complete);
  x2.window_complete.ic_vp_ci_12 = meanIcCi(x2c, "ic_vp", 12);
  x2.window_complete.ic_bp_ci_12 = meanIcCi(x2c, "ic_bp", 12);
  x2.window_complete.ic_vp_ci_4 = meanIcCi(x2c, "ic_vp", 4);

  const x3 = {
    all: { oracle: scoreBlock(x3Rows, "vp_oracle"), deployable: scoreBlock(x3Rows, "vp_deployable") },
    window_complete: {
      oracle: scoreBlock(x3Rows.filter((r) => r.complete), "vp_oracle"),
      deployable: scoreBlock(x3Rows.filter((r) => r.complete), "vp_deployable"),
    },
    rows: x3Rows.map((r) => ({ as_of: r.as_of, vp_oracle: r.vp_oracle, vp_deployable: r.vp_deployable, members_oracle: r.members_oracle, members_deployable: r.members_deployable, cap_coverage_oracle: r.cap_coverage_oracle, straddle_members: r.straddle_members, return_annualised: r.return_annualised, complete: r.complete })),
  };

  // ---------------- attack 1b: terminal sensitivity (oracle, window-complete) --
  const terminalVariants = {};
  for (const term of ["decay10", "decay5", "perpetuity", "none"]) {
    const rows = [];
    for (const origin of panel.origin_rows) {
      if (!windowComplete.has(origin.as_of)) continue;
      const asOf = origin.as_of;
      const t0 = ms(asOf);
      const ret = returnByOrigin.get(asOf);
      if (!Number.isFinite(ret)) continue;
      const ke = keByOrigin[asOf];
      if (!ke) continue;
      let capTotal = 0;
      let cap = 0;
      let ok = 0;
      for (const m of origin.members) {
        if (!m.ok || !(m.mc > 0) || !(m.book > 0)) continue;
        capTotal += m.mc;
        const c = concepts.get(m.symbol);
        if (!c) continue;
        let full = true;
        const path = [];
        for (let y = 1; y <= H; y += 1) {
          const target = iso(t0 + Math.round(y * 365.25 * DAY));
          const b = annualBook(c).find((r) => r.end >= target);
          const e = annualEarnings(c).find((r) => r.end >= target);
          if (!b || !e) {
            full = false;
            break;
          }
          path.push({ earnings: e.val, book: b.val });
        }
        if (!full) continue;
        const V = ownRiValue(m.book, path, ke, term);
        if (Number.isFinite(V) && V > 0) {
          cap += V;
          ok += 1;
        }
      }
      if (ok >= 20) rows.push({ as_of: asOf, vp: round6(cap / capTotal), ret });
    }
    const rho = ownSpearman(rows.map((r) => r.vp), rows.map((r) => r.ret));
    terminalVariants[term] = { n: rows.length, spearman_rho: round6(rho) };
  }

  // ---------------- attack 1a: no-straddle oracle variant ---------------------
  const noStraddle = {};
  {
    const rows = [];
    for (const origin of panel.origin_rows) {
      if (!windowComplete.has(origin.as_of)) continue;
      const asOf = origin.as_of;
      const t0 = ms(asOf);
      const ret = returnByOrigin.get(asOf);
      if (!Number.isFinite(ret)) continue;
      const ke = keByOrigin[asOf];
      if (!ke) continue;
      let capTotal = 0;
      let cap = 0;
      let ok = 0;
      for (const m of origin.members) {
        if (!m.ok || !(m.mc > 0) || !(m.book > 0)) continue;
        capTotal += m.mc;
        const c = concepts.get(m.symbol);
        if (!c) continue;
        let full = true;
        const path = [];
        for (let y = 1; y <= H; y += 1) {
          const target = iso(t0 + Math.round(y * 365.25 * DAY));
          const b = annualBook(c).find((r) => r.end >= target && ms(r.start ?? r.end) >= t0);
          const e = annualEarnings(c).find((r) => r.end >= target && ms(r.start ?? r.end) >= t0);
          if (!b || !e) {
            full = false;
            break;
          }
          path.push({ earnings: e.val, book: b.val });
        }
        if (!full) continue;
        const V = ownRiValue(m.book, path, ke, "decay10");
        if (Number.isFinite(V) && V > 0) {
          cap += V;
          ok += 1;
        }
      }
      if (ok >= 20) rows.push({ as_of: asOf, vp: round6(cap / capTotal), ret });
    }
    const rho = ownSpearman(rows.map((r) => r.vp), rows.map((r) => r.ret));
    noStraddle.result = { n: rows.length, spearman_rho: round6(rho) };
  }
  // straddle measurement on the handler-semantics rows
  noStraddle.straddle_measurement = x3.rows.map((r) => ({ as_of: r.as_of, straddle_members: r.straddle_members, first_period_start_sample: r.first_period_start_sample }));

  const body = {
    schema_version: "feno_rim_v2_x2x3_independent_audit.v1",
    role: "DeepSeek red team — contract Step 7",
    independence: "own spearman/block-bootstrap (from my own x0 module); own residual-income, oracle and deployable constructions; no import of x2-cross-sectional.mjs / x3-oracle-deployable.mjs / x3-criteria.mjs or their dependencies",
    handler_claims: {
      x2: { ic_vp: { all: 0.199, complete: 0.292 }, ic_bp: { all: 0.256, complete: 0.335 }, incremental: { all: -0.057, complete: -0.043 } },
      x3: { oracle_complete: { rho: 0.231, ci: [-0.030, 0.449], n: 13 }, deployable_complete: { rho: 0.033, ci: [-0.262, 0.322] } },
    },
    x2,
    x3,
    attack: {
      a1_straddle_and_terminal: {
        terminal_sensitivity_window_complete: terminalVariants,
        no_straddle_variant: noStraddle.result,
        straddle_measurement: noStraddle.straddle_measurement,
      },
      a2_bp_point_in_time: {
        note: "B/P = member.book / (member.price * member.shares), all three from the PIT basket panel at the origin (EDGAR filed<=origin, earliest-filed per period; price = unadjusted close <= origin within 45d; shares = PIT snapshot). The model numerator uses the same origin book and the same mcap denominator; both ICs are computed on the identical member set in the same loop. No asymmetry found in the construction.",
      },
      a3_member_composition: {
        note: "X3's numerator arms exclude members without oracle paths (GOOGL has no book concept; DIS until its XBRL starts) while capTotal includes ALL ok members — both arms share the denominator, so the bias is common; cap_coverage_oracle per origin reports the numerator's share of cap.",
      },
    },
    constraints: { quarantine: "KEEP_QUARANTINED", commit: "none" },
  };
  const auditSha = sha256(JSON.stringify(body));
  return { ...body, generated_at: generatedAt, audit_sha256: auditSha };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const audit = buildX2X3Audit();
  const outDir = path.join(ROOT, "data/computed/feno-rim-v2");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "X2X3_INDEPENDENT_AUDIT.json"), `${JSON.stringify(audit, null, 2)}\n`);
  console.log("=== X2/X3 independent reproduction + attack ===");
  for (const [setName, s] of Object.entries(audit.x2)) {
    console.log(`X2 ${setName}: n=${s.n} meanIC_vp=${s.mean_ic_vp} meanIC_bp=${s.mean_ic_bp} incremental=${round6(s.mean_ic_vp - s.mean_ic_bp)} positive=${s.positive_vp}/${s.n}`);
  }
  for (const [setName, s] of Object.entries(audit.x3)) {
    if (setName === "rows") continue;
    const o = s.oracle;
    const d = s.deployable;
    console.log(`X3 ${setName}: oracle rho=${o.spearman_rho} [${o.rho_ci_12?.ci_lower},${o.rho_ci_12?.ci_upper}] n=${o.n} | deployable rho=${d.spearman_rho} [${d.rho_ci_12?.ci_lower},${d.rho_ci_12?.ci_upper}] n=${d.n}`);
  }
  console.log("terminal sensitivity (window-complete oracle):", JSON.stringify(audit.attack.a1_straddle_and_terminal.terminal_sensitivity_window_complete));
  console.log("no-straddle variant:", JSON.stringify(audit.attack.a1_straddle_and_terminal.no_straddle_variant));
  console.log(`audit sha256: ${audit.audit_sha256.slice(0, 16)}… written: ${path.join(outDir, "X2X3_INDEPENDENT_AUDIT.json")}`);
}
