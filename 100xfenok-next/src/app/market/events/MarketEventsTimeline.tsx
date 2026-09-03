"use client";

import { useMemo } from "react";
import TransitionLink from "@/components/TransitionLink";
import { ROUTES } from "@/lib/routes";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import type { EvidenceRailFreshness } from "@/components/ui/EvidenceRail";
import type { EvidenceStage } from "@/lib/evidence/provenance";
import { isEventCollectionStale } from "@/lib/market-events/freshness";

type TimelineRow = Record<string, unknown>;

type TimelineDoc = {
  surface?: string;
  fetched_at?: string | null;
  source_as_of?: string | null;
  records?: TimelineRow[];
  tables?: Array<{ records?: TimelineRow[] }>;
  load_failed?: boolean;
};

interface MarketEventsTimelineProps {
  loaded: boolean;
  earnings: TimelineDoc | null;
  actions: TimelineDoc | null;
  splits: TimelineDoc | null;
  ipoCalendar: TimelineDoc | null;
  onRetry?: () => void;
}

type TimelineEvent = {
  key: string;
  date: string;
  symbol: string;
  title: string;
  chip: string;
  href?: string;
};

type TimelineLaneDef = {
  id: string;
  label: string;
  sourceLabel: string;
  dark: boolean;
  dateKeys: string[];
  emptyReason: string;
  /** no backing feed: shared absent-feed EmptyState, never fabricated rows */
  noFeed?: boolean;
  /** row predicate for lanes sharing a backing doc (e.g. dividend filter on actions) */
  matches?: (row: TimelineRow) => boolean;
  buildChip?: (row: TimelineRow) => string;
  buildTitle?: (row: TimelineRow) => string;
  buildSymbol?: (row: TimelineRow) => string;
  buildHref?: (row: TimelineRow, symbol: string) => string | undefined;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 28;
const WEEK_DAYS = 7;
const LANE_CAP = 20;
const LABEL_COL_PX = 140;

const NO_FEED_REASON = "no new feeds — 연결된 피드가 없습니다";
const NO_FEED_SOURCE = "연결된 피드 없음";
const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-interactive";

function text(value: unknown, fallback = "-"): string {
  if (value === null || value === undefined) return fallback;
  const next = String(value).trim();
  return next && next !== "-" ? next : fallback;
}

function rowSymbol(row: TimelineRow): string {
  return text(row.symbol).replace(/^\$/, "").toUpperCase();
}

function stockHref(symbol: string): string {
  return ROUTES.stock(symbol.replace(/^\$/, "").toUpperCase());
}

function isoDay(value: string | null | undefined): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw)?.[1] ?? null;
  if (iso) return iso;
  // Committed surfaces also use the "Sep 8, 2026" form (actions/IPO tables):
  // parse with the repo-standard Date.parse, then back to a UTC ISO day.
  const epoch = Date.parse(raw);
  if (!Number.isFinite(epoch)) return null;
  const date = new Date(epoch);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function localToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toIsoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function shortMd(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

function scrollToDrilldown(): void {
  if (typeof document === "undefined") return;
  document.querySelector('[data-market-events-drilldown="true"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function rowsOf(doc: TimelineDoc | null | undefined): TimelineRow[] {
  const records = Array.isArray(doc?.records) ? doc.records : [];
  const tableRows = Array.isArray(doc?.tables)
    ? doc.tables.flatMap((table) => (Array.isArray(table?.records) ? table.records : []))
    : [];
  return [...records, ...tableRows];
}

function isDividendRow(row: TimelineRow): boolean {
  return /dividend|배당/i.test(String(row.type ?? ""));
}

const LANES: TimelineLaneDef[] = [
  {
    id: "macro-us",
    label: "거시·미국",
    sourceLabel: NO_FEED_SOURCE,
    dark: false,
    dateKeys: [],
    emptyReason: NO_FEED_REASON,
    noFeed: true,
  },
  {
    id: "macro-kr",
    label: "거시·한국",
    sourceLabel: NO_FEED_SOURCE,
    dark: false,
    dateKeys: [],
    emptyReason: NO_FEED_REASON,
    noFeed: true,
  },
  {
    id: "earnings",
    label: "실적",
    sourceLabel: "stockanalysis · earnings_calendar",
    dark: true,
    dateKeys: ["date"],
    emptyReason: "앞으로 4주 실적 일정이 없습니다.",
    buildSymbol: (row) => rowSymbol(row),
    buildTitle: (row) => `${rowSymbol(row)} · ${text(row.name)}`,
    buildChip: (row) => text(row.timing).toUpperCase(),
    buildHref: (_row, symbol) => (symbol && symbol !== "-" ? stockHref(symbol) : undefined),
  },
  {
    id: "dividend",
    label: "배당",
    sourceLabel: NO_FEED_SOURCE,
    dark: false,
    dateKeys: [],
    emptyReason: NO_FEED_REASON,
    noFeed: true,
    matches: isDividendRow,
    buildSymbol: (row) => rowSymbol(row),
    buildTitle: (row) => `${rowSymbol(row)} · ${text(row.name)}`,
    buildChip: (row) => text(row.type),
    buildHref: (_row, symbol) => (symbol && symbol !== "-" ? stockHref(symbol) : undefined),
  },
  {
    id: "data-refresh",
    label: "데이터갱신",
    sourceLabel: NO_FEED_SOURCE,
    dark: false,
    dateKeys: [],
    emptyReason: NO_FEED_REASON,
    noFeed: true,
  },
  {
    id: "options-expiry",
    label: "옵션만기",
    sourceLabel: NO_FEED_SOURCE,
    dark: false,
    dateKeys: [],
    emptyReason: NO_FEED_REASON,
    noFeed: true,
  },
];

function laneEvents(lane: TimelineLaneDef, doc: TimelineDoc | null | undefined, startIso: string, endIso: string): TimelineEvent[] {
  if (lane.noFeed) return [];
  const events: TimelineEvent[] = [];
  rowsOf(doc).forEach((row, index) => {
    if (lane.matches && !lane.matches(row)) return;
    let date: string | null = null;
    for (const key of lane.dateKeys) {
      date = isoDay(typeof row[key] === "string" ? (row[key] as string) : null);
      if (date) break;
    }
    if (!date || date < startIso || date >= endIso) return;
    const symbol = lane.buildSymbol?.(row) ?? "-";
    const chip = lane.buildChip?.(row) ?? "-";
    events.push({
      key: `${lane.id}-${symbol || "row"}-${date}-${index}`,
      date,
      symbol,
      title: lane.buildTitle?.(row) ?? symbol,
      chip: chip === "-" ? "" : chip,
      href: lane.buildHref?.(row, symbol),
    });
  });
  return events
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol))
    .slice(0, LANE_CAP);
}

