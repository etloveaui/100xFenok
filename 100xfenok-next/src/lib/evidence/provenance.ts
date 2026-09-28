/**
 * Evidence provenance helpers (slice-5 E3).
 *
 * The drawer behind EvidenceRail "증거 보기" shows five hosted stages:
 * 수집 / 검증 / 발행 / 제공 / 다음. Sources:
 *  - 수집 + 검증: public data-health KPI (committed public mirror, no new writer).
 *  - 발행: public publish-outcome projection inside the KPI envelope (E3 backend).
 *  - 제공: this session's fetch boundary stamps (X-100x-Cache + receive time).
 *  - 다음: public lane-registry projection (latest/next expected slot per lane).
 */

export type EvidenceStageTone = "ok" | "warn" | "bad" | "muted";

export type EvidenceStage = {
  stage: "수집" | "원천" | "검증" | "발행" | "제공" | "다음";
  detail: string;
  at?: string | null;
  tone?: EvidenceStageTone;
};

export type ServingInfo = {
  servedAt: number;
  cacheHit: boolean | null;
};

const servingStamps = new Map<string, ServingInfo>();

export function recordServing(url: string, headers: Headers | null): void {
  let cacheHit: boolean | null = null;
  try {
    const value = headers?.get("X-100x-Cache");
    cacheHit = value ? value.toUpperCase() === "HIT" : null;
  } catch {
    cacheHit = null;
  }
  servingStamps.set(url, { servedAt: Date.now(), cacheHit });
}

export function getServingInfo(url: string): ServingInfo | null {
  return servingStamps.get(url) ?? null;
}

export function summarizeAllServing(): {
  latestServedAt: number | null;
  hitCount: number;
  stampedCount: number;
} {
  let latestServedAt: number | null = null;
  let hitCount = 0;
  let stampedCount = 0;
  for (const info of servingStamps.values()) {
    stampedCount += 1;
    if (info.cacheHit) hitCount += 1;
    if (latestServedAt === null || info.servedAt > latestServedAt) latestServedAt = info.servedAt;
  }
  return { latestServedAt, hitCount, stampedCount };
}

export function summarizeServing(urls: readonly string[]): {
  latestServedAt: number | null;
  hitCount: number;
  stampedCount: number;
} {
  let latestServedAt: number | null = null;
  let hitCount = 0;
  let stampedCount = 0;
  for (const url of urls) {
    const info = servingStamps.get(url);
    if (!info) continue;
    stampedCount += 1;
    if (info.cacheHit) hitCount += 1;
    if (latestServedAt === null || info.servedAt > latestServedAt) latestServedAt = info.servedAt;
  }
  return { latestServedAt, hitCount, stampedCount };
}

