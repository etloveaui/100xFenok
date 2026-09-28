import { signAdminScopedServerValue, verifyAdminScopedServerValue } from "@/lib/server/admin-session";
import { attachWindDownCoachFeedback, normalizeCoachEvidence, parseWindDownCoachFeedback, type WindDownCoachFeedback } from "../voice/coachFeedback";
import type { WindDownCoachDecision } from "../voice/coachContract";
import type { WindDownVoiceFinalizedTurn } from "../voice/product";
const SCOPE = "winddown-coach-feedback-v1";
function signedValue(productSessionId: string, conversationId: string, feedback: Omit<WindDownCoachFeedback, "signature">) {
  return JSON.stringify([productSessionId, conversationId, feedback.id, normalizeCoachEvidence(feedback.learnerText), feedback.was, feedback.now, feedback.why, feedback.spokenResponse]);
}
export async function createWindDownCoachFeedback(args: {
  productSessionId: string; conversationId: string; learnerText: string; decision: WindDownCoachDecision;
}): Promise<WindDownCoachFeedback | null> {
  const c = args.decision.correction;
  if (!c || !normalizeCoachEvidence(args.decision.spokenResponse).includes(normalizeCoachEvidence(c.now))) return null;
  const feedback = { id: crypto.randomUUID(), learnerText: args.learnerText, ...c, spokenResponse: args.decision.spokenResponse };
  const signature = await signAdminScopedServerValue(SCOPE, signedValue(args.productSessionId, args.conversationId, feedback));
  return parseWindDownCoachFeedback({ ...feedback, signature });
}
export async function verifyWindDownCoachFeedbacks(args: { productSessionId: string; turns: readonly WindDownVoiceFinalizedTurn[] }) {
  const seen = new Set<string>();
  for (const turn of args.turns) {
    if (turn.coachFeedback === undefined) continue;
    const feedback = parseWindDownCoachFeedback(turn.coachFeedback);
    // Re-attach from plain transcript evidence, never trust an existing field.
    const { coachFeedback: _ignored, ...plain } = turn;
    if (!feedback || seen.has(feedback.id) || !attachWindDownCoachFeedback(plain, feedback).coachFeedback
      || turn.correctionText !== feedback.spokenResponse
      || !await verifyAdminScopedServerValue(SCOPE, signedValue(args.productSessionId, turn.conversationId, feedback), feedback.signature)) return false;
    seen.add(feedback.id);
  }
  return true;
}
