"use client";

import { type ReactNode } from "react";
import TransitionLink from "@/components/TransitionLink";
import type { DashboardFreshnessCadence, DashboardFreshnessMap, DashboardSnapshot } from "@/lib/dashboard/types";
import TileBoundary from "@/components/dashboard/TileBoundary";
import {
  clamp,
  formatPercent,
  formatSignedBillions,
  formatSignedPercentDecimal,
  getMarketStateMeta,
} from "@/lib/dashboard/formatters";

type TileKey =
  | "hero"
  | "quick"
  | "fearGreed"
  | "breadth"
  | "vix"
  | "crypto"
  | "liquidity"
  | "riskAppetite"
  | "bankingStress";

type TileFreshness = {
  label?: string;
  tone?: "live" | "dated" | "stale" | "offline";
};

type RegimeAxis = {
  label: string;
  value: number;
  contribution: number;
  detail: string;
};

type HomeBentoGridProps = {
  dashboard: DashboardSnapshot;
  regimeLabel: string;
  regimeClass: string;
  regimeConfidence: number;
  regimeAxes: RegimeAxis[];
  dataReady: boolean;
  failedSources: string[];
  freshness?: DashboardFreshnessMap;
};

const tileSourceMap: Record<TileKey, string[]> = {
  hero: ["sentiment", "benchmarks", "weeklyBanking", "quarterlyBanking", "dailyBanking"],
  quick: ["ticker:SPY", "ticker:QQQ", "dailyBanking"],
  fearGreed: ["sentiment"],
  breadth: ["benchmarks", "ticker:XLK", "ticker:XLF", "ticker:XLV", "ticker:XLE", "ticker:XLI", "ticker:XLC", "ticker:XLY", "ticker:XLP", "ticker:XLRE", "ticker:XLB", "ticker:XLU"],
  vix: ["vix"],
  crypto: ["crypto"],
  liquidity: ["weeklyBanking"],
  riskAppetite: ["putCall"],
  bankingStress: ["weeklyBanking", "quarterlyBanking", "dailyBanking"],
};

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function toneFromRegimeClass(regimeClass: string) {
  if (regimeClass === "is-risk-on") {
    return {
      badge: "border-emerald-300/25 bg-emerald-400/12 text-emerald-200",
      value: "text-emerald-300",
      bar: "from-emerald-300 to-sky-300",
      label: "text-emerald-100",
      ring: "shadow-[0_24px_54px_-38px_rgba(16,185,129,0.65)]",
    };
  }
  if (regimeClass === "is-risk-off") {
    return {
      badge: "border-rose-300/25 bg-rose-400/12 text-rose-200",
      value: "text-rose-200",
      bar: "from-rose-300 to-amber-300",
      label: "text-rose-100",
      ring: "shadow-[0_24px_54px_-38px_rgba(244,63,94,0.55)]",
    };
  }
  return {
    badge: "border-amber-300/25 bg-amber-300/12 text-amber-100",
    value: "text-amber-200",
    bar: "from-amber-300 to-orange-200",
    label: "text-amber-100",
    ring: "shadow-[0_24px_54px_-38px_rgba(245,158,11,0.55)]",
  };
}

function formatQuarterLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const month = parsed.getUTCMonth();
  const quarter = Math.floor(month / 3) + 1;
  return `Q${quarter} ${parsed.getUTCFullYear()}`;
}

function formatDateLabel(cadence: DashboardFreshnessCadence, value: string | null) {
  if (!value) {
    if (cadence === "realtime") return "실시간";
    if (cadence === "weekly") return "주간";
    if (cadence === "quarterly") return "분기";
    return "일간";
  }

  if (cadence === "quarterly") {
    return `분기 · ${formatQuarterLabel(value)}`;
  }

  if (cadence === "realtime") {
    return "실시간";
  }

  const compact = value.slice(0, 10);
  const cadenceLabel = cadence === "weekly" ? "주간" : "일간";
  return `${cadenceLabel} · ${compact}`;
}