export async function fetchProvenanceJson<T>(url: string, timeoutMs = 15000): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    recordServing(url, response.headers);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const PROVENANCE_URLS = {
  kpi: "/data/admin/fenok-data-health-kpi.json",
  lanes: "/data/admin/lane-registry-projection.json",
} as const;

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as LooseRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function formatSlotShort(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const epoch = Date.parse(iso);
  if (!Number.isFinite(epoch)) return null;
  const date = new Date(epoch);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute} 예정`;
}

export function nextSlotForLane(laneProjection: unknown, laneId: string): string | null {
  const root = asRecord(laneProjection);
  const lanes = root && Array.isArray(root.lanes) ? root.lanes : [];
  for (const lane of lanes) {
    const row = asRecord(lane);
    if (row?.id !== laneId) continue;
    const schedule = asRecord(asRecord(row?.control_room_state)?.schedule);
    return asString(schedule?.next_expected_slot);
  }
  return null;
}

export function earliestNextSlot(laneProjection: unknown): { label: string; slot: string } | null {
  const root = asRecord(laneProjection);
  const lanes = root && Array.isArray(root.lanes) ? root.lanes : [];
  let best: { label: string; slot: string; epoch: number } | null = null;
  for (const lane of lanes) {
    const row = asRecord(lane);
    const schedule = asRecord(asRecord(row?.control_room_state)?.schedule);
    const slot = asString(schedule?.next_expected_slot);
    if (!slot) continue;
    const epoch = Date.parse(slot);
    if (!Number.isFinite(epoch)) continue;
    if (!best || epoch < best.epoch) {
      best = {
        label: asString(row?.label) ?? String(row?.id ?? "레인"),
        slot,
        epoch,
      };
    }
  }
  return best ? { label: best.label, slot: best.slot } : null;
}

export type ProvenanceScope = {
  /** lane-registry ids whose publication families / next slots may be attributed */
  laneIds?: readonly string[];
  /** serving-stamp URL prefixes whose files the panel actually read */
  servingUrlPrefixes?: readonly string[];
};

function normalizeScopeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return token.length > 0 ? token : null;
}

export function summarizeServingByPrefix(prefixes: readonly string[]): {
  latestServedAt: number | null;
  hitCount: number;
  stampedCount: number;
} {
  let latestServedAt: number | null = null;
  let hitCount = 0;
  let stampedCount = 0;
  for (const [url, info] of servingStamps.entries()) {
    if (!prefixes.some((prefix) => url.startsWith(prefix))) continue;
    stampedCount += 1;
    if (info.cacheHit) hitCount += 1;
    if (latestServedAt === null || info.servedAt > latestServedAt) latestServedAt = info.servedAt;
  }
  return { latestServedAt, hitCount, stampedCount };
}

export function earliestNextSlotForLanes(
  laneProjection: unknown,
  laneIds: readonly string[],
): { label: string; slot: string } | null {
  const scoped = new Set(
    laneIds.map(normalizeScopeToken).filter((token): token is string => token !== null),
  );
  const root = asRecord(laneProjection);
  const lanes = root && Array.isArray(root.lanes) ? root.lanes : [];
  let best: { label: string; slot: string; epoch: number } | null = null;
  for (const lane of lanes) {
    const row = asRecord(lane);
    const token = normalizeScopeToken(row?.id);
    if (!token || !scoped.has(token)) continue;
    const schedule = asRecord(asRecord(row?.control_room_state)?.schedule);
    const slot = asString(schedule?.next_expected_slot);
    if (!slot) continue;
    const epoch = Date.parse(slot);
    if (!Number.isFinite(epoch)) continue;
    if (!best || epoch < best.epoch) {
      best = {
        label: asString(row?.label) ?? String(row?.id ?? "레인"),
        slot,
        epoch,
      };
    }
  }
  return best ? { label: best.label, slot: best.slot } : null;
}

export function buildProvenanceStages(args: {
  kpi: unknown;
  laneProjection: unknown;
  serving: { latestServedAt: number | null; hitCount: number; stampedCount: number };
  /** when provided, 발행/제공/다음 attribute only in-scope lanes/files (P1: never global) */
  scope?: ProvenanceScope;
}): EvidenceStage[] {
  const { kpi, laneProjection, serving, scope } = args;
  const stages: EvidenceStage[] = [];
  const kpiRoot = asRecord(kpi);
  const runtime = asRecord(kpiRoot?.runtime);
  const producer = asRecord(runtime?.producer_context);
  const collectedAt = asString(producer?.built_at);
  const slotKey = asString(producer?.slot_key);
  if (kpiRoot && (collectedAt || slotKey)) {
    stages.push({
      stage: "수집",
      detail: slotKey ? `수집 슬롯 ${slotKey}` : "수집 파이프라인 실행",
      at: collectedAt,
      tone: "ok",
    });
  }
  const detection = asRecord(runtime?.fetch_cron_skip_detection);
  const evaluatedAt = asString(detection?.evaluated_at);
  const detectionStatus = asString(detection?.status);
  if (detection && (evaluatedAt || detectionStatus)) {
    stages.push({
      stage: "검증",
      detail: detectionStatus ? `스킵 탐지 ${detectionStatus}` : "스킵 탐지 평가",
      at: evaluatedAt,
      tone: detectionStatus === "ok" || detectionStatus === "pass" ? "ok" : "warn",
    });
  }
  const publication = asRecord(kpiRoot?.publication);
  const allFamilies = publication && Array.isArray(publication.families) ? publication.families : [];
  // P1: a publication family is attributable only when its normalized name is
  // one of the scoped lane ids. Unmatched families are omitted, never forged.
  const scopedLanes = scope?.laneIds
    ? new Set(scope.laneIds.map(normalizeScopeToken).filter((token): token is string => token !== null))
    : null;
  const families = scopedLanes
    ? allFamilies.filter((row) => {
      const token = normalizeScopeToken(asRecord(row)?.family);
      return token !== null && scopedLanes.has(token);
    })
    : allFamilies;
  if (families.length > 0) {
    const latest = families
      .map(asRecord)
      .filter((row): row is LooseRecord => Boolean(row))
      .sort((a, b) => String(b?.observed_at ?? "").localeCompare(String(a?.observed_at ?? "")))[0];
    if (latest) {
      const result = asString(latest.result);
      stages.push({
        stage: "발행",
        detail: result ? `공개 미러 ${result}` : "공개 미러 발행",
        at: asString(latest.observed_at),
        tone: result === "published" || result === "resumed" ? "ok" : "warn",
      });
    }
  }
  // P1: 제공 counts only the files this panel actually read (prefix match);
  // the unscoped fallback keeps prior callers working but must not feed Edge.
  const scopedServing = scope?.servingUrlPrefixes
    ? summarizeServingByPrefix(scope.servingUrlPrefixes)
    : serving;
  if (scopedServing.latestServedAt !== null) {
    stages.push({
      stage: "제공",
      detail:
        scopedServing.stampedCount > 0
          ? `이 화면이 읽은 파일 ${scopedServing.stampedCount}건${scopedServing.hitCount > 0 ? ` · 캐시 적중 ${scopedServing.hitCount}건` : ""}`
          : "이 화면이 읽은 파일",
      at: new Date(scopedServing.latestServedAt).toISOString(),
      tone: "muted",
    });
  }
  // P1: 다음 names the earliest slot among scoped lanes only.
  const next = scope?.laneIds ? earliestNextSlotForLanes(laneProjection, scope.laneIds) : earliestNextSlot(laneProjection);
  if (next) {
    stages.push({
      stage: "다음",
      detail: `${next.label} 슬롯`,
      at: formatSlotShort(next.slot),
      tone: "muted",
    });
  }
  return stages;
}
