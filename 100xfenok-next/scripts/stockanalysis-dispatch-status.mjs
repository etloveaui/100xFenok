// Single source of truth for the ETF history-gap report's recommended_dispatch.status
// vocabulary. The generator (report-stockanalysis-history-gap.mjs) EMITS these values; the
// audit checker (check-stockanalysis-market-audit.mjs) MATCHES against them. Keeping the
// enum in one leaf module (zero imports) prevents the owner_gated/scheduled_backfill_active
// drift that dead-lettered the daily_1y-continuity carve-out. Any status in the report that
// is not in this set is treated as a hard error so vocabulary drift becomes loud.
export const DISPATCH_STATUS = Object.freeze({
  MANUAL_DISPATCH_RECOMMENDED: "manual_dispatch_recommended",
  SCHEDULED_BACKFILL_ACTIVE: "scheduled_backfill_active",
  NOT_RECOMMENDED: "not_recommended",
});

export const DISPATCH_STATUS_VALUES = new Set(Object.values(DISPATCH_STATUS));
