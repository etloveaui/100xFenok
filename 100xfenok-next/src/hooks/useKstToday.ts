"use client";

import { useEffect, useState } from "react";
import { todayKST } from "@/lib/data-state";

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * Today's KST day (YYYY-MM-DD), moved on by a timer at each KST midnight so a
 * page left open overnight drops yesterday and rolls 오늘/내일 forward. The
 * timer re-arms after every firing, so a late or early wake-up only delays
 * the change, never stops it.
 */
export function useKstToday(): string {
  const [today, setToday] = useState(todayKST);
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      const sinceMidnight = (Date.now() + KST_OFFSET_MS) % DAY_MS;
      timer = window.setTimeout(() => {
        setToday(todayKST());
        schedule();
      }, DAY_MS - sinceMidnight + 1000);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);
  return today;
}
