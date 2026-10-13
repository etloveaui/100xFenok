import rotation from "./etf-detail-rotation-policy.json" with { type: "json" };

// One family record, with separate served-source and publication-parity scopes.
export const ETF_FAMILY = "stockanalysis-etf-detail";
export const FAMILY_HEALTH_SCHEMA = "family-health/1";
export const HEALTH_REFRESH_MS = 24 * 60 * 60 * 1000;
export const healthKey = (family = ETF_FAMILY) => `health/${family}.json`;

// Selection state records the publication decision. Source freshness is a
// present-time observation and must never mutate that immutable decision.
export function sourceFreshness(sourceAsOf, now, policy) {
  const age = Date.parse(now) - Date.parse(sourceAsOf);
  if (!sourceAsOf || !Number.isFinite(age) || age < 0
    || !Number.isFinite(policy?.fresh_ttl_hours) || !Number.isFinite(policy?.emergency_lkg_ttl_days)) return "unknown";
  if (age <= policy.fresh_ttl_hours * 3600_000) return "fresh";
  return age <= policy.emergency_lkg_ttl_days * 86400_000 ? "stale" : "expired";
}

export function buildDetailRefreshCadence(universe, core) {
  const records = universe?.records, coreTickers = core?.daily_refresh_universe?.tickers;
  if (!Array.isArray(records) || !records.length || !Array.isArray(coreTickers)) return null;
  const aums = new Map(records.filter(row => Number.isFinite(row?.aum) && row.aum > 0)
    .map(row => [String(row.ticker ?? row.s ?? "").toUpperCase(), row.aum]));
  const ranked = [...aums.keys()].sort((a, b) => aums.get(b) - aums.get(a) || (a < b ? -1 : a > b ? 1 : 0));
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const newFunds = records.filter(row => {
    const day = Date.parse(row?.inceptionDate ?? row?.inception);
    const age = (today - day) / 86400_000;
    return Number.isFinite(age) && age >= 0 && age <= rotation.new_fund_observation_days;
  }).map(row => String(row.ticker ?? row.s ?? "").toUpperCase()).filter(Boolean);
  const dailyWatch = rotation.daily_market_watch_tickers.filter(ticker => aums.has(ticker));
  return { schema_version: rotation.schema_version, core_tickers: [...new Set([...coreTickers, ...dailyWatch])].sort(),
    tier2_tickers: ranked.slice(0, rotation.tier2_size), new_fund_tickers: [...new Set(newFunds)].sort() };
}

export function detailSourcePolicy(ticker, cadence, emergencyDays) {
  if (cadence?.schema_version !== rotation.schema_version
    || !Array.isArray(cadence.core_tickers) || !Array.isArray(cadence.tier2_tickers)) return null;
  const core = cadence.core_tickers.includes(ticker);
  const interval = core ? rotation.core_interval_days : cadence.tier2_tickers.includes(ticker)
    ? rotation.tier2_interval_days : cadence.new_fund_tickers?.includes(ticker)
      ? rotation.new_fund_interval_days : rotation.tail_interval_days;
  // Both core and general run on weekdays and Sunday. Allow one complete
  // declared inter-run gap (2 days) for a delayed/missed attempt.
  const weekdays = rotation.general_weekdays_utc;
  const grace = Math.max(...weekdays.map((day, i) => ((weekdays[(i + 1) % weekdays.length] - day + 7) % 7) || 7));
  return { interval_days: interval, grace_days: grace,
    fresh_ttl_hours: (interval + grace) * 24,
    emergency_lkg_ttl_days: Math.max(interval * rotation.expiry_interval_multiplier, emergencyDays, interval + grace) };
}

export function etfSourceMembers(index, policy, cadence = index?.detail_refresh_cadence, fallbackOnly = false) {
  if (index?.schema_version !== "data-supply-etf-detail-public-index/v1"
    || !index.entries || typeof index.entries !== "object" || Array.isArray(index.entries)) return null;
  const entries = Object.entries(index.entries);
  if (entries.length !== index.enrolled_count
    || entries.some(([ticker, row]) => row?.ticker !== ticker || row.enrollment_state !== "enrolled")) return null;
  return entries.filter(([, row]) => !fallbackOnly || row.provider_role === "fallback")
    .map(([member, row]) => ({ member, source_as_of: row.resolution_state === "unavailable" ? null : row.source_as_of,
      refresh_policy: detailSourcePolicy(member, cadence, policy.emergency_lkg_ttl_days) }));
}

