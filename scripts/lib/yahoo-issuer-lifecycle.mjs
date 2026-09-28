import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "./json-canonical.mjs";
import { isRealCalendarDate } from "./market-calendar.mjs";

const POLICY_REL = path.posix.join("admin", "yahoo-batch-quote-history", "issuer-lifecycle.json");
const SYMBOL = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const integer = (value) => typeof value === "number" && Number.isInteger(value) && value >= 0;
const stampMs = (value) => typeof value === "string" && STAMP.test(value) && isRealCalendarDate(value.slice(0, 10))
  && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60
  ? new Date(value).getTime() : NaN;
const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const sortedUniqueSymbols = (value) => Array.isArray(value) && value.every((item) => typeof item === "string" && SYMBOL.test(item))
  && JSON.stringify(value) === JSON.stringify([...new Set(value)].sort());
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function sourceIdentity(dataRoot, target, after, nowMs) {
  const bytes = fs.readFileSync(path.join(dataRoot, "yf", "finance", `${target}.json`));
  const payload = JSON.parse(bytes);
  const info = payload?.data?.info;
  const bars = payload?.data?.history_1y;
  let epoch = info?.regularMarketTime;
  if (typeof epoch !== "number" || !Number.isFinite(epoch)) throw new Error("successor_quote_invalid");
  if (epoch > 10_000_000_000) epoch /= 1000;
  const quote = new Date(Math.floor(epoch) * 1000).toISOString().replace(/\.000Z$/, "Z");
  const dates = Array.isArray(bars) ? bars.map((bar) => bar?.date?.slice?.(0, 10)).filter(isRealCalendarDate).sort() : [];
  const history = dates.at(-1);
  const source = history && history <= quote.slice(0, 10) ? history : quote;
  const fetchedMs = stampMs(payload?.fetched_at);
  const price = info?.regularMarketPrice ?? info?.currentPrice;
  if (payload?.schema_version !== "yf-finance/v2" || payload?.ticker !== target || info?.symbol !== target
      || !positive(price) || !history || !bars.some((bar) => bar?.date?.slice?.(0, 10) === history && positive(bar?.Close))
      || !Number.isFinite(fetchedMs) || fetchedMs > nowMs || new Date(quote).getTime() > fetchedMs
      || new Date(history).getTime() > nowMs || new Date(history).getTime() > fetchedMs + 14 * 3600000
      || source.slice(0, 10) < after
      || ["quote_as_of", "history_as_of", "source_as_of"].some((key) => Object.hasOwn(payload, key)
        && payload[key] !== ({quote_as_of: quote, history_as_of: history, source_as_of: source})[key])) {
    throw new Error("successor_identity_invalid");
  }
  // A later actual payload may advance the provider bytes. The issuer identity
  // remains valid while ordinary live-lane freshness still judges its source age.
  return {source, sha256: digest(bytes)};
}

