import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  TimeScale,
  TimeSeriesScale,
  Tooltip,
  _adapters,
} from "chart.js";

let registered = false;

const DATE_FORMATS = {
  datetime: "datetime",
  millisecond: "datetime",
  second: "datetime",
  minute: "datetime",
  hour: "datetime",
  day: "day",
  week: "day",
  month: "month",
  quarter: "month",
  year: "year",
} as const;

type NativeTimeUnit = Exclude<keyof typeof DATE_FORMATS, "datetime">;

function nativeDate(value: number) {
  return new Date(value);
}

function dateParts(value: number) {
  const date = nativeDate(value);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
}

function addUtc(timestamp: number, amount: number, unit: NativeTimeUnit) {
  const date = nativeDate(timestamp);
  if (unit === "year") date.setUTCFullYear(date.getUTCFullYear() + amount);
  else if (unit === "quarter") date.setUTCMonth(date.getUTCMonth() + amount * 3);
  else if (unit === "month") date.setUTCMonth(date.getUTCMonth() + amount);
  else if (unit === "week") date.setUTCDate(date.getUTCDate() + amount * 7);
  else if (unit === "day") date.setUTCDate(date.getUTCDate() + amount);
  else if (unit === "hour") date.setUTCHours(date.getUTCHours() + amount);
  else if (unit === "minute") date.setUTCMinutes(date.getUTCMinutes() + amount);
  else if (unit === "second") date.setUTCSeconds(date.getUTCSeconds() + amount);
  else date.setUTCMilliseconds(date.getUTCMilliseconds() + amount);
  return date.getTime();
}

function startOfUtc(timestamp: number, unit: NativeTimeUnit | "isoWeek", weekday?: number | boolean) {
  const date = nativeDate(timestamp);
  if (unit === "year") date.setUTCMonth(0, 1);
  if (unit === "quarter") date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3, 1);
  if (unit === "month") date.setUTCDate(1);
  if (unit === "week" || unit === "isoWeek") {
    const target = typeof weekday === "number" ? weekday : 1;
    const current = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - current + target);
  }
  if (["year", "quarter", "month", "week", "isoWeek", "day"].includes(unit)) date.setUTCHours(0, 0, 0, 0);
  else if (unit === "hour") date.setUTCMinutes(0, 0, 0);
  else if (unit === "minute") date.setUTCSeconds(0, 0);
  else if (unit === "second") date.setUTCMilliseconds(0);
  return date.getTime();
}

_adapters._date.override({
  formats: () => DATE_FORMATS,
  parse(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  },
  format(timestamp, format) {
    const { year, month, day } = dateParts(timestamp);
    if (format === "year") return String(year);
    if (format === "month") return `${year}-${String(month + 1).padStart(2, "0")}`;
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  },
  add: addUtc,
  diff(a, b, unit) {
    const months = (nativeDate(a).getUTCFullYear() - nativeDate(b).getUTCFullYear()) * 12
      + nativeDate(a).getUTCMonth() - nativeDate(b).getUTCMonth();
    if (unit === "year") return months / 12;
    if (unit === "quarter") return months / 3;
    if (unit === "month") return months;
    const divisor = unit === "week" ? 604_800_000
      : unit === "day" ? 86_400_000
        : unit === "hour" ? 3_600_000
          : unit === "minute" ? 60_000
            : unit === "second" ? 1_000
              : 1;
    return (a - b) / divisor;
  },
  startOf: startOfUtc,
  endOf(timestamp, unit) {
    return addUtc(startOfUtc(timestamp, unit), 1, unit) - 1;
  },
});

export function ensureMarketChartJsRegistered(): void {
  if (registered) return;

  ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    TimeScale,
    TimeSeriesScale,
    LineElement,
    BarElement,
    Filler,
    Tooltip,
    Legend,
  );

  registered = true;
}