export function summarizeSourceHealth(members, now, policy) {
  const rows = members.map(row => ({ ...row,
    source_freshness: sourceFreshness(row.source_as_of, now,
      Object.hasOwn(row, "refresh_policy") ? row.refresh_policy : policy) }));
  const counts = { fresh: 0, stale: 0, expired: 0, unknown: 0 };
  for (const row of rows) counts[row.source_freshness] += 1;
  const dated = rows.filter(row => row.source_freshness !== "unknown")
    .sort((a, b) => Date.parse(a.source_as_of) - Date.parse(b.source_as_of) || a.member.localeCompare(b.member));
  const ratio = rows.length ? counts.fresh / rows.length : 0;
  const bounds = rows.map(row => row.refresh_policy).filter(Boolean);
  return { observed_at: now, scope: "detail", policy: bounds.length ? {
    basis: "member_rotation", interval_days: [...new Set(bounds.map(p => p.interval_days))].sort((a,b)=>a-b),
    grace_days: [...new Set(bounds.map(p => p.grace_days))].sort((a,b)=>a-b),
    fresh_bound_days: [...new Set(bounds.map(p => p.fresh_ttl_hours / 24))].sort((a,b)=>a-b),
    expired_bound_days: [...new Set(bounds.map(p => p.emergency_lkg_ttl_days))].sort((a,b)=>a-b),
  } : { fresh_ttl_hours: policy.fresh_ttl_hours, emergency_lkg_ttl_days: policy.emergency_lkg_ttl_days },
    status: !rows.length ? "unknown" : ratio >= 0.95 ? "fresh" : ratio >= 0.8 ? "degraded" : "stopped",
    reason: !rows.length ? "members_unavailable" : ratio >= 0.95 ? null : "member_ratio_low",
    total_members: rows.length, fresh_members: counts.fresh, counts,
    oldest_source_date: dated[0]?.source_as_of ?? null,
    oldest_source_member: dated[0]?.member ?? null,
    newest_source_date: dated.at(-1)?.source_as_of ?? null };
}

export function validateFamilyHealth(record, family = ETF_FAMILY) {
  if (record?.schema_version !== FAMILY_HEALTH_SCHEMA || record.family !== family
    || !Number.isFinite(Date.parse(record.observed_at))
    || !Number.isFinite(Date.parse(record.updated_at))
    || !record.reference || !Array.isArray(record.members)
    || !Number.isSafeInteger(record.parity?.behind_publication_cycles)
    || record.parity.behind_publication_cycles < 0
    || !Array.isArray(record.parity.alarm_reasons)
    || record.parity.alarm_reasons.some(reason => reason !== "plane_behind_canonical")) {
    throw new Error("FAMILY_HEALTH_INVALID");
  }
  for (const key of ["matched", "mismatched", "missing_plane", "plane_only", "plane_older"]) {
    if (!Number.isSafeInteger(record.parity[key]) || record.parity[key] < 0) throw new Error("FAMILY_HEALTH_COUNTS_INVALID");
  }
  if (record.last_publication_cycle !== null && !/^[1-9]\d*$/.test(record.last_publication_cycle)) {
    throw new Error("FAMILY_HEALTH_CYCLE_INVALID");
  }
  if ((record.parity.behind_publication_cycles > 1)
    !== record.parity.alarm_reasons.includes("plane_behind_canonical")) throw new Error("FAMILY_HEALTH_REASON_INVALID");
  if (record.lifecycle) {
    const rows = record.lifecycle.orphans;
    if (!Array.isArray(rows) || record.lifecycle.orphan_count !== rows.length
      || new Set(rows.map(row => row.ticker)).size !== rows.length
      || rows.some(row => !/^[A-Z0-9][A-Z0-9.-]*$/.test(row.ticker)
        || !Number.isFinite(Date.parse(row.first_seen_at))
        || Date.parse(row.first_seen_at) > Date.parse(record.observed_at))) throw new Error("FAMILY_HEALTH_ORPHANS_INVALID");
    const overdue = rows.filter(row => Date.parse(record.observed_at) - Date.parse(row.first_seen_at) > 14 * 86400_000).length;
    if (record.lifecycle.overdue_count !== overdue
      || JSON.stringify(record.lifecycle.alarm_reasons) !== JSON.stringify(overdue ? ["orphan_unclassified_over_14_days"] : [])) throw new Error("FAMILY_HEALTH_ORPHAN_REASON_INVALID");
  }
  const assets = side => record.members.filter(row => row[side]).map(row => ({ path: row.member, ...row[side] }));
  const derived = compareFamilyMembers(assets("reference"), assets("plane"));
  if (derived.members.length !== record.members.length
    || Object.keys(derived.counts).some(key => derived.counts[key] !== record.parity[key])
    || record.members.some((row, index) => row.member !== derived.members[index].member
      || row.status !== derived.members[index].status || row.plane_older !== derived.members[index].plane_older)) {
    throw new Error("FAMILY_HEALTH_MEMBERSHIP_INVALID");
  }
  return record;
}

