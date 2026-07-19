#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { formatScreenerSourceDateLabel } from "../src/lib/screener/source-dates";

assert.equal(
  formatScreenerSourceDateLabel("2026-07-17", "2026-07-14"),
  "분석 07-17 · 시세 07-14",
);
assert.equal(
  formatScreenerSourceDateLabel(null, "2026-07-14"),
  "분석 미제공 · 시세 07-14",
);
assert.equal(
  formatScreenerSourceDateLabel("2026-07-17T23:59:59Z", null),
  "분석 07-17 · 시세 미제공",
);
assert.equal(
  formatScreenerSourceDateLabel("invalid", undefined),
  "분석 미제공 · 시세 미제공",
);
assert.equal(
  formatScreenerSourceDateLabel(null, null, { pending: true }),
  "분석 확인 중 · 시세 확인 중",
);

const clientSource = readFileSync(resolve(process.cwd(), "src/app/screener/ScreenerClient.tsx"), "utf8");
assert.match(clientSource, /completeSourceFloor\(\[sourceDate, connectionIndexDate\]\)/,
  "completeSourceFloor must remain for internal data-state logic");
assert.doesNotMatch(clientSource, /const sourceDateLabel = screenerSourceDate/,
  "the header must not collapse source dates back to the internal floor");
assert.match(clientSource, /formatScreenerSourceDateLabel\(sourceDate, marketFactsDate,/);

console.log("test-screener-source-date-label: ok");
