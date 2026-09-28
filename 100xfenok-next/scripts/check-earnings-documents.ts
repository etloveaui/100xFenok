import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { asEarningsDocument } from "../src/lib/earnings/model";

// Independent acceptance values transcribed from the June 2026 SEC filings
// and Microsoft's detailed GAAP issuer table, checked on 2026-09-06.
const official = {
  AAPL: { end: "2026-06-27", revenue: 109417000000, costOfRevenue: 54647000000, operatingIncome: 35695000000, netIncome: 29789000000, dilutedEps: 2.02 },
  AMZN: { end: "2026-06-30", revenue: 200606000000, costOfRevenue: 95778000000, operatingIncome: 27461000000, netIncome: 62647000000, dilutedEps: 5.75 },
  MSFT: { end: "2026-06-30", revenue: 90007000000, costOfRevenue: 29525000000, operatingIncome: 40603000000, netIncome: 35766000000, dilutedEps: 4.81 },
  META: { end: "2026-06-30", revenue: 60801000000, costOfRevenue: 11330000000, operatingIncome: 18775000000, netIncome: 15848000000, dilutedEps: 6.18 },
};
let totalBytes = 0;
for (const [ticker, expected] of Object.entries(official)) {
  const bytes = readFileSync(`../data/earnings-overview/${ticker}.json`);
  totalBytes += bytes.byteLength;
  const document = asEarningsDocument(JSON.parse(bytes.toString("utf8")));
  assert.ok(document && document.ticker === ticker, `${ticker} document must satisfy the shared display contract`);
  const period = document.periods.find(period => period.end === expected.end);
  if (Date.now() - Date.parse(expected.end) < 650 * 86_400_000) assert.ok(period, `${ticker} must retain the independently checked recent source quarter`);
  if (period) for (const metric of ["revenue", "costOfRevenue", "operatingIncome", "netIncome", "dilutedEps"] as const) {
    assert.equal(period.income[metric], expected[metric], `${ticker} ${metric} must match the official GAAP acceptance source`);
  }
  if (document.periods[0].end === expected.end) assert.ok(document.periods[0].segments.length >= 2, `${ticker} known latest official segment table must be connected`);
  console.log(`[earnings-data] ${ticker}: ${document.periods.length} validated quarters; latest ${document.periods[0].end}; ${document.periods[0].segments.length} reconciled segments; official baseline ${period ? "matched" : "outside retention window"}`);
}
assert.ok(totalBytes <= 200_000, "four earnings documents must stay within their publication byte bound");
