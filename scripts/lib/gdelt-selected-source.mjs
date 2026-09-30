import fs from "node:fs";
import path from "node:path";
import { validToneSnapshot } from "../fetch-fenok-news-tone-proxy.mjs";

const SOURCE_FAMILY = "GDELT Web Legacy NGrams TOC";

function utcStamp(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/);
  if (!match || !Number.isFinite(Date.parse(value))) return null;
  const normalized = `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0")}Z`;
  return new Date(value).toISOString() === normalized ? normalized : null;
}

export function inspectGdeltSelectedSource({ dataRoot, nowIso, detectionRow = null, sourceAsOf = null, detectionReason = null } = {}) {
  const unavailable = { ready: false };
  if (typeof dataRoot !== "string" || utcStamp(nowIso) === null) return unavailable;
  try {
    const snapshot = JSON.parse(fs.readFileSync(path.join(dataRoot, "computed/fenok_news_tone_proxy.json"), "utf8"));
    const observedAt = utcStamp(snapshot.generated_at);
    const now = Date.parse(nowIso);
    if (!validToneSnapshot(snapshot) || !observedAt || Date.parse(observedAt) > now
      || snapshot.rows.some((entry) => !utcStamp(entry.as_of)
        || Date.parse(entry.as_of) > Date.parse(observedAt)
        || !Array.isArray(entry.source_families) || !entry.source_families.includes(SOURCE_FAMILY)
        || !Number.isInteger(entry.direct_news_tone_proxy?.article_count)
        || entry.direct_news_tone_proxy.article_count < 1
        || !Number.isFinite(entry.direct_news_tone_proxy.score_0_100)
        || entry.direct_news_tone_proxy.score_0_100 < 0 || entry.direct_news_tone_proxy.score_0_100 > 100)) return unavailable;
    const dates = snapshot.rows.map((entry) => utcStamp(entry.as_of)).sort();
    const providerSource = dates.at(-1);
    const floor = dates.at(0);
    const today = Date.parse(`${utcStamp(nowIso).slice(0, 10)}T00:00:00.000Z`);
    if (today - Date.parse(`${floor.slice(0, 10)}T00:00:00.000Z`) > 3 * 86400000
      || utcStamp(snapshot.source_as_of) !== floor
      || snapshot.coverage.with_articles !== 8 || snapshot.coverage.with_tone_score !== 8
      || (sourceAsOf !== null && utcStamp(sourceAsOf) !== providerSource)) return unavailable;
    const primary = snapshot.acquisition?.primary;
    const fallback = snapshot.acquisition?.fallback;
    if (fallback?.source_family !== SOURCE_FAMILY || utcStamp(fallback.source_as_of) !== providerSource
      || !["rate_limited", "schema_drift", "http_error", "transport_error"].includes(primary?.reason)
      || (primary.reason === "rate_limited" && !(primary.attempt?.retry_count >= 1))) return unavailable;
    return { ready: true, source_family: SOURCE_FAMILY, source_as_of: providerSource,
      observed_at: observedAt, primary_reason: primary.reason,
      detection_reason: detectionReason ?? detectionRow?.reason ?? primary.reason,
      detection_status: detectionRow?.status ?? "unavailable" };
  } catch (error) {
    if (error?.code === "ERR_KPI_FIXTURE_LIVE_DATA_READ") throw error;
    return unavailable;
  }
}
