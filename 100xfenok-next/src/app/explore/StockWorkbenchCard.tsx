"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { formatSignedPercentDecimal } from "@/lib/dashboard/formatters";

type WorkbenchTab = "action" | "revision" | "movers" | "returns";
type ActionBucket = "smart_money" | "value_momentum" | "index_core";

interface ActionRow {
  symbol: string;
  company?: string | null;
  sector?: string | null;
  actionScore?: number | null;
  confidenceLabel?: string | null;
  actionLabel?: string | null;
  actionBucket?: string | null;
  actionReasons?: string[];
  lowEvidence?: boolean | null;
  return12m?: number | null;
}

interface ActionDoc {
  generated_at?: string;
  coverage?: {
    indexed_stock_count?: number | null;
    conviction_matched_count?: number | null;
    quarter_close_ticker_count?: number | null;
    bucket_counts?: Record<string, number>;
  };
  fields?: string[];
  rows?: Array<ActionRow | unknown[]>;
}

interface RevisionRow {
  ticker: string;
  name: string | null;
  change_1w: number;
  eps_fy1: number | null;
  as_of: string | null;
}

interface RevisionDoc {
  generated_at?: string;
  up?: RevisionRow[];
  down?: RevisionRow[];
}

interface DiscoveryRow {
  symbol: string;
  company: string;
  sector: string | null;
  price?: number | null;
  change?: number | null;
  value?: number | null;
  changePercent?: number | null;
}

interface DiscoverySide {
  date?: string | null;
  count?: number | null;
  rows?: DiscoveryRow[];
}

interface DiscoveryDoc {
  generated_at?: string;
  movers?: {
    gainers?: DiscoverySide;
    losers?: DiscoverySide;
  };
  returns?: {
    asOf?: string | null;
    best1y?: DiscoveryRow[];
    worst1y?: DiscoveryRow[];
  };
  dividends?: {
    asOf?: string | null;
    highYield?: DiscoveryRow[];
    highTtm?: DiscoveryRow[];
  };
  universe?: {
    uniqueCount?: number | null;
  };
}

interface WorkbenchData {
  actions: ActionDoc | null;
  revisions: RevisionDoc | null;
  discovery: DiscoveryDoc | null;
}

let cache: WorkbenchData | null = null;
let pending: Promise<WorkbenchData> | null = null;

function loadJson<T>(path: string): Promise<T | null> {
  return fetch(path, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() as Promise<T> : null))
    .catch(() => null);
}

function loadWorkbench(): Promise<WorkbenchData> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = Promise.all([
    loadJson<ActionDoc>("/data/computed/stock_action_summary.json"),
    loadJson<RevisionDoc>("/data/global-scouter/core/revision_movers.json"),
    loadJson<DiscoveryDoc>("/data/slickcharts/discovery-summary.json"),
  ]).then(([actions, revisions, discovery]) => {
    cache = { actions, revisions, discovery };
    return cache;
  }).catch(() => {
    pending = null;
    return { actions: null, revisions: null, discovery: null };
  });
  return pending;
}

function cleanTicker(value: string | null | undefined): string {
  return String(value || "").replace(/^\$/, "").trim().toUpperCase();
}

function shortName(value: string | null | undefined, fallback = "—", max = 36): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function datePart(value: string | null | undefined): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "—";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text;
}

function fmtCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ko-KR") : "—";
}

function fmtScore(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value).toString() : "—";
}

function fmtFraction(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatSignedPercentDecimal(value, 1) : "—";
}

function fmtMove(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
}

