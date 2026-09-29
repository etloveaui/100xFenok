import { fetchJsonOrNull } from "../client/data-fetch";
import {
  MACRO_CALENDAR_URL,
  MACRO_PREV_VALUES_URL,
  parseMacroCalendar,
  type MacroCalendar,
} from "./macro-calendar";

export type CalendarLoadOptions = { withPreviousValues?: boolean; force?: boolean };

/** Share raw responses for five minutes; never retain a parsed calendar forever. */
export async function loadMacroCalendar({
  withPreviousValues = true,
  force = false,
}: CalendarLoadOptions = {}): Promise<MacroCalendar | null> {
  const options = { force, init: { cache: force ? "no-cache" as const : "default" as const } };
  const [calendar, prevValues] = await Promise.all([
    fetchJsonOrNull<unknown>(MACRO_CALENDAR_URL, options),
    withPreviousValues ? fetchJsonOrNull<unknown>(MACRO_PREV_VALUES_URL, options) : null,
  ]);
  // A missing previous-print file must not hide the calendar itself.
  return calendar === null ? null : parseMacroCalendar(calendar, prevValues);
}