function laneFreshness(doc: TimelineDoc | null | undefined, loaded: boolean, noFeed?: boolean): EvidenceRailFreshness {
  if (!loaded) return "pending";
  if (noFeed) return "stale";
  if (!doc || doc.load_failed) return "error";
  if (isEventCollectionStale(doc)) return "stale";
  return "fresh";
}

/**
 * Bare date for EvidenceRail asOf: the rail itself renders the "기준" prefix,
 * so callers must not add one (no "기준 기준" doubling).
 */
function laneAsOf(doc: TimelineDoc | null | undefined): string {
  const source = isoDay(doc?.source_as_of);
  if (source) return source;
  const collected = isoDay(doc?.fetched_at);
  if (collected) return `${collected} (수집)`;
  return "원천 기준일 미제공";
}

/**
 * Per-lane evidence drawer stages: 수집 + 다음 only. 검증·발행·제공 have no
 * per-lane evidence on this surface, so they are omitted rather than forged.
 */
function laneStages(lane: TimelineLaneDef, doc: TimelineDoc | null | undefined, events: TimelineEvent[]): EvidenceStage[] {
  if (lane.noFeed || !doc || doc.load_failed) return [];
  const sourceDay = isoDay(doc.source_as_of);
  const collectedDay = isoDay(doc.fetched_at);
  const at = sourceDay ?? collectedDay;
  const stages: EvidenceStage[] = [
    {
      stage: sourceDay ? "원천" : "수집",
      detail: lane.sourceLabel,
      at,
      tone: at ? "ok" : "muted",
    },
  ];
  const next = events[0];
  if (next) {
    stages.push({
      stage: "다음",
      detail: next.title,
      at: next.date,
      tone: "muted",
    });
  }
  return stages;
}