export function compareFamilyMembers(referenceAssets, planeAssets) {
  const index = (assets) => {
    const map = new Map();
    for (const asset of assets) {
      if (!asset.path?.startsWith("data/stockanalysis/etfs/")
        || asset.path.split("/").some(part => !part || part === "." || part === "..")
        || asset.path.includes("\\") || !/^[a-f0-9]{64}$/.test(asset.sha256)
        || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0
        || !Number.isFinite(Date.parse(asset.source_as_of)) || map.has(asset.path)) {
        throw new Error("FAMILY_HEALTH_MEMBER_INVALID");
      }
      map.set(asset.path, asset);
    }
    if (!map.size) throw new Error("FAMILY_HEALTH_EMPTY");
    return map;
  };
  const reference = index(referenceAssets), plane = index(planeAssets);
  const counts = { matched: 0, mismatched: 0, missing_plane: 0, plane_only: 0, plane_older: 0 };
  const members = [...new Set([...reference.keys(), ...plane.keys()])].sort().map(member => {
    const a = reference.get(member), b = plane.get(member);
    const status = !a ? "plane_only" : !b ? "missing_plane"
      : a.sha256 === b.sha256 && a.bytes === b.bytes ? "matched" : "mismatched";
    const planeOlder = Boolean(a && b && Date.parse(b.source_as_of) < Date.parse(a.source_as_of));
    counts[status] += 1;
    if (planeOlder) counts.plane_older += 1;
    const summary = asset => asset ? { sha256: asset.sha256, bytes: asset.bytes, source_as_of: asset.source_as_of } : null;
    return { member, status, plane_older: planeOlder, reference: summary(a), plane: summary(b) };
  });
  return { counts, members };
}

export function buildFamilyHealth({ snapshot, previous = null, cycle = null, now = new Date().toISOString() }) {
  if (previous) validateFamilyHealth(previous);
  if (cycle !== null && !/^[1-9]\d*$/.test(cycle)) throw new Error("FAMILY_HEALTH_CYCLE_INVALID");
  const { counts, members } = compareFamilyMembers(snapshot.reference.assets, snapshot.manifest.assets);
  const last = previous?.last_publication_cycle ?? null;
  const newCycle = cycle !== null && (last === null || BigInt(cycle) > BigInt(last));
  const streak = newCycle
    ? counts.plane_older > 0 ? (previous?.parity.behind_publication_cycles ?? 0) + 1 : 0
    : previous?.parity.behind_publication_cycles ?? 0;
  const priorOrphans = new Map((previous?.lifecycle?.orphans ?? []).map(row => [row.ticker, row]));
  const orphanRows = (snapshot.reference.lifecycle?.orphans ?? []).map(row => ({ ...row,
    first_seen_at: row.first_seen_at ?? priorOrphans.get(row.ticker)?.first_seen_at ?? snapshot.observed_at }));
  const overdue = orphanRows.filter(row => Date.parse(snapshot.observed_at) - Date.parse(row.first_seen_at) > 14 * 86400_000).length;
  return validateFamilyHealth({
    schema_version: FAMILY_HEALTH_SCHEMA, family: ETF_FAMILY,
    observed_at: snapshot.observed_at, updated_at: now,
    reference: { ...snapshot.reference, assets: undefined, lifecycle: undefined },
    plane: { generation_id: snapshot.manifest.generation_id, pointer_sequence: snapshot.pointer.sequence },
    source_health: Array.isArray(snapshot.reference.source_members)
      ? summarizeSourceHealth(snapshot.reference.source_members, now, snapshot.reference.source_policy)
      : { status: "unavailable", reason: "served_source_members_unavailable" },
    last_publication_cycle: newCycle ? cycle : last,
    members,
    lifecycle: { orphan_count: orphanRows.length, orphans: orphanRows, overdue_count: overdue,
      live_catalogue_gaps: snapshot.reference.lifecycle?.live_catalogue_gaps ?? [],
      alarm_reasons: overdue ? ["orphan_unclassified_over_14_days"] : [] },
    parity: { ...counts, status: counts.mismatched + counts.missing_plane + counts.plane_only + counts.plane_older ? "degraded" : "ok",
      behind_publication_cycles: streak,
      alarm_reasons: streak > 1 ? ["plane_behind_canonical"] : [] },
  });
}

// Independent alarm: a dead/unreadable R2 writer cannot silence its witness.
export function classifyFamilyHealth(record, { now = Date.now(), family = ETF_FAMILY } = {}) {
  const row = { file: `family-health:${family}`, label: `${family} family health`, family,
    last_timestamp: record?.observed_at ?? null, streak: 0 };
  let invalid = false;
  try { validateFamilyHealth(record, family); } catch { invalid = true; }
  const age = now - Date.parse(record?.observed_at);
  if (invalid || !Number.isFinite(age) || age > 2 * HEALTH_REFRESH_MS || age < -5 * 60 * 1000) {
    return { ...row, status: "alarm", alarm_reasons: ["health_record_stale"],
      message: invalid ? "Family record is missing, unreadable or invalid" : "Family record is outside its 48-hour refresh bound" };
  }
  const reasons = [...record.parity.alarm_reasons, ...(record.lifecycle?.alarm_reasons ?? [])];
  return { ...row, status: reasons.length ? "alarm" : "ok",
    alarm_reasons: reasons, streak: record.parity.behind_publication_cycles,
    parity: record.parity, lifecycle: record.lifecycle, reference: record.reference };
}
