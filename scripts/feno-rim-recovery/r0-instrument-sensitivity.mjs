// R0 instrument-sensitivity addendum (disclosure only).
// NOT a re-freeze and NOT a verdict change: the v2 verdict mapping (r0-criteria-v2.json,
// c94a4ffb01) is unchanged. This script demonstrates whether the frozen verdict
// (R0_INCONCLUSIVE) is invariant to the interval instrument, after red-team task 2
// (fh-20260807-019-cc-0ea2c035) retracted the ESS-primary recommendation and required the
// verdict to survive ALL reported lags. Inputs are the frozen v2 artifacts only.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const r6 = (x) => Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null;
const SEED = 20260807;

function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const q = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - q : q; }
function nw(v, lag) { const T = v.length, m = v.reduce((a, x) => a + x, 0) / T, x = v.map(a => a - m);
  let g = 0; for (let i = 0; i < T; i++) for (let j = 0; j < T; j++) {
    const d = Math.abs(i - j); if (d <= lag) g += (1 - d / (lag + 1)) * x[i] * x[j]; }
  const se = Math.sqrt(Math.max(g / (T * T), 0));
  if (!(se > 0)) return { lag, t: null, p: null };
  const t = m / se; return { lag, mean: r6(m), t: r6(t), p: r6(2 * (1 - normCdf(Math.abs(t)))) }; }
function acf1(v) { const T = v.length, m = v.reduce((a, x) => a + x, 0) / T;
  let num = 0, den = 0; for (let i = 0; i < T; i++) den += (v[i] - m) ** 2;
  for (let i = 1; i < T; i++) num += (v[i] - m) * (v[i - 1] - m);
  return den ? num / den : 0; }
function essDiag(v) { const T = v.length, rho = acf1(v);
  const raw = T * (1 - rho) / (1 + rho);
  return { rho1: r6(rho), ess_raw: r6(raw), ess_capped_at_T: r6(Math.min(T, Math.max(3, raw))),
    inflation_note: raw > T ? "negative acf inflates ESS above sample size - ESS is diagnostic only (red-team retraction)" : undefined }; }
function makeRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function mbb(v, block, seed, reps = 10000) { if (v.length < 4) return null; const rnd = makeRng(seed);
  const d = []; for (let r = 0; r < reps; r++) { const b = []; while (b.length < v.length) { const st = Math.floor(rnd() * v.length);
    for (let k = 0; k < block && b.length < v.length; k++) b.push(v[(st + k) % v.length]); }
    d.push(b.reduce((a, x) => a + x, 0) / b.length); }
  d.sort((a, b) => a - b);
  return { block, ci_lower: r6(d[Math.floor(d.length * 0.025)]), ci_upper: r6(d[Math.floor(d.length * 0.975)]), independent_blocks: Math.floor(v.length / block) }; }
// non-overlapping phases: every 12th origin (12-quarter horizon), 12 phases
function phases(v) { const out = [];
  for (let p = 0; p < 12; p++) { const s = []; for (let i = p; i < v.length; i += 12) s.push(v[i]);
    if (s.length) out.push({ phase: p, n: s.length, mean: r6(s.reduce((a, x) => a + x, 0) / s.length) }); }
  const means = out.map(x => x.mean);
  const m = means.reduce((a, x) => a + x, 0) / means.length;
  return { phases: out, mean_of_phase_means: r6(m), sd_of_phase_means: r6(Math.sqrt(means.reduce((a, x) => a + (x - m) ** 2, 0) / (means.length - 1))) }; }

