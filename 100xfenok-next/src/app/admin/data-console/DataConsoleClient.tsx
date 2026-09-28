"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, Panel, PanelHeader, Pill } from "@/components/ui";
import { fetchProvenanceJson, PROVENANCE_URLS } from "@/lib/evidence/provenance";

type KpiSet = {
  set?: string;
  served_path?: string | null;
  newest_source_date?: string | null;
  max_age?: string | null;
  serving_lkg?: boolean;
  status?: "fresh" | "delayed" | "stopped" | string;
};

type DataHealthKpi = {
  generated_at?: string;
  sets?: KpiSet[];
};

function shortDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const epoch = Date.parse(value);
  if (Number.isFinite(epoch)) {
    const date = new Date(epoch);
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hour = String(date.getUTCHours()).padStart(2, "0");
    const minute = String(date.getUTCMinutes()).padStart(2, "0");
    return `${month}-${day} ${hour}:${minute}`;
  }
  return value.slice(0, 16);
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : shortDateTime(value) ?? "—";
}

function statusLabel(status: string | undefined): string {
  if (status === "fresh") return "신선";
  if (status === "delayed") return "지연";
  if (status === "stopped") return "중단";
  return "확인 필요";
}

function statusClass(status: string | undefined): string {
  if (status === "fresh") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "delayed") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "stopped") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export default function DataConsoleClient() {
  const [kpi, setKpi] = useState<DataHealthKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshStale, setRefreshStale] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const kpiRef = useRef<DataHealthKpi | null>(null);
  kpiRef.current = kpi;

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const keepPreviousOnFailure = () => {
      if (cancelled) return;
      if (kpiRef.current) {
        setRefreshStale(true);
        setFailed(false);
      } else {
        setFailed(true);
      }
      setLoading(false);
    };
    fetchProvenanceJson<DataHealthKpi>(PROVENANCE_URLS.kpi)
      .then((kpiDoc) => {
        if (cancelled) return;
        if (kpiDoc) {
          setKpi(kpiDoc);
          setFailed(false);
          setRefreshStale(false);
        } else {
          keepPreviousOnFailure();
        }
        setLoading(false);
      })
      .catch(keepPreviousOnFailure);
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const sets = Array.isArray(kpi?.sets) ? kpi.sets : [];
  const fresh = sets.filter((item) => item.status === "fresh").length;
  const delayed = sets.filter((item) => item.status === "delayed").length;
  const stopped = sets.filter((item) => item.status === "stopped").length;
  const overall = stopped > 0 ? "stopped" : delayed > 0 ? "delayed" : sets.length > 0 ? "fresh" : "unknown";
  const headerTime = shortDateTime(kpi?.generated_at ?? null);
  const headerPillTone = overall === "fresh" ? "up" : overall === "unknown" ? "neutral" : "warn";
  const headerDot = overall === "fresh"
    ? "var(--fnk-color-gain)"
    : overall === "unknown" ? "var(--fnk-neutral-500)" : "var(--fnk-warn-500)";

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
          <span className="text-[13px] text-[var(--fnk-neutral-500)]">관리자 · 원천 날짜와 제공 경로</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {refreshStale ? (
            <span className="text-[12px] text-[var(--fnk-neutral-500)]">
              새로고침 실패 · 이전 값 표시 중{" "}
              <button
                type="button"
                onClick={reload}
                className="font-semibold text-[var(--fnk-brand-interactive)] hover:text-[var(--fnk-brand-navy)] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-interactive"
              >
                다시 시도
              </button>
            </span>
          ) : null}
          {kpi ? (
            <Pill tone={headerPillTone}>
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: headerDot }} />
              KPI {fresh} 신선 · {delayed} 지연 · {stopped} 중단
              {headerTime ? ` · ${headerTime} UTC` : ""}
            </Pill>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["데이터 세트", sets.length],
          ["신선", fresh],
          ["지연", delayed],
          ["중단", stopped],
        ].map(([label, value]) => (
          <Panel key={label} loading={loading}>
            <div className="flex flex-col gap-1 px-4 py-3.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--fnk-neutral-500)]">{label}</span>
              <span className="text-[22px] font-semibold tabular-nums text-[var(--fnk-neutral-900)]">{value}</span>
            </div>
          </Panel>
        ))}
      </div>

      <Panel
        loading={loading}
        empty={!loading && sets.length === 0}
        emptyReason="표시할 데이터 세트가 없습니다"
        emptyNextRefresh="다음 KPI 발행 시"
        emptyActionLabel="다시 읽기"
        onEmptyAction={reload}
      >
        <PanelHeader
          eyebrow="Ops Console"
          title="데이터별 원천 신선도"
          right={<span className="text-[12px] text-[var(--fnk-neutral-500)]">상태는 원천 날짜와 신선도 기준으로 계산합니다</span>}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left text-[12px]">
            <thead>
              <tr className="text-[12px] font-semibold text-[var(--fnk-neutral-500)]">
                <th className="border-b border-slate-200 px-3 py-2">데이터 세트</th>
                <th className="border-b border-slate-200 px-3 py-2">최신 원천일</th>
                <th className="border-b border-slate-200 px-3 py-2">최대 허용 나이</th>
                <th className="border-b border-slate-200 px-3 py-2">상태</th>
                <th className="border-b border-slate-200 px-3 py-2">LKG 제공</th>
                <th className="border-b border-slate-200 px-3 py-2">제공 경로</th>
              </tr>
            </thead>
            <tbody>
              {sets.map((item) => (
                <tr key={item.set} className="align-top">
                  <td className="border-b border-slate-100 px-3 py-3 font-semibold text-slate-950">{item.set || "—"}</td>
                  <td className="border-b border-slate-100 px-3 py-3 tabular-nums text-slate-700">{dateLabel(item.newest_source_date)}</td>
                  <td className="border-b border-slate-100 px-3 py-3 tabular-nums text-slate-700">{item.max_age || "—"}</td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-1 font-bold ${statusClass(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">
                    {item.serving_lkg === true ? "예" : item.serving_lkg === false ? "아니요" : "—"}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 font-mono text-slate-600">{item.served_path || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
