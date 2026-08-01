#!/usr/bin/env node
import assert from "node:assert/strict";

// This fixture is intentionally producer-shape-only: generated/fetched/build clocks are
// collection evidence, never a provider source date. A provider that publishes no aggregate
// date must remain explicit null + reason, even when its artifact was just rebuilt.
const fixture = {
  stockanalysis: {
    generated_at: "2026-08-01T12:00:00Z",
    fetched_at: "2026-08-01T11:59:00Z",
    source_as_of: null,
    source_as_of_reason: "provider publishes no aggregate source date",
  },
  yahoo: {
    fetched_at: "2026-08-01T11:58:00Z",
    data: { history_1y: [{ date: "2026-07-31" }] },
  },
  market_facts: {
    generated_at: "2026-08-01T12:01:00Z",
    facts: { quote: { as_of: "2026-07-31" }, financials: { fetched_at: "2026-07-30T00:00:00Z" } },
  },
  global_scouter: { generated_at: "2026-08-01T12:02:00Z", source_date: "2026-07-31" },
  rim: { generated_at: "2026-08-01T12:03:00Z", observed: { price: { as_of: "2026-07-31" } } },
};

function assertClockSeparation(doc) {
  assert.equal(doc.stockanalysis.source_as_of, null, "StockAnalysis provider-dateless source date must stay null");
  assert.match(doc.stockanalysis.source_as_of_reason, /no aggregate source date/);
  assert.notEqual(doc.stockanalysis.generated_at.slice(0, 10), doc.stockanalysis.source_as_of,
    "generated_at must not be promoted into StockAnalysis source_as_of");
  assert.equal(doc.market_facts.facts.quote.as_of, "2026-07-31", "market_facts uses field source stamp");
  assert.equal(doc.global_scouter.source_date, "2026-07-31", "Global Scouter uses explicit source_date");
  assert.equal(doc.rim.observed.price.as_of, "2026-07-31", "RIM uses observed source as_of");
  assert.notEqual(doc.rim.generated_at.slice(0, 10), doc.rim.observed.price.as_of,
    "RIM generated_at must remain distinct from observed source as_of");
}

assertClockSeparation(fixture);

// Mutation proof: a producer that substitutes its build day must fail this fence.
const promoted = structuredClone(fixture);
promoted.stockanalysis.source_as_of = promoted.stockanalysis.generated_at.slice(0, 10);
assert.throws(() => assertClockSeparation(promoted), /provider-dateless source date must stay null/);

console.log(JSON.stringify({ ok: true, suite: "source-clock honesty contract", mutation_guard: "pass" }, null, 2));
