import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { validateDetectionReport } from "../build-data-supply-detection-floor.mjs";
import { validToneSnapshot } from "../fetch-fenok-news-tone-proxy.mjs";
import { canonicalJson } from "./json-canonical.mjs";
import { hasStructuredGithubRunBinding } from "./data-supply-lkg-store.mjs";

const LANE_ID = "gdelt_news_tone";
const CANONICAL_PATH = "data/computed/fenok_news_tone_proxy.json";
const SOURCE_FAMILY = "GDELT Web Legacy NGrams TOC";
const MAX_PROOF_FILE_BYTES = 2 * 1024 * 1024;

function utcStamp(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/);
  if (!match || !Number.isFinite(Date.parse(value))) return null;
  const normalized = `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0")}Z`;
  return new Date(value).toISOString() === normalized ? normalized : null;
}

function readProofFile(dataRoot, relative) {
  const absolute = path.join(dataRoot, relative);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROOF_FILE_BYTES) {
    throw new Error("invalid selected-source proof file");
  }
  const bytes = fs.readFileSync(absolute);
  if (bytes.length > MAX_PROOF_FILE_BYTES) throw new Error("oversized selected-source proof file");
  return { bytes, document: JSON.parse(bytes.toString("utf8")) };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Read-only evidence shared by the builder and checker. Each invocation reads
// committed bytes afresh; no prior KPI claim or producer exit can qualify it.
export function inspectGdeltSelectedSource({
  dataRoot, nowIso, detectionRow = null, sourceAsOf = null, detectionReason = null,
} = {}) {
  let unavailable = { ready: false };
  if (typeof dataRoot !== "string" || utcStamp(nowIso) === null) return unavailable;
  try {
    const report = readProofFile(dataRoot, "admin/data-supply-detection-floor.json").document;
    validateDetectionReport(report);
    const row = report.lanes.find((item) => item.id === LANE_ID);
    unavailable = { ready: false, detection_reason: row.reason, detection_status: row.status,
      source_as_of: utcStamp(row.artifact.source_as_of) };
    const canonical = readProofFile(dataRoot, "computed/fenok_news_tone_proxy.json");
    const snapshot = canonical.document;
    const state = readProofFile(dataRoot, "admin/gdelt_news_tone/index.json").document;
    const item = state?.items?.news_tone_proxy;
    const observation = item?.provider_observation;
    const primary = snapshot?.acquisition?.primary;
    const fallback = snapshot?.acquisition?.fallback;
    const observedAt = utcStamp(observation?.observed_at);
    const now = Date.parse(nowIso);
    if (!validToneSnapshot(snapshot) || !observedAt || Date.parse(observedAt) > now
      || snapshot.rows.some((entry) => !utcStamp(entry.as_of)
        || Date.parse(entry.as_of) > Date.parse(observedAt)
        || !Array.isArray(entry.source_families) || !entry.source_families.includes(SOURCE_FAMILY)
        || !Number.isInteger(entry.direct_news_tone_proxy?.article_count)
        || entry.direct_news_tone_proxy.article_count < 1
        || !Number.isFinite(entry.direct_news_tone_proxy.score_0_100)
        || entry.direct_news_tone_proxy.score_0_100 < 0 || entry.direct_news_tone_proxy.score_0_100 > 100)) {
      return unavailable;
    }
    const providerSource = snapshot.rows.map((entry) => utcStamp(entry.as_of)).sort().at(-1);
    const sourceFloor = snapshot.rows.map((entry) => utcStamp(entry.as_of)).sort().at(0);
    const sourceFloorDay = Date.parse(`${sourceFloor.slice(0, 10)}T00:00:00.000Z`);
    const today = Date.parse(`${utcStamp(nowIso).slice(0, 10)}T00:00:00.000Z`);
    if (today - sourceFloorDay > 3 * 86400000
      || utcStamp(snapshot.source_as_of) !== sourceFloor
      || snapshot.coverage.with_articles !== 8 || snapshot.coverage.with_tone_score !== 8
      || utcStamp(snapshot.generated_at) !== observedAt
      || row.artifact.status !== "ready" || row.artifact.reason !== "ok"
      || utcStamp(row.artifact.source_as_of) !== providerSource
      || (detectionRow !== null && canonicalJson(row) !== canonicalJson(detectionRow))
      || (sourceAsOf !== null && utcStamp(sourceAsOf) !== providerSource)
      || (detectionReason !== null && row.reason !== detectionReason)) return unavailable;

    if (state.schema_version !== "data-supply-lkg-state/v1" || state.lane_id !== LANE_ID
      || !Array.isArray(state.retry_set) || state.retry_set.length !== 0
      || Object.keys(state.items ?? {}).length !== 1
      || item?.key !== "news_tone_proxy" || item.resolution_state !== "fresh_primary" || item.retry !== false
      || item.latest_failure != null || item.promotion_contract !== "provider_observation/v2"
      || item.current?.path !== CANONICAL_PATH
      || item.current.payload_sha256 !== sha256(canonical.bytes)
      || utcStamp(item.current.source_as_of) !== providerSource
      || observation.schema_version !== "provider_observation/v2"
      || utcStamp(observation.source_as_of) !== providerSource
      || !hasStructuredGithubRunBinding({ eventName: "workflow_dispatch",
        runId: observation.run_id, runAttempt: observation.run_attempt })
      || observation.run_attempt !== 1
      || utcStamp(item.updated_at) !== observedAt || utcStamp(state.updated_at) !== observedAt) return unavailable;
    const providerDocument = {
      schema_version: "gdelt-provider-observation/v1", source_as_of: providerSource,
      rows: snapshot.rows.map(({ ticker, as_of }) => ({ ticker, as_of })),
    };
    const providerBytes = Buffer.from(`${JSON.stringify(providerDocument, null, 2)}\n`);
    if (observation.payload_sha256 !== sha256(providerBytes)
      || fallback?.source_family !== SOURCE_FAMILY
      || utcStamp(fallback.source_as_of) !== providerSource || utcStamp(fallback.observed_at) !== observedAt
      || utcStamp(row.endpoint.observed_at) !== observedAt
      || !utcStamp(report.generated_at) || Date.parse(report.generated_at) < Date.parse(observedAt)
      || Date.parse(report.generated_at) > now) return unavailable;

    const tuple = primary?.attempt;
    const primaryReason = primary?.reason;
    if (!["rate_limited", "schema_drift", "http_error", "transport_error"].includes(primaryReason)
      || (primaryReason === "rate_limited" && !(tuple?.retry_count >= 1))
      || row.endpoint.reason !== primaryReason
      || row.reason !== primaryReason || row.status !== row.endpoint.status) return unavailable;
    return {
      ready: true, source_family: SOURCE_FAMILY, source_as_of: providerSource,
      observed_at: observedAt, primary_reason: primaryReason,
      detection_reason: row.reason, detection_status: row.status,
    };
  } catch (error) {
    if (error?.code === "ERR_KPI_FIXTURE_LIVE_DATA_READ") throw error;
    return unavailable;
  }
}
