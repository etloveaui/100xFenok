import type { WindDownCoachDecision } from "./coachContract";
import { normalizeCoachEvidence } from "./coachFeedback";
export function windDownSpeechBudget(action: WindDownCoachDecision["action"], learnerText: string) {
  if (action === "pause") return { sentences: 1, characters: 70 };
  const explain = /자세|상세|설명|왜|차이|explain|in detail|difference|\bwhy\b/i.test(learnerText);
  return explain ? { sentences: 4, characters: 520 } : { sentences: 2, characters: 260 };
}
/** Trim only at complete sentence boundaries; never stream an unchecked monologue. */
export function enforceWindDownSpeechBudget(decision: WindDownCoachDecision, learnerText: string): WindDownCoachDecision | null {
  const budget = windDownSpeechBudget(decision.action, learnerText);
  const text = decision.spokenResponse.trim().replace(/\s+/g, " ");
  const segments = Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(text), part => part.segment.trim()).filter(Boolean);
  const selected: string[] = [];
  for (const part of segments) {
    if (selected.length >= budget.sentences || [...selected, part].join(" ").length > budget.characters) break;
    if (decision.action === "pause" && /[?？]/.test(part)) break;
    selected.push(part);
  }
  if (!selected.length) return null;
  const spokenResponse = selected.join(" ");
  const correction = decision.correction && normalizeCoachEvidence(spokenResponse).includes(normalizeCoachEvidence(decision.correction.now)) ? decision.correction : null;
  return { ...decision, spokenResponse, correction };
}
