import { after, test } from "node:test";
import assert from "node:assert/strict";
import { invalidateData } from "../client/data-fetch";
import { loadMacroCalendar } from "./calendar-loader";
import { MACRO_CALENDAR_URL, MACRO_PREV_VALUES_URL } from "./macro-calendar";

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as Record<string, unknown>).window;
const originalNow = Date.now;
(globalThis as Record<string, unknown>).window = globalThis;
after(() => {
  globalThis.fetch = originalFetch;
  (globalThis as Record<string, unknown>).window = originalWindow;
  Date.now = originalNow;
});

const document = (day: string) => ({
  generated_at: `${day}T00:00:00Z`,
  range: { time_max: "2027-03-01T00:00:00+09:00" },
  events: [],
});

function resetCache(): void {
  invalidateData(MACRO_CALENDAR_URL);
  invalidateData(MACRO_PREV_VALUES_URL);
}

test("calendar callers share fresh data but refetch after five minutes", async () => {
  resetCache();
  let now = Date.parse("2026-09-29T00:00:00Z");
  Date.now = () => now;
  let calendarCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === MACRO_CALENDAR_URL) {
      calendarCalls += 1;
      return Response.json(document(calendarCalls === 1 ? "2026-09-28" : "2026-09-29"));
    }
    return Response.json({ values: {} });
  };
  try {
    const [a, b] = await Promise.all([loadMacroCalendar(), loadMacroCalendar()]);
    assert.equal(calendarCalls, 1);
    assert.equal(a?.generatedAt, b?.generatedAt);
    now += 300_001;
    const updated = await loadMacroCalendar();
    assert.equal(calendarCalls, 2, "a previous visit must not retain the calendar forever");
    assert.equal(updated?.generatedAt, "2026-09-29T00:00:00Z");
  } finally {
    Date.now = originalNow;
  }
});

test("home skips previous prints; a later full calendar request still loads them", async () => {
  resetCache();
  const urls: string[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json(String(url) === MACRO_CALENDAR_URL ? document("2026-09-29") : { values: {} });
  };
  assert.ok(await loadMacroCalendar({ withPreviousValues: false }));
  assert.deepEqual(urls, [MACRO_CALENDAR_URL]);
  assert.ok(await loadMacroCalendar());
  assert.deepEqual(urls, [MACRO_CALENDAR_URL, MACRO_PREV_VALUES_URL]);
});

test("HTTP failure is retried on the next visit, not cached as an empty calendar", async () => {
  resetCache();
  let calls = 0;
  globalThis.fetch = async (url) => {
    if (String(url) !== MACRO_CALENDAR_URL) return Response.json({ values: {} });
    calls += 1;
    return calls === 1 ? new Response("unavailable", { status: 503 }) : Response.json(document("2026-09-29"));
  };
  assert.equal(await loadMacroCalendar({ withPreviousValues: false }), null);
  assert.ok(await loadMacroCalendar({ withPreviousValues: false }));
  assert.equal(calls, 2);
});

test("manual refresh bypasses a fresh successful calendar without losing optional-print isolation", async () => {
  resetCache();
  let calendarCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === MACRO_CALENDAR_URL) {
      calendarCalls += 1;
      return Response.json(document(calendarCalls === 1 ? "2026-09-28" : "2026-09-29"));
    }
    return new Response("unavailable", { status: 503 });
  };
  const before = await loadMacroCalendar();
  const afterRefresh = await loadMacroCalendar({ force: true });
  assert.equal(before?.generatedAt, "2026-09-28T00:00:00Z");
  assert.equal(afterRefresh?.generatedAt, "2026-09-29T00:00:00Z");
  assert.equal(calendarCalls, 2);
  assert.equal(afterRefresh?.previousAsOf, null);
});

test("HTTP-200 error envelopes are unavailable, never an empty cached calendar", async () => {
  for (const invalid of [null, [], {}, { error: "upstream unavailable" }, { events: "not-an-array" }]) {
    resetCache();
    let calls = 0;
    globalThis.fetch = async () => Response.json(++calls === 1 ? invalid : document("2026-09-29"));
    assert.equal(await loadMacroCalendar({ withPreviousValues: false }), null);
    assert.equal((await loadMacroCalendar({ withPreviousValues: false }))?.generatedAt, "2026-09-29T00:00:00Z");
    assert.equal(calls, 2, "the invalid response must be evicted before retry");
  }
});

test("a valid calendar with no events still represents a genuinely empty calendar", async () => {
  resetCache();
  globalThis.fetch = async () => Response.json(document("2026-09-29"));
  const result = await loadMacroCalendar({ withPreviousValues: false });
  assert.ok(result);
  assert.deepEqual(result.events, []);
});
