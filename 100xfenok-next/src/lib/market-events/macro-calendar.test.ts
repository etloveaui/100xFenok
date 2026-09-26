import assert from "node:assert/strict";
import {
  coverageEndDay,
  formatKstDayHeading,
  formatPrintDate,
  isHeadlineMacro,
  isOptionsExpiry,
  macroEventsBetween,
  macroShortLabel,
  parseMacroCalendar,
  previousPrint,
} from "./macro-calendar";

function test(name: string, run: () => void): void {
  run();
  console.log(`ok - ${name}`);
}

const prevValues = {
  generated_at: "2026-09-25T11:44:41.697Z",
  aliases: {
    "Nonfarm Payrolls (NFP)": "nonfarm_payrolls",
    "비농업 고용지수 NFP": "nonfarm_payrolls",
    ism_manufacturing_pmi: "ism_manufacturing_pmi",
  },
  values: {
    nonfarm_payrolls: { value: "+162K", asOf: "2026-08-01", source: "FRED" },
    ism_manufacturing_pmi: { value: "54.6", asOf: "2026-09-01", source: "macro/activity-surveys" },
  },
};

const calendar = {
  generated_at: "2026-09-18T06:00:43+09:00",
  source: "BujaBot USD Google Calendar",
  range: { time_min: "2026-01-01T00:00:00+09:00", time_max: "2027-03-01T00:00:00+09:00" },
  events: [
    { id: "nfp", status: "confirmed", date_kst: "2026-10-02", time_kst: "21:30", importance: "H", category: "EMP", category_label: "고용", title_ko: "비농업 고용지수 NFP", title_en: "Nonfarm Payrolls (NFP)" },
    { id: "ism", status: "confirmed", date_kst: "2026-10-01", time_kst: "23:00", importance: "H", category: "PMI", title_ko: "ISM 제조업 PMI", title_en: "ISM Manufacturing PMI" },
    { id: "adp", status: "confirmed", date_kst: "2026-10-01", time_kst: "21:15", importance: "M", category: "EMP", title_ko: "ADP 고용보고서", title_en: "ADP Employment Report" },
    { id: "min", status: "confirmed", date_kst: "2026-10-08", time_kst: "03:00", importance: "M", category: "POL", title_ko: "FOMC 의사록 공개", title_en: "FOMC Minutes" },
    { id: "opx", status: "confirmed", date_kst: "2026-10-16", time_kst: "22:30", importance: "M", category: "FIN", title_ko: "월간 옵션 만기일", title_en: "Monthly Options Expiration" },
    { id: "13f", status: "confirmed", date_kst: "2026-11-14", time_kst: "09:00", importance: "M", category: "FIL", title_ko: "13F 공시 마감 · 2026 Q3" },
    { id: "cancelled", status: "cancelled", date_kst: "2026-10-03", importance: "H", category: "EMP", title_ko: "취소된 일정" },
    { id: "bad-date", date_kst: "10/04", importance: "H", title_ko: "형식 오류" },
    { id: "bad-imp", date_kst: "2026-10-05", importance: "X", title_ko: "중요도 오류" },
  ],
};

test("parses confirmed, well-formed events in time order and drops the rest", () => {
  const parsed = parseMacroCalendar(calendar, prevValues);
  assert.equal(parsed.generatedAt, "2026-09-18T06:00:43+09:00");
  assert.equal(parsed.coverageEnd, "2027-03-01");
  assert.deepEqual(parsed.events.map((e) => e.id), ["adp", "ism", "nfp", "min", "opx", "13f"]);
});

test("joins the previous print by title or alias and never invents one", () => {
  const byId = new Map(parseMacroCalendar(calendar, prevValues).events.map((e) => [e.id, e]));
  assert.deepEqual(byId.get("nfp")?.previous, { value: "+162K", asOf: "2026-08-01", source: "FRED" });
  assert.equal(byId.get("ism")?.previous?.value, "54.6");
  assert.equal(byId.get("adp")?.previous, null);
  assert.equal(previousPrint(["Nonfarm Payrolls (NFP)"], null), null);
  assert.equal(previousPrint(["Nonfarm Payrolls (NFP)"], { values: { nonfarm_payrolls: { value: "" } }, aliases: { "Nonfarm Payrolls (NFP)": "nonfarm_payrolls" } }), null);
});

