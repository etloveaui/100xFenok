export type MonaVnextIntent =
  | "lesson_attempt"
  | "next_material"
  | "english_visibility"
  | "repair"
  | "stop"
  | "unknown";

const NEXT_PATTERNS = [
  /다음/,
  /새로운/,
  /새 문장/,
  /넘어가/,
  /넘어갈/,
  /\bnext\b/i,
  /\bnew one\b/i,
];

const ENGLISH_VISIBILITY_PATTERNS = [
  /영어.*(?:안|않).*보/,
  /영어.*보여/,
  /밑에.*영어/,
  /카드.*영어/,
  /\bshow\b.*\benglish\b/i,
];

const REPAIR_PATTERNS = [
  /짜증/,
  /빡/,
  /씨발/,
  /좆/,
  /병신/,
  /무시/,
  /인식.*못/,
  /이해.*못/,
  /말.*이해/,
  /내 말.*(?:안|못).*듣/,
  /왜.*(?:넘어가|넘어갔|넘어갈|뛰어넘|뛰어났|건너뛰|스킵)/,
  /(?:넘어가|넘어갔|넘어갈|뛰어넘|뛰어났|건너뛰|스킵).*왜/,
  /왜.*반복/,
  /왜.*계속/,
  /못 알아듣/,
  /틀렸/,
  /\bagain\b/i,
];

const STOP_PATTERNS = [
  /그만/,
  /끝/,
  /자자/,
  /잘래/,
  /\bstop\b/i,
  /\bdone\b/i,
];

export function detectMonaVnextIntent(text: string | null | undefined): MonaVnextIntent {
  const normalized = (text ?? "").trim();
  if (!normalized) return "unknown";
  if (STOP_PATTERNS.some((pattern) => pattern.test(normalized))) return "stop";
  if (ENGLISH_VISIBILITY_PATTERNS.some((pattern) => pattern.test(normalized))) return "english_visibility";
  if (REPAIR_PATTERNS.some((pattern) => pattern.test(normalized))) return "repair";
  if (NEXT_PATTERNS.some((pattern) => pattern.test(normalized))) return "next_material";
  return "lesson_attempt";
}

export function hasLikelySttLanguageDrift(text: string | null | undefined) {
  const normalized = (text ?? "").trim();
  if (!normalized) return false;
  if (/[ぁ-ゟ゠-ヿ]/.test(normalized)) return true;
  if (/\b(?:hola|gracias|adios|selamat|terima|danke|bitte|bonjour|merci)\b/i.test(normalized)) return true;
  return false;
}
