"use client";

import { useMemo } from "react";
import TransitionLink from "@/components/TransitionLink";
import { ROUTES } from "@/lib/routes";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import type { EvidenceRailFreshness } from "@/components/ui/EvidenceRail";
import type { EvidenceStage } from "@/lib/evidence/provenance";
import { isEventCollectionStale } from "@/lib/market-events/freshness";
import { useKstToday } from "@/hooks/useKstToday";
import { dateOnly, isStaleAsOf } from "@/lib/data-state";
import {
  MACRO_CALENDAR_STALE_AFTER_DAYS,
  isHeadlineMacro,
  isOptionsExpiry,
  type MacroCalendar,
  type MacroEvent,
} from "@/lib/market-events/macro-calendar";

type TimelineRow = Record<string, unknown>;

type TimelineDoc = {
  surface?: string;
  fetched_at?: string | null;
  source_as_of?: string | null;
  records?: TimelineRow[];
  tables?: Array<{ records?: TimelineRow[] }>;
  /** earnings_calendar: per-day report counts for the weeks it lists, symbols only for the collected day */
  metadata?: { days?: Array<{ date?: unknown; count?: unknown }> } | null;
  load_failed?: boolean;
};

interface MarketEventsTimelineProps {
  loaded: boolean;
  earnings: TimelineDoc | null;
  actions: TimelineDoc | null;
  splits: TimelineDoc | null;
  ipoCalendar: TimelineDoc | null;
  macroLoaded: boolean;
  macroCalendar: MacroCalendar | null;
  onRetry?: () => void;
}

type TimelineEvent = {
  key: string;
  date: string;
  symbol: string;
  title: string;
  chip: string;
  href?: string;
  /** Reports this chip stands for: 1 for a symbol, the day's count for a count chip. */
  weight?: number;
};

type TimelineLaneDef = {
  id: string;
  label: string;
  sourceLabel: string;
  dark: boolean;
  dateKeys: string[];
  emptyReason: string;
  /** no backing feed: listed once under the timeline, never drawn as an empty lane */
  noFeed?: boolean;
  /** lane fed by the US macro calendar instead of a stockanalysis surface */
  macro?: (event: MacroEvent) => boolean;
  /** add one count chip per listed day that has no symbol rows (earnings_calendar metadata.days) */
  dayCounts?: boolean;
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
/** Symbol chips shown for one day of a day-count lane; the rest of that day folds into a "+N건" chip. */
const DAY_SYMBOL_CAP = 3;
const LABEL_COL_PX = 140;

const NO_FEED_REASON = "연결된 피드가 없습니다";
const NO_FEED_SOURCE = "연결된 피드 없음";
const MACRO_SOURCE = "BujaBot USD 캘린더";
/** Narrowest track the 860px timeline leaves beside its 140px label column. */
const MIN_TRACK_PX = 720;
const CHIP_GAP_PX = 6;
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

/** Calendar-day arithmetic on YYYY-MM-DD, independent of the browser's time zone. */
function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
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
    sourceLabel: MACRO_SOURCE,
    dark: false,
    dateKeys: [],
    emptyReason: "앞으로 4주 주요 지표·연준 일정이 없습니다.",
    macro: isHeadlineMacro,
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
    dayCounts: true,
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
    sourceLabel: MACRO_SOURCE,
    dark: false,
    dateKeys: [],
    emptyReason: "앞으로 4주 옵션 만기가 없습니다.",
    macro: isOptionsExpiry,
  },
];

function macroLaneEvents(lane: TimelineLaneDef, macroEvents: readonly MacroEvent[] | null, startIso: string, endIso: string): TimelineEvent[] {
  if (!lane.macro || !macroEvents) return [];
  return macroEvents
    .filter((event) => lane.macro!(event) && event.dateKst >= startIso && event.dateKst < endIso)
    .map((event) => ({
      // A recurring calendar entry keeps one id across occurrences (CPI on
      // 10/14 and 11/10), so the occurrence's date and time make the key.
      key: `${lane.id}-${event.id}-${event.dateKst}-${event.timeKst ?? ""}`,
      date: event.dateKst,
      symbol: "-",
      title: `${event.titleKo}${event.timeKst ? ` · ${event.timeKst} KST` : ""}`,
      chip: event.shortLabel,
    }))
    .slice(0, LANE_CAP);
}

