#!/usr/bin/env node
import assert from "node:assert/strict";

import { buildFenoYardeniPayload, parseFredObservations } from "./build-feno-yardeni-model.mjs";

const seedPayload = {
  meta: {
    model: "yardney_model",
    frequency: "weekly",
  },
  data: [
    {
      date: "2009-12-25",
      spx: 1100,
      eps: 80,
      bond_per: 20,
      fair_value: 1600,
      premium_pct: -31.25,
    },
    {
      date: "2010-01-01",
      spx: 1115.1,
      eps: 77.8493,
      bond_per: 20,
      fair_value: 1556.99,
      premium_pct: -28.38,
    },
  ],
};

const benchmarkPayload = {
  metadata: {
    version: "fixture-benchmark",
    generated: "2026-07-08T00:00:00.000Z",
    source: "Bloomberg Terminal",
  },
  sections: {
    sp500: {
      data: [
        {
          date: "2010-01-01",
          px_last: 1115.1,
          best_eps: 78.6127,
        },
        {
          date: "2010-01-08",
          px_last: 1144.98,
          best_eps: 79.1824,
        },
        {
          date: "2010-01-15",
          px_last: 1136.03,
          best_eps: 79.6816,
        },
      ],
    },
  },
};

const fredSeries = {
  WAAA: [
    { date: "2010-01-01", value: 5 },
    { date: "2010-01-08", value: 5.2 },
  ],
  WBAA: [
    { date: "2010-01-01", value: 6 },
    { date: "2010-01-08", value: 6.2 },
  ],
};

const { publicPayload, privatePayload, report } = buildFenoYardeniPayload({
  seedPayload,
  benchmarkPayload,
  fredSeries,
  generatedAt: "2026-07-08T00:00:00.000Z",
  generatedBy: "test",
});

assert.equal(publicPayload.meta.model, "feno_yardeni_model");
assert.equal(publicPayload.meta.public_schema_version, "yardney_model_public_v1");
assert.equal(publicPayload.meta.bond_yield_components_included, false);
assert.equal(publicPayload.data.length, 3);
assert.equal(publicPayload.data[0].date, "2009-12-25");
assert.equal(publicPayload.data[0].fair_value, 1600);

const firstComputed = publicPayload.data[1];
assert.deepEqual(firstComputed, {
  date: "2010-01-01",
  spx: 1115.1,
  eps: 78.6127,
  bond_per: 18.18,
  fair_value: 1429.18,
  premium_pct: -21.98,
});

assert.equal(publicPayload.data[2].date, "2010-01-08");
assert.equal(publicPayload.data.some((row) => row.date === "2010-01-15"), false);
assert.equal(report.seed_preserved_records, 1);
assert.equal(report.computed_records, 2);
assert.equal(report.skipped_benchmark_records, 1);

const publicText = JSON.stringify(publicPayload);
for (const forbidden of [
  "moodys_aaa",
  "moodys_baa",
  "spread_avg",
  "WAAA\":",
  "WBAA\":",
  "fred_aaa",
  "fred_baa",
]) {
  assert.equal(publicText.includes(forbidden), false, `public payload leaked ${forbidden}`);
}

assert.equal(privatePayload.data[1].moodys_aaa, 5);
assert.equal(privatePayload.data[1].moodys_baa, 6);
assert.equal(privatePayload.data[1].spread_avg, 5.5);

assert.deepEqual(
  parseFredObservations({
    observations: [
      { date: "2010-01-01", value: "5.00" },
      { date: "2010-01-08", value: "." },
      { date: "2010-01-15", value: "5.15" },
    ],
  }, "WAAA"),
  [
    { date: "2010-01-01", value: 5 },
    { date: "2010-01-15", value: 5.15 },
  ],
);

console.log("build-feno-yardeni-model tests passed");
