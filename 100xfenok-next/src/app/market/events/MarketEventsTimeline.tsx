"use client";

import { useMemo } from "react";
import TransitionLink from "@/components/TransitionLink";
import { ROUTES } from "@/lib/routes";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import type { EvidenceRailFreshness } from "@/components/ui/EvidenceRail";
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
  buildChip: (row: TimelineRow) => string;
  buildTitle: (row: TimelineRow) => string;
  buildSymbol: (row: TimelineRow) => string;
  buildHref: (row: TimelineRow, symbol: string) => string | undefined;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 28;
const WEEK_DAYS = 7;
const LANE_CAP = 20;
const LABEL_COL_PX = 140;

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
  return /^(\d{4}-\d{2}-\d{2})/.exec(raw)?.[1] ?? null;
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

function mondayOfCurrentWeek(today: Date): Date {
  const monday = new Date(today.getTime());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function shortMd(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

function rowsOf(doc: TimelineDoc | null | undefined): TimelineRow[] {
  const records = Array.isArray(doc?.records) ? doc.records : [];
  const tableRows = Array.isArray(doc?.tables)
    ? doc.tables.flatMap((table) => (Array.isArray(table?.records) ? table.records : []))
    : [];
  return [...records, ...tableRows];
}

const LANES: TimelineLaneDef[] = [
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
    id: "actions",
    label: "기업 이벤트",
    sourceLabel: "stockanalysis · actions_recent",
    dark: false,
    dateKeys: ["date"],
    emptyReason: "앞으로 4주 기업 이벤트가 없습니다.",
    buildSymbol: (row) => rowSymbol(row),
    buildTitle: (row) => `${rowSymbol(row)} · ${text(row.name)}`,
    buildChip: (row) => text(row.type),
    buildHref: (_row, symbol) => (symbol && symbol !== "-" ? stockHref(symbol) : undefined),
  },
  {
    id: "splits",
    label: "분할·병합",
    sourceLabel: "stockanalysis · actions_splits",
    dark: false,
    dateKeys: ["date"],
    emptyReason: "앞으로 4주 분할·병합 일정이 없습니다.",
    buildSymbol: (row) => rowSymbol(row),
    buildTitle: (row) => `${rowSymbol(row)} · ${text(row.company_name)}`,
    buildChip: (row) => text(row.split_ratio),
    buildHref: (_row, symbol) => (symbol && symbol !== "-" ? stockHref(symbol) : undefined),
  },
  {
    id: "ipos",
    label: "예정 IPO",
    sourceLabel: "stockanalysis · ipos_calendar",
    dark: false,
    dateKeys: ["ipo_date"],
    emptyReason: "앞으로 4주 예정 IPO가 없습니다.",
    buildSymbol: (row) => rowSymbol(row),
    buildTitle: (row) => `${rowSymbol(row)} · ${text(row.company_name)}`,
    buildChip: (row) => text(row.exchange),
    buildHref: () => undefined,
  },
];

function laneEvents(lane: TimelineLaneDef, doc: TimelineDoc | null | undefined, startIso: string, endIso: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  rowsOf(doc).forEach((row, index) => {
    let date: string | null = null;
    for (const key of lane.dateKeys) {
      date = isoDay(typeof row[key] === "string" ? (row[key] as string) : null);
      if (date) break;
    }
    if (!date || date < startIso || date >= endIso) return;
    const symbol = lane.buildSymbol(row);
    const chip = lane.buildChip(row);
    events.push({
      key: `${lane.id}-${symbol || "row"}-${date}-${index}`,
      date,
      symbol,
      title: lane.buildTitle(row),
      chip: chip === "-" ? "" : chip,
      href: lane.buildHref(row, symbol),
    });
  });
  return events
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol))
    .slice(0, LANE_CAP);
}

function laneFreshness(doc: TimelineDoc | null | undefined, loaded: boolean): EvidenceRailFreshness {
  if (!loaded) return "pending";
  if (!doc || doc.load_failed) return "error";
  if (isEventCollectionStale(doc)) return "stale";
  return "fresh";
}

function laneAsOf(doc: TimelineDoc | null | undefined): string {
  const source = isoDay(doc?.source_as_of);
  if (source) return `기준 ${source}`;
  const collected = isoDay(doc?.fetched_at);
  if (collected) return `수집 ${collected}`;
  return "원천 기준일 미제공";
}

