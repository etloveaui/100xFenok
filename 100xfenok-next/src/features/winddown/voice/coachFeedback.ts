import type { WindDownVoiceFinalizedTurn } from "./product";

export type WindDownCoachFeedback = {
  id: string; learnerText: string; was: string; now: string; why: string;
  spokenResponse: string; signature: string;
};
export function normalizeCoachEvidence(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}']+/gu, " ").trim();
}
export function parseWindDownCoachFeedback(value: unknown): WindDownCoachFeedback | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const limits = { id: 80, learnerText: 1500, was: 300, now: 300, why: 300, spokenResponse: 520, signature: 64 };
  if (Object.keys(v).length !== Object.keys(limits).length || !Object.entries(limits).every(([key, max]) => typeof v[key] === "string" && !!v[key].trim() && v[key].length <= max)) return null;
  const feedback = v as WindDownCoachFeedback;
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(feedback.id) || !/^[a-f0-9]{64}$/.test(feedback.signature)) return null;
  if (![feedback.learnerText, feedback.was, feedback.now].every(item => normalizeCoachEvidence(item))
    || !normalizeCoachEvidence(feedback.learnerText).includes(normalizeCoachEvidence(feedback.was)) || normalizeCoachEvidence(feedback.was) === normalizeCoachEvidence(feedback.now)) return null;
  if (!normalizeCoachEvidence(feedback.spokenResponse).includes(normalizeCoachEvidence(feedback.now))) return null;
  return { ...feedback };
}
export function attachWindDownCoachFeedback(turn: WindDownVoiceFinalizedTurn, value: unknown): WindDownVoiceFinalizedTurn {
  const feedback = parseWindDownCoachFeedback(value);
  if (!feedback || typeof turn.userText !== "string" || typeof turn.modelText !== "string" || !turn.finalized || turn.interrupted || turn.sttDrift
    || normalizeCoachEvidence(turn.userText ?? "") !== normalizeCoachEvidence(feedback.learnerText)
    || normalizeCoachEvidence(turn.modelText ?? "") !== normalizeCoachEvidence(feedback.spokenResponse)) return turn;
  return { ...turn, correctionText: feedback.spokenResponse, coachFeedback: feedback };
}
