#!/usr/bin/env node
// Tests for scripts/backfill-kospi-yahoo.mjs. No network: the Yahoo chart
// payload is an inline fixture and main() accepts a stubbed request.
import assert from "node:assert/strict";

import {
  applyKs11Backfill,
  buildKs11BackfillRows,
  parseKs11Chart,
} from "./backfill-kospi-yahoo.mjs";

const DAY = 86_400;
const BASE_TS = Date.UTC(2026, 8, 7, 6, 0, 0) / 1000; // 2026-09-07 15:00 KST

function chartFixture(dates, closes) {
  return {
    chart: {
      result: [{
        meta: { symbol: "^KS11", exchangeTimezoneName: "Asia/Seoul" },
        timestamp: dates.map((_, index) => BASE_TS + index * DAY),
        indicators: {
          quote: [{
            close: closes,
            open: closes.map((value) => value - 1),
            high: closes.map((value) => value + 2),
            low: closes.map((value) => value - 2),
            volume: closes.map((_, index) => 1000 + index),
          }],
        },
      }],
      error: null,
    },
  };
}

const dates5 = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"];
const closes5 = [3200.5, 3210.0, 3205.25, 3220.75, 3230.0];

{
  const rows = parseKs11Chart(chartFixture(dates5, closes5));
  assert.deepEqual(rows.map((row) => row.date), dates5, "KST calendar dates in order");
  assert.equal(rows[0].close, 3200.5);
  assert.equal(rows[0].volume, 1000);
  // Null closes are skipped, not fatal.
  const sparse = structuredClone(chartFixture(dates5, closes5));
  sparse.chart.result[0].indicators.quote[0].close[2] = null;
  assert.deepEqual(
    parseKs11Chart(sparse).map((row) => row.date),
    ["2026-09-07", "2026-09-08", "2026-09-10", "2026-09-11"],
  );
  assert.throws(
    () => parseKs11Chart({ chart: { result: [{ meta: { symbol: "^GSPC" } }] } }),
    /symbol mismatch/,
  );
}

{
  const chartRows = parseKs11Chart(chartFixture(dates5, closes5));
  const backfill = buildKs11BackfillRows(chartRows, { days: 100 });
  assert.equal(backfill.length, 5 - 1, "leading row without a previous close is dropped");
  for (const row of backfill) {
    assert.equal(row.market, "KOSPI");
    assert.equal(row.index_class, "KOSPI");
    assert.equal(row.index_name, "코스피");
    assert.equal(row.origin, "yahoo_chart_backfill");
    assert.equal(row.origin_symbol, "^KS11");
    assert.equal(row.acc_trade_value, null);
  }
  const sep10 = backfill.find((row) => row.date === "2026-09-10");
  assert.equal(sep10.close, 3220.75);
  assert.equal(sep10.change, 3220.75 - 3205.25);
  assert.equal(sep10.change_pct, Number(((3220.75 - 3205.25) / 3205.25 * 100).toFixed(4)));
}

// KRX-official rows win date conflicts; nothing advances past the KRX maximum.
{
  const krxRow = {
    market: "KOSPI", index_class: "KOSPI", index_name: "코스피",
    date: "2026-09-10", close: 9999.0, change: 1, change_pct: 0.01,
    open: 1, high: 1, low: 1, acc_trade_volume: 1, acc_trade_value: 1,
  };
  const document = {
    schema_version: "fenok_krx_public_index_daily.v1",
    as_of: "2026-09-10",
    status: "ready",
    row_count: 1,
    notes: ["note"],
    indices: [krxRow],
  };
  const chartRows = parseKs11Chart(chartFixture(dates5, closes5));
  const backfill = buildKs11BackfillRows(chartRows, { days: 100 });
  const { filled, skipped_conflict: skipped, merged } = applyKs11Backfill(document, backfill);
  // 4 backfill rows: 09-08/09-09 fill, 09-10 conflicts (KRX wins), 09-11 is
  // newer than the retained KRX maximum and must not advance as_of.
  assert.equal(filled, 2);
  assert.equal(skipped, 2);
  assert.equal(merged.date_max, "2026-09-10");
  assert.deepEqual(merged.indices.map((row) => row.date), ["2026-09-08", "2026-09-09", "2026-09-10"]);
  assert.equal(merged.indices.at(-1).close, 9999.0, "KRX row survives the conflict");
}

// Idempotence: a second application over its own output changes nothing.
{
  const chartRows = parseKs11Chart(chartFixture(dates5, closes5));
  const backfill = buildKs11BackfillRows(chartRows, { days: 100 });
  const first = applyKs11Backfill(null, backfill);
  assert.equal(first.merged.date_max, "2026-09-11");
  const document = { indices: first.merged.indices };
  const second = applyKs11Backfill(document, backfill);
  assert.equal(second.filled, 0);
  assert.deepEqual(second.merged.indices, first.merged.indices);
}

console.log("test-backfill-kospi-yahoo: ok");
