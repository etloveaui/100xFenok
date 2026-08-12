// Contract for the benchmark ordinal layer.
//
// The layer's whole job is "where does each index sit in its OWN history",
// read so it can carry verdict weight where cardinal methods disagree. Two
// things therefore have to be proven here and not trusted anywhere else:
//
// 1. The percentile follows the page convention (strict below / length,
//    rounded) — one convention per surface, never the deleted lab's copy.
// 2. Every as-of date is a ROW date. The producers' envelope stamps
//    (`metadata.version` / `metadata.generated`) already disagree with the
//    newest observations, so a badge keyed on them would print the wrong
//    day. This check feeds fake envelope stamps and demands row dates back.

import fs from "node:fs";
import path from "node:path";

import {
  BENCHMARK_ORDINAL_MIN_HISTORY,
  percentileRank,
  readBenchmarkOrdinals,
  zScorePopulation,
  type BenchmarkGroupId,
} from "../src/lib/market-valuation/benchmarkOrdinals";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

// --- metric primitives -------------------------------------------------------

// Page convention: strict below / length × 100, rounded.
assert(percentileRank([10, 20, 30], 30) === 67, "percentile of the max of 3 rows must be 67 (round(2/3·100))");
assert(percentileRank([10, 20, 30], 10) === 0, "percentile of the min must be 0");
assert(percentileRank([10, 20, 30], 20) === 33, "percentile must count strictly-below values");
assert(percentileRank([], 5) === null, "percentile over an empty series must be null");
assert(percentileRank([10, 20, 30], null) === null, "percentile of a null current must be null");

const z = zScorePopulation([10, 20, 30], 30);
assert(z !== null && near(z, 10 / Math.sqrt(200 / 3)), "z-score must use the population std");
assert(zScorePopulation([5, 5, 5], 5) === null, "z-score must be null when the history has no spread");

// --- fixtures ------------------------------------------------------------------

interface FixtureRow { date: string; px_last: number; best_eps: number; best_pe_ratio: number; px_to_book_ratio: number; roe: number }

function rows(dates: string[], peStart: number, peStep: number): FixtureRow[] {
  return dates.map((date, i) => ({
    date,
    px_last: 1000 + i,
    best_eps: 50,
    best_pe_ratio: peStart + peStep * i,
    px_to_book_ratio: 2 + i * 0.01,
    roe: 0.15 + i * 0.001,
  }));
}

