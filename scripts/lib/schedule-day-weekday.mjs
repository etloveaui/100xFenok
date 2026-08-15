// POSIX cron defaults to OR when both day-of-month and day-of-week are
// restricted. A schedule may explicitly opt into intersection semantics when
// its owner contract means a bounded weekday inside a day-of-month range.
export function matchesDayWeekday({
  dayMatch,
  weekdayMatch,
  dayWildcard,
  weekdayWildcard,
  dayWeekdayMode = "or",
  isHoliday = false,
}) {
  if (isHoliday) return false;
  if (dayWildcard && weekdayWildcard) return true;
  if (dayWildcard) return weekdayMatch;
  if (weekdayWildcard) return dayMatch;
  return dayWeekdayMode === "and" ? dayMatch && weekdayMatch : dayMatch || weekdayMatch;
}
