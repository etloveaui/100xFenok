import { DATA_STATE_LABELS, isStaleAsOf } from "@/lib/data-state";

// The /market/events surfaces are refreshed by fetch-stockanalysis.yml on a
// weekday-post-close x2 + Sunday cron. The widest natural gap (Friday evening ->
// Sunday evening) is ~2 calendar days, so a 3-day threshold flags a cron that has
// genuinely stalled without tripping on the normal weekend gap.
export const EVENTS_STALE_AFTER_DAYS = 3;

// Stale copy is the canonical data-state label, never a hand-typed variant
// (cp-design-system-spec.md section H rule 5).
export const EVENTS_STALE_LABEL = DATA_STATE_LABELS.stale;

export interface EventFreshnessInput {
  fetched_at?: string | null;
  source_as_of?: string | null;
}

// Collection freshness keys off fetched_at (when our cron last wrote the surface),
// not source_as_of, because these surfaces publish no aggregate source date. A
// missing fetched_at is treated as "not stale" here — an unavailable surface is a
// separate signal already carried by its empty count, and we never invent staleness.
export function isEventCollectionStale(
  doc: EventFreshnessInput | null | undefined,
  today?: string,
): boolean {
  return isStaleAsOf(doc?.fetched_at ?? null, EVENTS_STALE_AFTER_DAYS, today);
}

// Board-level: since every surface is written and mirrored in a single cron run,
// any surface behind the collection threshold means the events cron is behind.
export function isEventBoardStale(
  docs: Array<EventFreshnessInput | null | undefined>,
  today?: string,
): boolean {
  return docs.some((doc) => isEventCollectionStale(doc, today));
}

// Canonical stale suffix for the inline "기준/수집 {date}" labels; empty when fresh.
export function eventStaleSuffix(
  doc: EventFreshnessInput | null | undefined,
  today?: string,
): string {
  return isEventCollectionStale(doc, today) ? ` · ${EVENTS_STALE_LABEL}` : "";
}
