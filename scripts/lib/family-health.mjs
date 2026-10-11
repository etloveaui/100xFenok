// One family record. Source freshness is deliberately unevaluated until the
// shared calendar model supplies it; byte parity is not a freshness verdict.
export const ETF_FAMILY = "stockanalysis-etf-detail";
export const FAMILY_HEALTH_SCHEMA = "family-health/1";
export const HEALTH_REFRESH_MS = 24 * 60 * 60 * 1000;
export const healthKey = (family = ETF_FAMILY) => `health/${family}.json`;

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
  return validateFamilyHealth({
    schema_version: FAMILY_HEALTH_SCHEMA, family: ETF_FAMILY,
    observed_at: snapshot.observed_at, updated_at: now,
    reference: { ...snapshot.reference, assets: undefined },
    plane: { generation_id: snapshot.manifest.generation_id, pointer_sequence: snapshot.pointer.sequence },
    source_health: { status: "not_evaluated", reason: "shared_calendar_model_pending" },
    last_publication_cycle: newCycle ? cycle : last,
    members,
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
  return { ...row, status: record.parity.alarm_reasons.length ? "alarm" : "ok",
    alarm_reasons: [...record.parity.alarm_reasons], streak: record.parity.behind_publication_cycles,
    parity: record.parity, reference: record.reference };
}
