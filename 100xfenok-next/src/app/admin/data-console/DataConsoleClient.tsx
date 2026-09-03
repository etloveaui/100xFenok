"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import type { EvidenceRailFreshness } from "@/components/ui/EvidenceRail";
import {
  buildProvenanceStages,
  earliestNextSlot,
  fetchProvenanceJson,
  formatSlotShort,
  nextSlotForLane,
  PROVENANCE_URLS,
  summarizeServing,
} from "@/lib/evidence/provenance";

type KpiCheck = {
  id?: string;
  label?: string;
  status?: string;
  status_label?: string;
  detail?: string;
};

type KpiLane = {
  id?: string;
  label?: string;
  status?: string;
  status_label?: string;
  status_message?: string;
  as_of?: string | null;
  checks?: KpiCheck[];
};

type KpiTotals = {
  lanes?: number;
  ready?: number;
  degraded?: number;
  warning?: number;
  blocked?: number;
  unavailable?: number;
};

type PublishFamily = {
  family?: string;
  result?: string;
  observed_at?: string;
};

type DataHealthKpi = {
  generated_at?: string;
  status?: string;
  status_label?: string;
  status_message?: string;
  totals?: KpiTotals;
  lanes?: KpiLane[];
  deployment_integrity?: {
    status?: string;
    status_label?: string;
    blocker_count?: number;
  };
  publication?: {
    families?: PublishFamily[];
  };
};

type RegistryLane = {
  id?: string;
  label?: string;
  cadence?: {
    kind?: string;
    provider?: string | null;
  };
};

