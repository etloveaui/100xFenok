import type { Metadata } from "next";
import Link from "next/link";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import { ROUTES } from "@/lib/routes";
import { readPublicAssetText } from "@/lib/server/public-assets";
import LaneBoard, { type AlarmState, type LaneProjection } from "./LaneBoard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin Data Lab | 100xFenok",
  description: "100xFenok 관리자 데이터 상태와 레거시 Data Lab 경계를 분리한 진단 화면",
};

type CoverageCheck = {
  label?: string;
  status?: string;
  status_label?: string;
  detail?: string;
  as_of?: string;
  age_days?: number;
  max_age_days?: number;
  warn_only?: boolean;
};

type CoverageSurface = {
  id?: string;
  route?: string;
  label?: string;
  status?: string;
  status_label?: string;
  coverage_score?: number;
  as_of?: string;
  checks?: CoverageCheck[];
};

type ProductSurfaceCoverage = {
  generated_at?: string;
  totals?: Record<string, number>;
  surfaces?: CoverageSurface[];
};

type DataHealthSet = {
  set: string;
  served_path: string | null;
  newest_source_date: string | null;
  max_age: string | null;
  status?: string;
  serving_lkg?: boolean;
};

type DataHealthKpi = {
  generated_at?: string;
  sets?: DataHealthSet[];
};

async function readProductSurfaceCoverage(): Promise<ProductSurfaceCoverage | null> {
  try {
    return JSON.parse(await readPublicAssetText("/data/admin/product-surface-coverage.json")) as ProductSurfaceCoverage;
  } catch {
    return null;
  }
}

async function readDataHealthKpi(): Promise<DataHealthKpi | null> {
  try {
    return JSON.parse(await readPublicAssetText("/data/admin/fenok-data-health-kpi.json")) as DataHealthKpi;
  } catch {
    return null;
  }
}

async function readLaneRegistryProjection(): Promise<LaneProjection[] | null> {
  try {
    const parsed = JSON.parse(await readPublicAssetText("/data/admin/lane-registry-projection.json")) as { lanes?: LaneProjection[] };
    return Array.isArray(parsed.lanes) ? parsed.lanes : null;
  } catch {
    return null;
  }
}

async function readAlarmState(): Promise<AlarmState | null> {
  try {
    return JSON.parse(await readPublicAssetText("/data/admin/alarm-state.json")) as AlarmState;
  } catch {
    return null;
  }
}

function dateLabel(value?: string) {
  if (!value) return "-";
  return value.slice(0, 10);
}

