"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * V4 TraceableNumber — wraps any KPI with a freshness dot + hover popover
 * exposing { source, fetched-at, raw-value }.
 *
 * Drop-in for Next.js under `src/components/dashboard/v4/`.
 * Reads from the existing DashboardSnapshot freshness map; no new API call.
 */

export type TraceableTone = "live" | "dated" | "stale" | "offline";

export type TraceableMeta = {
  /** Maps to V2 V2Freshness tone. */
  tone: TraceableTone;
  /** Display source ("CBOE realtime"). */
  source?: string;
  /** Formatted local timestamp ("05-12 09:42:31"). */
  fetchedAt?: string;
  /** Pre-rounded display already in `children` — this is the raw API value. */
  rawValue?: number | string | null;
  /** "realtime" | "daily" | "weekly" | "quarterly" — V2 DashboardFreshnessCadence. */
  cadence?: "realtime" | "daily" | "weekly" | "quarterly";
  /** Key into the freshness map ("vix", "ticker:SPY"). */
  sourceKey?: string;
  /** Optional Korean note line at the bottom of the popover. */
  note?: string;
};

export type TraceableMode = "off" | "hover-one" | "hover-all";

const TONE: Record<TraceableTone, { dot: string; label: string }> = {
  live:    { dot: "#10b981", label: "실시간 · 15분 지연" },
  dated:   { dot: "#1B73D3", label: "캐시 · 정상" },
  stale:   { dot: "#D5AD36", label: "최신 폴백 · 경고" },
  offline: { dot: "#94a3b8", label: "소스 실패 · 마지막 정상값" },
};

const CADENCE_KO: Record<NonNullable<TraceableMeta["cadence"]>, string> = {
  realtime: "실시간",
  daily: "일간",
  weekly: "주간",
  quarterly: "분기",
};

function formatRaw(v: TraceableMeta["rawValue"]): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    if (Math.abs(v) >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
    return v.toString();
  }
  return String(v);
}

type TraceableNumberProps = {
  meta?: TraceableMeta;
  mode?: TraceableMode;
  children: ReactNode;
  /** Pixel size of the indicator dot. Default 7. */
  dotSize?: number;
};

export default function TraceableNumber({
  meta,
  mode = "hover-one",
  children,
  dotSize = 7,
}: TraceableNumberProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (mode !== "hover-one" || !open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [mode, open]);

  if (!meta || mode === "off") return <>{children}</>;

  const showPopover = mode === "hover-all" || open;
  const tone = TONE[meta.tone] ?? TONE.dated;

  return (
    <span
      ref={wrapRef}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
    >
      {children}
      <button
        type="button"
        aria-label={`데이터 출처 보기 — ${meta.sourceKey ?? meta.source ?? ""}`}
        onMouseEnter={() => mode === "hover-one" && setOpen(true)}
        onMouseLeave={() => mode === "hover-one" && setOpen(false)}
        onFocus={() => mode === "hover-one" && setOpen(true)}
        onBlur={() => mode === "hover-one" && setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          if (mode === "hover-one") setOpen((v) => !v);
        }}
        style={{
          display: "inline-block",
          marginLeft: 3,
          padding: 0,
          width: dotSize,
          height: dotSize,
          borderRadius: "50%",
          background: tone.dot,
          border: "none",
          cursor: "help",
          boxShadow: `0 0 0 1.5px #fff, 0 0 0 2px ${tone.dot}66`,
          verticalAlign: "super",
          flex: `0 0 ${dotSize}px`,
          transition: "transform .12s",
          transform: showPopover ? "scale(1.25)" : "scale(1)",
          animation: meta.tone === "live" ? "pulse 1.6s ease-in-out infinite" : "none",
        }}
      />
      {showPopover && <TracePopover data={meta} tone={tone} />}
    </span>
  );
}

function TracePopover({ data, tone }: { data: TraceableMeta; tone: { dot: string; label: string } }) {
  return (
    <div
      role="tooltip"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: 22,
        left: -6,
        zIndex: 50,
        minWidth: 232,
        maxWidth: 280,
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: "10px 12px 11px",
        boxShadow:
          "0 12px 32px -8px rgba(15,23,42,0.18), 0 2px 6px rgba(15,23,42,0.08)",
        fontFamily: "'Noto Sans KR',sans-serif",
        fontSize: 12,
        color: "#0f172a",
        lineHeight: 1.55,
        textAlign: "left",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
          paddingBottom: 6,
          borderBottom: "1px dashed #e2e8f0",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: tone.dot }} />
        <span
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: ".1em",
            color: "#475569",
            textTransform: "uppercase",
          }}
        >
          {data.tone}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 10,
            color: "#94a3b8",
          }}
        >
          {data.sourceKey ?? "—"}
        </span>
      </div>
      <Row k="출처" v={data.source ?? data.sourceKey ?? "—"} />
      <Row k="갱신" v={data.fetchedAt ?? "—"} mono />
      <Row k="원본값" v={formatRaw(data.rawValue)} mono />
      <Row k="주기" v={data.cadence ? CADENCE_KO[data.cadence] : "—"} />
      {data.note ? (
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: "1px dashed #e2e8f0",
            fontSize: 10.5,
            color: "#64748b",
            lineHeight: 1.5,
          }}
        >
          {data.note}
        </div>
      ) : null}
      <div
        style={{
          marginTop: 6,
          fontSize: 10,
          color: tone.dot,
          fontWeight: 700,
          fontFamily: "'JetBrains Mono',monospace",
        }}
      >
        {tone.label}
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 11.5, padding: "2px 0" }}>
      <span style={{ color: "#64748b", width: 50, flex: "0 0 50px" }}>{k}</span>
      <span
        style={{
          color: "#0f172a",
          fontWeight: 700,
          fontFamily: mono ? "'JetBrains Mono',monospace" : "'Noto Sans KR',sans-serif",
          wordBreak: "break-all",
        }}
      >
        {v}
      </span>
    </div>
  );
}

/**
 * Helper to build a TraceableMeta from a V2 DashboardFreshnessMap entry.
 * Mirrors the freshnessFromCadence() logic in components/dashboard/v2/types.ts
 * so V4 stays on the existing data contract — no new API call.
 */
export function metaFromFreshness(
  freshness:
    | { cadence: TraceableMeta["cadence"]; updatedAt: string | null; isFallback: boolean; source?: string }
    | undefined,
  rawValue: TraceableMeta["rawValue"],
  opts: { sourceKey?: string; note?: string } = {},
): TraceableMeta {
  if (!freshness) {
    return {
      tone: "dated",
      rawValue,
      source: "—",
      fetchedAt: "—",
      cadence: "daily",
      sourceKey: opts.sourceKey,
      note: opts.note,
    };
  }
  const tone: TraceableTone = freshness.isFallback
    ? freshness.cadence === "realtime"
      ? "stale"
      : "offline"
    : freshness.cadence === "realtime"
      ? "live"
      : "dated";

  const fetchedAt = freshness.updatedAt
    ? new Date(freshness.updatedAt)
        .toLocaleString("ko-KR", {
          hour12: false,
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
        .replace(/\. /g, "-")
        .replace(".", "")
    : "—";

  return {
    tone,
    rawValue,
    source: freshness.source ?? opts.sourceKey ?? "—",
    fetchedAt,
    cadence: freshness.cadence,
    sourceKey: opts.sourceKey,
    note: opts.note,
  };
}
