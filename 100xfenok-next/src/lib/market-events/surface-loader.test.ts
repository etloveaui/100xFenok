import { after, test } from "node:test";
import assert from "node:assert/strict";
import { loadEventSurface } from "./surface-loader";

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as Record<string, unknown>).window;
(globalThis as Record<string, unknown>).window = globalThis;
after(() => {
  globalThis.fetch = originalFetch;
  (globalThis as Record<string, unknown>).window = originalWindow;
});

test("returning to a partially failed board retries the failed feed without refetching fresh peers", async () => {
  const calls = new Map<string, number>();
  globalThis.fetch = async (input) => {
    const url = String(input);
    const count = (calls.get(url) ?? 0) + 1;
    calls.set(url, count);
    if (url.endsWith("retry-failure") && count === 1) return new Response("unavailable", { status: 503 });
    return Response.json({ records: [{ symbol: "NVDA" }], source_as_of: "2026-09-29" });
  };
  const [fresh, failed] = await Promise.all([loadEventSurface("retry-success"), loadEventSurface("retry-failure")]);
  assert.equal(fresh.load_failed, undefined);
  assert.equal(failed.load_failed, true);
  assert.equal(failed.status_code, 503);
  const [retained, recovered] = await Promise.all([loadEventSurface("retry-success"), loadEventSurface("retry-failure")]);
  assert.deepEqual(retained.records, fresh.records);
  assert.equal(recovered.load_failed, undefined);
  assert.equal(calls.get("/api/data/stockanalysis/surfaces/retry-success"), 1);
  assert.equal(calls.get("/api/data/stockanalysis/surfaces/retry-failure"), 2);
});

test("HTTP-200 unavailable and malformed surface bodies do not stick in the cache", async () => {
  for (const [name, badBody] of [["typed-unavailable", { load_failed: true }], ["invalid-body", null]] as const) {
    let calls = 0;
    globalThis.fetch = async () => Response.json(++calls === 1 ? badBody : { records: [{ symbol: "SPY" }] });
    assert.equal((await loadEventSurface(name)).load_failed, true);
    assert.equal((await loadEventSurface(name)).records?.[0].symbol, "SPY");
    assert.equal(calls, 2);
  }
});

test("manual refresh fetches the surface again instead of reusing its fresh cache", async () => {
  let calls = 0;
  globalThis.fetch = async () => Response.json({ records: [{ value: ++calls }] });
  assert.equal((await loadEventSurface("manual-refresh")).records?.[0].value, 1);
  assert.equal((await loadEventSurface("manual-refresh", true)).records?.[0].value, 2);
});

test("an error object without rows is unavailable, while a real empty feed remains valid", async () => {
  let calls = 0;
  globalThis.fetch = async () => Response.json(++calls === 1 ? { error: "upstream unavailable" } : { records: [] });
  assert.equal((await loadEventSurface("error-envelope")).load_failed, true);
  const empty = await loadEventSurface("error-envelope");
  assert.equal(empty.load_failed, undefined);
  assert.deepEqual(empty.records, []);
  assert.equal(calls, 2);
});

test("null rows and a different feed identity cannot reach the event renderer", async () => {
  const invalid = [{ records: [null] }, { tables: [{ records: [null] }] }, { tables: [null] }, { surface: "wrong-feed", records: [] }];
  for (let index = 0; index < invalid.length; index += 1) {
    let calls = 0;
    globalThis.fetch = async () => Response.json(++calls === 1 ? invalid[index] : { records: [] });
    const name = `row-shape-${index}`;
    assert.equal((await loadEventSurface(name)).load_failed, true);
    assert.deepEqual((await loadEventSurface(name)).records, []);
    assert.equal(calls, 2);
  }
});