function statusClass(status?: string) {
  if (status === "fresh" || status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "delayed" || status === "partial" || status === "pending" || status === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "stopped" || status === "stale" || status === "unavailable" || status === "error" || status === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function statusText(status?: string, fallback?: string) {
  return fallback || {
    fresh: "신선",
    delayed: "지연",
    stopped: "중단",
    ready: "정상",
    partial: "부분",
    pending: "대기",
    warning: "주의",
    blocked: "차단",
    stale: "오래됨",
    unavailable: "없음",
    error: "오류",
  }[status || ""] || "점검";
}

function freshnessChecks(surface: CoverageSurface) {
  return (surface.checks || []).filter((check) => typeof check.max_age_days === "number");
}

export default async function AdminDataLabPage() {
  const dataHealthKpi = await readDataHealthKpi();
  const coverage = await readProductSurfaceCoverage();
  const laneProjection = await readLaneRegistryProjection();
  const alarmState = await readAlarmState();
  const kpiSets = dataHealthKpi?.sets || [];
  const setCounts = Object.fromEntries(["fresh", "delayed", "stopped"].map((status) => [
    status,
    kpiSets.filter((set) => set.status === status).length,
  ]));
  const surfaces = coverage?.surfaces || [];
  const totals = coverage?.totals || {};

  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4"
      data-admin-data-lab-surface="true"
      data-admin-data-lab-route-owner="legacy-admin-data-lab"
    >
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-admin-data-lab-boundary="true">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[12px] font-black uppercase tracking-[0.12em] text-slate-500">Admin Data Lab</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Data Lab (레거시)</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
              관리자 데이터 진단은 기존 HTML Data Lab을 기본 소유 화면으로 유지하고, 공개 제품 화면과 원시 진단
              경계를 분리합니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[12px] font-black uppercase tracking-[0.08em]">
              <span
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600"
                data-admin-data-lab-boundary-chip="admin-only"
              >
                admin only
              </span>
              <span
                className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700"
                data-admin-data-lab-boundary-chip="legacy-html"
              >
                legacy html
              </span>
              <span
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700"
                data-admin-data-lab-boundary-chip="source-audit"
              >
                source audit
              </span>
            </div>
          </div>
          <nav className="grid min-w-[min(100%,24rem)] grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Data Lab 경로">
            <Link
              href="/admin"
              className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-[12px] font-black text-slate-700 transition hover:bg-slate-100"
              data-admin-data-lab-owner-link="admin-hub"
            >
              Admin Hub
            </Link>
            <Link
              href={ROUTES.market}
              className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-[12px] font-black text-slate-700 transition hover:bg-slate-100"
              data-admin-data-lab-owner-link="market"
            >
              시장 화면
            </Link>
            <Link
              href={ROUTES.explore}
              className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-[12px] font-black text-slate-700 transition hover:bg-slate-100"
              data-admin-data-lab-owner-link="explore"
            >
              홈 탐색
            </Link>
          </nav>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-admin-data-health-kpi="true">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[12px] font-black uppercase tracking-[0.12em] text-slate-500">Fenok Data Health</p>
            <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950">데이터 헬스 KPI</h2>
            <p className="mt-1 text-[12px] font-semibold text-slate-500">KPI 생성 {dateLabel(dataHealthKpi?.generated_at)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-[12px] font-black sm:grid-cols-4">
            {[
              ["데이터 세트", kpiSets.length.toLocaleString("ko-KR")],
              ["신선", setCounts.fresh.toLocaleString("ko-KR")],
              ["지연", setCounts.delayed.toLocaleString("ko-KR")],
              ["중단", setCounts.stopped.toLocaleString("ko-KR")],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-slate-500">{label}</p>
                <p className="mt-1 text-sm text-slate-950">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left text-[12px]">
            <thead>
              <tr className="text-[12px] font-black uppercase tracking-[0.12em] text-slate-500">
                <th className="border-b border-slate-200 px-3 py-2">데이터 세트</th>
                <th className="border-b border-slate-200 px-3 py-2">상태</th>
                <th className="border-b border-slate-200 px-3 py-2">최신 원천일</th>
                <th className="border-b border-slate-200 px-3 py-2">허용 나이</th>
                <th className="border-b border-slate-200 px-3 py-2">LKG</th>
                <th className="border-b border-slate-200 px-3 py-2">제공 경로</th>
              </tr>
            </thead>
            <tbody>
              {kpiSets.length > 0 ? kpiSets.map((set) => (
                <tr key={set.set} className="align-top">
                  <td className="border-b border-slate-100 px-3 py-3">
                    <p className="font-black text-slate-950">{set.set}</p>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-1 font-black ${statusClass(set.status)}`}>
                      {statusText(set.status)}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 font-semibold text-slate-600">{dateLabel(set.newest_source_date || undefined)}</td>
                  <td className="border-b border-slate-100 px-3 py-3 font-semibold text-slate-600">{set.max_age || "-"}</td>
                  <td className="border-b border-slate-100 px-3 py-3 font-semibold text-slate-600">{typeof set.serving_lkg === "boolean" ? (set.serving_lkg ? "사용 중" : "아님") : "-"}</td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <code className="break-all font-semibold text-slate-600">{set.served_path || "-"}</code>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td className="px-3 py-4 text-sm font-bold text-rose-700" colSpan={6}>fenok-data-health-kpi를 읽지 못했습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <LaneBoard
        projection={laneProjection}
        kpiLanes={kpiSets.map((set) => ({
          id: set.set,
          status: set.status,
          newest_source_date: set.newest_source_date,
          max_age: set.max_age,
          served_path: set.served_path,
          serving_lkg: set.serving_lkg,
        }))}
        alarm={alarmState}
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-admin-data-lab-coverage="true">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[12px] font-black uppercase tracking-[0.12em] text-slate-500">Product Freshness Gate</p>
            <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950">제품 화면 데이터 상태</h2>
            <p className="mt-1 text-[12px] font-semibold text-slate-500">스냅샷 생성 {dateLabel(coverage?.generated_at)}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-[12px] font-black sm:grid-cols-6">
            {[
              ["전체", totals.surfaces],
              ["정상", totals.ready],
              ["부분", totals.partial],
              ["대기", totals.pending],
              ["오래됨", totals.stale],
              ["오류", (totals.unavailable || 0) + (totals.error || 0)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-slate-500">{label}</p>
                <p className="mt-1 text-sm text-slate-950">{Number(value || 0).toLocaleString("ko-KR")}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-[12px]">
            <thead>
              <tr className="text-[12px] font-black uppercase tracking-[0.12em] text-slate-500">
                <th className="border-b border-slate-200 px-3 py-2">화면</th>
                <th className="border-b border-slate-200 px-3 py-2">상태</th>
                <th className="border-b border-slate-200 px-3 py-2">커버리지</th>
                <th className="border-b border-slate-200 px-3 py-2">기준일 체크</th>
              </tr>
            </thead>
            <tbody>
              {surfaces.length > 0 ? surfaces.map((surface) => (
                <tr key={surface.id || surface.route} className="align-top">
                  <td className="border-b border-slate-100 px-3 py-3">
                    <p className="font-black text-slate-950">{surface.label || surface.id}</p>
                    <p className="mt-1 font-semibold text-slate-500">{surface.route || "-"}</p>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-1 font-black ${statusClass(surface.status)}`}>
                      {statusText(surface.status, surface.status_label)}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <span className="font-black tabular-nums text-slate-900">
                      {typeof surface.coverage_score === "number" ? `${surface.coverage_score.toFixed(0)}%` : "-"}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      {freshnessChecks(surface).map((check) => (
                        <span
                          key={`${surface.id}-${check.label}`}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 font-bold ${statusClass(check.status)}`}
                        >
                          {check.label}
                          <span className="tabular-nums">
                            {typeof check.age_days === "number" && typeof check.max_age_days === "number"
                              ? `${check.age_days}/${check.max_age_days}d`
                              : dateLabel(check.as_of)}
                          </span>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td className="px-3 py-4 text-sm font-bold text-rose-700" colSpan={4}>product-surface-coverage를 읽지 못했습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div data-admin-data-lab-legacy-frame="true">
        <RouteEmbedFrame src="/admin/data-lab/index.html" title="100x Admin Data Lab" loading="eager" />
      </div>
    </main>
  );
}