type LaneRegistry = {
  lanes?: RegistryLane[];
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function freshnessOf(status: unknown, registryLane: RegistryLane | null): EvidenceRailFreshness {
  if (registryLane?.cadence?.kind === "annual") return "fixed";
  if (status === "ready") return "fresh";
  if (status === "degraded") return "stale";
  if (status === "error" || status === "blocked" || status === "unavailable") return "error";
  return "pending";
}

function statusLabelOf(lane: KpiLane): string {
  const direct = str(lane.status_label);
  if (direct) return direct;
  if (lane.status === "ready") return "정상";
  if (lane.status === "degraded") return "저하";
  return "확인 중";
}

/** "2026-09-03T16:34:15.108Z" -> "09-03 16:34", non-ISO -> slice fallback, unparseable -> null */
function shortDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const epoch = Date.parse(value);
  if (Number.isFinite(epoch)) {
    const date = new Date(epoch);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${month}-${day} ${hour}:${minute}`;
  }
  return value.slice(0, 16);
}

function coverageText(lane: KpiLane): string {
  const checks = Array.isArray(lane.checks) ? lane.checks : [];
  if (checks.length === 0) return "점검 없음";
  const ok = checks.filter((check) => check.status === "ready").length;
  return `점검 ${ok}/${checks.length} 통과`;
}

function cadenceText(lane: RegistryLane | null): string | null {
  if (!lane) return null;
  const kind = str(lane.cadence?.kind);
  const provider = str(lane.cadence?.provider);
  if (kind && provider) return `${kind} · ${provider}`;
  return kind ?? provider;
}

const KPI_URLS = [PROVENANCE_URLS.kpi, PROVENANCE_URLS.lanes] as const;

export default function DataConsoleClient() {
  const [kpi, setKpi] = useState<DataHealthKpi | null>(null);
  const [registry, setRegistry] = useState<LaneRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    Promise.all([
      fetchProvenanceJson<DataHealthKpi>(PROVENANCE_URLS.kpi),
      fetchProvenanceJson<LaneRegistry>(PROVENANCE_URLS.lanes),
    ]).then(([kpiDoc, registryDoc]) => {
      if (cancelled) return;
      setKpi(kpiDoc);
      setRegistry(registryDoc);
      setFailed(kpiDoc === null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const serving = useMemo(
    () => summarizeServing([...KPI_URLS]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kpi, registry, reloadKey],
  );

  const lanes = useMemo(() => (kpi && Array.isArray(kpi.lanes) ? kpi.lanes : []), [kpi]);
  const totals: KpiTotals = kpi?.totals ?? {};
  const families = useMemo(
    () => (kpi?.publication && Array.isArray(kpi.publication.families) ? kpi.publication.families : []),
    [kpi],
  );
  const published = families.filter((family) => family.result === "published").length;
  const resumed = families.filter((family) => family.result === "resumed").length;
  const failedFamilies = families.filter(
    (family) => family.result !== "published" && family.result !== "resumed",
  ).length;
  const registryById = useMemo(() => {
    const map = new Map<string, RegistryLane>();
    const rows = registry && Array.isArray(registry.lanes) ? registry.lanes : [];
    for (const row of rows) {
      if (typeof row.id === "string" && row.id.length > 0) map.set(row.id, row);
    }
    return map;
  }, [registry]);
  const nextSlot = useMemo(() => earliestNextSlot(registry), [registry]);

  const headerTime = shortDateTime(kpi?.generated_at ?? null);
  const headerPillTone = kpi?.status === "ready" ? "up" : kpi?.status === "degraded" ? "warn" : "neutral";

  if (failed && !loading) {
    return (
      <Panel
        error
        errorDetail="fenok-data-health-kpi.json을 읽지 못했습니다."
        onRetry={reload}
        retryLabel="다시 읽기"
      >
        <EmptyState
          reason="데이터 건강 KPI를 읽지 못했습니다"
          nextRefresh="다음 KPI 발행 시 자동 복구됩니다"
          actionLabel="다시 읽기"
          onAction={reload}
        />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[20px] font-semibold text-[var(--fnk-neutral-900)]">데이터 건강 콘솔</h1>
          <span className="text-[13px] text-[var(--fnk-neutral-500)]">관리자 · 증거 레일의 전체 화면판</span>
        </div>
        {kpi ? (
          <Pill tone={headerPillTone}>
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "var(--fnk-color-gain)" }}
            />
            KPI {str(kpi.status_label) ?? "확인 중"}
            {headerTime ? ` · ${headerTime} UTC` : ""}
          </Pill>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Panel loading={loading}>
          <div className="flex flex-col gap-1 px-4 py-3.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fnk-neutral-500)]">레인 상태</span>
            <span className="text-[22px] font-semibold tabular-nums text-[var(--fnk-neutral-900)]">
              {num(totals.ready) ?? "—"} / {num(totals.lanes) ?? "—"}{" "}
              <span className="text-[12px] font-medium text-[var(--fnk-neutral-500)]">신선</span>
            </span>
            <span className="text-[12px] text-[var(--fnk-neutral-500)]">
              저하 {num(totals.degraded) ?? "—"} · 차단 {num(totals.blocked) ?? "—"}
            </span>
          </div>
        </Panel>
        <Panel loading={loading}>
          <div className="flex flex-col gap-1 px-4 py-3.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fnk-neutral-500)]">배포</span>
            <span className="text-[22px] font-semibold tabular-nums text-[var(--fnk-neutral-900)]">
              {str(kpi?.deployment_integrity?.status_label) ?? "—"}
            </span>
            <span className="text-[12px] text-[var(--fnk-neutral-500)]">
              차단 {num(kpi?.deployment_integrity?.blocker_count) ?? "—"}건
            </span>
          </div>
        </Panel>
        <Panel loading={loading}>
          <div className="flex flex-col gap-1 px-4 py-3.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fnk-neutral-500)]">발행 결과</span>
            <span className="text-[22px] font-semibold tabular-nums text-[var(--fnk-neutral-900)]">
              {families.length > 0 ? published : "—"}{" "}
              <span className="text-[12px] font-medium text-[var(--fnk-neutral-500)]">성공</span>
            </span>
            <span className="text-[12px] text-[var(--fnk-neutral-500)]">
              재개 {resumed} · 실패 {failedFamilies} · {families.length} 패밀리
            </span>
          </div>
        </Panel>
        <Panel loading={loading} empty={!loading && !nextSlot} emptyReason="다음 슬롯 정보 없음" emptyNextRefresh="레지스트리 다음 발행 시">
          <div className="flex flex-col gap-1 px-4 py-3.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fnk-neutral-500)]">다음 예정</span>
            <span className="truncate text-[22px] font-semibold tabular-nums text-[var(--fnk-neutral-900)]">
              {nextSlot ? (shortDateTime(nextSlot.slot) ?? "—") : "—"}
            </span>
            <span className="truncate text-[12px] text-[var(--fnk-neutral-500)]">{nextSlot?.label ?? ""}</span>
          </div>
        </Panel>
      </div>

      <Panel
        loading={loading}
        empty={!loading && lanes.length === 0}
        emptyReason="표시할 레인이 없습니다"
        emptyNextRefresh="다음 KPI 발행 시"
      >
        <PanelHeader
          eyebrow="Ops Console"
          title="레인별 신선도"
          right={<span className="text-[12px] text-[var(--fnk-neutral-500)]">점 = 상태 · 증거 보기로 그 레인의 서랍</span>}
        />
        {registry === null && !loading ? (
          <p className="px-4 pt-2 text-[12px] text-[var(--fnk-neutral-500)]">
            레인 레지스트리를 읽지 못해 주기·다음 예정이 미표시입니다. KPI 기준 상태는 정상 표시됩니다.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <div className="min-w-[880px]">
            <div
              className="grid grid-cols-[24px_minmax(0,1.4fr)_minmax(0,1fr)_110px_130px_150px] items-center gap-2.5 px-4 text-[11px] font-semibold text-[var(--fnk-neutral-500)]"
              aria-hidden="true"
            >
              <span />
              <span>레인</span>
              <span>마지막 기준</span>
              <span>주기</span>
              <span>다음 예정</span>
              <span className="text-right">커버리지</span>
            </div>
            {lanes.map((lane) => {
              const laneId = str(lane.id) ?? "";
              const registryLane = laneId ? (registryById.get(laneId) ?? null) : null;
              const freshness = freshnessOf(lane.status, registryLane);
              const cadence = cadenceText(registryLane) ?? "—";
              const slot = laneId ? nextSlotForLane(registry, laneId) : null;
              const nextLabel = slot ? (formatSlotShort(slot) ?? shortDateTime(slot) ?? "—") : "—";
              const stages = buildProvenanceStages({
                kpi,
                laneProjection: registry,
                serving,
                scope: {
                  laneIds: laneId ? [laneId] : [],
                  servingUrlPrefixes: [...KPI_URLS],
                },
              });
              return (
                <div key={laneId || lane.label} className="transition-colors duration-150 hover:bg-[var(--fnk-neutral-50)]">
                  <div className="grid grid-cols-[24px_minmax(0,1.4fr)_minmax(0,1fr)_110px_130px_150px] items-center gap-2.5 px-4 py-2 text-[12px]">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 rounded-full"
                      style={{
                        background:
                          freshness === "fresh"
                            ? "var(--fnk-color-gain)"
                            : freshness === "error"
                              ? "var(--fnk-color-loss)"
                              : freshness === "fixed"
                                ? "var(--fnk-neutral-500)"
                                : "var(--fnk-warn-500)",
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-[var(--fnk-neutral-900)]">
                        {str(lane.label) ?? laneId}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-[var(--fnk-neutral-500)]">
                        {laneId} · {statusLabelOf(lane)}
                      </span>
                    </span>
                    <span className="truncate tabular-nums text-[var(--fnk-neutral-700)]">
                      {shortDateTime(lane.as_of ?? null) ?? "—"}
                    </span>
                    <span className="truncate text-[var(--fnk-neutral-500)]">{cadence}</span>
                    <span className="truncate tabular-nums text-[var(--fnk-neutral-700)]">{nextLabel}</span>
                    <span className="truncate text-right font-semibold tabular-nums text-[var(--fnk-neutral-700)]">
                      {coverageText(lane)}
                    </span>
                  </div>
                  <EvidenceRail
                    freshness={freshness}
                    source="데이터 헬스 KPI"
                    asOf={shortDateTime(lane.as_of ?? null) ?? "—"}
                    coverage={coverageText(lane)}
                    next={slot ? (nextLabel === "—" ? undefined : nextLabel) : undefined}
                    onRetry={freshness !== "fresh" ? reload : undefined}
                    stages={stages}
                    skeletonDelayMs={120}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 px-4 py-2.5 text-[11px] text-[var(--fnk-neutral-500)]">
          <span>
            <span aria-hidden="true" className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--fnk-color-gain)" }} />
            신선
          </span>
          <span>
            <span aria-hidden="true" className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--fnk-warn-500)" }} />
            대기 · 공급자 일정 또는 자연 확인
          </span>
          <span>
            <span aria-hidden="true" className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--fnk-color-loss)" }} />
            오류 · 재시도 가능
          </span>
          <span>
            <span aria-hidden="true" className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--fnk-neutral-500)" }} />
            고정 · 연 1회 자료
          </span>
        </div>
      </Panel>
    </div>
  );
}
