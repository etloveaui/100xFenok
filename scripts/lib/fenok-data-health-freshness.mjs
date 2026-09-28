import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRESHNESS_CLASSES,
  dateOnly,
  freshnessVerdict,
  policyToday,
  resolveSourcePolicy,
} from "../../100xfenok-next/src/lib/freshness-policy.mjs";
import { yahooBusinessDayAge } from "./market-calendar.mjs";
import { YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS } from "./kpi-contract-constants.mjs";

export const DETECTION_CALENDARS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "data-supply-detection-calendars.json",
);
export const DETECTION_CALENDARS = JSON.parse(fs.readFileSync(DETECTION_CALENDARS_PATH, "utf8"));

const STATUS_SEVERITY = Object.freeze({ fresh: 0, delayed: 1, stopped: 2 });
const US_TRADING_LANES = new Set([
  "finra_short_volume",
  "nasdaq_giw_sox",
  "occ_options_volume",
  "us_indices_daily",
  "yahoo_ticker_macro",
]);
const PUBLIC_SERVED_PATHS = Object.freeze({
  // Yahoo batch and ETF fallback share this public directory.
  yahoo_batch_quote_history: "data/yf/finance",
  // FINRA's public product is the derived flow-proxy document; raw input stays private.
  finra_short_volume: "data/computed/fenok_flow_proxies.json",
  // These source lanes publish only their derived public proxy documents.
  apewisdom_attention: "data/computed/fenok_social_attention_proxy.json",
  gdelt_news_tone: "data/computed/fenok_news_tone_proxy.json",
});

// A verdict follows the window the product actually refreshes on, not a lane's
// nominal producer cadence. These stay here rather than in FAMILY_POLICY because
// the lane-registry drift guard requires the two to agree, and the registry
// records the producer, not the refresh window.
const LANE_CADENCE = Object.freeze({
  // ETF details rotate on the fetch-stockanalysis stale-retry window
  // (existing_etf_detail_age, 720h) and are not produced daily.
  stockanalysis_etf_detail: "monthly",
});
// Members of one lane published on different cadences are judged on their own.
const MEMBER_CADENCE = Object.freeze({
  // CFTC positioning publishes weekly; the other sentiment members are daily.
  sentiment: Object.freeze({ cftc: "weekly" }),
  // SlickCharts member ids are their own cadences, matching the crons declared
  // in data-supply-detection-config.mjs.
  slickcharts: Object.freeze({ weekly: "weekly", monthly: "monthly", history: "monthly", symbols: "weekly" }),
});
// Members that close with a market session are aged in that session's trading
// days, so a Friday close is one day old on Monday rather than three.
const MEMBER_CALENDAR = Object.freeze({
  sentiment: Object.freeze({ cnn: "us_trading", vix: "us_trading", move: "us_trading" }),
});

// Data sets that are not scheduled producers and have no cadence to judge.
export const HEALTH_SET_EXCLUSIONS = new Set([
  // An on-demand Yahoo ETF fallback store, read only when a detail refresh needs
  // it. A scheduled verdict would read "stopped" for a store nobody is waiting on;
  // its effect is already visible through the ETF detail set.
  "yahoo_etf_fallback",
]);

function validCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function dateValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) >= 1e12 ? value : value * 1000;
    const timestamp = new Date(milliseconds);
    return Number.isFinite(timestamp.getTime()) ? dateOnly(timestamp.toISOString()) : null;
  }
  return typeof value === "string" ? dateOnly(value) : null;
}

function policyLimit(policy) {
  const cadence = policy ? FRESHNESS_CLASSES[policy.cadence] : null;
  return cadence ? cadence.cycleDays + (policy.releaseLagDays ?? 0) + cadence.graceDays : null;
}

function laneCadence(lane) {
  const override = LANE_CADENCE[lane.id];
  if (FRESHNESS_CLASSES[override]) return override;
  return FRESHNESS_CLASSES[lane.cadence?.kind] ? lane.cadence.kind : "daily";
}