export default function MarketEventsTimeline({ loaded, earnings, actions, splits, ipoCalendar }: MarketEventsTimelineProps) {
  const windowDef = useMemo(() => {
    const today = localToday();
    const monday = mondayOfCurrentWeek(today);
    const startIso = toIsoDay(monday);
    const endIso = toIsoDay(new Date(monday.getTime() + WINDOW_DAYS * DAY_MS));
    const weeks = Array.from({ length: WINDOW_DAYS / WEEK_DAYS }, (_, week) => {
      const weekStart = new Date(monday.getTime() + week * WEEK_DAYS * DAY_MS);
      const weekEnd = new Date(weekStart.getTime() + (WEEK_DAYS - 1) * DAY_MS);
      return `${shortMd(toIsoDay(weekStart))} ~ ${shortMd(toIsoDay(weekEnd))}`;
    });
    const todayIso = toIsoDay(today);
    const todayFraction = Math.min(
      0.985,
      Math.max(0, (today.getTime() - monday.getTime()) / (WINDOW_DAYS * DAY_MS)),
    );
    return { startIso, endIso, weeks, todayIso, todayFraction };
  }, []);

  const docs: Record<string, TimelineDoc | null> = { earnings, actions, splits, ipoCalendar };

  const laneViews = useMemo(
    () =>
      LANES.map((lane) => {
        const doc = docs[lane.id];
        const events = loaded ? laneEvents(lane, doc, windowDef.startIso, windowDef.endIso) : [];
        const slotsByDate = new Map<string, number>();
        const placed = events.map((event) => {
          const slot = slotsByDate.get(event.date) ?? 0;
          slotsByDate.set(event.date, slot + 1);
          return { event, slot };
        });
        const maxSlots = Math.max(1, ...[...slotsByDate.values()]);
        const failed = Boolean(doc?.load_failed);
        return { lane, doc, events, placed, maxSlots, failed };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, earnings, actions, splits, ipoCalendar, windowDef],
  );

  const totalInWindow = laneViews.reduce((sum, view) => sum + view.events.length, 0);
  const anyFailed = laneViews.some((view) => view.failed);

  if (!loaded) {
    return (
      <section className="panel" data-market-events-timeline="true" aria-label="이벤트 타임라인">
        <Panel loading>
          <span aria-hidden="true" />
        </Panel>
      </section>
    );
  }

  if (!earnings && !actions && !splits && !ipoCalendar) {
    return (
      <section className="panel" data-market-events-timeline="true" aria-label="이벤트 타임라인">
        <Panel error errorDetail="이벤트 표면을 읽지 못했습니다.">
          <PanelHeader eyebrow="Timeline Gantt" title="앞으로 4주" />
          <EmptyState reason="이벤트 타임라인을 표시할 수 없습니다" nextRefresh="다음 수집 시 자동 복구됩니다" />
        </Panel>
      </section>
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
            {laneViews.map(({ lane, doc, events, placed, maxSlots, failed }) => (
              <div key={lane.id} className="border-t border-slate-100" data-timeline-lane={lane.id}>
                <div className="grid items-stretch" style={{ gridTemplateColumns: `${LABEL_COL_PX}px minmax(0, 1fr)` }}>
                  <div className="flex flex-col justify-center gap-0.5 border-r border-slate-100 px-4 py-2">
                    <span className="text-[12px] font-semibold text-slate-700">{lane.label}</span>
                    <span className="num text-[11px] text-slate-500">{events.length}건</span>
                  </div>
                  <div className="relative" style={{ minHeight: Math.max(46, maxSlots * 30 + 16) }}>
                    {events.length ? (
                      placed.map(({ event, slot }) => {
                        const leftPct = Math.min(
                          82,
                          ((Date.parse(`${event.date}T00:00:00`) - Date.parse(`${windowDef.startIso}T00:00:00`)) / (WINDOW_DAYS * DAY_MS)) * 100,
                        );
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
                            className="absolute transition hover:opacity-80"
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
                        <EmptyState
                          reason={failed ? `${lane.label} 표면을 불러오지 못했습니다` : lane.emptyReason}
                          nextRefresh="다음 수집 시"
                        />
                      </div>
                    )}
                  </div>
                </div>
                <EvidenceRail
                  freshness={laneFreshness(doc, loaded)}
                  source={lane.sourceLabel}
                  asOf={laneAsOf(doc)}
                  coverage={failed ? "수집 실패 · 0건" : `앞으로 4주 ${events.length}건`}
                  next={
                    failed
                      ? "다음 수집 시 자동 복구"
                      : events.length
                        ? `다음 ${shortMd(events[0].date)} ${events[0].symbol || events[0].title}`
                        : undefined
                  }
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