test("lane rules: headline releases plus every Fed event; options expiry on its own lane", () => {
  const events = parseMacroCalendar(calendar, prevValues).events;
  assert.deepEqual(events.filter(isHeadlineMacro).map((e) => e.id), ["ism", "nfp", "min"]);
  assert.deepEqual(events.filter(isOptionsExpiry).map((e) => e.id), ["opx"]);
  assert.deepEqual(macroEventsBetween(events, "2026-10-01", "2026-10-08").map((e) => e.id), ["adp", "ism", "nfp"]);
});

test("short labels and date formatting", () => {
  assert.equal(macroShortLabel("국내총생산 GDP"), "GDP");
  assert.equal(macroShortLabel("ISM 서비스 PMI"), "ISM 서비스");
  assert.equal(macroShortLabel("13F 공시 마감 · 2026 Q3"), "13F 마감");
  assert.equal(macroShortLabel("미시간 소비자심리지수"), "미시간 소비자심리지수");
  assert.equal(formatKstDayHeading("2026-09-30"), "9/30 (수)");
  assert.equal(formatKstDayHeading("2026-10-04"), "10/4 (일)");
  assert.equal(formatPrintDate("2026-09-19"), "9/19");
  assert.equal(formatPrintDate(null), null);
});

test("a malformed document yields an empty calendar, not an error", () => {
  assert.deepEqual(parseMacroCalendar(null, prevValues), { generatedAt: null, source: null, coverageEnd: null, previousAsOf: null, previousPendingFrom: null, events: [] });
  assert.deepEqual(parseMacroCalendar({ events: "x" }, null).events, []);
});

test("coverage ends at the first KST day time_max leaves out", () => {
  assert.equal(coverageEndDay("2027-03-01T00:00:00+09:00"), "2027-03-01");
  assert.equal(coverageEndDay("2027-02-28T15:00:00Z"), "2027-03-01");
  assert.equal(coverageEndDay("2027-02-28T23:30:00+09:00"), "2027-03-01");
  assert.equal(coverageEndDay("2027-02-28T10:00:00+09:00"), "2027-03-01");
  assert.equal(coverageEndDay(null), null);
  assert.equal(coverageEndDay("not a date"), null);
});

test("a print is the previous print only for its series' first release after the file", () => {
  const claims = (id: string, date: string) => ({ id, status: "confirmed", date_kst: date, time_kst: "21:30", importance: "M", category: "EMP", title_ko: "주간 실업수당 청구", title_en: "Initial Jobless Claims" });
  const weekly = { ...calendar, events: [claims("c0924", "2026-09-24"), claims("c1001", "2026-10-01"), claims("c1008", "2026-10-08"), ...calendar.events] };
  const prints = {
    generated_at: "2026-09-25T06:07:00Z", // 9/25 15:07 KST, after the 9/24 release
    aliases: { ...prevValues.aliases, "Initial Jobless Claims": "jobless_claims" },
    values: { ...prevValues.values, jobless_claims: { value: "197K", asOf: "2026-09-19", source: "FRED" } },
  };
  const parsed = parseMacroCalendar(weekly, prints);
  const byId = new Map(parsed.events.map((e) => [e.id, e]));
  // 9/24 is already in the file (its own print), 10/8 comes after 10/1's print.
  assert.equal(byId.get("c0924")?.previous, null);
  assert.equal(byId.get("c1001")?.previous?.value, "197K");
  assert.equal(byId.get("c1008")?.previous, null);
  assert.equal(parsed.previousAsOf, "2026-09-25T06:07:00Z");
  assert.equal(parsed.previousPendingFrom, "2026-10-01");

  // A file last written 9/20 still precedes 9/24, and is one print behind from 10/1 on.
  const behind = parseMacroCalendar(weekly, { ...prints, generated_at: "2026-09-20T06:07:00Z" });
  const behindById = new Map(behind.events.map((e) => [e.id, e]));
  assert.equal(behindById.get("c0924")?.previous?.value, "197K");
  assert.equal(behindById.get("c1001")?.previous, null);
  assert.equal(behind.previousPendingFrom, "2026-09-24");

  // Without a timestamp the file cannot say which release it precedes.
  const undated = parseMacroCalendar(weekly, { ...prints, generated_at: undefined });
  assert.ok(undated.events.every((e) => e.previous === null));
  assert.equal(undated.previousPendingFrom, null);
});