function laneEvents(lane: TimelineLaneDef, doc: TimelineDoc | null | undefined, startIso: string, endIso: string): TimelineEvent[] {
  if (lane.noFeed || lane.macro) return [];
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
  if (lane.dayCounts) {
    // The feed lists symbols for the collected day only, but it carries the
    // report count of every day it covers; those days get one count chip.
    // The lane cap applies to neither: a collected day of 17 reports would
    // otherwise crowd out the later days, and the lane total with them.
    const symbolDays = new Set(events.map((event) => event.date));
    const shown: TimelineEvent[] = [];
    for (const date of [...symbolDays].sort()) {
      const dayEvents = events.filter((event) => event.date === date).sort((a, b) => a.symbol.localeCompare(b.symbol));
      shown.push(...dayEvents.slice(0, DAY_SYMBOL_CAP));
      const rest = dayEvents.length - DAY_SYMBOL_CAP;
      if (rest > 0) {
        shown.push({
          key: `${lane.id}-more-${date}`,
          date,
          symbol: "-",
          title: `${date} 실적 발표 ${dayEvents.length.toLocaleString("ko-KR")}건 중 ${rest.toLocaleString("ko-KR")}건 더 · 전체 목록은 아래 표`,
          chip: `+${rest.toLocaleString("ko-KR")}건`,
          weight: rest,
        });
      }
    }
    for (const day of Array.isArray(doc?.metadata?.days) ? doc.metadata.days : []) {
      const date = isoDay(typeof day?.date === "string" ? day.date : null);
      const count = typeof day?.count === "number" && Number.isFinite(day.count) ? day.count : 0;
      if (!date || count <= 0 || symbolDays.has(date) || date < startIso || date >= endIso) continue;
      shown.push({
        key: `${lane.id}-count-${date}`,
        date,
        symbol: "-",
        title: `${date} 실적 발표 ${count.toLocaleString("ko-KR")}건 · 종목 목록은 수집일만 제공`,
        chip: `${count.toLocaleString("ko-KR")}건`,
        weight: count,
      });
    }
    // By date only: the sort is stable, so a day's "+N건" chip stays after its symbols.
    return shown.sort((a, b) => a.date.localeCompare(b.date));
  }
  return events
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol))
    .slice(0, LANE_CAP);
}

function eventWeight(events: TimelineEvent[]): number {
  return events.reduce((sum, event) => sum + (event.weight ?? 1), 0);
}

/** Chip width from its text: Hangul runs ~12px, Latin/digits ~7.2px at 12px semibold, plus padding and gaps. */
function estimateChipPx(event: TimelineEvent): number {
  const parts = [shortMd(event.date), event.symbol !== "-" ? event.symbol : "", event.chip].filter(Boolean);
  const textPx = parts.join("").split("").reduce((sum, ch) => sum + (/[\u3131-\ud79d]/.test(ch) ? 12 : 7.2), 0);
  return Math.ceil(textPx + (parts.length - 1) * 6 + 18);
}

/**
 * Stack chips so none overlaps: each goes on the first row whose last chip
 * ends before it starts. Measured against the narrowest track, so a wider
 * screen only adds room. Same-day chips, which used to be the only case that
 * stacked, still land on separate rows.
 */
function packChips(events: TimelineEvent[], startIso: string): Array<{ event: TimelineEvent; slot: number; leftPct: number; widthPx: number }> {
  const rowEnds: number[] = [];
  const startMs = Date.parse(`${startIso}T00:00:00Z`);
  return events.map((event) => {
    const leftPct = ((Date.parse(`${event.date}T00:00:00Z`) - startMs) / (WINDOW_DAYS * DAY_MS)) * 100;
    const widthPx = estimateChipPx(event);
    // A chip near the window end is pulled left until it fits (same clamp the
    // style applies against the real track width).
    const leftPx = Math.min((leftPct / 100) * MIN_TRACK_PX, MIN_TRACK_PX - widthPx);
    let slot = rowEnds.findIndex((end) => end + CHIP_GAP_PX <= leftPx);
    if (slot === -1) {
      slot = rowEnds.length;
      rowEnds.push(0);
    }
    rowEnds[slot] = leftPx + widthPx;
    return { event, slot, leftPct, widthPx };
  });
}

