import type { WindDownModelFreeMode } from "@/features/winddown/server/studyBootstrap";

export function normalizeWindDownStudyMode(value: string | null): WindDownModelFreeMode | null {
  return value === "learn" || value === "review" ? value : null;
}

export function getWindDownKstDay(now = new Date()) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
      .map((part) => [part.type, part.value]),
  );
  if (!values.year || !values.month || !values.day) {
    throw new Error("WINDDOWN_KST_DAY_UNAVAILABLE");
  }
  return `${values.year}-${values.month}-${values.day}`;
}

export function normalizeWindDownStudySeed(
  value: string | null,
  mode: WindDownModelFreeMode,
  day = getWindDownKstDay(),
) {
  const normalized = (value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._:-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return normalized || `${day}:${mode}`;
}
