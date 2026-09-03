"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { useDashboardData } from "@/hooks/useDashboardData";
import { clamp, getRegimeLabel } from "@/lib/dashboard/formatters";
import { isValidEntityTicker, normalizeForEntityKey } from "@/lib/ticker";
import { EvidenceRail, Panel, PanelHeader } from "@/components/ui";
import type { EvidenceRailFreshness } from "@/components/ui/EvidenceRail";
import type { EvidenceStage } from "@/lib/evidence/provenance";
import { formatMoney as formatMoneyByCurrency } from "@/lib/format";
import { useWatchlist } from "@/lib/watchlist";
import { ROUTES } from "@/lib/routes";

type DiffSegment = "visit" | "week" | "revision";
type DiffTone = "up" | "down" | "neutral";

type DiffRow = {
  id: string;
  ticker: string | null;
  title: string;
  kind: string;
  before: string;
  after: string;
  afterNote?: string;
  delta: string;
  tone: DiffTone;
  accent: "add" | "del" | "none";
  href?: string;
  rank: number;
};

type VisitSnapshot = {
  at: string;
  edgeScore: number | null;
  regime: string | null;
  revisionAsOf: string | null;
  quarter: string | null;
};

const SNAPSHOT_KEY = "100xfenok:changes:last-visit:v1";