function fmtRevision(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function fmtDividendYield(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

function fmtDollars(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";
}

function confidenceText(label: string | null | undefined): string {
  if (label === "high") return "신뢰 높음";
  if (label === "medium") return "신뢰 중간";
  if (label === "low") return "신뢰 낮음";
  return "신뢰 미정";
}

function actionTone(row: ActionRow): "up" | "neutral" {
  if (row.lowEvidence || row.confidenceLabel === "low") return "neutral";
  if (row.actionBucket === "smart_money" || row.actionBucket === "value_momentum") return "up";
  return "neutral";
}

function normalizeActionRow(row: ActionRow | unknown[], fields: string[]): ActionRow | null {
  if (!Array.isArray(row)) return row.symbol ? row : null;
  const value = (key: string): unknown => {
    const index = fields.indexOf(key);
    return index >= 0 ? row[index] : undefined;
  };
  const symbol = value("symbol");
  if (typeof symbol !== "string" || symbol.length === 0) return null;
  const actionReasons = value("actionReasons");
  return {
    symbol,
    company: typeof value("company") === "string" ? value("company") as string : null,
    sector: typeof value("sector") === "string" ? value("sector") as string : null,
    actionScore: typeof value("actionScore") === "number" ? value("actionScore") as number : null,
    confidenceLabel: typeof value("confidenceLabel") === "string" ? value("confidenceLabel") as string : null,
    actionLabel: typeof value("actionLabel") === "string" ? value("actionLabel") as string : null,
    actionBucket: typeof value("actionBucket") === "string" ? value("actionBucket") as string : null,
    actionReasons: Array.isArray(actionReasons) ? actionReasons.filter((item): item is string => typeof item === "string") : [],
    lowEvidence: typeof value("lowEvidence") === "boolean" ? value("lowEvidence") as boolean : false,
    return12m: typeof value("return12m") === "number" ? value("return12m") as number : null,
  };
}

function StockRowLink({
  symbol,
  name,
  detail,
  value,
  tone = "neutral",
}: {
  symbol?: string | null;
  name?: string | null;
  detail?: string | null;
  value?: string | null;
  tone?: "up" | "down" | "neutral";
}) {
  const ticker = cleanTicker(symbol);
  const body = (
    <>
      <span className="co">
        <div className="n">{shortName(name || ticker)}</div>
        <div className="tk">{ticker || "—"}{detail ? ` · ${detail}` : ""}</div>
      </span>
      <span className={`pc num ${tone}`}>{value || "—"}</span>
    </>
  );
  return ticker ? (
    <TransitionLink href={`/stock/${encodeURIComponent(ticker)}`} className="mv-row">
      {body}
    </TransitionLink>
  ) : (
    <div className="mv-row">{body}</div>
  );
}

export default function StockWorkbenchCard() {
  const [data, setData] = useState<WorkbenchData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<WorkbenchTab>("action");
  const [actionBucket, setActionBucket] = useState<ActionBucket>("smart_money");

  useEffect(() => {
    let cancelled = false;
    loadWorkbench().then((next) => {
      if (!cancelled) {
        setData(next);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const allActions = useMemo(() => {
    const fields = data?.actions?.fields ?? [];
    return (data?.actions?.rows ?? [])
      .map((row) => normalizeActionRow(row, fields))
      .filter((row): row is ActionRow => Boolean(row));
  }, [data]);

  const actionRows = useMemo(
    () => allActions.filter((row) => row.actionBucket === actionBucket).slice(0, 4),
    [allActions, actionBucket],
  );
  const revisionUp = (data?.revisions?.up ?? []).slice(0, 3);
  const revisionDown = (data?.revisions?.down ?? []).slice(0, 3);
  const gainers = (data?.discovery?.movers?.gainers?.rows ?? []).slice(0, 3);
  const losers = (data?.discovery?.movers?.losers?.rows ?? []).slice(0, 3);
  const best1y = (data?.discovery?.returns?.best1y ?? []).slice(0, 2);
  const worst1y = (data?.discovery?.returns?.worst1y ?? []).slice(0, 1);
  const highYield = (data?.discovery?.dividends?.highYield ?? []).slice(0, 2);
  const highTtm = (data?.discovery?.dividends?.highTtm ?? []).slice(0, 1);

  const actionBucketCounts = allActions.reduce<Record<string, number>>((acc, row) => {
    const key = row.actionBucket || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const moverCount = (data?.discovery?.movers?.gainers?.count ?? gainers.length)
    + (data?.discovery?.movers?.losers?.count ?? losers.length);
  const revisionCount = (data?.revisions?.up?.length ?? 0) + (data?.revisions?.down?.length ?? 0);
  const returnsCount = data?.discovery?.universe?.uniqueCount ?? null;
  const tabs: Array<{ key: WorkbenchTab; label: string; count: number | null }> = [
    { key: "action", label: "이벤트", count: allActions.length },
    { key: "revision", label: "추정치", count: revisionCount },
    { key: "movers", label: "급등락", count: moverCount },
    { key: "returns", label: "수익/배당", count: returnsCount },
  ];

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>종목 후보</h2>
        <span className="desc">
          {datePart(data?.actions?.generated_at ?? data?.revisions?.generated_at ?? data?.discovery?.generated_at)} · 이벤트/추정치/급등락
        </span>
      </div>

      {!loaded ? (
        <div className="mv-row">
          <span className="co">
            <div className="n">종목 후보 확인 중</div>
            <div className="tk">이벤트·추정치·급등락·수익률 데이터를 읽고 있습니다</div>
          </span>
          <span className="pc num neutral">...</span>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2 px-[var(--panel-pad)]">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={tab === item.key}
                onClick={() => setTab(item.key)}
                className={`min-h-9 rounded-full border px-3 text-[11px] font-black tracking-wide transition ${
                  tab === item.key
                    ? "border-[var(--c-brand)] bg-[var(--c-brand)] text-white"
                    : "border-[var(--c-line)] bg-white text-[var(--c-ink-3)] hover:border-[var(--c-brand)] hover:text-[var(--c-brand)]"
                }`}
              >
                {item.label} · {fmtCount(item.count)}
              </button>
            ))}
          </div>

          {tab === "action" ? (
            <div className="mt-3">
              <div className="mb-2 flex flex-wrap gap-1.5 px-[var(--panel-pad)]">
                {[
                  ["smart_money", "기관·고수"],
                  ["value_momentum", "밸류+모멘텀"],
                  ["index_core", "지수 핵심"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={actionBucket === key}
                    onClick={() => setActionBucket(key as ActionBucket)}
                    className={`min-h-8 rounded-full border px-2.5 text-[10px] font-black transition ${
                      actionBucket === key
                        ? "border-[var(--c-ink)] bg-[var(--c-ink)] text-white"
                        : "border-[var(--c-line)] bg-[var(--c-surface-2)] text-[var(--c-ink-3)] hover:border-[var(--c-ink-3)]"
                    }`}
                  >
                    {label} · {fmtCount(actionBucketCounts[key])}
                  </button>
                ))}
              </div>
              <div className="mv-col">
                {actionRows.length > 0 ? actionRows.map((row) => (
                  <StockRowLink
                    key={row.symbol}
                    symbol={row.symbol}
                    name={row.company}
                    detail={`${row.actionLabel || "관찰"} · ${row.sector || "섹터 미정"} · ${confidenceText(row.confidenceLabel)}`}
                    value={`${fmtScore(row.actionScore)} / ${fmtFraction(row.return12m)}`}
                    tone={actionTone(row)}
                  />
                )) : (
                  <StockRowLink name="표시할 투자 후보 없음" detail="선택한 분류에 표시할 종목이 없습니다" tone="neutral" />
                )}
              </div>
            </div>
          ) : null}

          {tab === "revision" ? (
            <div className="panel-b grid gap-3 lg:grid-cols-2">
              <div className="mv-col">
                <div className="mv-h up">▲ EPS 상향</div>
                {revisionUp.map((row) => (
                  <StockRowLink
                    key={`ru-${row.ticker}`}
                    symbol={row.ticker}
                    name={row.name}
                    detail={`FY+1 EPS ${row.eps_fy1 ?? "—"} · ${datePart(row.as_of)}`}
                    value={fmtRevision(row.change_1w)}
                    tone="up"
                  />
                ))}
              </div>
              <div className="mv-col">
                <div className="mv-h down">▼ EPS 하향</div>
                {revisionDown.map((row) => (
                  <StockRowLink
                    key={`rd-${row.ticker}`}
                    symbol={row.ticker}
                    name={row.name}
                    detail={`FY+1 EPS ${row.eps_fy1 ?? "—"} · ${datePart(row.as_of)}`}
                    value={fmtRevision(row.change_1w)}
                    tone="down"
                  />
                ))}
              </div>
            </div>
          ) : null}

          {tab === "movers" ? (
            <div className="panel-b grid gap-3 lg:grid-cols-2">
              <div className="mv-col">
                <div className="mv-h up">▲ 상승</div>
                {gainers.map((row) => (
                  <StockRowLink
                    key={`g-${row.symbol}`}
                    symbol={row.symbol}
                    name={row.company}
                    detail={`${row.sector || "섹터 미정"} · ${row.price ? `$${row.price.toFixed(2)}` : "가격 —"}`}
                    value={fmtMove(row.changePercent)}
                    tone="up"
                  />
                ))}
              </div>
              <div className="mv-col">
                <div className="mv-h down">▼ 하락</div>
                {losers.map((row) => (
                  <StockRowLink
                    key={`l-${row.symbol}`}
                    symbol={row.symbol}
                    name={row.company}
                    detail={`${row.sector || "섹터 미정"} · ${row.price ? `$${row.price.toFixed(2)}` : "가격 —"}`}
                    value={fmtMove(row.changePercent)}
                    tone="down"
                  />
                ))}
              </div>
            </div>
          ) : null}

          {tab === "returns" ? (
            <div className="panel-b grid gap-3 lg:grid-cols-2">
              <div className="mv-col">
                <div className="mv-h up">수익률</div>
                {best1y.map((row) => (
                  <StockRowLink key={`b1-${row.symbol}`} symbol={row.symbol} name={row.company} detail={row.sector} value={fmtFraction(row.value ?? row.changePercent)} tone="up" />
                ))}
                {worst1y.map((row) => (
                  <StockRowLink key={`w1-${row.symbol}`} symbol={row.symbol} name={row.company} detail={row.sector} value={fmtFraction(row.value ?? row.changePercent)} tone="down" />
                ))}
              </div>
              <div className="mv-col">
                <div className="mv-h up">배당</div>
                {highYield.map((row) => (
                  <StockRowLink key={`hy-${row.symbol}`} symbol={row.symbol} name={row.company} detail={row.sector} value={fmtDividendYield(row.value)} tone="up" />
                ))}
                {highTtm.map((row) => (
                  <StockRowLink key={`ht-${row.symbol}`} symbol={row.symbol} name={row.company} detail={row.sector} value={fmtDollars(row.value)} tone="up" />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      <div className="panel-foot flex flex-wrap items-center justify-between gap-2">
        <span>계산 점수·추정치 변화·급등락 종목·수익/배당 요약은 데이터 갱신 시 자동 반영됩니다</span>
        <TransitionLink href="/screener" className="font-black text-brand-interactive hover:underline">
          스크리너로 이동
        </TransitionLink>
      </div>
    </section>
  );
}
