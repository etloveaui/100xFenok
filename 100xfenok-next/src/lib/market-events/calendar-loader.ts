import {
  MACRO_CALENDAR_URL,
  MACRO_PREV_VALUES_URL,
  parseMacroCalendar,
  type MacroCalendar,
} from "./macro-calendar";

let calendarCache: MacroCalendar | null = null;
let pending: Promise<MacroCalendar | null> | null = null;

function fetchOptionalJson(url: string): Promise<unknown> {
  return fetch(url)
    .then((response) => response.ok ? response.json() : null)
    .catch(() => null);
}

export type CalendarLoadOptions = { withPreviousValues?: boolean; force?: boolean };

/** Calendar loading extracted from the event board for behavioral verification. */
export function loadMacroCalendar(_options: CalendarLoadOptions = {}): Promise<MacroCalendar | null> {
  if (calendarCache) return Promise.resolve(calendarCache);
  if (pending) return pending;
  pending = Promise.all([fetchOptionalJson(MACRO_CALENDAR_URL), fetchOptionalJson(MACRO_PREV_VALUES_URL)])
    .then(([calendar, prevValues]) => {
      if (calendar === null) {
        pending = null;
        return null;
      }
      calendarCache = parseMacroCalendar(calendar, prevValues);
      return calendarCache;
    });
  return pending;
}
