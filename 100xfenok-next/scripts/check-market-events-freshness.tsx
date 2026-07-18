import {
  EVENTS_STALE_AFTER_DAYS,
  EVENTS_STALE_LABEL,
  eventStaleSuffix,
  isEventBoardStale,
  isEventCollectionStale,
} from "../src/lib/market-events/freshness";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// Fixed KST "today" so the day-bucket math is deterministic.
const TODAY = "2026-07-18";

// Threshold and label are the documented, canonical values.
assert(EVENTS_STALE_AFTER_DAYS === 3, "threshold must stay documented at 3 days");
assert(
  EVENTS_STALE_LABEL === "오래됨",
  "stale label must be the canonical data-state label (cp-design-system §H.5)",
);

// Collection freshness keys off fetched_at.
assert(
  !isEventCollectionStale({ fetched_at: "2026-07-18T01:18:28Z" }, TODAY),
  "same-day fetch is fresh",
);
// Widest natural weekend gap (Friday -> Monday = 3 days) must NOT flag stale.
assert(
  !isEventCollectionStale({ fetched_at: "2026-07-15T23:50:00Z" }, TODAY),
  "3-day gap is within weekend tolerance",
);
// One cron cycle beyond the weekend gap (4 days) is genuinely stale.
assert(
  isEventCollectionStale({ fetched_at: "2026-07-14T23:50:00Z" }, TODAY),
  "4-day gap is stale",
);
// A missing fetched_at is not invented into staleness (unavailable is a separate signal).
assert(!isEventCollectionStale({ fetched_at: null }, TODAY), "null fetched_at is not stale");
assert(!isEventCollectionStale({}, TODAY), "empty doc is not stale");
assert(!isEventCollectionStale(null, TODAY), "null doc is not stale");
// An old source_as_of alone never drives collection staleness.
assert(
  !isEventCollectionStale(
    { fetched_at: "2026-07-18T01:18:28Z", source_as_of: "2026-01-01" },
    TODAY,
  ),
  "collection staleness ignores source_as_of",
);

// Inline suffix uses exactly the canonical label, and is empty when fresh.
assert(eventStaleSuffix({ fetched_at: "2026-07-18T01:18:28Z" }, TODAY) === "", "fresh -> no suffix");
assert(
  eventStaleSuffix({ fetched_at: "2026-07-14T00:00:00Z" }, TODAY) === ` · ${EVENTS_STALE_LABEL}`,
  "stale -> canonical suffix",
);

// Board is stale if ANY surface is behind (surfaces move together per cron run).
assert(
  isEventBoardStale(
    [{ fetched_at: "2026-07-18T01:18:28Z" }, { fetched_at: "2026-07-14T00:00:00Z" }],
    TODAY,
  ),
  "board stale when any surface stale",
);
assert(
  !isEventBoardStale([{ fetched_at: "2026-07-18T01:18:28Z" }], TODAY),
  "board fresh when all surfaces fresh",
);
assert(!isEventBoardStale([], TODAY), "empty board is not stale");

console.log(JSON.stringify({ ok: true, EVENTS_STALE_AFTER_DAYS, EVENTS_STALE_LABEL }, null, 2));
