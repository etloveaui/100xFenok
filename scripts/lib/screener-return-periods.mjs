export const CALENDAR_RETURN_PERIODS = Object.freeze({
  ret1y: Object.freeze({ label: "2025년", years: Object.freeze([2025]) }),
  ret3y: Object.freeze({ label: "2023–2025 누적", years: Object.freeze([2023, 2024, 2025]) }),
  ret5y: Object.freeze({ label: "2021–2025 누적", years: Object.freeze([2021, 2022, 2023, 2024, 2025]) }),
});

export function compoundCalendarReturns(rows, years) {
  const byYear = new Map((Array.isArray(rows) ? rows : []).map((row) => [
    Number(row?.year),
    row?.return === null || row?.return === undefined || row?.return === "" ? NaN : Number(row.return),
  ]));
  const values = years.map((year) => byYear.get(year));
  if (values.some((value) => !Number.isFinite(value))) return undefined;
  return values.reduce((product, value) => product * (1 + value / 100), 1) - 1;
}
