export const RECENT_TERMINAL_MAX_AGE_HOURS = 48;

function parseTimestamp(value) {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(ms);
    return Number.isFinite(parsed.valueOf()) ? parsed : null;
  }
  return null;
}

export function timestampAgeHours(value, now = new Date()) {
  const parsed = parseTimestamp(value);
  if (!parsed) return null;
  return Math.max(0, (now.valueOf() - parsed.valueOf()) / 36e5);
}

function isProviderCoverageGap(entry) {
  return entry?.availability_status === "provider_absent"
    || entry?.failure_class === "provider_coverage_gap";
}

function hasTerminalEvidence(entry) {
  return Boolean(String(entry?.failure_reason || "")) || isProviderCoverageGap(entry);
}

function hasActiveRetryWindow(entry, now) {
  if (!hasTerminalEvidence(entry)) return false;
  const lastAge = timestampAgeHours(entry?.last_attempt_utc, now);
  if (lastAge != null && lastAge <= RECENT_TERMINAL_MAX_AGE_HOURS) return true;
  return [entry?.next_attempt_after_utc, entry?.next_probe_after_utc]
    .map(parseTimestamp)
    .some((timestamp) => timestamp && timestamp > now);
}

export function pendingDaily1yTerminalSource(entry, now = new Date()) {
  if (!hasActiveRetryWindow(entry, now)) return null;
  const reason = String(entry?.failure_reason || "");
  if (entry?.failure_class === "successful_short_history") {
    return "successful_short_history_cooldown";
  }
  if (reason.includes("quoteType is not ETF/MUTUALFUND")) {
    return "provider_rejected_non_etf";
  }
  if (reason.includes("HTTP Error 404") || isProviderCoverageGap(entry)) {
    return "source_unavailable_recent_failure";
  }
  return "provider_recent_failure";
}