function syntheticPolicy(lane, cadence, calendar) {
  return {
    cadence,
    releaseLagDays: 0,
    supplier: "automated",
    calendar: calendar ?? (US_TRADING_LANES.has(lane.id) ? "us_trading" : "calendar"),
  };
}

function policyForPath(lane, output) {
  return resolveSourcePolicy({
    laneId: lane.id,
    cadence: laneCadence(lane),
    path: `/${output}`,
    ...(US_TRADING_LANES.has(lane.id) ? { calendar: "us_trading" } : {}),
  });
}

function policyForMember(lane, member, fallback) {
  const cadence = MEMBER_CADENCE[lane.id]?.[member?.id];
  const calendar = MEMBER_CALENDAR[lane.id]?.[member?.id];
  if (!FRESHNESS_CLASSES[cadence] && !calendar) return fallback;
  return syntheticPolicy(lane, FRESHNESS_CLASSES[cadence] ? cadence : laneCadence(lane), calendar);
}

function widestPolicy(lane, policies) {
  const usable = policies.filter(Boolean);
  if (usable.length === 0) {
    return resolveSourcePolicy({ laneId: lane.id, cadence: laneCadence(lane) });
  }
  return usable.reduce((widest, policy) => (
    (policyLimit(policy) ?? -1) > (policyLimit(widest) ?? -1) ? policy : widest
  ));
}

function verdictForSource(sourceValue, policy, nowIso, calendars) {
  const sourceDate = dateValue(sourceValue);
  if (!validCalendarDate(sourceDate)) return { date: null, status: "unknown" };
  if (!policy) return { date: sourceDate, status: "stopped" };
  const today = policyToday(nowIso, policy);
  if (!today || sourceDate > today) return { date: sourceDate, status: "stopped" };
  const verdict = freshnessVerdict(sourceDate, policy, today, { calendars });
  return {
    date: sourceDate,
    status: Object.hasOwn(STATUS_SEVERITY, verdict.state) ? verdict.state : "stopped",
  };
}

function worstStatus(statuses) {
  const dated = statuses.filter((status) => Object.hasOwn(STATUS_SEVERITY, status));
  if (dated.length === 0) return "unknown";
  return dated.reduce((worst, status) => (
    STATUS_SEVERITY[status] > STATUS_SEVERITY[worst] ? status : worst
  ), "fresh");
}

function dataFile(dataRoot, repoRelativePath) {
  if (typeof repoRelativePath !== "string") return null;
  const relativePath = repoRelativePath.startsWith("data/")
    ? repoRelativePath.slice("data/".length)
    : repoRelativePath;
  if (!relativePath || relativePath.startsWith("/") || relativePath.split("/").includes("..")) return null;
  return path.join(dataRoot, relativePath);
}

