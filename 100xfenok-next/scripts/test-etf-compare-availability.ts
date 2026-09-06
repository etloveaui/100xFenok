import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompareCsv,
  overlapFor,
  type EtfCompareRow,
  type EtfHolding,
  type PairOverlap,
} from "../src/app/etfs/compare/etfCompareOverlap";

type ExpectedPairOverlap = Omit<PairOverlap, "overlapWeight"> & {
  overlapWeight: number | null;
  availability: "ready" | "unavailable";
};

// The availability field is intentionally asserted through this test-only contract.
// The baseline PairOverlap does not expose it yet; keeping the cast here makes the
// RED result a behavioral assertion instead of a type/module compilation failure.
function expectedPair(pair: PairOverlap): ExpectedPairOverlap {
  return pair as unknown as ExpectedPairOverlap;
}

function row(ticker: string, holdings: EtfHolding[] = [], overrides: Partial<EtfCompareRow> = {}): EtfCompareRow {
  return {
    ticker,
    failed: false,
    data: {
      ticker,
      normalized: { holdings },
    },
    ...overrides,
  };
}

const validComparator = row("READY", [{ symbol: "MSFT", name: "Microsoft Corp", weight_pct: 4 }]);

test("null, failed, missing and unusable holding evidence is unavailable with null overlap", () => {
  const cases: Array<[string, EtfCompareRow]> = [
    ["null payload", row("NULL", [], { data: null })],
    ["failed payload", row("FAILED", [{ symbol: "MSFT", weight_pct: 5 }], { failed: true })],
    ["missing holdings", {
      ticker: "MISSING",
      failed: false,
      data: { ticker: "MISSING", normalized: {} },
    }],
    ["invalid weights", row("INVALID", [
      { symbol: "NAN", weight_pct: Number.NaN },
      { symbol: "TEXT", weight_pct: "not-a-number" as unknown as number },
      { symbol: "NEGATIVE", weight_pct: -1 },
    ])],
  ];

  for (const [label, candidate] of cases) {
    const pair = expectedPair(overlapFor(candidate, validComparator));
    assert.equal(pair.availability, "unavailable", label);
    assert.equal(pair.overlapWeight, null, label);
    assert.deepEqual(pair.common, [], label);
  }
});

test("two valid nonempty disjoint holdings are ready with a real zero overlap", () => {
  const pair = expectedPair(overlapFor(
    row("LEFT", [{ symbol: "AAPL", name: "Apple Inc", weight_pct: 6.8 }]),
    row("RIGHT", [{ symbol: "MSFT", name: "Microsoft Corp", weight_pct: 6.4 }]),
  ));

  assert.equal(pair.availability, "ready");
  assert.equal(pair.overlapWeight, 0);
  assert.deepEqual(pair.common, []);
});

test("valid overlap sums minimum weights within the top-25 holding window", () => {
  const left = row("LEFT", [
    { symbol: "NVDA", name: "NVIDIA Corp", weight_pct: 7.8 },
    { symbol: "AAPL", name: "Apple Inc", weight_pct: 6.8 },
    ...Array.from({ length: 23 }, (_, index) => ({
      symbol: `L${String(index).padStart(2, "0")}`,
      name: `Left holding ${index}`,
      weight_pct: 1,
    })),
    { symbol: "LATE", name: "Shared after top 25", weight_pct: 99 },
  ]);
  const right = row("RIGHT", [
    { symbol: "NVDA", name: "NVIDIA Corp", weight_pct: 7.2 },
    { symbol: "AAPL", name: "Apple Inc", weight_pct: 8.1 },
    ...Array.from({ length: 23 }, (_, index) => ({
      symbol: `R${String(index).padStart(2, "0")}`,
      name: `Right holding ${index}`,
      weight_pct: 1,
    })),
    { symbol: "LATE", name: "Shared after top 25", weight_pct: 99 },
  ]);

  const pair = expectedPair(overlapFor(left, right));
  assert.equal(pair.availability, "ready");
  assert.equal(pair.overlapWeight, 14);
  assert.deepEqual(pair.common.map((item) => item.symbol), ["NVDA", "AAPL"]);
  assert.deepEqual(pair.common.map((item) => item.minWeight), [7.2, 6.8]);
});

test("CSV marks unavailable pairs without exporting numeric zero", () => {
  const unavailable = expectedPair(overlapFor(
    row("MISSING", [], { data: null }),
    validComparator,
  ));
  const readyZero = expectedPair(overlapFor(
    row("LEFT", [{ symbol: "AAPL", name: "Apple Inc", weight_pct: 6.8 }]),
    validComparator,
  ));
  const csv = buildCompareCsv(
    [unavailable.left, unavailable.right, readyZero.left, readyZero.right],
    [unavailable, readyZero],
  );
  const lines = csv.split("\n");
  const header = lines[0]?.split(",") ?? [];
  const overlapWeightIndex = header.indexOf("overlap_weight_pct");
  const unavailableLine = lines.find((line) => /(?:^|,)unavailable(?:,|$)/.test(line));
  const readyZeroLine = lines.find((line) => /(?:^|,)ready(?:,|$)/.test(line));

  assert.ok(unavailableLine, "CSV must preserve the unavailable state for the pair");
  assert.notEqual(overlapWeightIndex, -1, "CSV must retain the overlap weight column");
  assert.equal(unavailableLine?.split(",")[overlapWeightIndex], "");
  assert.doesNotMatch(unavailableLine ?? "", /(?:^|,)0(?:,|$)/);
  assert.ok(readyZeroLine, "CSV must retain a ready zero-overlap pair summary");
  assert.equal(readyZeroLine?.split(",")[overlapWeightIndex], "0");
});
