/**
 * US macro release calendar for the market pages.
 *
 * Schedule: data/calendar/usd-calendar.json, the read-only mirror of the
 * BujaBot USD Google Calendar (US macro releases, FOMC, FOMC minutes, Jackson
 * Hole, monthly options expiration, 13F deadlines). Previous print:
 * data/calendar/prev-values.json (FRED and the activity-survey feed). Neither
 * carries a consensus or forecast, so nothing here shows one.
 */

export const MACRO_CALENDAR_URL = "/data/calendar/usd-calendar.json";
export const MACRO_PREV_VALUES_URL = "/data/calendar/prev-values.json";

/** The mirror is refreshed outside CI and covers months ahead; a month-old snapshot is flagged, not hidden. */
export const MACRO_CALENDAR_STALE_AFTER_DAYS = 30;

export type MacroImportance = "H" | "M" | "L";

export type MacroPrevious = {
  value: string;
  asOf: string | null;
  source: string | null;
};

export type MacroEvent = {
  id: string;
  dateKst: string;
  timeKst: string | null;
  importance: MacroImportance;
  category: string;
  categoryLabel: string | null;
  titleKo: string;
  titleEn: string | null;
  /** Short name for dense chips (GDP, ISM 제조업, FOMC 의사록 …). */
  shortLabel: string;
  source: string | null;
  sourceUrl: string | null;
  previous: MacroPrevious | null;
};

export type MacroCalendar = {
  generatedAt: string | null;
  source: string | null;
  /** Last day the mirror covers (KST, YYYY-MM-DD). */
  coversThrough: string | null;
  events: MacroEvent[];
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^\d{2}:\d{2}$/;

const SHORT_LABELS: Record<string, string> = {
  "국내총생산 GDP": "GDP",
  "비농업 고용지수 NFP": "NFP",
  "개인소비지출 PCE": "PCE",
  "소비자물가지수 CPI": "CPI",
  "생산자물가지수 PPI": "PPI",
  "ISM 제조업 PMI": "ISM 제조업",
  "ISM 서비스 PMI": "ISM 서비스",
  "FOMC 금리결정 · 기자회견": "FOMC 금리",
  "FOMC 의사록 공개": "FOMC 의사록",
  "잭슨홀 심포지엄": "잭슨홀",
  "월간 옵션 만기일": "옵션 만기",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function macroShortLabel(titleKo: string): string {
  const known = SHORT_LABELS[titleKo];
  if (known) return known;
  if (titleKo.startsWith("13F 공시 마감")) return "13F 마감";
  return titleKo;
}

function normalizePrevKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
}

/**
 * Latest prior print for one release, matched by title the way the calendar
 * previous-value builder keys it (exact title, normalized title, or alias).
 */
export function previousPrint(titles: Array<string | null>, prevValues: unknown): MacroPrevious | null {
  if (!isRecord(prevValues)) return null;
  const values = isRecord(prevValues.values) ? prevValues.values : {};
  const aliases = isRecord(prevValues.aliases) ? prevValues.aliases : {};
  const alias = (key: string): string | null => str(aliases[key]);
  const candidates = titles
    .filter((title): title is string => typeof title === "string" && title.length > 0)
    .flatMap((title) => [title, normalizePrevKey(title), alias(title), alias(normalizePrevKey(title))])
    .filter((key): key is string => typeof key === "string" && key.length > 0);
  for (const key of candidates) {
    const resolved = alias(key) ?? key;
    const match = values[resolved] ?? values[key];
    if (!isRecord(match)) continue;
    const value = str(match.value);
    if (!value) continue;
    return { value, asOf: str(match.asOf), source: str(match.source) };
  }
  return null;
}

export function parseMacroCalendar(calendar: unknown, prevValues: unknown): MacroCalendar {
  if (!isRecord(calendar) || !Array.isArray(calendar.events)) {
    return { generatedAt: null, source: null, coversThrough: null, events: [] };
  }
  const range = isRecord(calendar.range) ? calendar.range : {};
  const events: MacroEvent[] = [];
  calendar.events.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    if (raw.status !== undefined && raw.status !== "confirmed") return;
    const dateKst = str(raw.date_kst);
    const titleKo = str(raw.title_ko) ?? str(raw.title_en);
    const importance = raw.importance;
    if (!dateKst || !ISO_DAY.test(dateKst) || !titleKo) return;
    if (importance !== "H" && importance !== "M" && importance !== "L") return;
    const timeKst = str(raw.time_kst);
    const titleEn = str(raw.title_en);
    events.push({
      id: str(raw.id) ?? `${dateKst}-${index}`,
      dateKst,
      timeKst: timeKst && HH_MM.test(timeKst) ? timeKst : null,
      importance,
      category: str(raw.category) ?? "—",
      categoryLabel: str(raw.category_label),
      titleKo,
      titleEn,
      shortLabel: macroShortLabel(titleKo),
      source: str(raw.source),
      sourceUrl: str(raw.source_url),
      previous: previousPrint([titleEn, titleKo], prevValues),
    });
  });
  events.sort((a, b) => a.dateKst.localeCompare(b.dateKst) || (a.timeKst ?? "").localeCompare(b.timeKst ?? "") || a.titleKo.localeCompare(b.titleKo));
  const timeMax = str(range.time_max);
  return {
    generatedAt: str(calendar.generated_at),
    source: str(calendar.source),
    coversThrough: timeMax && ISO_DAY.test(timeMax.slice(0, 10)) ? timeMax.slice(0, 10) : null,
    events,
  };
}

/** Events on [fromIso, toIsoExclusive), KST days. */
export function macroEventsBetween(events: readonly MacroEvent[], fromIso: string, toIsoExclusive: string): MacroEvent[] {
  return events.filter((event) => event.dateKst >= fromIso && event.dateKst < toIsoExclusive);
}

export function isOptionsExpiry(event: MacroEvent): boolean {
  return event.category === "FIN" && event.titleKo.includes("옵션 만기");
}

/** Timeline lane rule: the market-moving releases (H) plus every Fed event. */
export function isHeadlineMacro(event: MacroEvent): boolean {
  if (isOptionsExpiry(event) || event.category === "FIL") return false;
  return event.importance === "H" || event.category === "POL";
}

export const MACRO_IMPORTANCE_LABEL: Record<MacroImportance, string> = { H: "높음", M: "보통", L: "낮음" };

/** "2026-09-30" -> "9/30 (수)" in KST calendar terms. */
export function formatKstDayHeading(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d} (${weekday})`;
}

/**
 * The previous print's own date, shown as is ("9/19"). Its meaning differs by
 * source (FRED stamps the observation period, the survey feed its release), so
 * it is never re-read as a month label.
 */
export function formatPrintDate(asOf: string | null): string | null {
  if (!asOf || !ISO_DAY.test(asOf.slice(0, 10))) return null;
  return `${Number(asOf.slice(5, 7))}/${Number(asOf.slice(8, 10))}`;
}
