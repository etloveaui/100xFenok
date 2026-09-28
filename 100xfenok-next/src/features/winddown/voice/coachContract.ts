export const WIND_DOWN_COACH_MODEL = "openai/gpt-oss-120b";
export const WIND_DOWN_COACH_ENDPOINT = "/api/winddown/live/coach/";
export type WindDownCoachRequest = {
  productSessionId: string; conversationId: string; proof: string;
  learnerText: string; history: { role: "user" | "assistant"; text: string }[];
};
export type WindDownCoachDecision = {
  action: "answer" | "scaffold" | "clarify" | "pause";
  spokenResponse: string;
  correction: { was: string; now: string; why: string } | null;
};
export type WindDownCoachContext = {
  recentPractice: { phrase: string; needsPractice: boolean }[];
};
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => key in value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= max;
}
export function parseWindDownCoachRequest(value: unknown): WindDownCoachRequest | null {
  if (!record(value) || !exact(value, ["productSessionId", "conversationId", "proof", "learnerText", "history"])
    || !text(value.productSessionId, 120) || !text(value.conversationId, 120)
    || !text(value.proof, 2048) || !text(value.learnerText, 1500)
    || !Array.isArray(value.history) || value.history.length > 12) return null;
  if (!value.history.every(item => record(item) && exact(item, ["role", "text"])
    && (item.role === "user" || item.role === "assistant") && text(item.text, 1500))) return null;
  return value as WindDownCoachRequest;
}
export function parseWindDownCoachDecision(value: unknown, learnerText: string): WindDownCoachDecision | null {
  if (!record(value) || !exact(value, ["action", "spokenResponse", "correction"])
    || !["answer", "scaffold", "clarify", "pause"].includes(String(value.action))
    || !text(value.spokenResponse, 900)) return null;
  if (value.correction !== null) {
    const c = value.correction;
    if (!record(c) || !exact(c, ["was", "now", "why"]) || !text(c.was, 300)
      || !text(c.now, 300) || !text(c.why, 300) || !learnerText.includes(c.was)
      || c.was === c.now) return null;
  }
  return value as WindDownCoachDecision;
}
export function buildWindDownCoachContext(profile: unknown, entries: readonly { id: string; en: string }[]): WindDownCoachContext {
  const records = record(profile) && record(profile.records) ? Object.values(profile.records).filter(record) : [];
  const phrases = new Map(entries.map(entry => [entry.id, entry.en]));
  const recentPractice = records.sort((a, b) => String(b.lastReviewedAt ?? "").localeCompare(String(a.lastReviewedAt ?? "")))
    .flatMap(item => {
      const phrase = phrases.get(String(item.expressionId));
      return phrase ? [{ phrase: phrase.slice(0, 180), needsPractice: item.lastRating === "again" || item.lastRating === "hard" }] : [];
    }).slice(0, 4);
  return { recentPractice };
}
