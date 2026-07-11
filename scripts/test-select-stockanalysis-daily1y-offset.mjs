#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  businessDayOrdinalUtc,
  selectStockAnalysisDaily1yOffset,
} from "./select-stockanalysis-daily1y-offset.mjs";

assert.equal(businessDayOrdinalUtc(new Date("1970-01-05T12:00:00Z")), 0);
assert.equal(businessDayOrdinalUtc(new Date("1970-01-09T12:00:00Z")), 4);
assert.equal(businessDayOrdinalUtc(new Date("1970-01-12T12:00:00Z")), 5);

const sevenScheduledWeekdays = [
  "2026-07-06T22:50:00Z",
  "2026-07-07T22:50:00Z",
  "2026-07-08T22:50:00Z",
  "2026-07-09T22:50:00Z",
  "2026-07-10T22:50:00Z",
  "2026-07-13T22:50:00Z",
  "2026-07-14T22:50:00Z",
];
const shardIndices = sevenScheduledWeekdays.map((now) => (
  selectStockAnalysisDaily1yOffset({ tickerCount: 840, limit: 120, now: new Date(now) }).shardIndex
));
assert.deepEqual([...new Set(shardIndices)].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
assert.equal(selectStockAnalysisDaily1yOffset({ tickerCount: 0, limit: 120, now: new Date() }).offset, 0);
assert.throws(() => selectStockAnalysisDaily1yOffset({ tickerCount: 1, limit: 0 }), /positive integer/);

console.log("test-select-stockanalysis-daily1y-offset: ok");