const adj = rj("data/computed/feno-rim-recovery/R0_ADJUDICATION_V2.json");
const series = {
  r0a_D: { all_origins: adj.r0a_paired_ic_difference.all_origins.series_D, window_complete: adj.r0a_paired_ic_difference.window_complete.series_D },
  r0b_partial: { all_origins: adj.r0b_partial_correlation.all_origins.primary_partial_correlation.per_origin.map(x => x.partial_ic),
    window_complete: adj.r0b_partial_correlation.window_complete.primary_partial_correlation.per_origin.map(x => x.partial_ic) },
  r0b_regressor_only: { all_origins: adj.r0b_partial_correlation.all_origins.sensitivity_regressor_only.per_origin.map(x => x.resid_ic),
    window_complete: adj.r0b_partial_correlation.window_complete.sensitivity_regressor_only.per_origin.map(x => x.resid_ic) },
  r0c_b2_M1: { all_origins: adj.r0c_fama_macbeth.all_origins.model1.series_b2.map(x => x.b2), window_complete: adj.r0c_fama_macbeth.window_complete.model1.series_b2.map(x => x.b2) },
  r0c_b2_M2: { all_origins: adj.r0c_fama_macbeth.all_origins.model2.series_b2.map(x => x.b2), window_complete: adj.r0c_fama_macbeth.window_complete.model2.series_b2.map(x => x.b2) },
  r0d_S: { all_origins: adj.r0d_stratified_permutation.all_origins.per_origin.filter(x => x.S !== null).map(x => x.S),
    window_complete: adj.r0d_stratified_permutation.window_complete.per_origin.filter(x => x.S !== null).map(x => x.S) }
};

const out = { schema_version: "feno_rim_recovery_r0_instrument_sensitivity.v1",
  purpose: "Disclosure addendum after red-team task 2 ESS retraction. Verdict mapping unchanged; shows whether R0_INCONCLUSIVE survives every instrument.",
  v2_frozen_verdict: adj.verdict.label,
  instruments_per_series: {},
  generated_at: new Date().toISOString() };

const survivors = [];
for (const [name, sets] of Object.entries(series)) {
  out.instruments_per_series[name] = {};
  for (const [set, v] of Object.entries(sets)) {
    const lags = [2, 4, 8, 11].map(l => nw(v, l));
    const blocks = { b4: mbb(v, 4, SEED), b8: mbb(v, 8, SEED), b12: mbb(v, 12, SEED) };
    const ess = essDiag(v);
    const exclPos = (ci) => ci.ci_lower > 0, exclNeg = (ci) => ci.ci_upper < 0;
    const sigPosAllLags = lags.every(x => x.p !== null && x.p <= 0.05 && x.mean > 0);
    const sigNegAllLags = lags.every(x => x.p !== null && x.p <= 0.05 && x.mean < 0);
    out.instruments_per_series[name][set] = { T: v.length, nw_lags: lags, block_ci: blocks, ess_diagnostic: ess,
      survives_all_lags_positive: sigPosAllLags, survives_all_lags_negative: sigNegAllLags,
      block4_excludes_zero_positive: exclPos(blocks.b4), block4_excludes_zero_negative: exclNeg(blocks.b4),
      non_overlapping_12q_phases: phases(v) };
    if (name === "r0c_b2_M1") survivors.push({ set, sigPosAllLags, sigNegAllLags, lag_p: lags.map(x => x.p) }); } }

// verdict-invariance statement under the red-team's all-lags rule
const anyLegSurvives = Object.values(out.instruments_per_series).some(s =>
  Object.values(s).some(x => x.survives_all_lags_positive || x.survives_all_lags_negative));
out.verdict_invariance = {
  red_team_rule: "verdict must survive ALL reported lags (2/4/8/11) plus block battery; no single instrument decides a leg; ESS capped at T and diagnostic only",
  any_leg_significant_at_all_lags: anyLegSurvives,
  consequence: anyLegSurvives
    ? "a leg survives every instrument - revisit the frozen mapping in a future amendment"
    : "no leg survives every instrument: POSITIVE and NEGATIVE both fail under the strictest rule, ZERO unreachable, so the frozen verdict stays R0_INCONCLUSIVE regardless of instrument choice",
  note: "v2's own primary instruments (ESS CI + NW lag 11) also returned R0_INCONCLUSIVE via the set-disagreement rule. The two instrument philosophies converge on the same verdict." };

fs.writeFileSync(path.join(ROOT, "data/computed/feno-rim-recovery/R0_INSTRUMENT_SENSITIVITY.json"), JSON.stringify(out, null, 2) + "\n");
console.log("instrument sensitivity written.");
for (const s of survivors) console.log("M1 b2", s.set, "p by lag:", s.lag_p.join("/"), "survivesAllLags:", s.sigPosAllLags);
console.log("any leg survives all lags:", anyLegSurvives, "=>", out.verdict_invariance.consequence);
