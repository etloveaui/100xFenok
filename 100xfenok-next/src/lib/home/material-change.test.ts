import assert from "node:assert/strict";
import { projectMaterialChanges } from "./material-change";

const revisions = {
  generated_at: "2026-08-16T12:00:00.000Z",
  up: [
    { ticker: "$AAPL", name: "Apple", change_1w: 0.4, as_of: "2026-08-14" },
    { ticker: "MSFT", name: "Microsoft", change_1w: 0.3, as_of: "2026-08-14" },
    { ticker: "IBM", name: "IBM", change_1w: 0.2, as_of: "2026-08-14" },
  ],
  down: [
    { ticker: "NVDA", name: "NVIDIA", change_1w: -0.4, as_of: "2026-08-14" },
    { ticker: "AMD", name: "AMD", change_1w: -0.2, as_of: "2026-08-14" },
    { ticker: "TSLA", name: "Tesla", change_1w: -0.1, as_of: "2026-08-14" },
  ],
};

const superinvestors = {
  metadata: { quarter: "2026-Q2", generated_at: "2026-08-16T16:00:00.000Z" },
  bought: [
    { ticker: "GOOGL", name: "Alphabet", amount: 100, investors_count: 4, new_count: 2 },
    { ticker: "META", name: "Meta", amount: 80, investors_count: 3, new_count: 0 },
  ],
  sold: [{ ticker: "BAC", name: "Bank of America", amount: 120, investors_count: 5 }],
};

function test(name: string, run: () => void): void {
  run();
  console.log(`ok - ${name}`);
}

