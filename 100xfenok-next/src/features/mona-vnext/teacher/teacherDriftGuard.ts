import type { TeacherEffect } from "./teacherSession";

const TARGET_ACTIONS = new Set<TeacherEffect["expectedModelAction"]>([
  "speak_target",
  "reveal_target",
  "present_card",
]);

export function normalizeTeacherTargetText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[’‘`]/g, "'")
    .replace(/\bcan not\b/g, "cannot")
    .replace(/\bi am\b/g, "i'm")
    .replace(/\byou are\b/g, "you're")
    .replace(/\bit is\b/g, "it's")
    .replace(/\bdo not\b/g, "don't")
    .replace(/\bdid not\b/g, "didn't")
    .replace(/\bdoes not\b/g, "doesn't")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shouldFlagTeacherModelDrift(effect: TeacherEffect | null, observedText: string | null | undefined) {
  if (!effect || !TARGET_ACTIONS.has(effect.expectedModelAction) || !effect.targetEn) return false;
  const observed = normalizeTeacherTargetText(observedText);
  const target = normalizeTeacherTargetText(effect.targetEn);
  if (!observed || !target) return false;
  return !observed.includes(target);
}