function macroLaneFreshness(macroLoaded: boolean, macroCalendar: MacroCalendar | null, coverageGap: string | null): EvidenceRailFreshness {
  if (!macroLoaded) return "pending";
  if (!macroCalendar) return "error";
  // A mirror that stops inside the window, or does not say where it stops,
  // leaves later days unknown however recently it was generated.
  if (coverageGap !== null) return "stale";
  return isStaleAsOf(dateOnly(macroCalendar.generatedAt), MACRO_CALENDAR_STALE_AFTER_DAYS) ? "stale" : "fresh";
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
function laneStages(lane: TimelineLaneDef, doc: TimelineDoc | null | undefined, events: TimelineEvent[], macroCalendar: MacroCalendar | null): EvidenceStage[] {
  if (lane.noFeed) return [];
  let stages: EvidenceStage[];
  if (lane.macro) {
    if (!macroCalendar) return [];
    const at = dateOnly(macroCalendar.generatedAt);
    stages = [{ stage: "원천", detail: macroCalendar.source ?? lane.sourceLabel, at, tone: at ? "ok" : "muted" }];
  } else {
    if (!doc || doc.load_failed) return [];
    const sourceDay = isoDay(doc.source_as_of);
    const collectedDay = isoDay(doc.fetched_at);
    const at = sourceDay ?? collectedDay;
    stages = [
      {
        stage: sourceDay ? "원천" : "수집",
        detail: lane.sourceLabel,
        at,
        tone: at ? "ok" : "muted",
      },
    ];
  }
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

export default function MarketEventsTimeline({ loaded, earnings, actions, splits, ipoCalendar, macroLoaded, macroCalendar, onRetry }: MarketEventsTimelineProps) {
  // The product's day is the KST day (the macro lanes and the calendar panel
  // above are dated in KST), whatever zone the browser is in.
  const today = useKstToday();
  const windowDef = useMemo(() => {
    const startIso = today;
    const endIso = addDaysIso(startIso, WINDOW_DAYS);
    const weeks = Array.from({ length: WINDOW_DAYS / WEEK_DAYS }, (_, week) => {
      const weekStart = addDaysIso(startIso, week * WEEK_DAYS);
      return `${shortMd(weekStart)} ~ ${shortMd(addDaysIso(weekStart, WEEK_DAYS - 1))}`;
    });
    return { startIso, endIso, weeks, todayIso: startIso, todayFraction: 0 };
  }, [today]);

  const laneViews = useMemo(() => {
    const docs: Record<string, TimelineDoc | null> = { earnings, dividend: actions, ipoCalendar };
    return LANES.filter((lane) => !lane.noFeed).map((lane) => {
      const doc = lane.macro ? null : docs[lane.id] ?? null;
      const events = lane.macro
        ? macroLaneEvents(lane, macroCalendar?.events ?? null, windowDef.startIso, windowDef.endIso)
        : loaded
          ? laneEvents(lane, doc, windowDef.startIso, windowDef.endIso)
          : [];
      const placed = packChips(events, windowDef.startIso);
      const maxSlots = Math.max(1, ...placed.map((item) => item.slot + 1));
      const failed = lane.macro ? macroLoaded && !macroCalendar : Boolean(doc?.load_failed);
      // Where the mirror's coverage leaves this window short; null when it
      // covers the whole window (or the lane does not read the mirror).
      const coverageEnd = lane.macro && macroCalendar ? macroCalendar.coverageEnd : undefined;
      const coverageGap = coverageEnd === undefined || (coverageEnd !== null && coverageEnd >= windowDef.endIso)
        ? null
        : coverageEnd === null
          ? "수록 범위 미확인"
          : coverageEnd <= windowDef.startIso
            ? "캘린더 수록 기간 지남"
            : `${shortMd(coverageEnd)}부터 미수록`;
      const freshness = lane.macro ? macroLaneFreshness(macroLoaded, macroCalendar, coverageGap) : laneFreshness(doc, loaded);
      const asOf = lane.macro
        ? (dateOnly(macroCalendar?.generatedAt ?? null) ? `${dateOnly(macroCalendar?.generatedAt ?? null)} (일정)` : "원천 기준일 미제공")
        : laneAsOf(doc);
      return { lane, doc, events, placed, maxSlots, failed, freshness, asOf, coverageGap };
    });
  }, [loaded, earnings, actions, ipoCalendar, macroLoaded, macroCalendar, windowDef]);

  const hiddenLanes = LANES.filter((lane) => lane.noFeed).map((lane) => lane.label);
  const totalInWindow = laneViews.reduce((sum, view) => sum + eventWeight(view.events), 0);
  const anyFailed = laneViews.some((view) => view.failed);

  if (!loaded && !macroLoaded) {
    return (
      <div data-market-events-timeline="true" aria-label="이벤트 타임라인">
        <Panel loading>
          <span aria-hidden="true" />
        </Panel>
      </div>
    );
  }

  if (loaded && !earnings && !actions && !splits && !ipoCalendar && macroLoaded && !macroCalendar) {
    return (
      <div data-market-events-timeline="true" aria-label="이벤트 타임라인">
        <Panel error errorDetail="이벤트 데이터를 읽지 못했습니다." onRetry={onRetry} retryLabel="다시 읽기">
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
              className="grid items-center border-b border-slate-200 text-[12px] font-semibold text-slate-500"
              style={{ gridTemplateColumns: `${LABEL_COL_PX}px repeat(4, minmax(0, 1fr))`, height: 32 }}
            >
              <span className="pl-4">구분</span>
              {windowDef.weeks.map((week) => (
                <span key={week} className="num truncate pr-2">{week}</span>
              ))}
            </div>
            {laneViews.map(({ lane, events, placed, maxSlots, failed, freshness, asOf, coverageGap }) => {
              const pendingLane = lane.macro ? !macroLoaded : !loaded;
              return (
                <div key={lane.id} className="border-t border-slate-100" data-timeline-lane={lane.id}>
                  <div className="grid items-stretch" style={{ gridTemplateColumns: `${LABEL_COL_PX}px minmax(0, 1fr)` }}>
                    <div className="flex flex-col justify-center gap-0.5 border-r border-slate-100 px-4 py-2">
                      <span className="text-[12px] font-semibold text-slate-700">{lane.label}</span>
                      <span className="num text-[12px] text-slate-500">{pendingLane ? "확인 중" : `${eventWeight(events).toLocaleString("ko-KR")}건`}</span>
                    </div>
                    <div className="relative" style={{ minHeight: Math.max(46, maxSlots * 30 + 16) }}>
                      {events.length ? (
                        placed.map(({ event, slot, leftPct, widthPx }) => {
                          const left = `min(${leftPct}%, calc(100% - ${widthPx}px))`;
                          const chip = (
                            <span
                              title={`${event.title} · ${event.date}`}
                              className={`inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[12px] font-semibold ${
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
                              style={{ left, top: 8 + slot * 30 }}
                            >
                              {chip}
                            </TransitionLink>
                          ) : (
                            <span key={event.key} className="absolute" style={{ left, top: 8 + slot * 30 }}>
                              {chip}
                            </span>
                          );
                        })
                      ) : pendingLane ? null : (
                        <div className="flex min-h-[46px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[12px] text-slate-500">
                          {failed ? (
                            <>
                              <span>{lane.label} 피드를 불러오지 못했습니다</span>
                              {onRetry ? (
                                <button type="button" onClick={onRetry} className={`font-semibold text-brand-interactive ${FOCUS_RING}`}>
                                  다시 시도
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <span>{lane.emptyReason}</span>
                              <button type="button" onClick={scrollToDrilldown} className={`font-semibold text-brand-interactive ${FOCUS_RING}`}>
                                전체 검색으로 이동
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <EvidenceRail
                    freshness={freshness}
                    source={lane.sourceLabel}
                    asOf={asOf}
                    coverage={failed
                      ? "수집 실패 · 0건"
                      : `앞으로 4주 ${eventWeight(events).toLocaleString("ko-KR")}건${coverageGap ? ` · ${coverageGap}` : ""}`}
                    next={
                      failed
                        ? "수집 시 자동 복구"
                        : events.length
                          ? `${shortMd(events[0].date)} ${events[0].symbol !== "-" ? events[0].symbol : events[0].chip}`
                          : undefined
                    }
                    onRetry={failed || freshness === "stale" ? onRetry : undefined}
                    stages={laneStages(lane, lane.macro ? null : earnings, events, macroCalendar)}
                    skeletonDelayMs={120}
                  />
                </div>
              );
            })}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-brand-interactive"
              style={{ left: `calc(${LABEL_COL_PX}px + (100% - ${LABEL_COL_PX}px) * ${windowDef.todayFraction})` }}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">
        <span>
          <span aria-hidden="true" className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-slate-900" />
          검정 = 실적
        </span>
        <span>위치는 해당 날짜 기준 · 파랑선 = 오늘</span>
        <span>거시·미국 = 중요 지표와 연준 일정</span>
        {hiddenLanes.length ? <span>{hiddenLanes.join("·")} 일정은 연결된 피드가 없어 표시하지 않습니다</span> : null}
      </div>
    </section>
  );
}
