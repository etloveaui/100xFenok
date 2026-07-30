import type { WindDownModelFreeMode } from "@/features/winddown/server/studyBootstrap";

export function normalizeWindDownStudyMode(value: string | null): WindDownModelFreeMode | null {
  return value === "learn" || value === "review" ? value : null;
}

export function normalizeWindDownStudyCount(value: string | null) {
  if (value === null || value.trim() === "") return 20;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.floor(parsed), 20)) : 20;
}

export function normalizeWindDownStudySeed(
  value: string | null,
  mode: WindDownModelFreeMode,
  day = new Date().toISOString().slice(0, 10),
) {
  const normalized = (value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._:-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return normalized || `${day}:${mode}`;
}
