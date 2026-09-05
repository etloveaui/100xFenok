import assert from "node:assert/strict";
import { ROUTES } from "../src/lib/routes";

const tickerDestination = new URL(ROUTES.superinvestorsByTicker("NVDA"), "https://example.test");
assert.equal(tickerDestination.searchParams.get("tab"), "stocks",
  "A stock-to-investor pivot must select the current stocks tab, not the removed by-ticker tab");
assert.equal(tickerDestination.searchParams.get("ticker"), "NVDA");

const investorDestination = new URL(ROUTES.superinvestorsGuru("berkshire"), "https://example.test");
assert.equal(investorDestination.searchParams.get("tab"), "investors",
  "An investor deep link must use the current investors tab");
assert.equal(investorDestination.searchParams.get("guru"), "berkshire");

console.log("journey-continuity: canonical investor deep links passed");
