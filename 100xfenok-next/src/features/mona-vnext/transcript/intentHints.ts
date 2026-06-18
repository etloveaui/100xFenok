export type MonaVnextIntent =
  | "lesson_attempt"
  | "next_material"
  | "english_visibility"
  | "repair"
  | "meta_question"
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

const STRICT_STOP_PHRASES = new Set([
  "그만",
  "그만해",
  "그만하자",
  "그만할래",
  "그만할게",
  "stop",
  "끝낼래",
]);

const META_QUESTION_PATTERNS = [
  /(?:오늘|지금)?.*(?:준비된|준비한)?.*(?:문장|표현).*(?:몇|수|개)/,
  /(?:몇|수|개).*(?:문장|표현).*(?:준비|있)/,
  /(?:초기|시스템)?.*(?:prompt|프롬프트)/i,
  /(?:로그|logging|저장|기록).*(?:되|됐|돼|확인|실패|성공|남)/i,
  /(?:준비했던|빨모|빨모쌤|자료).*(?:맞|들어|연결|반영)/,
];

function normalizeStrictStopText(text: string | null | undefined) {
  return (text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.!?。！？…]+$/g, "")
    .replace(/\s+/g, " ");
}

export function hasStrictMonaVnextStopIntent(text: string | null | undefined) {
  return STRICT_STOP_PHRASES.has(normalizeStrictStopText(text));
}

export function detectMonaVnextIntent(text: string | null | undefined): MonaVnextIntent {
  const normalized = (text ?? "").trim();
  if (!normalized) return "unknown";
  if (hasStrictMonaVnextStopIntent(normalized)) return "stop";
  if (META_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized))) return "meta_question";
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