const SEGMENTS: Array<{ key: DiffSegment; label: string }> = [
  { key: "visit", label: "지난 방문 이후" },
  { key: "week", label: "1주" },
  { key: "revision", label: "리비전 단위" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function isoDay(value: unknown): string | null {
  const text = asString(value);
  const match = text?.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function readSnapshot(): VisitSnapshot | null {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.at !== "string") return null;
    return {
      at: parsed.at,
      edgeScore: asNumber(parsed.edgeScore),
      regime: asString(parsed.regime),
      revisionAsOf: asString(parsed.revisionAsOf),
      quarter: asString(parsed.quarter),
    };
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: VisitSnapshot): void {
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // private mode / quota: diff still renders, next visit just has no baseline
  }
}

/** Listing suffix → ISO currency: decided by listing market, never a KR-only test. */
function currencyForTicker(ticker: string): string {
  const symbol = ticker.toUpperCase();
  if (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) return "KRW";
  if (symbol.endsWith(".HK")) return "HKD";
  if (symbol.endsWith(".SZ") || symbol.endsWith(".SS")) return "CNY";
  if (symbol.endsWith(".T")) return "JPY";
  if (symbol.endsWith(".L")) return "GBP";
  return "USD";
}

function formatMoney(value: number, ticker: string): string {
  return formatMoneyByCurrency(value, currencyForTicker(ticker));
}

function formatSigned(value: number, digits: number, suffix: string): string {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${Math.abs(value).toFixed(digits)}${suffix}`;
}

function stockHrefOf(ticker: string | null): string | undefined {
  if (!ticker || !isValidEntityTicker(ticker)) return undefined;
  return ROUTES.stock(ticker);
}

function revisionRows(doc: unknown): DiffRow[] {
  if (!isRecord(doc)) return [];
  const rows: DiffRow[] = [];
  for (const key of ["up", "down"] as const) {
    const list = doc[key];
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!isRecord(raw)) continue;
      const ticker = normalizeForEntityKey(raw.ticker);
      if (!isValidEntityTicker(ticker)) continue;
      const change = asNumber(raw.change_1w);
      const eps = asNumber(raw.eps_fy1);
      const asOf = isoDay(raw.as_of);
      if (change === null || change === 0 || eps === null || asOf === null) continue;
      if (key === "up" ? change <= 0 : change >= 0) continue;
      // The revision feed carries no previous-EPS field: before stays unavailable
      // rather than derived via eps/(1+change), which flips sign on negative EPS.
      const name = asString(raw.name) ?? ticker;
      rows.push({
        id: `revision:${key}:${ticker}:${asOf}`,
        ticker,
        title: `${ticker} · ${name}`,
        kind: "FY+1 EPS",
        before: "—",
        after: formatMoney(eps, ticker),
        delta: formatSigned(change * 100, 1, "%"),
        tone: change > 0 ? "up" : "down",
        accent: change > 0 ? "add" : "del",
        href: stockHrefOf(ticker),
        rank: key === "down" ? 2 : 4,
      });
    }
  }
  const up = rows.filter((row) => row.tone === "up").slice(0, 3);
  const down = rows.filter((row) => row.tone === "down").slice(0, 3);
  return [...up, ...down];
}

function holderRows(trades: unknown, byTicker: unknown): DiffRow[] {
  if (!isRecord(trades)) return [];
  const holders = new Map<string, number>();
  if (isRecord(byTicker)) {
    for (const [key, entry] of Object.entries(byTicker)) {
      if (isRecord(entry) && Array.isArray(entry.holders)) {
        holders.set(normalizeForEntityKey(key), entry.holders.length);
      }
    }
  }
  const buys: Array<{ row: DiffRow; amount: number }> = [];
  const bought = Array.isArray(trades.bought) ? trades.bought : [];
  const sold = Array.isArray(trades.sold) ? trades.sold : [];
  for (const raw of bought) {
    if (!isRecord(raw)) continue;
    const ticker = normalizeForEntityKey(raw.ticker);
    const fresh = asNumber(raw.new_count) ?? 0;
    const current = holders.get(ticker);
    if (!isValidEntityTicker(ticker) || fresh <= 0 || current === undefined) continue;
    const before = current - fresh;
    if (before < 0) continue;
    const amount = asNumber(raw.amount) ?? 0;
    const top = isRecord(raw.top_investor) ? asString(raw.top_investor.name) : null;
    // 신규 only for true new positions (no prior holders); otherwise an increase.
    const isNew = before === 0;
    buys.push({
      row: {
        id: `holders:new:${ticker}`,
        ticker,
        title: `${ticker} · ${asString(raw.name) ?? ticker}`,
        kind: "13F 보유 투자자",
        before: `${before}명`,
        after: `${current}명`,
        afterNote: isNew
          ? (top ? `${top} 신규` : "신규 진입")
          : (top ? `${top} 포함 ${fresh}명 증가` : `${fresh}명 증가`),
        delta: `+${fresh}`,
        tone: "up",
        accent: "add",
        href: stockHrefOf(ticker),
        rank: 5,
      },
      amount,
    });
  }
  const sells: Array<{ row: DiffRow; amount: number }> = [];
  for (const raw of sold) {
    if (!isRecord(raw)) continue;
    const ticker = normalizeForEntityKey(raw.ticker);
    const exits = asNumber(raw.exit_count) ?? 0;
    const current = holders.get(ticker);
    if (!isValidEntityTicker(ticker) || exits <= 0 || current === undefined) continue;
    const amount = asNumber(raw.amount) ?? 0;
    sells.push({
      row: {
        id: `holders:exit:${ticker}`,
        ticker,
        title: `${ticker} · ${asString(raw.name) ?? ticker}`,
        kind: "13F 보유 투자자",
        before: `${current + exits}명`,
        after: `${current}명`,
        afterNote: `${exits}명 전량 이탈`,
        delta: `-${exits}`,
        tone: "down",
        accent: "del",
        href: stockHrefOf(ticker),
        rank: 3,
      },
      amount,
    });
  }
  // Buys and sells rank separately by magnitude (amount): top of each direction
  // stays visible instead of buys-then-slice hiding every exit candidate.
  // The fractional rank keeps magnitude order through the final rank-then-title sort.
  const byAmountDesc = (a: { amount: number }, b: { amount: number }) => b.amount - a.amount;
  const topBuys = buys.sort(byAmountDesc).slice(0, 3).map(({ row }, index) => ({ ...row, rank: 5 + index * 0.01 }));
  const topSells = sells.sort(byAmountDesc).slice(0, 3).map(({ row }, index) => ({ ...row, rank: 3 + index * 0.01 }));
  return [...topBuys, ...topSells];
}

function revisionAsOf(doc: unknown): string | null {
  if (!isRecord(doc)) return null;
  const days = new Set<string>();
  for (const key of ["up", "down"] as const) {
    const list = doc[key];
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const day = isRecord(raw) ? isoDay(raw.as_of) : null;
      if (day) days.add(day);
    }
  }
  const sorted = [...days].sort();
  return sorted.length === 1 ? sorted[0] : null;
}

function tradesQuarter(doc: unknown): string | null {
  if (!isRecord(doc) || !isRecord(doc.metadata)) return null;
  const quarter = asString(doc.metadata.quarter);
  return quarter !== null && /^\d{4}-Q[1-4]$/.test(quarter) ? quarter : null;
}

// Weekly US-Thursday batch lands Friday 08:00 KST (same clock the home panel uses).
function lastRevisionRefreshMs(nowMs: number): number {
  const kst = new Date(nowMs + 9 * 3600 * 1000);
  const back = (kst.getUTCDay() - 5 + 7) % 7;
  const dayStartKstAsUtc = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600 * 1000;
  let refresh = dayStartKstAsUtc - back * 86400 * 1000 + 8 * 3600 * 1000;
  if (refresh > nowMs) refresh -= 7 * 86400 * 1000;
  return refresh;
}

function nextRevisionRefreshLabel(nowMs: number): string {
  const last = lastRevisionRefreshMs(nowMs);
  const next = last > nowMs ? last : last + 7 * 86400 * 1000;
  const kst = new Date(next + 9 * 3600 * 1000);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return `${mm}-${dd} 08:00 리비전 갱신 후 자동 생성`;
}

function toneClass(tone: DiffTone): string {
  if (tone === "up") return "text-gain";
  if (tone === "down") return "text-loss";
  return "text-slate-700";
}

function accentClass(accent: DiffRow["accent"]): string {
  if (accent === "add") return "bg-[var(--fnk-color-gain-soft)] shadow-[inset_2px_0_0_var(--fnk-color-gain)]";
  if (accent === "del") return "bg-[var(--fnk-color-loss-soft)] shadow-[inset_2px_0_0_var(--fnk-color-loss)]";
  return "";
}

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-interactive";

export default function ChangesClient() {
  const { dashboard, dataReady, failedSources } = useDashboardData();
  const [revisionDoc, setRevisionDoc] = useState<unknown>(null);
  const [tradesDoc, setTradesDoc] = useState<unknown>(null);
  const [byTickerDoc, setByTickerDoc] = useState<unknown>(null);
  const [feedsLoaded, setFeedsLoaded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [segment, setSegment] = useState<DiffSegment>("visit");
  const watchlist = useWatchlist();
  const [mineOnly, setMineOnly] = useState(true);
  const [snapshot] = useState<VisitSnapshot | null>(() => (
    typeof window === "undefined" ? null : readSnapshot()
  ));
  const [snapshotSaved, setSnapshotSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFeedsLoaded(false);
    Promise.all([
      fetchJson<unknown>("/data/global-scouter/core/revision_movers.json"),
      fetchJson<unknown>("/data/sec-13f/analytics/trades_ranking.json"),
      fetchJson<unknown>("/data/sec-13f/by_ticker.json"),
    ]).then(([revision, trades, byTicker]) => {
      if (cancelled) return;
      setRevisionDoc(revision);
      setTradesDoc(trades);
      setByTickerDoc(byTicker);
      setFeedsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  const retryFeeds = () => setRetryKey((key) => key + 1);

  const dashboardSettled = dataReady || failedSources.length > 0;
  const dashboardFailed = failedSources.length > 0;
  const settled = feedsLoaded && dashboardSettled;

  const regime = useMemo(() => {
    const breadthTotal = Math.max(dashboard.sectorRows.length, 1);
    const breadthRatio = dashboard.sectorUp / breadthTotal;
    const score = clamp(
      (dashboard.fearGreedScore / 100) * 0.45 + breadthRatio * 0.35 + (1 - dashboard.stressScore) * 0.2,
      0,
      1,
    );
    return {
      label: getRegimeLabel(score),
      confidence: Math.round(score * 100),
    };
  }, [dashboard]);

  const revAsOf = useMemo(() => revisionAsOf(revisionDoc), [revisionDoc]);
  const quarter = useMemo(() => tradesQuarter(tradesDoc), [tradesDoc]);
  const nextDiffLabel = useMemo(() => nextRevisionRefreshLabel(Date.now()), []);

  // Persist this visit as next visit's baseline once everything settles.
  // Failed dashboard fallbacks are never snapshotted as truth: without a real
  // load the Edge/regime fields stay null instead of freezing a fallback.
  useEffect(() => {
    if (!settled || snapshotSaved) return;
    setSnapshotSaved(true);
    writeSnapshot({
      at: new Date().toISOString(),
      edgeScore: dataReady ? regime.confidence : null,
      regime: dataReady ? regime.label : null,
      revisionAsOf: revAsOf,
      quarter,
    });
  }, [settled, snapshotSaved, dataReady, regime.confidence, regime.label, revAsOf, quarter]);

  const rows = useMemo(() => {
    if (!settled) return [];
    const revRows = revisionRows(revisionDoc);
    const holdRows = holderRows(tradesDoc, byTickerDoc);
    const out: DiffRow[] = [];
    // Snapshot comparisons need a real dashboard load: fallback values are
    // never rendered as the current side of a visit diff.
    const liveDashboard = dataReady && !dashboardFailed;
    if (segment === "visit") {
      if (snapshot && snapshot.edgeScore !== null && liveDashboard) {
        const delta = regime.confidence - snapshot.edgeScore;
        if (delta !== 0) {
          out.push({
            id: "snapshot:edge",
            ticker: null,
            title: "단기 Edge 점수",
            kind: "시장 체력",
            before: String(snapshot.edgeScore),
            after: String(regime.confidence),
            delta: formatSigned(delta, 0, ""),
            tone: delta > 0 ? "up" : "down",
            accent: "none",
            href: ROUTES.regime,
            rank: Math.abs(delta) >= 3 ? 1 : 6,
          });
        }
      }
      if (snapshot?.regime && liveDashboard && snapshot.regime !== regime.label) {
        out.push({
          id: "snapshot:regime",
          ticker: null,
          title: "시장 판독",
          kind: "국면",
          before: snapshot.regime,
          after: regime.label,
          delta: "변경",
          tone: "neutral",
          accent: "none",
          href: ROUTES.regime,
          rank: 0,
        });
      }
      const snapDay = snapshot?.at.slice(0, 10) ?? null;
      const snapQuarter = snapshot?.quarter ?? null;
      for (const row of revRows) {
        const rowDay = row.id.split(":").at(-1) ?? "";
        if (!snapshot || !snapDay || rowDay > snapDay) out.push(row);
      }
      if (!snapshot || !snapQuarter || quarter !== snapQuarter) out.push(...holdRows);
    } else if (segment === "week") {
      out.push(...revRows);
    } else {
      out.push(...revRows, ...holdRows);
    }
    // 내 종목 기준: with a non-empty watchlist and 내 종목 on, rows scope to
    // watched tickers; visit-baseline rows (no ticker) always stay.
    const scoped = mineOnly && watchlist.length > 0
      ? out.filter((row) => row.ticker === null || watchlist.includes(row.ticker.toUpperCase()))
      : out;
    return scoped.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  }, [settled, segment, revisionDoc, tradesDoc, byTickerDoc, snapshot, dataReady, dashboardFailed, mineOnly, watchlist, regime.confidence, regime.label, quarter]);

  const upCount = rows.filter((row) => row.tone === "up").length;
  const downCount = rows.filter((row) => row.tone === "down").length;
  const flatCount = rows.length - upCount - downCount;
  const first = rows[0] ?? null;

  const revMissing = feedsLoaded && revisionDoc === null;
  const holdersMissing = feedsLoaded && (tradesDoc === null || byTickerDoc === null);
  const anyFeedMissing = revMissing || holdersMissing;
  const allMissing = revMissing && holdersMissing;
  const revOverdue = useMemo(() => {
    if (!isRecord(revisionDoc)) return false;
    const stamp = asString(revisionDoc.generated_at);
    const ms = stamp ? Date.parse(stamp) : NaN;
    if (!Number.isFinite(ms)) return revAsOf !== null && revAsOf < new Date(lastRevisionRefreshMs(Date.now())).toISOString().slice(0, 10);
    return ms < lastRevisionRefreshMs(Date.now());
  }, [revisionDoc, revAsOf]);

  const mainFreshness: EvidenceRailFreshness = !settled
    ? "pending"
    : allMissing
      ? "error"
      : dashboardFailed || anyFeedMissing
        ? "partial"
        : revOverdue
          ? "stale"
          : "fresh";
  const mainAsOf = `리비전 ${revAsOf ?? "미확인"} · 13F ${quarter ?? "미확인"}${
    segment === "visit" ? ` · 스냅샷 ${snapshot ? snapshot.at.slice(0, 10) : "첫 방문"}` : ""
  }`;

  const snapshotNotice = segment === "visit" && !snapshot
    ? "첫 방문 — 이번 값을 기준으로 저장했습니다. 다음 방문부터 방문 사이 변화가 표시됩니다."
    : null;

  // Evidence drawer stages: only feeds that actually loaded (수집). Failed
  // feeds are omitted rather than forged.
  const feedStages: EvidenceStage[] = useMemo(() => {
    const stages: EvidenceStage[] = [];
    if (isRecord(revisionDoc)) {
      const at = isoDay(revisionDoc.generated_at);
      stages.push({ stage: "수집", detail: "컨센서스 리비전 무버", at, tone: at ? "ok" : "muted" });
    }
    if (isRecord(tradesDoc) && isRecord(byTickerDoc)) {
      const meta = isRecord(tradesDoc.metadata) ? tradesDoc.metadata : null;
      const at = meta ? isoDay(meta.generated_at) : null;
      stages.push({ stage: "수집", detail: `13F 분기 집계${quarter ? ` ${quarter}` : ""}`, at, tone: at ? "ok" : "muted" });
    }
    return stages;
  }, [revisionDoc, tradesDoc, byTickerDoc, quarter]);

  // One empty action: lift the watchlist scope first, otherwise widen to the
  // revision segment, otherwise re-read the feeds.
  const emptyScopeActive = mineOnly && watchlist.length > 0;
  const handleEmptyAction = () => {
    if (emptyScopeActive) setMineOnly(false);
    else if (segment !== "revision") setSegment("revision");
    else retryFeeds();
  };
  const emptyActionLabel = emptyScopeActive
    ? "관심 종목 필터 해제"
    : segment !== "revision"
      ? "리비전 단위로 보기"
      : "다시 읽기";

  // Honest scope label: 내 종목 only with a non-empty watchlist, otherwise the
  // global fallback says so.
  const scopeNotice = emptyScopeActive
    ? `내 종목 ${watchlist.length}개 기준`
    : !mineOnly
      ? "전체 변화 보기 중"
      : "관심 종목이 없어 전체 변화를 보여줍니다";

  return (
    <div className="flex flex-col gap-4" data-changes-surface="true">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[20px] font-semibold text-slate-900">무엇이 바뀌었나</h1>
          <span className="text-[13px] text-slate-500">
            {segment === "visit"
              ? snapshot
                ? `마지막 방문 ${snapshot.at.slice(0, 10)} 이후`
                : "이번 방문 기준 저장 중"
              : segment === "week"
                ? "최근 1주 컨센서스 변화"
                : "최근 리비전 배치 + 13F 분기 집계"}
            {` · ${scopeNotice}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 rounded-md bg-slate-100 p-0.5" role="group" aria-label="관심 범위">
            {([
              { key: true, label: "내 종목" },
              { key: false, label: "전체" },
            ] as const).map((item) => (
              <button
                key={item.label}
                type="button"
                aria-pressed={mineOnly === item.key}
                onClick={() => setMineOnly(item.key)}
                className={`inline-flex h-[26px] items-center rounded-md px-2.5 text-[12px] font-medium transition ${FOCUS_RING} ${
                  mineOnly === item.key ? "bg-slate-900 text-white" : "text-slate-600"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        <div className="flex gap-0.5 rounded-md bg-slate-100 p-0.5" role="tablist" aria-label="비교 범위">
          {SEGMENTS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={segment === item.key}
              onClick={() => setSegment(item.key)}
              className={`inline-flex h-[26px] items-center rounded-md px-2.5 text-[12px] font-medium transition ${
                segment === item.key ? "bg-slate-900 text-white" : "text-slate-600"
              }`}
            >
              {item.label}
            </button>
          ))}
          </div>
        </div>
      </div>

      <Panel
        loading={!settled}
        empty={settled && rows.length === 0}
        emptyReason={
          snapshotNotice ?? (revMissing && holdersMissing
            ? "비교할 피드를 읽지 못했습니다"
            : "이 범위에 표시할 변화가 없습니다")
        }
        emptyNextRefresh="다음 수집 시"
        emptyActionLabel={settled && rows.length === 0 ? emptyActionLabel : undefined}
        onEmptyAction={settled && rows.length === 0 ? handleEmptyAction : undefined}
        stale={settled && revOverdue && rows.length > 0}
        asOf={revAsOf ?? undefined}
        error={settled && allMissing}
        errorDetail="리비전·13F 피드를 읽지 못했습니다."
        onRetry={settled ? retryFeeds : undefined}
        retryLabel="다시 읽기"
        keepContentOnStale
      >
        <PanelHeader
          eyebrow="Diff Review"
          title="전 → 후, 한 줄에 한 변화"
          right={<span className="text-[12px] text-slate-500">초록 = 상향·신규 · 빨강 = 하향·이탈 · 굵게 = 지금 값</span>}
        />
        <div
          className="hidden grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_100px] items-center gap-2 border-b border-slate-200 px-4 text-[11px] font-semibold text-slate-500 md:grid md:h-8"
          aria-hidden="true"
        >
          <span>항목</span><span>이전</span><span>지금</span><span className="text-right">변화</span>
        </div>
        {rows.map((row) => {
          const body = (
            <>
              <span className="min-w-0">
                <span className="block truncate font-mono text-[12px] text-slate-900">{row.ticker ?? row.title}</span>
                <span className="block truncate text-[12px] text-slate-500">
                  {row.ticker ? `${row.title.slice(row.ticker.length + 3) || row.kind} · ${row.kind}` : row.kind}
                </span>
              </span>
              <span className="truncate text-right tabular-nums text-[12px] text-slate-400 line-through md:text-left">
                {row.before}
              </span>
              <span className="min-w-0 truncate text-[13px] font-semibold tabular-nums text-slate-900">
                {row.after}
                {row.afterNote ? <span className="ml-2 font-medium text-slate-500">{row.afterNote}</span> : null}
              </span>
              <span className={`shrink-0 text-right text-[13px] font-semibold tabular-nums ${toneClass(row.tone)}`}>
                {row.delta}
              </span>
            </>
          );
          const className = `grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-slate-100 px-4 py-2 text-[13px] transition-colors duration-150 first:border-t-0 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_100px] md:gap-2 ${FOCUS_RING} ${accentClass(row.accent)}`;
          return row.href ? (
            <TransitionLink key={row.id} href={row.href} className={`${className} hover:bg-slate-50`}>
              {body}
            </TransitionLink>
          ) : (
            <div key={row.id} tabIndex={0} className={className}>{body}</div>
          );
        })}
        <EvidenceRail
          freshness={mainFreshness}
          source="컨센서스 리비전 · 13F · Fenok Edge"
          asOf={mainAsOf}
          coverage={`행 ${rows.length}건`}
          next={nextDiffLabel}
          onRetry={settled ? retryFeeds : undefined}
          lkgAsOf={snapshot?.revisionAsOf ?? undefined}
          stages={feedStages}
          skeletonDelayMs={120}
        />
      </Panel>

      <div className="grid gap-4 md:grid-cols-3">
        <Panel
          loading={!settled}
          empty={settled && rows.length === 0}
          emptyReason="집계할 변화가 없습니다"
          emptyNextRefresh="다음 수집 시"
          emptyActionLabel={settled && rows.length === 0 ? emptyActionLabel : undefined}
          onEmptyAction={settled && rows.length === 0 ? handleEmptyAction : undefined}
          stale={settled && revOverdue && rows.length > 0}
          asOf={mainAsOf}
          error={settled && allMissing}
          errorDetail="리비전·13F 피드를 읽지 못했습니다."
          onRetry={settled ? retryFeeds : undefined}
          retryLabel="다시 읽기"
          keepContentOnStale
        >
          <div className="flex flex-col gap-1 px-4 py-3.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">변화 {rows.length}건</span>
            <span className="text-[13px] text-slate-700">
              상향·신규 {upCount} · 하향·이탈 {downCount} · 중립 {flatCount}
            </span>
          </div>
          <EvidenceRail
            freshness={mainFreshness}
            source="리비전 무버 · 13F 집계"
            asOf={mainAsOf}
            coverage={`행 ${rows.length}건`}
            onRetry={settled ? retryFeeds : undefined}
            lkgAsOf={snapshot?.revisionAsOf ?? undefined}
            stages={feedStages}
            skeletonDelayMs={120}
          />
        </Panel>
        <Panel
          loading={!settled}
          empty={settled && !first}
          emptyReason="먼저 볼 항목이 없습니다"
          emptyNextRefresh="다음 수집 시"
          emptyActionLabel={settled && !first ? emptyActionLabel : undefined}
          onEmptyAction={settled && !first ? handleEmptyAction : undefined}
          stale={settled && revOverdue && rows.length > 0}
          asOf={mainAsOf}
          error={settled && allMissing}
          errorDetail="리비전·13F 피드를 읽지 못했습니다."
          onRetry={settled ? retryFeeds : undefined}
          retryLabel="다시 읽기"
          keepContentOnStale
        >
          <div className="flex flex-col gap-1 px-4 py-3.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">먼저 볼 것</span>
            <span className="truncate text-[13px] text-slate-700">
              {first ? `${first.title} ${first.kind} — ${first.after} (${first.delta})` : "—"}
            </span>
          </div>
          <EvidenceRail
            freshness={mainFreshness}
            source={first ? `${first.kind} · ${first.title}` : "변화 행"}
            asOf={mainAsOf}
            coverage={first ? `변화 ${first.delta}` : "행 없음"}
            onRetry={settled ? retryFeeds : undefined}
            lkgAsOf={snapshot?.revisionAsOf ?? undefined}
            stages={feedStages}
            skeletonDelayMs={120}
          />
        </Panel>
        <Panel loading={!settled}>
          <div className="flex flex-col gap-1 px-4 py-3.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">다음 diff</span>
            <span className="text-[13px] text-slate-700">{nextDiffLabel}</span>
          </div>
          <EvidenceRail
            freshness="fixed"
            source="리비전 발행 주기"
            asOf={revAsOf ?? "미확인"}
            coverage="주 1회 배치"
            next={nextDiffLabel}
            skeletonDelayMs={120}
          />
        </Panel>
      </div>

      <div className="flex items-center gap-2 text-[12px] text-slate-500">
        <span>ETF 순유입 행은 홈·스크리너·종목 표면에 피드가 없어 제외했습니다. 값이 생기면 이 페이지에 추가됩니다.</span>
        <TransitionLink href={ROUTES.screener} className="font-semibold text-brand-interactive hover:underline">
          스크리너로 이동
        </TransitionLink>
      </div>
    </div>
  );
}
