"use client";

import { useEffect, useState } from "react";

interface CalendarEvent {
  date_kst: string;
  time_kst: string;
  importance: "H" | "M" | "L";
  category_label: string;
  title_ko: string;
}

interface CalendarDoc {
  events?: CalendarEvent[];
}

let cache: CalendarDoc | null = null;
let pending: Promise<CalendarDoc | null> | null = null;
function loadCalendar(): Promise<CalendarDoc | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch("/data/calendar/usd-calendar.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      cache = d;
      return d;
    })
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}

function todayKST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
}

function dday(dateStr: string, today: string): string {
  if (dateStr === today) return "오늘";
  const diff =
    (new Date(dateStr + "T00:00:00+09:00").getTime() -
      new Date(today + "T00:00:00+09:00").getTime()) /
    86400000;
  if (diff === 1) return "내일";
  return `D-${diff}`;
}

function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

export default function WeekAheadCard() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadCalendar().then((doc) => {
      if (cancelled || !doc?.events) return;
      const today = todayKST();
      const filtered = doc.events
        .filter(
          (e) =>
            e.date_kst >= today &&
            (e.importance === "H" || e.importance === "M")
        )
        .slice(0, 6);
      setEvents(filtered);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (events.length === 0) return null;

  const today = todayKST();

  return (
    <div className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-black tracking-tight text-slate-900">
          이번 주 미국 일정
        </h2>
        <span className="text-[10px] font-semibold text-slate-400">
          KST 기준
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {events.map((e, i) => {
          const isH = e.importance === "H";
          return (
            <div
              key={`${e.date_kst}-${e.time_kst}-${i}`}
              className="flex items-center gap-2"
            >
              <span
                className={`inline-flex min-w-[3rem] shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-black ${
                  isH
                    ? "bg-rose-50 text-rose-600"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {dday(e.date_kst, today)}
              </span>
              <span className="text-[10px] font-bold text-slate-400 tabular-nums">
                {shortDate(e.date_kst)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-700">
                {isH && (
                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />
                )}
                {e.title_ko}
              </span>
              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                {e.category_label}
              </span>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-black ${
                  isH
                    ? "bg-rose-100 text-rose-600"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {isH ? "중요" : "보통"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
