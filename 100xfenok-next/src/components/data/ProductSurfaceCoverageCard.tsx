"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDataDate, type DataReadinessStatus } from "@/lib/data-state";

interface ProductSurfaceCheck {
  label: string;
  status: DataReadinessStatus;
  status_label: string;
  detail: string;
  reason?: string | null;
}

interface ProductSurface {
  id: string;
  route: string;
  label: string;
  status: DataReadinessStatus;
  status_label: string;
  coverage_score: number | null;
  summary: string;
  checks: ProductSurfaceCheck[];
}

interface ProductSurfaceCoveragePayload {
  schema_version: "product-surface-coverage/v1";
  generated_at: string;
  surfaces: ProductSurface[];
}

let cachedPayload: ProductSurfaceCoveragePayload | null = null;
let pendingPayload: Promise<ProductSurfaceCoveragePayload | null> | null = null;

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function loadPayload() {
  if (cachedPayload) return Promise.resolve(cachedPayload);
  if (pendingPayload) return pendingPayload;
  pendingPayload = fetch("/data/admin/product-surface-coverage.json", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? (response.json() as Promise<ProductSurfaceCoveragePayload>) : null))
    .then((payload) => {
      cachedPayload = payload;
      return payload;
    })
    .catch(() => null)
    .finally(() => {
      pendingPayload = null;
    });
  return pendingPayload;
}

function tone(status: DataReadinessStatus) {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "partial" || status === "stale" || status === "pending") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "error") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function dotTone(status: DataReadinessStatus) {
  if (status === "ready") return "bg-emerald-500";
  if (status === "partial" || status === "stale" || status === "pending") return "bg-amber-500";
  if (status === "error") return "bg-rose-500";
  return "bg-slate-300";
}

export default function ProductSurfaceCoverageCard({
  surfaceId,
  className,
}: {
  surfaceId: string;
  className?: string;
}) {
  const [payload, setPayload] = useState<ProductSurfaceCoveragePayload | null>(cachedPayload);
  const [loaded, setLoaded] = useState(Boolean(cachedPayload));

  useEffect(() => {
    let cancelled = false;
    loadPayload().then((next) => {
      if (!cancelled) {
        setPayload(next);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const surface = useMemo(
    () => payload?.surfaces.find((item) => item.id === surfaceId) ?? null,
    [payload, surfaceId],
  );

  if (!loaded) {
    return (
      <section className={cx("rounded-[1.25rem] border border-[var(--c-line)] bg-[var(--c-panel)] px-4 py-3 text-sm font-semibold text-[var(--c-ink-3)]", className)}>
        데이터 준비도 확인 중
      </section>
    );
  }

  if (!surface) {
    return (
      <section className={cx("rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800", className)}>
        이 화면의 데이터 준비도 정보를 찾지 못했습니다.
      </section>
    );
  }

  const shownChecks = surface.checks.slice(0, 4);
  const generated = formatDataDate(payload?.generated_at);
  const score = typeof surface.coverage_score === "number" ? `${Math.round(surface.coverage_score)}%` : "점검";

  return (
    <section className={cx("rounded-[1.35rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-sm", className)}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--c-ink-3)]">데이터 준비도</p>
          <h2 className="mt-1 text-sm font-black text-[var(--c-ink)]">{surface.label}</h2>
          <p className="mt-1 max-w-3xl text-xs font-semibold leading-5 text-[var(--c-ink-3)]">{surface.summary}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black", tone(surface.status))}>
            <span className={cx("h-1.5 w-1.5 rounded-full", dotTone(surface.status))} />
            {surface.status_label}
          </span>
          <span className="rounded-full border border-[var(--c-line)] bg-[var(--c-surface-2)] px-2 py-1 text-[10px] font-black text-[var(--c-ink-3)]">
            {score}
          </span>
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {shownChecks.map((item) => (
          <div key={`${surface.id}-${item.label}`} className="rounded-xl border border-[var(--c-line-2)] bg-[var(--c-surface-2)] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-black text-[var(--c-ink)]">{item.label}</span>
              <span className={cx("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-black", tone(item.status))}>{item.status_label}</span>
            </div>
            <p className="mt-1 truncate text-[11px] font-semibold text-[var(--c-ink-3)]" title={item.reason ?? item.detail}>
              {item.detail}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] font-semibold text-[var(--c-ink-3)]">
        기준 {generated ?? "확인 중"} · 자세한 감사는 Data Lab에서 확인
      </p>
    </section>
  );
}
