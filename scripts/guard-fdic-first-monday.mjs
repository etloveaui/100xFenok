#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesDayWeekday } from "./lib/schedule-day-weekday.mjs";

const TIMEZONE = "America/New_York";
const CALENDAR_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "lib", "data-supply-detection-calendars.json");
const CALENDARS = JSON.parse(fs.readFileSync(CALENDAR_PATH, "utf8"));
const FDIC_CALENDAR = CALENDARS.calendars.find((row) => row.id === "us_federal_business");

function localParts(value, timeZone = TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "numeric",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    ...parts,
    iso: `${parts.year}-${parts.month}-${String(parts.day).padStart(2, "0")}`,
  };
}

export function isFirstMonday(value, timeZone = TIMEZONE) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error("invalid FDIC schedule guard clock");
  const parts = localParts(instant, timeZone);
  return parts.weekday === "Monday" && Number(parts.day) >= 1 && Number(parts.day) <= 7;
}

export function isFdicScheduleOccurrence(value) {
  const parts = localParts(value, TIMEZONE);
  return matchesDayWeekday({
    dayMatch: Number(parts.day) >= 1 && Number(parts.day) <= 7,
    weekdayMatch: parts.weekday === "Monday",
    dayWildcard: false,
    weekdayWildcard: false,
    dayWeekdayMode: "and",
    isHoliday: FDIC_CALENDAR.holidays.includes(parts.iso),
  });
}

export function scheduleEligible({ eventName, now = new Date() } = {}) {
  return eventName !== "schedule" || isFdicScheduleOccurrence(now);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const eventName = process.env.GITHUB_EVENT_NAME || "local";
  const now = process.env.FDIC_SCHEDULE_GUARD_NOW || new Date().toISOString();
  const eligible = scheduleEligible({ eventName, now });
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `eligible=${eligible}\n`);
  console.log(`FDIC schedule eligibility: ${eligible ? "eligible" : "non-first-Monday; skip producer"}`);
}