function weeklyDates(count: number, end = "2026-01-30"): string[] {
  const [y, m, d] = end.split("-").map(Number);
  const endMs = Date.UTC(y, m - 1, d);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    out.push(new Date(endMs - i * 7 * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

// Fake envelope stamps that MUST never reach a badge.
const FAKE_METADATA = { version: "2020-12-31", generated: "2021-01-01T00:00:00", update_frequency: "weekly" };

function payload(sections: Record<string, { name?: string; name_en?: string; data: FixtureRow[] }>) {
  return { metadata: FAKE_METADATA, sections };
}

const longDates = weeklyDates(BENCHMARK_ORDINAL_MIN_HISTORY + 10);

// --- row-dated clocks -----------------------------------------------------------

const usFixture = payload({
  sp500: { name: "S&P 500", name_en: "Sp500", data: rows(longDates, 15, 0.1) },
  nasdaq100: { name: "NASDAQ 100", name_en: "Ndx", data: rows(longDates.slice(0, -1), 18, 0.1) },
});

const single = readBenchmarkOrdinals({ us: usFixture });
assert(single.status === "ready", "a well-formed us payload must be ready");
if (single.status !== "ready") throw new Error("unreachable");

const spx = single.groups.find((g) => g.id === "us")?.rows.find((r) => r.id === "sp500");
assert(spx !== undefined, "sp500 row must exist");
assert(spx!.asOf === longDates[longDates.length - 1], "row asOf must be the last ROW date, not the envelope version/generated");
assert(spx!.asOf !== FAKE_METADATA.version && spx!.asOf !== "2021-01-01", "envelope stamps must never surface as as-of");
assert(spx!.spxPremium === null, "the sp500 row itself must carry no premium");
assert(spx!.points === longDates.length, "points must count the section's rows");

const usGroup = single.groups.find((g) => g.id === "us");
assert(usGroup !== null && usGroup!.asOf === longDates[longDates.length - 2], "group asOf must be the MIN of its sections' last-row dates");

// Percentile sanity on a known ramp: latest PE is the max of 62 values → round(61/62·100).
assert(spx!.pe.percentile === Math.round(((longDates.length - 1) / longDates.length) * 100), "percentile must rank the current PE within the section's own history");
assert(spx!.pe.zScore !== null && spx!.pe.zScore > 0, "a record-high PE must carry a positive z-score");
assert(spx!.earningsYield !== null && near(spx!.earningsYield, 1 / spx!.pe.current!), "earnings yield must be 1/PE");

// --- sector premium: same-date SPX base or nothing --------------------------------

const sectorDates = longDates;
const sectorFixture = payload({
  energy: { name: "Energy", data: rows(sectorDates, 12, 0.1) },
  late_sector: { name: "Late", data: rows([...sectorDates, "2026-02-06"], 12, 0.1) },
});

const withSectors = readBenchmarkOrdinals({ us: usFixture, us_sectors: sectorFixture });
assert(withSectors.status === "ready", "us + us_sectors must be ready");
if (withSectors.status !== "ready") throw new Error("unreachable");
const sectorGroupReady = withSectors.groups.find((g) => g.id === "us_sectors");
const energy = sectorGroupReady?.rows.find((r) => r.id === "energy");
const lateSector = sectorGroupReady?.rows.find((r) => r.id === "late_sector");
assert(energy !== undefined && lateSector !== undefined, "sector rows must exist");

const expectedBasePe = 15 + 0.1 * (longDates.length - 1);
const expectedEnergyPe = 12 + 0.1 * (sectorDates.length - 1);
assert(energy!.spxPremium !== null && near(energy!.spxPremium, expectedEnergyPe / expectedBasePe - 1), "sector premium must be sector PE / same-date SPX PE − 1");
assert(lateSector!.spxPremium === null, "a sector row whose date has no SPX observation must get null, never a guess");

// --- refusal behaviour -------------------------------------------------------------

const empty = readBenchmarkOrdinals({});
assert(empty.status === "refused" && empty.reason === "payload_absent", "no payloads at all must refuse with payload_absent");

const hollow = readBenchmarkOrdinals({ us: { metadata: FAKE_METADATA, sections: {} } });
assert(hollow.status === "refused" && hollow.reason === "no_publishable_row", "a sections-less-of-rows payload must refuse, not render empty groups as ready");

const partial = readBenchmarkOrdinals({ us: null, emerging: payload({ kospi: { name: "KOSPI", data: rows(longDates, 9, 0.05) } }) });
assert(partial.status === "ready", "one broken source must not blank the others");
if (partial.status !== "ready") throw new Error("unreachable");
const usRefused = partial.groups.find((g) => g.id === "us");
assert(usRefused?.refusal === "payload_absent" && usRefused.rows.length === 0, "the broken group must say why it refused");
const kospi = partial.groups.find((g) => g.id === "emerging")?.rows.find((r) => r.id === "kospi");
assert(kospi !== undefined && kospi!.asOf === longDates[longDates.length - 1], "the surviving group must carry row dates");

// --- history guard and malformed clocks ----------------------------------------------

const shortFixture = payload({ tiny: { name: "Tiny", data: rows(weeklyDates(10), 10, 0.1) } });
const shortView = readBenchmarkOrdinals({ developed: shortFixture });
assert(shortView.status === "ready", "a short history is publishable");
if (shortView.status !== "ready") throw new Error("unreachable");
const tiny = shortView.groups.find((g) => g.id === "developed")?.rows.find((r) => r.id === "tiny");
assert(tiny !== undefined, "short section must render");
assert(tiny!.pe.current !== null, "short history keeps the current value");
assert(tiny!.pe.percentile === null && tiny!.pe.zScore === null, `histories under ${BENCHMARK_ORDINAL_MIN_HISTORY} rows must not rank`);

const badClockFixture = payload({
  badclock: {
    name: "Bad clock",
    data: [
      ...rows(longDates.slice(0, -1), 10, 0.1),
      { date: "2026-02-31", px_last: 1, best_eps: 1, best_pe_ratio: 99, px_to_book_ratio: 1, roe: 0.1 },
    ],
  },
});
const badClockView = readBenchmarkOrdinals({ msci: badClockFixture });
assert(badClockView.status === "ready", "a malformed trailing date must not refuse the section");
if (badClockView.status !== "ready") throw new Error("unreachable");
const badClock = badClockView.groups.find((g) => g.id === "msci")?.rows.find((r) => r.id === "badclock");
assert(badClock?.asOf === longDates[longDates.length - 2], "an impossible calendar day must never become the as-of");

// --- trailing windows: boundary, truncation refusal, definition ----------------

// A ~6y weekly series: 3y/5y windows must rank, the 10y window must be REFUSED
// (data cannot span it) and state the ACTUAL span instead of a number.
const sixYDates = weeklyDates(6 * 52 + 1);
const sixYFixture = payload({ sp500: { name: "S&P 500", data: rows(sixYDates, 15, 0.1) } });
const sixYView = readBenchmarkOrdinals({ us: sixYFixture });
assert(sixYView.status === "ready", "6y fixture must be ready");
if (sixYView.status !== "ready") throw new Error("unreachable");
const sixYRow = sixYView.groups.find((g) => g.id === "us")?.rows.find((r) => r.id === "sp500");
assert(sixYRow !== undefined, "6y fixture must yield a row");
const w6 = sixYRow!.pe.windows;
// Ramp: PE strictly increasing; current = last (the max). Window percentiles
// must use the SAME strict-below definition as all-history.
assert(w6.w3.percentile !== null, "3y window must rank on a 6y series");
assert(w6.w5.percentile !== null, "5y window must rank on a 6y series");
assert(
  w6.w3.percentile === Math.round(((3 * 52) / (3 * 52 + 1)) * 100),
  "3y window percentile must count strictly-below values inside the window only",
);
assert(w6.w10.truncated === true, "10y window on a 6y series must be refused (truncated)");
assert(w6.w10.percentile === null, "a refused window must never print a percentile");
assert(w6.w10.spanYears !== null && w6.w10.spanYears < 10 && w6.w10.spanYears >= 5.9, `refused window must state the actual span (~6y), got ${w6.w10.spanYears}`);

// A full ~10y weekly series: the 10y window must rank (not truncated).
const tenYDates = weeklyDates(10 * 52 + 6);
const tenYFixture = payload({ sp500: { name: "S&P 500", data: rows(tenYDates, 15, 0.1) } });
const tenYView = readBenchmarkOrdinals({ us: tenYFixture });
assert(tenYView.status === "ready", "10y fixture must be ready");
if (tenYView.status !== "ready") throw new Error("unreachable");
const tenYRow = tenYView.groups.find((g) => g.id === "us")?.rows.find((r) => r.id === "sp500");
assert(tenYRow !== undefined, "10y fixture must yield a row");
const w10 = tenYRow!.pe.windows;
assert(w10.w10.truncated === false, "a full 10y series must NOT be refused");
assert(w10.w10.percentile !== null, "a full 10y series must rank its 10y window");
assert(w10.w10.spanYears === 10, "a non-refused window reports its requested length");
assert(
  w10.w10.percentile === Math.round(((10 * 52 + 5) / (10 * 52 + 6)) * 100),
  "10y window percentile must count strictly-below values inside the window",
);

// Boundary: a series ending exactly one weekly step short of the window start
// must refuse; a series with one extra early row must not. The refusal is
// derived from the DATA (earliest dated row vs window start), never a list.
const boundaryShort = readBenchmarkOrdinals({ us: payload({ sp500: { data: rows(weeklyDates(10 * 52), 15, 0.1) } }) });
if (boundaryShort.status === "ready") {
  const r = boundaryShort.groups.find((g) => g.id === "us")?.rows.find((x) => x.id === "sp500");
  assert(r?.pe.windows.w10.truncated === true, "a series short of the 10y start by one weekly step must refuse the 10y window");
}
const boundaryLong = readBenchmarkOrdinals({ us: payload({ sp500: { data: rows(weeklyDates(10 * 52 + 8), 15, 0.1) } }) });
if (boundaryLong.status === "ready") {
  const r = boundaryLong.groups.find((g) => g.id === "us")?.rows.find((x) => x.id === "sp500");
  assert(r?.pe.windows.w10.truncated === false, "a series reaching past the 10y start must not refuse the 10y window");
}

// Determinism: identical inputs must produce an identical view.
const detA = readBenchmarkOrdinals({ us: usFixture, emerging: payload({ kospi: { name: "KOSPI", data: rows(longDates, 9, 0.05) } }) });
const detB = readBenchmarkOrdinals({ us: usFixture, emerging: payload({ kospi: { name: "KOSPI", data: rows(longDates, 9, 0.05) } }) });
assert(JSON.stringify(detA) === JSON.stringify(detB), "readBenchmarkOrdinals must be deterministic");

// --- live structural invariants (no exact values: the estate refreshes weekly) ---------

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const liveUs = JSON.parse(fs.readFileSync(path.join(ROOT, "../data/benchmarks/us.json"), "utf8")) as {
  sections?: Record<string, { data?: Array<{ date?: string; best_pe_ratio?: number }> }>;
};
const liveView = readBenchmarkOrdinals({ us: liveUs as Partial<Record<BenchmarkGroupId, unknown>>["us"] });
assert(liveView.status === "ready", "the live us.json must read as ready");
if (liveView.status !== "ready") throw new Error("unreachable");
const liveUsGroup = liveView.groups.find((g) => g.id === "us");
assert(liveUsGroup !== undefined && liveUsGroup.rows.length === 4, "live us.json must yield exactly 4 index rows");
for (const row of liveUsGroup?.rows ?? []) {
  const fileRows = liveUs.sections?.[row.id]?.data ?? [];
  const lastDated = [...fileRows].reverse().find((r) => typeof r.date === "string");
  assert(row.asOf === lastDated?.date, `live ${row.id}: badge date must equal the file's last row date`);
  for (const metric of [row.pe, row.pb, row.roe]) {
    if (metric.percentile !== null) {
      assert(metric.percentile >= 0 && metric.percentile <= 100, "live percentiles must stay within 0–100");
    }
  }
  assert(row.spxPremium === null, "live us rows carry no sector premium");
}

// --- live window invariants across ALL six benchmark files (data-derived) -------------

const LIVE_BENCH_FILES = [
  "../data/benchmarks/us.json",
  "../data/benchmarks/us_sectors.json",
  "../data/benchmarks/developed.json",
  "../data/benchmarks/emerging.json",
  "../data/benchmarks/msci.json",
  "../data/benchmarks/micro_sectors.json",
] as const;
const livePayloads: Partial<Record<BenchmarkGroupId, unknown>> = {};
for (const file of LIVE_BENCH_FILES) {
  livePayloads[file.split("/").pop()!.replace(".json", "") as BenchmarkGroupId] = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}
const liveAllView = readBenchmarkOrdinals(livePayloads);
assert(liveAllView.status === "ready", "all six live benchmark files must read as ready");
if (liveAllView.status !== "ready") throw new Error("unreachable");

const liveRows = liveAllView.groups.flatMap((g) => g.rows);
assert(liveRows.length === 38, `live benchmark estate must yield 38 index rows, got ${liveRows.length}`);
const shortAt10y = liveRows
  .filter((r) => r.pe.windows.w10.truncated)
  .map((r) => ({ id: r.id, spanYears: r.pe.windows.w10.spanYears }));
const expectedShort = ["hang_seng_tech", "real_estate", "us_regional_banks", "과창판_(star50_index)"];
assert(
  shortAt10y.map((s) => s.id).sort().join("|") === [...expectedShort].sort().join("|"),
  `live 10y-truncated set must be exactly the four short sections, got ${JSON.stringify(shortAt10y)}`,
);
for (const row of liveRows) {
  const w10m = row.pe.windows.w10;
  if (w10m.truncated) {
    assert(w10m.percentile === null, `live ${row.id}: a refused 10y window must not print a percentile`);
    assert(w10m.spanYears !== null && w10m.spanYears < 10, `live ${row.id}: a refused window must state a span under 10y`);
  } else {
    assert(w10m.spanYears === 10, `live ${row.id}: a non-refused 10y window must report 10y`);
  }
  for (const id of ["w3", "w5", "w10"] as const) {
    const p = row.pe.windows[id].percentile;
    if (p !== null) assert(p >= 0 && p <= 100, `live ${row.id} ${id}: percentile must stay within 0–100`);
  }
}

// A displayed multiple must be CURRENT. us_biotech's forward PE last computed
// on 2011-03-18 because the sector's forward EPS is now negative, and the panel
// printed that 2011 value as today's. A stale number is worse than an absent
// one: the reader cannot tell it is stale.
const bio = liveRows.find((r) => r.id === "us_biotech");
assert(bio !== undefined, "live estate must still contain us_biotech");
assert(
  bio!.pe.current === null,
  "us_biotech must not display a multiple: its forward EPS is negative and the last computable value is from 2011",
);
assert(
  bio!.pe.currentStaleDays !== null && bio!.pe.currentStaleDays > 365,
  "a withheld current value must report how stale the last computable one was",
);
const staleShown = liveRows.filter(
  (r) => r.pe.current !== null && r.pe.currentStaleDays !== null && r.pe.currentStaleDays > 45,
);
assert(
  staleShown.length === 0,
  `no index may display a multiple older than 45 days, got ${JSON.stringify(staleShown.map((r) => [r.id, r.pe.currentStaleDays]))}`,
);
const showing = liveRows.filter((r) => r.pe.current !== null).length;
assert(showing === 37, `exactly 37 of 38 indices should display a multiple today, got ${showing}`);

console.log("benchmark ordinals contract: ok");
