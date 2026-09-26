"use client";

import { useMemo } from "react";
import { EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import type { EvidenceRailFreshness } from "@/components/ui/EvidenceRail";
import { dateOnly, daysUntilKstDate, isStaleAsOf, todayKST } from "@/lib/data-state";
import {
  MACRO_CALENDAR_STALE_AFTER_DAYS,
  formatKstDayHeading,
  formatPrintDate,
  macroEventsBetween,
  type MacroCalendar,
  type MacroEvent,
} from "@/lib/market-events/macro-calendar";

const HORIZON_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

interface MacroCalendarPanelProps {
  loaded: boolean;
  failed: boolean;
  calendar: MacroCalendar | null;
  onRetry?: () => void;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

function dayTag(iso: string, today: string): string | null {
  const diff = daysUntilKstDate(iso, today);
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  return null;
}

function EventRow({ event }: { event: MacroEvent }) {
  const high = event.importance === "H";
  const printDate = formatPrintDate(event.previous?.asOf ?? null);
  return (
    <div
      className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-baseline gap-x-3 border-t border-[var(--c-line)] px-4 py-2 text-[13px] first:border-t-0 md:grid-cols-[56px_minmax(0,1fr)_minmax(0,180px)]"
      data-macro-event={event.id}
      title={[event.titleEn, event.source].filter(Boolean).join(" · ") || undefined}
    >
      <span className="tabular-nums text-[12px] text-[var(--c-ink-3)]">{event.timeKst ?? "—"}</span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={`min-w-0 ${high ? "font-semibold text-[var(--c-ink)]" : "text-[var(--c-ink-2)]"}`}>{event.titleKo}</span>
        {high ? (
          <span className="rounded-[4px] bg-[var(--c-warn-soft)] px-1.5 text-[12px] font-semibold leading-[18px] text-[var(--c-warn-ink)]">중요</span>
        ) : null}
        {event.categoryLabel ? <span className="text-[12px] text-[var(--c-ink-4)] max-md:hidden">{event.categoryLabel}</span> : null}
      </span>
      <span className="justify-self-end whitespace-nowrap text-right text-[12px] tabular-nums text-[var(--c-ink-3)]">
        {event.previous ? (
          <>
            <span className="max-md:hidden">직전 </span>
            <b className="font-semibold text-[var(--c-ink-2)]">{event.previous.value}</b>
            {printDate ? <span className="ml-1 text-[var(--c-ink-4)]">{printDate}</span> : null}
          </>
        ) : (
          <span className="text-[var(--c-ink-4)]">—</span>
        )}
      </span>
    </div>
  );
}

export default function MacroCalendarPanel({ loaded, failed, calendar, onRetry }: MacroCalendarPanelProps) {
  const today = useMemo(() => todayKST(), []);
  const horizonEnd = addDaysIso(today, HORIZON_DAYS);
  const events = useMemo(
    () => (calendar ? macroEventsBetween(calendar.events, today, horizonEnd).filter((event) => event.importance !== "L") : []),
    [calendar, today, horizonEnd],
  );
  const groups = useMemo(() => {
    const byDay = new Map<string, MacroEvent[]>();
    for (const event of events) {
      const list = byDay.get(event.dateKst) ?? [];
      list.push(event);
      byDay.set(event.dateKst, list);
    }
    return [...byDay.entries()];
  }, [events]);

  const highCount = events.filter((event) => event.importance === "H").length;
  const generatedDay = dateOnly(calendar?.generatedAt ?? null);
  const stale = generatedDay !== null && isStaleAsOf(generatedDay, MACRO_CALENDAR_STALE_AFTER_DAYS, today);
  const outOfRange = calendar?.coversThrough != null && calendar.coversThrough < horizonEnd;
  const freshness: EvidenceRailFreshness = !loaded
    ? "pending"
    : failed || !calendar
      ? "error"
      : stale || outOfRange
        ? "stale"
        : "fresh";
  const next = events[0];

  return (
    <section data-macro-calendar="true" aria-label="미국 경제 일정">
      <Panel
        loading={!loaded}
        error={loaded && (failed || !calendar)}
        errorDetail="경제 일정 캘린더를 읽지 못했습니다."
        onRetry={onRetry}
        retryLabel="다시 읽기"
        empty={loaded && !failed && calendar !== null && events.length === 0}
        emptyReason={outOfRange ? `캘린더는 ${calendar?.coversThrough}까지만 수록돼 있습니다` : "앞으로 2주 미국 경제 일정이 없습니다"}
        emptyNextRefresh="캘린더 갱신 시"
      >
        <PanelHeader
          eyebrow="Economic Calendar"
          title="미국 경제 일정 · 앞으로 2주"
          right={
            <>
              {highCount > 0 ? <Pill tone="warn">중요 {highCount}</Pill> : null}
              <Pill>{events.length}건</Pill>
            </>
          }
        />
        <div
          className="hidden grid-cols-[56px_minmax(0,1fr)_minmax(0,180px)] gap-x-3 border-b border-[var(--c-line)] px-4 text-[12px] font-semibold text-[var(--c-ink-3)] md:grid md:h-8 md:items-center"
          aria-hidden="true"
        >
          <span>시간 KST</span>
          <span>지표</span>
          <span className="text-right">직전 발표값</span>
        </div>
        <div>
          {groups.map(([day, dayEvents]) => {
            const tag = dayTag(day, today);
            return (
              <div key={day} data-macro-day={day}>
                <div className="flex items-baseline gap-2 border-t border-[var(--c-line)] bg-[var(--c-surface-2)] px-4 py-1.5 text-[12px] font-semibold text-[var(--c-ink-2)] first:border-t-0">
                  <span className="tabular-nums">{formatKstDayHeading(day)}</span>
                  {tag ? <span className="text-[var(--c-brand)]">{tag}</span> : null}
                  <span className="font-normal text-[var(--c-ink-4)]">{dayEvents.length}건</span>
                </div>
                {dayEvents.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </div>
            );
          })}
        </div>
        <EvidenceRail
          freshness={freshness}
          source="BujaBot USD 캘린더 · 직전값 FRED·활동 서베이"
          asOf={generatedDay ? `${generatedDay} (일정)` : "—"}
          asOfKind="published"
          coverage={`앞으로 2주 ${events.length}건 · 중요도 높음·보통`}
          next={next ? `${formatKstDayHeading(next.dateKst)} ${next.timeKst ?? ""} ${next.titleKo}`.replace(/\s+/g, " ").trim() : undefined}
          onRetry={failed || stale ? onRetry : undefined}
          skeletonDelayMs={120}
        />
      </Panel>
    </section>
  );
}