function readOptionalJson(dataRoot, repoRelativePath) {
  const filePath = dataFile(dataRoot, repoRelativePath);
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function memberDate(value, basis = "source", id = null, sourcePath = null) {
  const date = dateValue(value);
  return {
    id,
    path: sourcePath,
    date: validCalendarDate(date) ? date : null,
    basis: validCalendarDate(date) ? basis : null,
  };
}

function dateFromDocument(document, id = null, sourcePath = null) {
  if (Array.isArray(document)) {
    const dates = document.map((row) => dateValue(row?.date)).filter(validCalendarDate).sort();
    return dates.length
      ? memberDate(dates.at(-1), "source", id, sourcePath)
      : datedOrCollected(document, [], ["fetched_at"], id, sourcePath);
  }
  for (const key of ["source_as_of", "as_of", "date", "metadata.version"]) {
    const value = key.includes(".")
      ? key.split(".").reduce((current, segment) => current?.[segment], document)
      : document?.[key];
    const result = memberDate(value, "source", id, sourcePath);
    if (result.date) return result;
  }
  return datedOrCollected(document, [], ["fetched_at"], id, sourcePath);
}

function latestSourceDateInFile(dataRoot, repoRelativePath) {
  return dateFromDocument(readOptionalJson(dataRoot, repoRelativePath));
}

function datedOrCollected(
  document,
  sourceKeys = ["source_as_of"],
  collectionKeys = ["fetched_at"],
  id = null,
  sourcePath = null,
) {
  for (const key of sourceKeys) {
    const result = memberDate(document?.[key], "source", id, sourcePath);
    if (result.date) return result;
  }
  for (const key of collectionKeys) {
    const result = memberDate(document?.[key], "collected", id, sourcePath);
    if (result.date) return result;
  }
  return memberDate(null, "source", id, sourcePath);
}

function sourceMembersForLane(lane, floorRow, dataRoot) {
  if (!dataRoot) return null;
  if (lane.id === "yahoo_etf_fallback") {
    const state = readOptionalJson(dataRoot, lane.recovery_store);
    if (!state?.items || typeof state.items !== "object" || Array.isArray(state.items)) return null;
    const members = Object.entries(state.items).map(([id, item]) => {
      const served = item?.resolution_state === "lkg_primary" ? item?.lkg : item?.current;
      return datedOrCollected({
        source_as_of: served?.source_as_of ?? item?.current?.source_as_of ?? item?.lkg?.source_as_of,
        fetched_at: served?.fetched_at ?? item?.current?.fetched_at ?? item?.lkg?.fetched_at,
      }, ["source_as_of"], ["fetched_at"], id);
    });
    return { members, totalMembers: members.length };
  }
  if (lane.id === "stockanalysis_etf_universe") {
    const document = readOptionalJson(dataRoot, "stockanalysis/etf_universe.json");
    return document ? { members: [datedOrCollected(document)], totalMembers: 1 } : null;
  }
  if (lane.id === "stockanalysis_etf_detail") {
    const coverage = readOptionalJson(dataRoot, "stockanalysis/coverage/etf_detail.json");
    const summary = coverage?.source_date_summary;
    if (!Array.isArray(summary?.source_date_histogram)) return null;
    const bucketTotal = summary.source_date_histogram.reduce((total, bucket) => (
      total + (Number.isInteger(bucket?.count) && bucket.count > 0 ? bucket.count : 0)
    ), 0);
    if (!Number.isInteger(summary.total_members) || summary.total_members < 1
      || bucketTotal !== summary.total_members) return null;
    const members = summary.source_date_histogram.flatMap((bucket) => (
      Array.from({ length: Number.isInteger(bucket?.count) ? bucket.count : 0 }, () => memberDate(
        bucket?.date,
        bucket?.basis === "collected" ? "collected" : "source",
      ))
    ));
    return {
      members,
      totalMembers: Number.isInteger(summary.total_members) ? summary.total_members : members.length,
      oldestSourceMember: typeof summary.oldest_source_member === "string" ? summary.oldest_source_member : null,
    };
  }
  if (lane.id === "stockanalysis_surfaces") {
    const document = readOptionalJson(dataRoot, "stockanalysis/surfaces/index.json");
    if (!document) return null;
    const totalMembers = Number.isInteger(document.counts?.surfaces_requested)
      ? document.counts.surfaces_requested
      : Array.isArray(document.results) ? document.results.length : 1;
    const results = Array.isArray(document.results) ? document.results : [];
    const members = results.map((result) => {
      const id = typeof result?.surface === "string" ? result.surface : null;
      const relativePath = typeof result?.path === "string"
        ? result.path.startsWith("data/") ? result.path : `stockanalysis/${result.path}`
        : id ? `stockanalysis/surfaces/${id}.json` : null;
      if (result?.status !== "ok" || !relativePath) return memberDate(null, "source", id, relativePath);
      return dateFromDocument(readOptionalJson(dataRoot, relativePath), id, relativePath);
    });
    while (members.length < totalMembers) members.push(memberDate(null));
    return { members, totalMembers };
  }
  if (lane.id === "yahoo_ticker_macro") {
    const document = readOptionalJson(dataRoot, "macro/yahoo-ticker.json");
    if (!document?.tickers || typeof document.tickers !== "object" || Array.isArray(document.tickers)) return null;
    const members = Object.entries(document.tickers).map(([id, ticker]) => datedOrCollected({
      source_as_of: ticker?.regularMarketTime,
      fetched_at: ticker?.fetched_at,
    }, ["source_as_of"], ["fetched_at"], id));
    return { members, totalMembers: members.length };
  }
  if (lane.id === "yahoo_batch_quote_history") {
    const document = readOptionalJson(dataRoot, "admin/yahoo-batch-quote-history/index.json");
    if (!document) return null;
    const symbols = Array.isArray(document.catalogue_symbols) ? document.catalogue_symbols : [];
    const members = symbols.map((id) => {
      if (typeof id !== "string" || !/^[A-Z0-9^=.-]+$/i.test(id)) return memberDate(null, "source", id);
      const state = readOptionalJson(dataRoot, `admin/yahoo-batch-quote-history/tickers/${id}.json`);
      const selected = state?.resolution_state === "lkg_primary" ? state?.lkg : state?.current;
      const source = selected?.source_as_of ?? state?.current?.source_as_of ?? state?.lkg?.source_as_of;
      const fetched = selected?.fetched_at ?? state?.current?.fetched_at ?? state?.lkg?.fetched_at;
      return datedOrCollected({ source_as_of: source, fetched_at: fetched }, ["source_as_of"], ["fetched_at"], id);
    });
    return {
      members,
      totalMembers: members.length,
      yahooBusinessDays: YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS,
    };
  }
  if (lane.id === "stockanalysis_stock_financial") {
    const observedAt = floorRow?.artifact?.fetched_at
      ?? floorRow?.artifact?.generated_at
      ?? floorRow?.artifact?.source_as_of;
    return {
      members: [datedOrCollected({ fetched_at: observedAt }, [], ["fetched_at"], lane.id)],
      totalMembers: 1,
    };
  }
  if (lane.id === "slickcharts" && Array.isArray(floorRow?.members)) {
    const recovery = readOptionalJson(dataRoot, lane.recovery_store);
    const recoveryMembers = recovery?.members && typeof recovery.members === "object"
      && !Array.isArray(recovery.members) ? recovery.members : {};
    const members = floorRow.members.map((member) => {
      const id = member?.id ?? null;
      const artifact = member?.artifact ?? member;
      const state = recoveryMembers[id];
      const promotedRun = state?.promoted_run ?? state?.current?.promoted_run ?? state?.lkg?.promoted_run;
      const receipt = state?.provider_observation?.source_floor
        ?? state?.current?.provider_observation?.source_floor
        ?? state?.lkg?.provider_observation?.source_floor;
      return datedOrCollected({
        source_as_of: artifact?.source_as_of,
      fetched_at: artifact?.fetched_at ?? promotedRun?.observed_at ?? receipt,
      }, ["source_as_of"], ["fetched_at"], id, artifact?.path ?? null);
    });
    return { members, totalMembers: members.length };
  }
  if (lane.id === "us_indices_daily") {
    const outputs = lane.roots?.canonical_outputs ?? [];
    if (outputs.length === 0) return null;
    const members = outputs.map((output) => {
      const relative = output.startsWith("data/") ? output.slice("data/".length) : output;
      return dateFromDocument(readOptionalJson(dataRoot, relative), path.basename(output, path.extname(output)), output);
    });
    return { members, totalMembers: outputs.length };
  }
  if (lane.id === "edgar_filings") {
    // The floor artifact carries the newest filing date, which is the provider's
    // content, not the collection. The lane is weekly, so the weekly collection
    // clock is the honest basis for the verdict.
    const document = readOptionalJson(dataRoot, "edgar-korean-summaries/index.json");
    if (!document) return null;
    const collected = datedOrCollected(
      document,
      [],
      ["updated", "generatedAt"],
      lane.id,
      "edgar-korean-summaries/index.json",
    );
    return { members: [collected], totalMembers: 1 };
  }
  if (lane.id === "sentiment") {
    const document = readOptionalJson(dataRoot, "admin/sentiment/index.json");
    const items = document?.items && typeof document.items === "object" && !Array.isArray(document.items)
      ? document.items
      : {};
    const ids = Array.isArray(lane.provider_members) ? lane.provider_members : Object.keys(items).sort();
    const members = ids.map((id) => {
      const item = items[id];
      const served = item?.resolution_state === "lkg_primary" ? item?.lkg : item?.current;
      return datedOrCollected({
        source_as_of: item?.provider_observation?.source_as_of ?? served?.source_as_of,
        fetched_at: served?.fetched_at ?? item?.provider_observation?.observed_at ?? item?.updated_at,
      }, ["source_as_of"], ["fetched_at"], id);
    });
    return { members, totalMembers: members.length };
  }
  if (lane.id === "benchmarks") {
    const outputs = lane.roots?.canonical_outputs ?? [];
    const members = outputs.filter((output) => output.endsWith(".json")).map((output) => {
      const relative = output.startsWith("data/") ? output.slice("data/".length) : output;
      return dateFromDocument(readOptionalJson(dataRoot, relative), path.basename(output, path.extname(output)), output);
    });
    return members.length > 1 ? { members, totalMembers: members.length } : null;
  }
  if (Array.isArray(floorRow?.source_artifacts) && floorRow.source_artifacts.length > 1) {
    const members = floorRow.source_artifacts.map((artifact) => datedOrCollected(
      artifact,
      ["source_as_of"],
      ["fetched_at"],
      artifact?.id ?? null,
      artifact?.path ?? null,
    ));
    return { members, totalMembers: members.length };
  }
  if (Array.isArray(floorRow?.members) && floorRow.members.length > 1) {
    const members = floorRow.members.map((member) => datedOrCollected(
      member?.artifact ?? member,
      ["source_as_of"],
      ["fetched_at"],
      member?.id ?? null,
      member?.artifact?.path ?? null,
    ));
    return { members, totalMembers: members.length };
  }
  return null;
}

function memberSummary(lane, evidence, nowIso, calendars) {
  const outputs = lane.roots?.canonical_outputs ?? [];
  const policies = outputs.map((output) => policyForPath(lane, output));
  const policy = widestPolicy(lane, policies);
  const memberPolicies = evidence.members.map((member) => policyForMember(
    lane,
    member,
    member.path ? policyForPath(lane, member.path) : policy,
  ));
  const members = evidence.members.map((member, index) => {
    let verdict;
    if (Number.isInteger(evidence.yahooBusinessDays)) {
      const age = member.date ? yahooBusinessDayAge(member.date, nowIso, member.id) : null;
      verdict = {
        date: member.date,
        status: Number.isFinite(age)
          ? age <= evidence.yahooBusinessDays ? "fresh" : "stopped"
          : "unknown",
      };
    } else {
      verdict = verdictForSource(member.date, memberPolicies[index] ?? policy, nowIso, calendars);
    }
    return { ...member, ...verdict };
  });
  const dated = members.filter((member) => member.date).sort((left, right) => (
    left.date.localeCompare(right.date) || String(left.id ?? "").localeCompare(String(right.id ?? ""))
  ));
  const dates = dated.map((member) => member.date);
  const observedBases = new Set(dated.map((member) => member.basis).filter(Boolean));
  const dateBasis = observedBases.size > 1 ? "mixed" : observedBases.values().next().value;
  const freshMembers = members.filter((member) => member.status === "fresh").length;
  const totalMembers = Number.isInteger(evidence.totalMembers) ? evidence.totalMembers : members.length;
  const multiMember = totalMembers > 1;
  const status = dated.length === 0
    ? "unknown"
    : multiMember
      ? freshMembers * 100 >= totalMembers * 95
        ? "fresh"
        : freshMembers * 100 >= totalMembers * 80 ? "delayed" : "stopped"
      : worstStatus(members.map((member) => member.status));
  const maxAge = evidence.yahooBusinessDays
    ? `${evidence.yahooBusinessDays}bd`
    : policyLimit(policy);
  const oldest = dated[0] ?? null;
  const newest = dated.at(-1) ?? null;
  const fredLimits = lane.id === "fred_banking"
    ? memberPolicies.map(policyLimit).filter(Number.isFinite)
    : [];
  return {
    newest_source_date: newest?.date ?? null,
    max_age: evidence.yahooBusinessDays ? maxAge : fredLimits.length > 0 ? `${Math.min(...fredLimits)}d` : maxAge === null ? null : `${maxAge}d`,
    status,
    ...(dateBasis ? { date_basis: dateBasis } : {}),
    ...(multiMember ? {
      oldest_source_date: oldest?.date ?? null,
      oldest_source_member: evidence.oldestSourceMember ?? oldest?.id ?? null,
      fresh_members: freshMembers,
      total_members: totalMembers,
    } : {}),
  };
}

export function publicServedPath(lane) {
  if (PUBLIC_SERVED_PATHS[lane.id]) return PUBLIC_SERVED_PATHS[lane.id];
  const roots = lane.roots ?? {};
  const approved = lane.privacy_class === "private"
    ? [...(lane.public_canonical_outputs ?? []), ...(roots.public_mirror ?? [])]
    : lane.privacy_class === "public_safe_aggregate"
      ? roots.public_mirror ?? []
      : roots.canonical_outputs ?? [];
  for (const item of approved) {
    if (typeof item !== "string" || item.split("/").includes("..")) continue;
    if (item.startsWith("data/")) return item;
    if (item.startsWith("100xfenok-next/public/data/")) {
      return item.slice("100xfenok-next/public/".length);
    }
  }
  return null;
}

export function summarizeDataSetFreshness(
  lane,
  floorRow,
  nowIso,
  calendars = DETECTION_CALENDARS,
  dataRoot = null,
) {
  const outputs = lane.roots?.canonical_outputs ?? [];
  const outputPolicies = outputs.map((output) => policyForPath(lane, output));
  const policy = widestPolicy(lane, outputPolicies);
  const memberEvidence = sourceMembersForLane(lane, floorRow, dataRoot);
  if (memberEvidence) return memberSummary(lane, memberEvidence, nowIso, calendars);

  const sourceDate = memberDate(floorRow?.artifact?.source_as_of);
  const collectedDate = sourceDate.date
    ? sourceDate
    : memberDate(floorRow?.artifact?.fetched_at, "collected");
  const result = verdictForSource(collectedDate.date, policy, nowIso, calendars);
  const limit = policyLimit(policy);
  return {
    newest_source_date: result.date,
    max_age: limit === null ? null : `${limit}d`,
    status: result.status,
    ...(result.date && collectedDate.basis === "collected" ? { date_basis: "collected" } : {}),
  };
}

export function readDetectionFloorRows(dataRoot) {
  let document;
  try {
    document = JSON.parse(fs.readFileSync(path.join(dataRoot, "admin", "data-supply-detection-floor.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw error;
  }
  if (!document || typeof document !== "object" || Array.isArray(document) || !Array.isArray(document.lanes)) {
    throw new Error("malformed data supply detection floor");
  }
  const rows = new Map();
  for (const row of document.lanes) {
    if (typeof row?.id !== "string" || rows.has(row.id)) {
      throw new Error("malformed or duplicate detection floor lane");
    }
    rows.set(row.id, row);
  }
  return rows;
}