// Independently verify issuer facts from canonical files, without a Yahoo state partition.
export function readVerifiedYahooIssuerPolicy({dataRoot = null, nowIso, evaluatedAt = nowIso, expectedSha256 = null} = {}) {
  const fail = (reason) => ({valid: false, reasons: [reason], rows: new Map(), sha256: null});
  if (typeof dataRoot !== "string" || !dataRoot) return fail("canonical_data_root_required");
  const nowMs = stampMs(nowIso);
  const evaluatedMs = stampMs(evaluatedAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(evaluatedMs) || evaluatedMs > nowMs) return fail("issuer_policy_clock_invalid");
  if (expectedSha256 !== null && !SHA256.test(expectedSha256)) return fail("canonical_policy_hash_invalid");
  let bytes;
  let policy;
  try {
    bytes = fs.readFileSync(path.join(dataRoot, POLICY_REL));
    policy = JSON.parse(bytes);
  } catch {
    return fail("canonical_policy_unreadable");
  }
  if (expectedSha256 !== null && digest(bytes) !== expectedSha256) return fail("canonical_policy_hash_mismatch");
  if (policy?.schema_version !== "yahoo-issuer-lifecycle/v1" || !Array.isArray(policy?.events)) return fail("policy_envelope_invalid");
  const rows = new Map();
  const cutoff = evaluatedAt.slice(0, 10);
  const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && isRealCalendarDate(value) && value <= cutoff;
  try {
    for (const row of policy.events) {
      if (!row || typeof row !== "object" || typeof row.symbol !== "string" || !SYMBOL.test(row.symbol) || rows.has(row.symbol)
          || !["issuer_announced_redemption", "issuer_completed_acquisition", "ticker_rename"].includes(row.event)) {
        throw new Error("issuer_event_invalid");
      }
      let after = row.effective_date;
      if (row.event !== "ticker_rename" && ["announced_month", "after_market_close_date", "eligibility_after", "eligibility_basis"].some((key) => row[key] != null)) {
        throw new Error("completed_event_boundary_conflict");
      }
      if (row.event === "ticker_rename" && row.announced_month != null) {
        const month = row.announced_month;
        if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month) || !isRealCalendarDate(`${month}-01`)) throw new Error("rename_month_invalid");
        const [year, number] = month.split("-").map(Number);
        after = `${String(year + (number === 12 ? 1 : 0)).padStart(4, "0")}-${String(number % 12 + 1).padStart(2, "0")}-01`;
        if (row.effective_date != null || row.after_market_close_date != null || row.eligibility_basis !== "after_announced_month" || row.eligibility_after !== after) throw new Error("rename_month_boundary_invalid");
      } else if (row.event === "ticker_rename" && row.after_market_close_date != null) {
        if (!validDate(row.after_market_close_date)) throw new Error("rename_after_close_date_invalid");
        after = new Date(new Date(`${row.after_market_close_date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
        if (row.effective_date != null || row.announced_month != null || row.eligibility_basis !== "after_market_close" || row.eligibility_after !== after) {
          throw new Error("rename_after_close_boundary_invalid");
        }
      } else if (["eligibility_after", "eligibility_basis"].some((key) => row[key] != null)) throw new Error("exact_date_boundary_conflict");
      if (!validDate(after) || typeof row.issuer !== "string" || !row.issuer.trim()) throw new Error("issuer_date_or_name_invalid");
      for (const key of ["notice_date", "source_published_date", "settlement_amount_notice_date", "last_trading_date_expected", "settlement_date_expected"]) {
        if (row[key] != null && !validDate(row[key])) throw new Error("issuer_evidence_date_invalid");
      }
      const domain = row.primary_source_domain;
      if (typeof domain !== "string" || !/^[a-z0-9]+(?:[.\-][a-z0-9]+)*\.[a-z]{2,}$/.test(domain)
          || /\.(local|internal|test|invalid|example)$/.test(domain) || !Array.isArray(row.source_urls) || row.source_urls.length === 0) {
        throw new Error("issuer_primary_source_invalid");
      }
      for (const text of row.source_urls) {
        const url = new URL(text);
        if (typeof text !== "string" || text !== text.trim() || /\s/.test(text) || url.protocol !== "https:"
            || (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) || url.username || url.password || url.port || url.pathname === "/") {
          throw new Error("issuer_primary_url_invalid");
        }
      }
      if (row.event === "ticker_rename") {
        if (typeof row.alias_target !== "string" || !SYMBOL.test(row.alias_target) || row.alias_target === row.symbol) throw new Error("alias_target_invalid");
      } else if (row.alias_target != null) throw new Error("completed_event_alias_invalid");
      if (row.event === "issuer_announced_redemption" && row.payment_status !== "not_verified") throw new Error("redemption_payment_unverified_required");
      rows.set(row.symbol, {row, after});
    }
    for (const {row, after} of rows.values()) {
      if (row.event !== "ticker_rename") continue;
      if (rows.has(row.alias_target)) throw new Error("alias_conflict_or_cycle");
      sourceIdentity(dataRoot, row.alias_target, after, nowMs);
    }
  } catch {
    return fail("issuer_policy_or_successor_invalid");
  }
  return {valid: true, reasons: [], rows, sha256: digest(bytes)};
}

export function assessYahooIssuerLifecycle(state, {dataRoot = null, nowIso = state?.generated_at} = {}) {
  const counts = state?.counts ?? {};
  const active = counts.active;
  const eligible = counts.eligible ?? active;
  const inactive = counts.lifecycle_inactive ?? 0;
  const result = {valid: false, reasons: [], active, eligible, inactive, projection: null};
  const fail = (reason) => { result.reasons.push(reason); return result; };
  if (![active, eligible, inactive].every(integer) || eligible + inactive !== active) return fail("eligibility_equation_invalid");
  const metadata = state?.issuer_lifecycle_policy;
  const noRows = (value) => value == null || (Array.isArray(value) && value.length === 0);
  if (metadata == null && inactive === 0 && eligible === active
      && noRows(state?.lifecycle_inactive_symbols) && noRows(state?.issuer_lifecycle_details)) {
    return {...result, valid: true};
  }
  if (typeof dataRoot !== "string" || !dataRoot) return fail("canonical_data_root_required");
  const evaluatedMs = stampMs(metadata?.evaluated_at);
  const nowMs = stampMs(nowIso);
  const scope = state?.active_universe_scope;
  const attempt = state?.current_attempt;
  if (state?.schema_version !== "yahoo-batch-quote-history-index/v1" || state?.lane_id !== "yahoo_batch_quote_history"
      || !["all_sources", "core_etf"].includes(scope) || metadata?.active_universe_scope !== scope
      || metadata?.path !== POLICY_REL || !SHA256.test(metadata?.sha256 ?? "")
      || !Number.isFinite(evaluatedMs) || !Number.isFinite(nowMs) || evaluatedMs > nowMs
      || metadata?.evaluated_at !== state?.generated_at
      || typeof attempt?.run_id !== "string" || !attempt.run_id
      || !integer(attempt?.run_attempt) || attempt.run_attempt < 1
      || metadata?.run_id !== attempt.run_id || metadata?.run_attempt !== attempt.run_attempt
      || typeof attempt?.event_name !== "string" || !attempt.event_name || metadata?.event_name !== attempt.event_name) {
    return fail("policy_index_binding_invalid");
  }
  if (!sortedUniqueSymbols(state?.catalogue_symbols) || state.catalogue_symbols.length !== active
      || !sortedUniqueSymbols(state?.lifecycle_inactive_symbols)) return fail("catalogue_or_inactive_symbols_invalid");
  const verifiedPolicy = readVerifiedYahooIssuerPolicy({dataRoot, nowIso, evaluatedAt: metadata.evaluated_at, expectedSha256: metadata.sha256});
  if (!verifiedPolicy.valid) return fail(verifiedPolicy.reasons[0]);
  const rows = verifiedPolicy.rows;
  const catalogue = new Set(state.catalogue_symbols);
  const expected = [...rows.keys()].filter((symbol) => catalogue.has(symbol)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(state.lifecycle_inactive_symbols) || expected.length !== inactive) return fail("scoped_inactive_set_mismatch");
  const details = state.issuer_lifecycle_details;
  if (!Array.isArray(details) || details.length !== inactive || JSON.stringify(details.map((row) => row?.symbol)) !== JSON.stringify(expected)) return fail("issuer_details_set_mismatch");
  for (const detail of details) {
    const {row, after} = rows.get(detail.symbol);
    const copy = {...detail};
    if (row.event === "ticker_rename") {
      const source = copy.alias_target_source_as_of;
      if (!SHA256.test(copy.alias_target_payload_sha256 ?? "") || typeof source !== "string"
          || !isRealCalendarDate(source.slice(0, 10)) || source.slice(0, 10) < after
          || !Number.isFinite(new Date(source).getTime()) || new Date(source).getTime() > evaluatedMs) return fail("alias_qualification_evidence_invalid");
      delete copy.alias_target_payload_sha256;
      delete copy.alias_target_source_as_of;
    }
    if (canonicalJson(copy) !== canonicalJson(row)) return fail("issuer_details_policy_mismatch");
  }
  const allowed = ["symbol", "event", "effective_date", "effective_date_basis", "issuer", "primary_source_domain", "source_urls",
    "notice_date", "source_published_date", "settlement_amount_notice_date", "last_trading_date_expected", "settlement_date_expected",
    "payment_status", "alias_target", "announced_month", "after_market_close_date", "eligibility_after", "eligibility_basis"];
  const events = expected.map((symbol) => Object.fromEntries(allowed.filter((key) => Object.hasOwn(rows.get(symbol).row, key))
    .map((key) => [key, rows.get(symbol).row[key]])));
  const projection = {policy_ref: "yahoo-issuer-lifecycle", sha256: metadata.sha256, evaluated_at: metadata.evaluated_at,
    scope, attempt_ref: metadata.run_id, attempt_number: metadata.run_attempt, inactive_symbols: expected, events};
  if (JSON.stringify(projection).includes(POLICY_REL) || JSON.stringify(projection).includes("_private/")) return fail("issuer_public_projection_invalid");
  return {...result, valid: true, projection};
}