function deriveFreshnessMeta(meta: DashboardFreshnessMap[string] | undefined): TileFreshness | undefined {
  if (!meta) return undefined;
  const tone = meta.isFallback ? (meta.cadence === "realtime" ? "stale" : "offline") : meta.cadence === "realtime" ? "live" : "dated";
  return {
    label: formatDateLabel(meta.cadence, meta.updatedAt),
    tone,
  };
}

function FreshnessBadge({
  meta,
  dark = false,
}: {
  meta?: TileFreshness;
  dark?: boolean;
}) {
  if (!meta?.label) return null;

  if (meta.tone === "live") {
    return (
      <span
        className={cx(
          "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em]",
          dark ? "border-white/[0.12] bg-white/[0.08] text-emerald-200" : "border-emerald-200 bg-emerald-50 text-emerald-700",
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.18)]" />
        {meta.label}
      </span>
    );
  }

  if (meta.tone === "stale") {
    return (
      <span
        className={cx(
          "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em]",
          dark ? "border-amber-300/20 bg-amber-300/12 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-700",
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        {meta.label}
      </span>
    );
  }

  return (
    <span
        className={cx(
          "inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em]",
          dark ? "border-white/[0.10] bg-white/[0.08] text-white/70" : "border-slate-200 bg-slate-50 text-slate-600",
        )}
      >
      {meta.label}
    </span>
  );
}

function TileShell({
  kicker,
  title,
  children,
  className,
  dark = false,
  muted = false,
  freshness,
  href,
  hrefLabel = "상세 보기",
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  className?: string;
  dark?: boolean;
  muted?: boolean;
  freshness?: TileFreshness;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <article
      className={cx(
        "relative min-w-0 overflow-hidden rounded-[1.5rem] border p-4 transition hover:-translate-y-px",
        dark
          ? "border-white/10 bg-[linear-gradient(160deg,#020617_0%,#08182f_52%,#0f2e57_100%)] text-white shadow-[0_18px_42px_-32px_rgba(15,23,42,0.85)]"
          : "border-slate-200 bg-white text-slate-950 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.10)] hover:shadow-[0_18px_48px_-12px_rgba(0,0,0,0.14)]",
        muted && "opacity-[0.55] saturate-[0.75]",
        className,
      )}
    >
      <div className="relative z-10 flex min-h-full flex-col gap-4">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cx("text-[11px] font-black uppercase tracking-[0.14em]", dark ? "text-white/60" : "text-slate-500")}>
              {kicker}
            </p>
            <h3 className={cx("mt-2 text-lg font-black tracking-tight", dark ? "text-white" : "text-slate-950")}>{title}</h3>
          </div>
          <FreshnessBadge meta={freshness} dark={dark} />
        </header>

        <div className="min-w-0 flex-1">{children}</div>

        {href ? (
          <div className="flex justify-end">
            <TransitionLink
              href={href}
              className={cx(
                "inline-flex min-h-9 items-center justify-center rounded-full border px-3 text-[11px] font-black uppercase tracking-[0.12em] transition hover:-translate-y-0.5",
                dark
                  ? "border-white/[0.12] bg-white/[0.08] text-white/80 hover:bg-white/[0.14]"
                  : "border-slate-200 bg-white text-slate-700 hover:border-brand-interactive hover:text-brand-interactive",
              )}
            >
              {hrefLabel}
            </TransitionLink>
          </div>
        ) : null}
      </div>

      {muted ? (
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-white/30 backdrop-blur-[1px]" aria-hidden="true" />
      ) : null}
      <div
        className={cx(
          "pointer-events-none absolute inset-0 rounded-[inherit]",
          dark
            ? "bg-[radial-gradient(120%_100%_at_0%_0%,rgba(52,211,153,0.12),rgba(52,211,153,0)_55%)]"
            : "bg-[radial-gradient(120%_90%_at_0%_0%,rgba(27,115,211,0.06),rgba(27,115,211,0)_55%),radial-gradient(110%_80%_at_100%_100%,rgba(213,173,54,0.05),rgba(213,173,54,0)_52%)]",
        )}
        aria-hidden="true"
      />
    </article>
  );
}


function axisStyle(index: number) {
  if (index === 0) return "from-emerald-300 to-sky-300";
  if (index === 1) return "from-sky-300 to-blue-300";
  return "from-amber-300 to-orange-200";
}

export default function HomeBentoGrid({
  dashboard,
  regimeLabel,
  regimeClass,
  regimeConfidence,
  regimeAxes,
  dataReady,
  failedSources,
  freshness,
}: HomeBentoGridProps) {
  const regimeTone = toneFromRegimeClass(regimeClass);
  const spyIndex = dashboard.quickIndices.find((item) => item.symbol === "SPY") ?? dashboard.quickIndices[0];
  const qqqIndex = dashboard.quickIndices.find((item) => item.symbol === "QQQ") ?? dashboard.quickIndices[1];
  const sectorLeaders = [...dashboard.sectorRows]
    .sort((left, right) => right.displayChange - left.displayChange)
    .slice(0, 3);
  const sectorLaggards = [...dashboard.sectorRows]
    .sort((left, right) => left.displayChange - right.displayChange)
    .slice(0, 2);
  const fearGreedOffset = Number((126 * (1 - clamp(dashboard.fearGreedScore, 0, 100) / 100)).toFixed(2));
  const isOffline = (!dataReady && failedSources.length > 0) || (
    dataReady && (["hero", "quick", "fearGreed", "breadth", "vix", "crypto", "liquidity", "riskAppetite", "bankingStress"] as TileKey[])
      .every((tileKey) => tileSourceMap[tileKey].every((source) => failedSources.includes(source)))
  );
  const hasPartialFailures = dataReady && !isOffline && failedSources.length > 0;
  const isLoading = !dataReady && failedSources.length === 0;

  const hasTickerFailures = (sourcePrefix: string) => failedSources.some((item) => item.startsWith(sourcePrefix));
  const tileFailed = {
    hero: tileSourceMap.hero.some((item) => failedSources.includes(item)) || hasTickerFailures("ticker:XL"),
    quick: tileSourceMap.quick.some((item) => failedSources.includes(item)),
    fearGreed: tileSourceMap.fearGreed.some((item) => failedSources.includes(item)),
    breadth: failedSources.includes("benchmarks") || hasTickerFailures("ticker:XL"),
    vix: failedSources.includes("vix"),
    crypto: failedSources.includes("crypto"),
    liquidity: failedSources.includes("weeklyBanking"),
    riskAppetite: failedSources.includes("putCall"),
    bankingStress: tileSourceMap.bankingStress.some((item) => failedSources.includes(item)),
  } satisfies Record<TileKey, boolean>;

  const freshnessMap: Partial<Record<TileKey, TileFreshness>> = {
    hero: {
      label: "혼합 기준",
      tone: tileFailed.hero ? "stale" : "dated",
    },
    quick: deriveFreshnessMeta(freshness?.["ticker:SPY"] ?? freshness?.dailyBanking),
    fearGreed: deriveFreshnessMeta(freshness?.sentiment),
    breadth: dashboard.sectorMode === "LIVE_1D"
      ? deriveFreshnessMeta(freshness?.["ticker:XLK"] ?? freshness?.benchmarks)
      : deriveFreshnessMeta(freshness?.benchmarks),
    vix: deriveFreshnessMeta(freshness?.vix),
    crypto: deriveFreshnessMeta(freshness?.crypto),
    liquidity: deriveFreshnessMeta(freshness?.weeklyBanking),
    riskAppetite: deriveFreshnessMeta(freshness?.putCall),
    bankingStress: {
      label: "혼합 기준",
      tone: tileFailed.bankingStress ? "stale" : "dated",
    },
  };

  return (
    <div className="space-y-4">
        {isLoading ? (
          <div className="rounded-[1.2rem] border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">
            데이터를 확인하는 중입니다. 기본값은 흐리게 표시됩니다.
          </div>
        ) : null}
        {hasPartialFailures ? (
          <div className="rounded-[1.2rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            일부 데이터가 늦거나 미수신 상태입니다. 정상 수신된 타일만 선명하게 표시합니다.
          </div>
        ) : null}
        {isOffline ? (
          <div className="rounded-[1.2rem] border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
            오프라인 기준값입니다. 실제 시장과 다를 수 있습니다.
          </div>
        ) : null}

        <section className="grid auto-rows-[minmax(138px,auto)] grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 lg:gap-4">
          <TileBoundary tileKey="hero">
          <TileShell
            kicker="Market Regime"
            title={regimeLabel}
            dark
            muted={!dataReady || isOffline || tileFailed.hero}
            freshness={freshnessMap.hero}
            className={cx(
              "col-span-2 sm:col-span-3 lg:col-span-2",
              "lg:row-span-2",
              regimeTone.ring,
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className={cx("inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em]", regimeTone.badge)}>
                <span className={regimeTone.label}>시장 판정</span>
              </div>
              <div className="rounded-2xl border border-white/[0.10] bg-white/[0.08] px-4 py-3 text-right">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-white/60">Confidence</p>
                <p className={cx("mt-1 text-4xl font-black orbitron", regimeTone.value)}>{regimeConfidence}%</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              {regimeAxes.map((axis, index) => (
                <div key={axis.label} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.12em] text-white/80">
                    <span>{axis.label}</span>
                    <span>{axis.value}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-white/10">
                    <div
                      className={cx("h-2.5 rounded-full bg-gradient-to-r", axisStyle(index))}
                      style={{ width: `${axis.value}%` }}
                    />
                  </div>
                  <p className="text-sm text-white/[0.68]">{axis.detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {["3초 요약", "30초 오버뷰"].map((item, index) => (
                <div key={item} className="rounded-2xl border border-white/[0.10] bg-white/[0.06] px-3 py-3">
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-white/60">{item}</p>
                  <p className="mt-2 text-sm font-semibold text-white/[0.88]">
                    {index === 0
                      ? `${regimeLabel} ${regimeConfidence}% · ${dashboard.fearGreedLabel}`
                      : `섹터 ${dashboard.sectorUp}/${dashboard.sectorRows.length} · 유동성 ${formatSignedBillions(dashboard.liquidityFlow)}`}
                  </p>
                </div>
              ))}
            </div>
          </TileShell>
          </TileBoundary>

          <TileBoundary tileKey="quick">
          <TileShell
            kicker="Quick Indices"
            title="SPY · QQQ · 10Y · HY"
            muted={!dataReady || isOffline || tileFailed.quick}
            freshness={freshnessMap.quick}
            className="col-span-2 sm:col-span-1 lg:col-span-2"
          >
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  label: "SPY",
                  value: formatSignedPercentDecimal(spyIndex.change),
                  sub: spyIndex.price !== null ? `$${spyIndex.price.toFixed(2)}` : "기본 데이터",
                  meta: getMarketStateMeta(spyIndex.marketState),
                  tone: spyIndex.change >= 0 ? "text-emerald-700" : "text-rose-700",
                },
                {
                  label: "QQQ",
                  value: formatSignedPercentDecimal(qqqIndex.change),
                  sub: qqqIndex.price !== null ? `$${qqqIndex.price.toFixed(2)}` : "기본 데이터",
                  meta: getMarketStateMeta(qqqIndex.marketState),
                  tone: qqqIndex.change >= 0 ? "text-emerald-700" : "text-rose-700",
                },
                {
                  label: "10Y",
                  value: formatPercent(dashboard.tenYearYield, 2),
                  sub: "일간 금리",
                  meta: null,
                  tone: "text-slate-900",
                },
                {
                  label: "HY",
                  value: formatPercent(dashboard.hySpread, 2),
                  sub: "신용 스프레드",
                  meta: null,
                  tone: "text-amber-700",
                },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{item.label}</p>
                    {item.meta ? (
                      <span className={cx("market-state-badge", item.meta.className)}>{item.meta.label}</span>
                    ) : null}
                  </div>
                  <p className={cx("mt-2 text-2xl font-black orbitron", item.tone)}>{item.value}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{item.sub}</p>
                </div>
              ))}
            </div>
          </TileShell>
          </TileBoundary>

          <TileBoundary tileKey="vix">
          <TileShell
            kicker="Volatility"
            title="VIX"
            muted={!dataReady || isOffline || tileFailed.vix}
            freshness={freshnessMap.vix}
            href="/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fsentiment-signal%2Findex.html"
            className="col-span-1"
          >
            <p className="text-4xl font-black tracking-tight text-slate-950 orbitron">{dashboard.vixValue.toFixed(1)}</p>
            <p className="mt-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">
              {dashboard.vixLabel}
            </p>
          </TileShell>
          </TileBoundary>

          <TileBoundary tileKey="crypto">
          <TileShell
            kicker="Crypto Sentiment"
            title="Crypto F&G"
            muted={!dataReady || isOffline || tileFailed.crypto}
            freshness={freshnessMap.crypto}
            href="/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fsentiment-signal%2Findex.html"
            className="col-span-1"
          >
            <p className="text-4xl font-black tracking-tight text-slate-950 orbitron">{Math.round(dashboard.cryptoFearGreed)}</p>
            <p className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-700">
              {dashboard.cryptoLabel}
            </p>
          </TileShell>
          </TileBoundary>

          <TileBoundary tileKey="fearGreed">
          <TileShell
            kicker="Fear & Greed"
            title="Sentiment Gauge"
            muted={!dataReady || isOffline || tileFailed.fearGreed}
            freshness={freshnessMap.fearGreed}
            href="/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fsentiment-signal%2Findex.html"
            className="col-span-1 sm:col-span-2 lg:col-span-2"
          >
            <div className="flex items-center gap-4">
              <div className="relative h-20 w-20 shrink-0 sm:h-24 sm:w-24">
                <svg viewBox="0 0 100 50" className="h-full w-full" aria-hidden="true">
                  <defs>
                    <linearGradient id="homeFearGreedGauge" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#ef4444" />
                      <stop offset="50%" stopColor="#f59e0b" />
                      <stop offset="100%" stopColor="#22c55e" />
                    </linearGradient>
                  </defs>
                  <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" stroke="#e2e8f0" strokeWidth="7" strokeLinecap="round" />
                  <path
                    d="M 10 45 A 40 40 0 0 1 90 45"
                    fill="none"
                    stroke="url(#homeFearGreedGauge)"
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray="126"
                    strokeDashoffset={fearGreedOffset}
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-4xl font-black tracking-tight text-slate-950 orbitron">{Math.round(dashboard.fearGreedScore)}</p>
                <p className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-700">
                  {dashboard.fearGreedLabel}
                </p>
              </div>
            </div>
          </TileShell>
          </TileBoundary>

          <TileBoundary tileKey="breadth">
          <TileShell
            kicker="Breadth"
            title="Sector Expansion"
            muted={!dataReady || isOffline || tileFailed.breadth}
            freshness={freshnessMap.breadth}
            href="/sectors"
            hrefLabel="섹터 보기"
            className="col-span-1"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                상승 {dashboard.sectorUp}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-700">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                하락 {dashboard.sectorDown}
              </span>
            </div>
            <div className="mt-3 hidden flex-wrap gap-2 sm:flex">
              {sectorLeaders.map((sector) => (
                <span key={sector.key} className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                  {sector.etf} {formatSignedPercentDecimal(sector.displayChange, 1)}
                </span>
              ))}
              {sectorLaggards.map((sector) => (
                <span key={`lag-${sector.key}`} className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                  {sector.etf} {formatSignedPercentDecimal(sector.displayChange, 1)}
                </span>
              ))}
            </div>
            <div className="mt-3 sm:hidden">
              <div className="h-2 rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-emerald-500 to-sky-400"
                  style={{ width: `${(dashboard.sectorUp / Math.max(dashboard.sectorRows.length, 1)) * 100}%` }}
                />
              </div>
            </div>
          </TileShell>
          </TileBoundary>

          <TileBoundary tileKey="liquidity">
          <TileShell
            kicker="Liquidity"
            title="Funding Pulse"
            muted={!dataReady || isOffline || tileFailed.liquidity}
            freshness={freshnessMap.liquidity}
            href="/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fliquidity-flow.html"
            className="col-span-2 sm:col-span-1"
          >
            <p className="text-3xl font-black tracking-tight text-slate-950 orbitron">{formatSignedBillions(dashboard.liquidityFlow)}</p>
            <p className="mt-2 text-sm text-slate-600">{dashboard.liquidityFlowLabel}</p>
            <div className="mt-4 flex h-14 items-end gap-1.5 rounded-[1rem] border border-emerald-100 bg-emerald-50 px-2 py-2">
              {dashboard.liquidityBars.map((bar, index) => (
                <span
                  key={`${bar.delta}-${index}`}
                  className={cx(
                    "flex-1 rounded-t-md",
                    bar.delta >= 0 ? "bg-gradient-to-t from-emerald-700 to-emerald-400" : "bg-gradient-to-t from-orange-500 to-rose-500",
                  )}
                  style={{ height: `${bar.height}%` }}
                />
              ))}
            </div>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              예대율 {formatPercent(dashboard.loanDepositRatio, 1)}
            </p>
          </TileShell>
          </TileBoundary>

          <TileBoundary tileKey="bankingStress">
          <TileShell
            kicker="Banking + Stress"
            title="Funding Stress Guard"
            muted={!dataReady || isOffline || tileFailed.bankingStress}
            freshness={freshnessMap.bankingStress}
            href="/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fbanking-health.html"
            className="col-span-2 sm:col-span-3 lg:col-span-2"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1rem] border border-slate-200 bg-white/70 px-3 py-3">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Banking</p>
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={cx(
                      "h-2.5 w-2.5 rounded-full",
                      dashboard.bankingTone === "stable" ? "bg-emerald-500" : dashboard.bankingTone === "watch" ? "bg-amber-500" : "bg-rose-500",
                    )}
                  />
                  <strong className="text-lg font-black text-slate-950">{dashboard.bankingLabel}</strong>
                </div>
                <p className="mt-2 text-sm text-slate-600">{dashboard.bankingSummary}</p>
              </div>
              <div className="rounded-[1rem] border border-slate-200 bg-white/70 px-3 py-3">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Stress</p>
                <p className="mt-2 text-3xl font-black text-slate-950 orbitron">{dashboard.stressScore.toFixed(2)}</p>
                <p className="mt-2 text-sm text-slate-600">
                  {dashboard.stressLabel} · HY {formatPercent(dashboard.hySpread, 2)} · 10Y {formatPercent(dashboard.tenYearYield, 2)}
                </p>
              </div>
            </div>
          </TileShell>
          </TileBoundary>

          <TileBoundary tileKey="riskAppetite">
          <TileShell
            kicker="Positioning"
            title="Risk Appetite"
            muted={!dataReady || isOffline || tileFailed.riskAppetite}
            freshness={freshnessMap.riskAppetite}
            href="/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fsentiment-signal%2Findex.html"
            className="col-span-2 sm:col-span-2 lg:col-span-2"
          >
            <div className="grid gap-3 sm:grid-cols-[0.7fr_1.3fr]">
              <div className="rounded-[1rem] border border-slate-200 bg-white/70 px-3 py-3">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Put / Call</p>
                <p className="mt-2 text-3xl font-black text-slate-950 orbitron">{dashboard.putCallValue.toFixed(2)}</p>
                <p className="mt-2 text-sm text-slate-600">{dashboard.putCallLabel}</p>
              </div>
              <div className="grid gap-2">
                <div className="rounded-[1rem] border border-slate-200 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700">
                  Crypto {Math.round(dashboard.cryptoFearGreed)} · {dashboard.cryptoLabel}
                </div>
                <div className="rounded-[1rem] border border-slate-200 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700">
                  VIX {dashboard.vixValue.toFixed(2)} · {dashboard.vixLabel}
                </div>
                <div className="rounded-[1rem] border border-slate-200 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700">
                  Put/Call {dashboard.putCallValue.toFixed(2)} · {dashboard.putCallLabel}
                </div>
              </div>
            </div>
          </TileShell>
          </TileBoundary>
        </section>
    </div>
  );
}
