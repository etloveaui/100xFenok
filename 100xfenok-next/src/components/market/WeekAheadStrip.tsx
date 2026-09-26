"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { useKstToday } from "@/hooks/useKstToday";
import { dateOnly, daysUntilKstDate, isStaleAsOf } from "@/lib/data-state";
import {
  MACRO_CALENDAR_STALE_AFTER_DAYS,
  MACRO_CALENDAR_URL,
  formatKstDayHeading,
  isHeadlineMacro,
  macroEventsBetween,
  parseMacroCalendar,
  type MacroCalendar,
  type MacroEvent,
} from "@/lib/market-events/macro-calendar";
import { ROUTES } from "@/lib/routes";

const HORIZON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

let calendarCache: MacroCalendar | null = null;
let calendarPending: Promise<MacroCalendar | null> | null = null;

/** The strip needs names and times only, so it skips the previous-print file. */
function loadCalendar(): Promise<MacroCalendar | null> {
  if (calendarCache) return Promise.resolve(calendarCache);
  if (calendarPending) return calendarPending;
  calendarPending = fetch(MACRO_CALENDAR_URL)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
    .then((doc) => {
      if (doc === null) {
        calendarPending = null;
        return null;
      }
      calendarCache = parseMacroCalendar(doc, null);
      return calendarCache;
    });
  return calendarPending;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

function dayLabel(iso: string, today: string): string {
  const diff = daysUntilKstDate(iso, today);
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  return formatKstDayHeading(iso);
}

/**
 * Home "이번 주 일정": the week's market-moving US releases and Fed events,
 * one chip per KST day, the whole strip linking to the full calendar on
 * /market/events. It holds one line of height from the first paint, so the
 * cards below never move when the calendar lands.
 */
export default function WeekAheadStrip() {
  const [state, setState] = useState<{ loaded: boolean; calendar: MacroCalendar | null }>({ loaded: false, calendar: null });
  const today = useKstToday();

  useEffect(() => {
    let cancelled = false;
    loadCalendar().then((calendar) => {
      if (!cancelled) setState({ loaded: true, calendar });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const horizonEnd = addDaysIso(today, HORIZON_DAYS);
  // The mirror is refreshed outside CI; past its time_max the file simply has
  // no rows, which must not read as a quiet week.
  const coverageEnd = state.calendar?.coverageEnd ?? null;
  const uncoveredFrom = coverageEnd !== null && coverageEnd < horizonEnd ? coverageEnd : null;
  // A mirror without a usable range.time_max does not say how far it reaches.
  const coverageUnknown = state.calendar !== null && coverageEnd === null;

  const groups = useMemo(() => {
    if (!state.calendar) return [];
    const byDay = new Map<string, MacroEvent[]>();
    for (const event of macroEventsBetween(state.calendar.events, today, horizonEnd).filter(isHeadlineMacro)) {
      const list = byDay.get(event.dateKst) ?? [];
      list.push(event);
      byDay.set(event.dateKst, list);
    }
    return [...byDay.entries()];
  }, [state.calendar, today, horizonEnd]);

  const summary = groups.length
    ? groups.map(([day, events]) => `${dayLabel(day, today)} ${events.map((event) => event.titleKo).join(", ")}`).join(" · ")
    : null;
  const coverageNote = uncoveredFrom
    ? uncoveredFrom <= today
      ? "캘린더 수록 기간이 지났습니다"
      : `${formatKstDayHeading(uncoveredFrom)}부터 미수록`
    : coverageUnknown
      ? "수록 범위 미확인"
      : null;
  // A month-old mirror may list releases that have since moved, or miss new
  // ones, so the strip says how old it is, as the full calendar's rail does.
  // One without a readable generated_at is of unknown age and says so.
  const generatedDay = dateOnly(state.calendar?.generatedAt ?? null);
  const staleNote = state.calendar === null
    ? null
    : generatedDay === null
      ? "캘린더 기준일 미확인"
      : isStaleAsOf(generatedDay, MACRO_CALENDAR_STALE_AFTER_DAYS, today)
        ? `${formatKstDayHeading(generatedDay)} 기준 · 갱신 지연`
        : null;
  // What the strip says in place of chips; the link's accessible name carries
  // it too, since an aria-label replaces the visible text for screen readers.
  const status = !state.loaded
    ? "일정 확인 중"
    : !state.calendar
      ? "캘린더를 읽지 못했습니다"
      : groups.length > 0
        ? null
        : uncoveredFrom && uncoveredFrom <= today
          ? "캘린더 수록 기간이 지나 일정을 확인할 수 없습니다"
          : uncoveredFrom
            ? `${formatKstDayHeading(uncoveredFrom)} 전까지 주요 미국 지표·연준 일정이 없습니다`
            : coverageUnknown
              ? "캘린더 수록 범위를 확인할 수 없습니다"
              : "7일 안에 주요 미국 지표·연준 일정이 없습니다";

  return (
    <TransitionLink
      href={ROUTES.marketEvents}
      data-home-week-ahead
      aria-label={[summary ? `이번 주 주요 일정: ${summary}` : `이번 주 일정: ${status}`, summary ? coverageNote : null, staleNote, "경제 일정 전체 보기"].filter(Boolean).join(". ")}
      className="group flex min-h-11 items-center gap-2 overflow-x-auto whitespace-nowrap rounded-[8px] text-[12px] [scrollbar-width:none] md:min-h-8 [&::-webkit-scrollbar]:hidden"
    >
      <span className="shrink-0 font-semibold text-[var(--c-ink-2)]">이번 주 일정</span>
      {status !== null ? (
        <span className="shrink-0 text-[var(--c-ink-4)]">{status}</span>
      ) : (
        groups.map(([day, events]) => (
          <span
            key={day}
            title={events.map((event) => `${event.titleKo}${event.timeKst ? ` ${event.timeKst} KST` : ""}`).join(" · ")}
            className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[6px] border border-[var(--c-line)] bg-[var(--c-panel)] px-2"
          >
            <span className="tabular-nums text-[var(--c-ink-3)]">{dayLabel(day, today)}</span>
            <span className="font-semibold text-[var(--c-ink)]">{events.map((event) => event.shortLabel).join(" · ")}</span>
          </span>
        ))
      )}
      {groups.length > 0 && coverageNote ? <span className="shrink-0 text-[var(--c-ink-4)]">{coverageNote}</span> : null}
      {staleNote ? <span className="shrink-0 font-semibold text-[var(--c-warn-ink)]">{staleNote}</span> : null}
      <span className="ml-auto shrink-0 pl-1 font-semibold text-[var(--c-brand)] group-hover:underline">전체 일정 →</span>
    </TransitionLink>
  );
}