export default function MarketEventsTimeline({ loaded, earnings, actions, splits, ipoCalendar, onRetry }: MarketEventsTimelineProps) {
  const windowDef = useMemo(() => {
    const today = localToday();
    const startIso = toIsoDay(today);
    const endIso = toIsoDay(new Date(today.getTime() + WINDOW_DAYS * DAY_MS));
    const weeks = Array.from({ length: WINDOW_DAYS / WEEK_DAYS }, (_, week) => {
      const weekStart = new Date(today.getTime() + week * WEEK_DAYS * DAY_MS);
      const weekEnd = new Date(weekStart.getTime() + (WEEK_DAYS - 1) * DAY_MS);
      return `${shortMd(toIsoDay(weekStart))} ~ ${shortMd(toIsoDay(weekEnd))}`;
    });
    const todayIso = toIsoDay(today);
    return { startIso, endIso, weeks, todayIso, todayFraction: 0 };
  }, []);

  const docs: Record<string, TimelineDoc | null> = { earnings, dividend: actions, ipoCalendar };

  const laneViews = useMemo(
    () =>
      LANES.map((lane) => {
        const doc = docs[lane.id] ?? null;
        const events = loaded ? laneEvents(lane, doc, windowDef.startIso, windowDef.endIso) : [];
        const slotsByDate = new Map<string, number>();
        const placed = events.map((event) => {
          const slot = slotsByDate.get(event.date) ?? 0;
          slotsByDate.set(event.date, slot + 1);
          return { event, slot };
        });
        const maxSlots = Math.max(1, ...[...slotsByDate.values()]);
        const failed = Boolean(doc?.load_failed) && !lane.noFeed;
        const freshness = laneFreshness(doc, loaded, lane.noFeed);
        return { lane, doc, events, placed, maxSlots, failed, freshness };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, earnings, actions, ipoCalendar, windowDef],
  );

  const totalInWindow = laneViews.reduce((sum, view) => sum + view.events.length, 0);
  const anyFailed = laneViews.some((view) => view.failed);

  if (!loaded) {
    return (
      <div data-market-events-timeline="true" aria-label="이벤트 타임라인">
        <Panel loading>
          <span aria-hidden="true" />
        </Panel>
      </div>
    );
  }

  if (!earnings && !actions && !splits && !ipoCalendar) {
    return (
      <div data-market-events-timeline="true" aria-label="이벤트 타임라인">
        <Panel error errorDetail="이벤트 표면을 읽지 못했습니다." onRetry={onRetry} retryLabel="다시 읽기">
          <PanelHeader eyebrow="Timeline Gantt" title="앞으로 4주" />
          <EmptyState reason="이벤트 타임라인을 표시할 수 없습니다" nextRefresh="다음 수집 시 자동 복구됩니다" />
        </Panel>
      </div>
    );
  }

  return (
    <section className="panel" data-market-events-timeline="true" aria-label="이벤트 타임라인">
      <PanelHeader
        eyebrow="Timeline Gantt"
        title="앞으로 4주"
        right={
          <>
            <Pill>오늘 {shortMd(windowDef.todayIso)}</Pill>
            <Pill tone={anyFailed ? "warn" : "neutral"}>{totalInWindow.toLocaleString("ko-KR")}건</Pill>
          </>
        }
      />
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="relative">
            <div
              className="grid items-center border-b border-slate-200 text-[11px] font-semibold text-slate-500"
              style={{ gridTemplateColumns: `${LABEL_COL_PX}px repeat(4, minmax(0, 1fr))`, height: 32 }}
            >
              <span className="pl-4">레인</span>
              {windowDef.weeks.map((week) => (
                <span key={week} className="num truncate pr-2">{week}</span>
              ))}
            </div>
            {laneViews.map(({ lane, doc, events, placed, maxSlots, failed, freshness }) => (
              <div key={lane.id} className="border-t border-slate-100" data-timeline-lane={lane.id}>
                <div className="grid items-stretch" style={{ gridTemplateColumns: `${LABEL_COL_PX}px minmax(0, 1fr)` }}>
                  <div className="flex flex-col justify-center gap-0.5 border-r border-slate-100 px-4 py-2">
                    <span className="text-[12px] font-semibold text-slate-700">{lane.label}</span>
                    <span className="num text-[11px] text-slate-500">{lane.noFeed ? "피드 없음" : `${events.length}건`}</span>
                  </div>
                  <div className="relative" style={{ minHeight: Math.max(46, maxSlots * 30 + 16) }}>
                    {events.length ? (
                      placed.map(({ event, slot }) => {
                        const leftPct =
                          ((Date.parse(`${event.date}T00:00:00`) - Date.parse(`${windowDef.startIso}T00:00:00`)) / (WINDOW_DAYS * DAY_MS)) * 100;
                        const chip = (
                          <span
                            title={`${event.title} · ${event.date}`}
                            className={`inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] font-semibold ${
                              lane.dark
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-700"
                            }`}
                          >
                            <span className="num">{shortMd(event.date)}</span>
                            {event.symbol && event.symbol !== "-" ? (
                              <span className="font-mono">{event.symbol}</span>
                            ) : null}
                            {event.chip ? <span className="truncate">{event.chip}</span> : null}
                          </span>
                        );
                        return event.href ? (
                          <TransitionLink
                            key={event.key}
                            href={event.href}
                            className={`absolute transition hover:opacity-80 ${FOCUS_RING}`}
                            style={{ left: `${leftPct}%`, top: 8 + slot * 30 }}
                          >
                            {chip}
                          </TransitionLink>
                        ) : (
                          <span key={event.key} className="absolute" style={{ left: `${leftPct}%`, top: 8 + slot * 30 }}>
                            {chip}
                          </span>
                        );
                      })
                    ) : (
                      <div className="px-4 py-2">
                        {failed ? (
                          <EmptyState
                            reason={`${lane.label} 표면을 불러오지 못했습니다`}
                            nextRefresh="다음 수집 시 자동 복구됩니다"
                            actionLabel="다시 시도"
                            onAction={onRetry}
                          />
                        ) : lane.noFeed ? (
                          <EmptyState
                            reason={lane.emptyReason}
                            nextRefresh="피드 연결 시"
                            actionLabel="전체 검색으로 이동"
                            onAction={scrollToDrilldown}
                          />
                        ) : (
                          <EmptyState
                            reason={lane.emptyReason}
                            nextRefresh="다음 수집 시"
                            actionLabel="전체 검색으로 이동"
                            onAction={scrollToDrilldown}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <EvidenceRail
                  freshness={freshness}
                  source={lane.sourceLabel}
                  asOf={lane.noFeed ? "원천 기준일 미제공" : laneAsOf(doc)}
                  coverage={lane.noFeed ? "연결된 피드 없음" : failed ? "수집 실패 · 0건" : `앞으로 4주 ${events.length}건`}
                  next={
                    failed
                      ? "다음 수집 시 자동 복구"
                      : events.length
                        ? `다음 ${shortMd(events[0].date)} ${events[0].symbol || events[0].title}`
                        : undefined
                  }
                  onRetry={!lane.noFeed && (failed || freshness === "stale") ? onRetry : undefined}
                  stages={laneStages(lane, doc, events)}
                  skeletonDelayMs={120}
                />
              </div>
            ))}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-brand-interactive"
              style={{ left: `calc(${LABEL_COL_PX}px + (100% - ${LABEL_COL_PX}px) * ${windowDef.todayFraction})` }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1 text-[10px] font-semibold text-brand-interactive"
              style={{ left: `calc(${LABEL_COL_PX}px + (100% - ${LABEL_COL_PX}px) * ${windowDef.todayFraction} + 4px)` }}
            >
              오늘
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
        <span>
          <span aria-hidden="true" className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-slate-900" />
          검정 = 실적
        </span>
        <span>위치는 해당 날짜 기준 · 파랑선 = 오늘</span>
      </div>
    </section>
  );
}
