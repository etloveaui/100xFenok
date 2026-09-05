import assert from "node:assert/strict";
import {
  MAX_JOURNEY_CONTEXT_LENGTH,
  MAX_JOURNEY_SNAPSHOT_LENGTH,
  MAX_JOURNEY_SCROLL_Y,
  consumeJourneyScrollSnapshot,
  consumeScreenerJourneySnapshot,
  decodeJourneyScrollSnapshot,
  decodeScreenerJourneySnapshot,
  encodeScreenerJourneySnapshot,
  journeySnapshotStorageKey,
  journeyReturnTo,
  saveScreenerJourneySnapshot,
  saveJourneyScrollSnapshot,
} from "../src/lib/journey-context";
import { ROUTES } from "../src/lib/routes";

const tickerDestination = new URL(ROUTES.superinvestorsByTicker("NVDA"), "https://example.test");
assert.equal(tickerDestination.searchParams.get("tab"), "stocks",
  "A stock-to-investor pivot must select the current stocks tab, not the removed by-ticker tab");
assert.equal(tickerDestination.searchParams.get("ticker"), "NVDA");

const investorDestination = new URL(ROUTES.superinvestorsGuru("berkshire"), "https://example.test");
assert.equal(investorDestination.searchParams.get("tab"), "investors",
  "An investor deep link must use the current investors tab");
assert.equal(investorDestination.searchParams.get("guru"), "berkshire");

const screenerOrigin = "/screener?ticker=NVDA&sector=Technology#results";
const stockDestination = new URL(ROUTES.stock("NVDA", screenerOrigin), "https://example.test");
assert.equal(stockDestination.pathname, "/stock/NVDA");
assert.equal(stockDestination.searchParams.get("returnTo"), screenerOrigin);
assert.equal(journeyReturnTo(screenerOrigin), screenerOrigin);
assert.equal(journeyReturnTo("/superinvestors?tab=investors&guru=berkshire#detail"), "/superinvestors?tab=investors&guru=berkshire#detail");
assert.equal(journeyReturnTo("/superinvestors?tab=stocks&ticker=NVDA&returnTo=%2Fscreener%3Fticker%3DMSFT"), "/superinvestors?tab=stocks&ticker=NVDA&returnTo=%2Fscreener%3Fticker%3DMSFT");
assert.equal(journeyReturnTo("/stock/NVDA"), null, "stock pages must not recursively become return targets");
assert.equal(journeyReturnTo("/screener?returnTo=%2Fstock%2FNVDA"), null, "nested stock targets must be rejected");
assert.equal(journeyReturnTo("https://evil.example/screener?ticker=NVDA"), null);
assert.equal(journeyReturnTo("//evil.example/screener"), null);
assert.equal(journeyReturnTo("/screener\u0000"), null);
assert.equal(journeyReturnTo("/screener?note=%00"), null);
assert.equal(journeyReturnTo(`/screener?x=${"x".repeat(MAX_JOURNEY_CONTEXT_LENGTH)}`), null);

const snapshot = { selectedTickers: ["NVDA", "MSFT", "NVDA"], visibleIndex: 37 };
const encoded = encodeScreenerJourneySnapshot(snapshot);
assert.deepEqual(decodeScreenerJourneySnapshot(encoded), {
  selectedTickers: ["NVDA", "MSFT"],
  visibleIndex: 37,
});
assert.equal(decodeScreenerJourneySnapshot("not-json"), null);
assert.equal(decodeScreenerJourneySnapshot("x".repeat(MAX_JOURNEY_SNAPSHOT_LENGTH + 1)), null);
assert.equal(decodeScreenerJourneySnapshot(JSON.stringify({ selectedTickers: ["NVDA"], visibleIndex: -1 })), null);
assert.equal(decodeScreenerJourneySnapshot(JSON.stringify({ selectedTickers: ["NVDA", "bad ticker"], visibleIndex: 1 })), null);
assert.equal(decodeScreenerJourneySnapshot(JSON.stringify({ selectedTickers: ["NVDA"], visibleIndex: 1, extra: "ignored" })), null,
  "snapshot state shape must stay explicit");
assert.deepEqual(decodeJourneyScrollSnapshot(JSON.stringify({ scrollY: 480 })), { scrollY: 480 });
assert.equal(decodeJourneyScrollSnapshot(JSON.stringify({ scrollY: -1 })), null);
assert.equal(decodeJourneyScrollSnapshot(JSON.stringify({ scrollY: MAX_JOURNEY_SCROLL_Y + 1 })), null);

const storage = new Map<string, string>();
const storageAdapter = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
};
saveScreenerJourneySnapshot(storageAdapter, screenerOrigin, snapshot);
assert.deepEqual(consumeScreenerJourneySnapshot(storageAdapter, screenerOrigin), {
  selectedTickers: ["NVDA", "MSFT"],
  visibleIndex: 37,
});
assert.equal(consumeScreenerJourneySnapshot(storageAdapter, screenerOrigin), null,
  "a restored snapshot is consumed once");
const malformedKey = journeySnapshotStorageKey(screenerOrigin);
assert.ok(malformedKey);
storageAdapter.setItem(malformedKey, "{}{}");
assert.equal(consumeScreenerJourneySnapshot(storageAdapter, screenerOrigin), null);
assert.equal(storage.has(malformedKey), false, "malformed state is cleared");

const investorOrigin = "/superinvestors?tab=stocks&ticker=NVDA";
assert.equal(saveJourneyScrollSnapshot(investorOrigin, { scrollY: 480 }, storageAdapter), true);
assert.deepEqual(consumeJourneyScrollSnapshot(storageAdapter, investorOrigin), { scrollY: 480 });
assert.equal(storage.has(journeySnapshotStorageKey(investorOrigin) ?? ""), false, "scroll state is one-shot");

console.log("journey-continuity: canonical investor deep links passed");
