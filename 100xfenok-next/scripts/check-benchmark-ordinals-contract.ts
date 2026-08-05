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

// --- live structural invariants (no exact values: the estate refreshes weekly) ---------

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const liveUs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/benchmarks/us.json"), "utf8")) as {
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

console.log("benchmark ordinals contract: ok");
