const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function todayKST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export function dateOnly(value: string | null | undefined): string | null {
  const match = typeof value === "string" ? DATE_RE.exec(value) : null;
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function formatAsOf(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const trimmed = value.trim();
  const match = DATE_RE.exec(trimmed);
  if (!match) return trimmed;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return match[4] && match[5] ? `${date} ${match[4]}:${match[5]}` : date;
}

export function daysUntilKstDate(dateValue: string | null | undefined, today = todayKST()): number | null {
  const target = dateOnly(dateValue);
  if (!target) return null;
  const [targetY, targetM, targetD] = target.split("-").map(Number);
  const [todayY, todayM, todayD] = today.split("-").map(Number);
  if (![targetY, targetM, targetD, todayY, todayM, todayD].every(Number.isFinite)) return null;
  const targetTime = Date.UTC(targetY, targetM - 1, targetD);
  const todayTime = Date.UTC(todayY, todayM - 1, todayD);
  return Math.round((targetTime - todayTime) / DAY_MS);
}

export function isStaleAsOf(value: string | null | undefined, maxAgeDays = 7, today = todayKST()): boolean {
  const diff = daysUntilKstDate(value, today);
  return diff !== null && diff < -maxAgeDays;
}

export function latestAsOf(values: Array<string | null | undefined>): string | null {
  return values
    .map((value) => ({ raw: value ?? null, key: dateOnly(value) }))
    .filter((item): item is { raw: string; key: string } => Boolean(item.raw && item.key))
    .sort((a, b) => a.key.localeCompare(b.key))
    .at(-1)?.raw ?? null;
}
