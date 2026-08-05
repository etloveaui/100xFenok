// Contract for the shared valuation axis.
//
// The axis exists to make a disagreement visible. That is only honest if every
// reading on it was measured the same way, so the first thing this check proves
// is that the adapter IGNORES a producer's published percentage and re-derives
// it against the shared anchor. Yardeni's own `premium_pct` was computed against
// the close it read; using it would put two different questions on one axis.
//
// The rest is refusal behaviour. A cardinal axis with a missing anchor, a
// collapsed band, or an undated reading has to draw nothing rather than draw
// something plausible.

import fs from "node:fs";
import path from "node:path";

import {
  RIM_LENS,
  YARDENI_LENS,
  buildMethodologyAxis,
  type RimRowInput,
} from "../src/app/market-valuation/methodologyAxis";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const projection = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public/data/computed/fenok-rim/sustainable-index-ranges.public.json"),
  "utf8",
));
const yardeniDoc = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public/data/yardney/yardney_model.json"),
  "utf8",
));

const spxRow = projection.rows.find((row: { id: string }) => row.id === "SPX");
assert(spxRow, "the deployed projection must carry an SPX row");
const yardeniLatest = yardeniDoc.data[yardeniDoc.data.length - 1];

const rim: RimRowInput = {
  id: spxRow.id,
  label: spxRow.label,
  asOf: spxRow.as_of,
  currentPrice: spxRow.current_price,
  range: spxRow.range,
  confidence: spxRow.confidence,
};
const yardeni = { date: yardeniLatest.date, fairValue: yardeniLatest.fair_value };

// --- the re-derivation, which is the whole point --------------------------
const axis = buildMethodologyAxis({ rim, yardeni });
assert(axis !== null, "the real SPX payload must produce an axis");
assert(axis!.anchorPrice === spxRow.current_price, "the anchor is the RIM row's dated price");
assert(axis!.readings.length === 2, "SPX carries both methods");

const yardeniReading = axis!.readings.find((r) => r.lens === YARDENI_LENS)!;
const expected = yardeni.fairValue / spxRow.current_price - 1;
assert(near(yardeniReading.lowPct, expected), "Yardeni is re-derived against the shared anchor");
assert(yardeniReading.lowPct === yardeniReading.highPct, "a point reading has equal endpoints");

// The producer's own percentage was measured against a different close, so the
// adapter must NOT reproduce it. If these ever coincide the anchors coincided,
// and this assertion is the thing that tells us.
const publishedPct = yardeniLatest.premium_pct / 100;
assert(
  !near(yardeniReading.lowPct, -publishedPct, 1e-4),
  "the adapter must not reproduce the producer's own premium — it was measured against another price",
);

const rimReading = axis!.readings.find((r) => r.lens === RIM_LENS)!;
assert(near(rimReading.lowPct, spxRow.range.low / spxRow.current_price - 1), "RIM low re-derived");
assert(near(rimReading.highPct, spxRow.range.high / spxRow.current_price - 1), "RIM high re-derived");
assert(rimReading.lowPct < rimReading.highPct, "a band keeps both ends");

// --- disagreement is non-overlap, not distance between centres ------------
assert(axis!.disagrees === true, "SPX's two methods do not overlap today");
assert(axis!.spreadPp !== null && axis!.spreadPp > 0, "the spread is reported in percentage points");

const overlapping = buildMethodologyAxis({
  rim,
  // A fair value inside the band agrees with it, however far from its centre.
  yardeni: { date: yardeni.date, fairValue: (spxRow.range.low + spxRow.range.high) / 2 },
})!;
assert(overlapping.disagrees === false, "a point inside the band is agreement, not disagreement");

// --- refusals --------------------------------------------------------------
const refusals: Array<[string, () => unknown]> = [
  ["an absent anchor price", () => buildMethodologyAxis({ rim: { ...rim, currentPrice: null }, yardeni })],
  ["a zero anchor price", () => buildMethodologyAxis({ rim: { ...rim, currentPrice: 0 }, yardeni })],
  ["a negative anchor price", () => buildMethodologyAxis({ rim: { ...rim, currentPrice: -1 }, yardeni })],
  ["an impossible anchor date", () => buildMethodologyAxis({ rim: { ...rim, asOf: "2026-02-31" }, yardeni })],
];
for (const [label, run] of refusals) {
  assert(run() === null, `${label} must withhold the whole index`);
}

// A defective method is withheld with a reason; the other one still renders.
const collapsed = clone(rim);
collapsed.range = { low: spxRow.range.low, high: spxRow.range.low };
const withCollapsedBand = buildMethodologyAxis({ rim: collapsed, yardeni })!;
assert(withCollapsedBand.readings.length === 1, "a collapsed band drops one reading, not the axis");
assert(
  withCollapsedBand.withheld.some((w) => w.lens === RIM_LENS && w.reason.length > 0),
  "a withheld method states why",
);
assert(withCollapsedBand.spreadPp === null, "one reading has no spread");
assert(withCollapsedBand.disagrees === false, "one reading cannot disagree with itself");

for (const [label, bad] of [
  ["a missing fair value", { date: yardeni.date, fairValue: Number.NaN }],
  ["a zero fair value", { date: yardeni.date, fairValue: 0 }],
  ["an impossible date", { date: "2026-02-31", fairValue: yardeni.fairValue }],
] as Array<[string, { date: string; fairValue: number }]>) {
  const result = buildMethodologyAxis({ rim, yardeni: bad })!;
  assert(
    !result.readings.some((r) => r.lens === YARDENI_LENS),
    `${label} must withhold that method`,
  );
  assert(result.withheld.some((w) => w.lens === YARDENI_LENS), `${label} must record the reason`);
  assert(result.readings.length === 1, `${label} leaves the other method readable`);
}

// An index with no Yardeni coverage is a one-reading axis, not a refusal.
const kospiRow = projection.rows.find((row: { id: string }) => row.id === "KOSPI");
if (kospiRow) {
  const kospi = buildMethodologyAxis({
    rim: {
      id: kospiRow.id, label: kospiRow.label, asOf: kospiRow.as_of,
      currentPrice: kospiRow.current_price, range: kospiRow.range, confidence: kospiRow.confidence,
    },
  })!;
  assert(kospi.readings.length === 1, "an index Yardeni does not cover still draws its own band");
  assert(kospi.withheld.length === 0, "a method that was never offered is not 'withheld'");
}

// --- no single target anywhere in the output ------------------------------
const serialised = JSON.stringify(axis);
for (const forbidden of ["midpoint", "mid", "target", "fair_value", "point_estimate", "average"]) {
  assert(!serialised.includes(`"${forbidden}"`), `the axis must not expose '${forbidden}'`);
}

process.stdout.write("check-methodology-axis-contract: ok\n");
