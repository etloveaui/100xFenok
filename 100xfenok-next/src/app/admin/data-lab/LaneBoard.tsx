// Lane Board (#365 P1): joins the 20 lane-registry projection lanes to the KPI
// lanes[] by id for a single per-lane row (metadata + freshness + status +
// recovery). KPI-only composite/platform gates render in a separate strip — they
// are never force-joined to a registry lane. Pure/presentational so it can be
// render-tested in isolation; the page passes the read artifacts in.

export type LaneProjection = {
  id: string;
  label?: string;
  store_kind?: string;
  cadence?: { kind?: string; provider?: string | null };
  enforcement?: string;
  privacy_class?: string;
  owner_workflow?: string | null;
};

export type LaneBoardKpiLane = {
  id?: string;
  label?: string;
  status?: string;
  status_label?: string;
  as_of?: string | null;
  details?: {
    recovery_retry_set?: unknown[];
    recovery_recovered?: unknown[];
    last_attempt?: { event_name?: string | null; observed_at?: string | null } | null;
  };
};

export type AlarmState = {
  status?: string;
  open_incident_count?: number;
};

function dateLabel(value?: string | null) {
  return value ? value.slice(0, 10) : "-";
}

function statusClass(status?: string) {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "partial" || status === "pending" || status === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "stale" || status === "unavailable" || status === "error" || status === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

const STATUS_KO: Record<string, string> = {
  ready: "정상",
  partial: "부분",
  pending: "대기",
  warning: "주의",
  blocked: "차단",
  stale: "오래됨",
  unavailable: "없음",
  error: "오류",
};

function statusText(status?: string, fallback?: string) {
  return fallback || STATUS_KO[status || ""] || "점검";
}

const ENFORCEMENT_KO: Record<string, string> = { live: "실시행", shadow: "관찰" };
const PRIVACY_KO: Record<string, string> = {
  private: "비공개",
  public_mirror: "공개 미러",
  public_safe_aggregate: "공개 집계",
};
const CADENCE_KO: Record<string, string> = {
  hourly: "시간", daily: "일", weekly: "주", monthly: "월", quarterly: "분기", mixed: "혼합", unknown: "미상",
};

function countOf(list?: unknown[]) {
  return Array.isArray(list) ? list.length : 0;
}

export default function LaneBoard({
  projection,
  kpiLanes,
  alarm = null,
}: {
  projection: LaneProjection[] | null;
  kpiLanes: LaneBoardKpiLane[];
  alarm?: AlarmState | null;
}) {
  const projectionIds = new Set((projection ?? []).map((lane) => lane.id));
  const platformGates = kpiLanes.filter((lane) => lane.id && !projectionIds.has(lane.id));

  const alarmOpen = alarm?.status === "open";
  const alarmCount = typeof alarm?.open_incident_count === "number" ? alarm.open_incident_count : 0;
  const alarmLabel = !alarm
    ? "알람 상태 미확인"
    : alarmOpen
      ? `알람 열림 ${alarmCount}`
      : alarm.status === "unknown"
        ? "알람 확인 필요"
        : "알람 없음";
  const alarmClass = !alarm
    ? "border-slate-200 bg-slate-50 text-slate-600"
    : alarmOpen
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : alarm.status === "unknown"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-admin-lane-board="true">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Lane Registry × Data Health</p>
          <h2 className="text-lg font-black tracking-tight text-slate-950">레인 보드</h2>
          <p className="text-xs font-semibold text-slate-500">
            관리 레인의 메타데이터·신선도·복구 상태를 한 화면에서 확인합니다.
          </p>
        </div>
        <span
          data-admin-alarm-badge={alarmOpen ? "open" : alarm?.status ?? "unknown"}
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs font-black ${alarmClass}`}
        >
          {alarmLabel}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-xs">
          <thead>
            <tr className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
              <th className="border-b border-slate-200 px-3 py-2">레인</th>
              <th className="border-b border-slate-200 px-3 py-2">메타데이터</th>
              <th className="border-b border-slate-200 px-3 py-2">기준일</th>
              <th className="border-b border-slate-200 px-3 py-2">상태</th>
              <th className="border-b border-slate-200 px-3 py-2">복구</th>
              <th className="border-b border-slate-200 px-3 py-2">최근 실행</th>
            </tr>
          </thead>
          <tbody>
            {projection && projection.length > 0 ? projection.map((lane) => {
              const kpi = kpiLanes.find((k) => k.id === lane.id) ?? null;
              const retry = countOf(kpi?.details?.recovery_retry_set);
              const recovered = countOf(kpi?.details?.recovery_recovered);
              const lastAttempt = kpi?.details?.last_attempt ?? null;
              return (
                <tr key={lane.id} className="align-top" data-lane-row={lane.id}>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <p className="font-black text-slate-950">{lane.label || lane.id}</p>
                    <p className="mt-1 font-semibold text-slate-500">{lane.owner_workflow || "워크플로 없음"}</p>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <div className="flex flex-wrap gap-1 text-[10px] font-bold">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">{lane.store_kind || "-"}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">{CADENCE_KO[lane.cadence?.kind || ""] || lane.cadence?.kind || "-"}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">{ENFORCEMENT_KO[lane.enforcement || ""] || lane.enforcement || "-"}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">{PRIVACY_KO[lane.privacy_class || ""] || lane.privacy_class || "-"}</span>
                    </div>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <span className="font-semibold text-slate-500">{kpi ? dateLabel(kpi.as_of) : "-"}</span>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    {kpi ? (
                      <span className={`inline-flex rounded-full border px-2 py-1 font-black ${statusClass(kpi.status)}`}>
                        {statusText(kpi.status, kpi.status_label)}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-1 font-black text-slate-500">KPI 없음</span>
                    )}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <span className="orbitron font-black tabular-nums text-slate-900">재시도 {retry} · 복구 {recovered}</span>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    {lastAttempt?.observed_at ? (
                      <span className="font-semibold text-slate-500">
                        {dateLabel(lastAttempt.observed_at)}
                        {lastAttempt.event_name ? <span className="ml-1 text-[10px] text-slate-500">{lastAttempt.event_name}</span> : null}
                      </span>
                    ) : (
                      <span className="font-semibold text-slate-500">-</span>
                    )}
                  </td>
                </tr>
              );
            }) : (
              <tr>
                <td className="px-3 py-4 text-sm font-bold text-rose-700" colSpan={6}>lane-registry-projection을 읽지 못했습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4" data-admin-platform-gates="true">
        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Platform Gates</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">레지스트리 레인에 속하지 않는 KPI 집계 게이트입니다.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {platformGates.length > 0 ? platformGates.map((gate) => (
            <span
              key={gate.id}
              data-platform-gate={gate.id}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold ${statusClass(gate.status)}`}
            >
              {gate.label || gate.id}
              <span className="font-black">{statusText(gate.status, gate.status_label)}</span>
            </span>
          )) : (
            <span className="text-xs font-semibold text-slate-500">표시할 플랫폼 게이트가 없습니다.</span>
          )}
        </div>
      </div>
    </section>
  );
}