function main(): void {
  test("keeps the Home mix and deterministic cap/order", () => {
    const result = projectMaterialChanges(revisions, superinvestors);
    assert.deepEqual(
      result.changed.map(({ kind, ticker }) => `${kind}:${ticker}`),
      [
        "up:AAPL",
        "up:MSFT",
        "down:NVDA",
        "down:AMD",
        "buy:GOOGL",
        "sell:BAC",
        "new-position:GOOGL",
      ],
    );
    assert.equal(result.changed.length, 7);
  });

  test("keeps raw superinvestor selection deterministic when rows are reordered", () => {
    const reordered = {
      ...superinvestors,
      bought: [...superinvestors.bought].reverse(),
      sold: [...superinvestors.sold].reverse(),
    };
    const first = projectMaterialChanges(revisions, superinvestors);
    const second = projectMaterialChanges(revisions, reordered);
    assert.deepEqual(second.changed, first.changed);
  });

  test("does not include generatedAt in stable identity", () => {
    const first = projectMaterialChanges(revisions, { ...superinvestors, metadata: { quarter: "2026-Q2", generated_at: "one" } });
    const second = projectMaterialChanges(revisions, { ...superinvestors, metadata: { quarter: "2026-Q2", generated_at: "two" } });
    assert.equal(first.changed[0].id, second.changed[0].id);
    assert.equal(first.changed[0].id, "revision:up:AAPL:2026-08-14");
    assert.notEqual(first.sources.superinvestor.evidence.generatedAt, second.sources.superinvestor.evidence.generatedAt);
  });

  test("intersects attention before the changed cap and applies flag priority", () => {
    const result = projectMaterialChanges(revisions, superinvestors, {
      IBM: "RISK",
      BAC: "VERIFY",
      GOOGL: "THESIS",
      AAPL: "WATCH",
    });
    assert.deepEqual(
      result.attention.map(({ ticker, flag }) => `${flag}:${ticker}`),
      ["RISK:IBM", "VERIFY:BAC", "THESIS:GOOGL", "THESIS:GOOGL", "WATCH:AAPL"],
    );
    assert.equal(result.attention[0].id, "revision:up:IBM:2026-08-14");
  });

  test("distinguishes missing and malformed sources without fabricated items", () => {
    const missing = projectMaterialChanges(undefined, null);
    assert.equal(missing.sources.revision.status, "missing");
    assert.equal(missing.sources.superinvestor.status, "missing");
    assert.deepEqual(missing.changed, []);
    assert.deepEqual(missing.attention, []);

    const invalid = projectMaterialChanges(
      { up: "not-an-array" },
      { metadata: { quarter: "not-a-quarter" }, bought: "not-an-array" },
    );
    assert.equal(invalid.sources.revision.status, "invalid");
    assert.equal(invalid.sources.superinvestor.status, "invalid");
    assert.deepEqual(invalid.changed, []);
    assert.deepEqual(invalid.attention, []);
  });

  test("accepts the Home highlight shape only inside a quarter-bearing wrapper", () => {
    const wrapped = projectMaterialChanges(undefined, {
      metadata: { quarter: "2026-Q2", generated_at: "2026-08-16T16:00:00.000Z" },
      highlights: [
        { key: "bought", label: "최다 매수", ticker: "AAPL", meta: "Apple", signal: "4명 매수", tone: "positive" },
        { key: "sold", label: "최다 매도", ticker: "BAC", meta: "Bank of America", signal: "5명 매도", tone: "negative" },
      ],
    });
    assert.equal(wrapped.sources.superinvestor.status, "available");
    assert.deepEqual(wrapped.changed.map(({ kind, ticker, asOf }) => `${kind}:${ticker}:${asOf}`), [
      "buy:AAPL:2026-Q2",
      "sell:BAC:2026-Q2",
    ]);

    const naked = projectMaterialChanges(undefined, [{ key: "bought", ticker: "AAPL" }] as never);
    assert.equal(naked.sources.superinvestor.status, "invalid");
    assert.equal(naked.sources.superinvestor.evidence.reason, "source_wrapper_required");
    assert.deepEqual(naked.changed, []);
  });

  test("rejects wrong-sign revisions and negative transaction values", () => {
    const wrongSigns = projectMaterialChanges(
      {
        up: [{ ticker: "AAPL", change_1w: 0, as_of: "2026-08-14" }, { ticker: "MSFT", change_1w: -0.1, as_of: "2026-08-14" }],
        down: [{ ticker: "TSLA", change_1w: 0, as_of: "2026-08-14" }, { ticker: "AMD", change_1w: 0.1, as_of: "2026-08-14" }],
      },
      null,
    );
    assert.equal(wrongSigns.sources.revision.status, "invalid");
    assert.equal(wrongSigns.sources.revision.evidence.reason, "candidate_invalid");
    assert.deepEqual(wrongSigns.changed, []);

    const negativeValues = projectMaterialChanges(undefined, {
      metadata: { quarter: "2026-Q2" },
      bought: [{ ticker: "AAPL", amount: -1, investors_count: 1 }],
      sold: [{ ticker: "MSFT", amount: -2, investors_count: 1 }],
    });
    assert.equal(negativeValues.sources.superinvestor.status, "invalid");
    assert.equal(negativeValues.sources.superinvestor.evidence.validCandidateCount, 0);
    assert.equal(negativeValues.sources.superinvestor.evidence.invalidCandidateCount, 2);
    assert.equal(negativeValues.sources.superinvestor.evidence.reason, "candidate_invalid");
    assert.deepEqual(negativeValues.changed, []);
  });

  test("keeps revision date and 13F quarter clocks independent", () => {
    const result = projectMaterialChanges(revisions, superinvestors);
    assert.equal(result.sources.revision.evidence.generatedAt, revisions.generated_at);
    assert.deepEqual(result.sources.revision.evidence.asOfs, ["2026-08-14"]);
    assert.equal(result.sources.superinvestor.evidence.generatedAt, superinvestors.metadata.generated_at);
    assert.deepEqual(result.sources.superinvestor.evidence.quarters, ["2026-Q2"]);
    assert.equal(result.changed.find((item) => item.source === "revision")?.asOf, "2026-08-14");
    assert.equal(result.changed.find((item) => item.source === "superinvestor")?.asOf, "2026-Q2");
  });

  test("normalizes tickers and resolves duplicate ids deterministically", () => {
    const duplicateRows = [
      { ticker: "aapl", name: "Zulu", change_1w: 0.5, as_of: "2026-08-14" },
      { ticker: "$AAPL", name: "Alpha", change_1w: 0.5, as_of: "2026-08-14" },
    ];
    const forward = projectMaterialChanges({ up: duplicateRows }, null);
    const reverse = projectMaterialChanges({ up: [...duplicateRows].reverse() }, null);
    assert.equal(forward.changed.length, 1);
    assert.equal(forward.changed[0].ticker, "AAPL");
    assert.equal(forward.changed[0].id, "revision:up:AAPL:2026-08-14");
    assert.equal(forward.changed[0].title, "Alpha");
    assert.deepEqual(forward.changed, reverse.changed);
  });
}

main();
