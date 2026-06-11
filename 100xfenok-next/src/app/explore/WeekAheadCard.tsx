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

function ddayInfo(dateStr: string, today: string): { big: string; small: string; cls: string } {
  if (dateStr === today) return { big: "오늘", small: shortDate(dateStr), cls: "today" };
  const diff =
    (new Date(dateStr + "T00:00:00+09:00").getTime() -
      new Date(today + "T00:00:00+09:00").getTime()) /
    86400000;
  if (diff === 1) return { big: "내일", small: shortDate(dateStr), cls: "soon" };
  if (diff <= 3) return { big: `D-${diff}`, small: shortDate(dateStr), cls: "soon" };
  return { big: `D-${diff}`, small: shortDate(dateStr), cls: "" };
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
            (e.importance === "H" || e.importance === "M"),
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
    <div className="c-card">
      <div className="card-title">
        <h2>이번 주 미국 일정</h2>
        <span className="sub">KST 기준</span>
      </div>
      {events.map((e, i) => {
        const isH = e.importance === "H";
        const dd = ddayInfo(e.date_kst, today);
        return (
          <div key={`${e.date_kst}-${e.time_kst}-${i}`} className="cal-row">
            <span className={`dday ${dd.cls}`}>
              {dd.big}
              <small>{dd.small}</small>
            </span>
            <span className="ev">
              {e.title_ko}
              <small>{e.category_label}</small>
            </span>
            {isH ? (
              <span className="imp-high">중요</span>
            ) : (
              <span className="imp-mid">보통</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
