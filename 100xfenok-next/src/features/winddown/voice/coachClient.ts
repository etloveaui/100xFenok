import { WIND_DOWN_COACH_ENDPOINT, parseWindDownCoachDecision, type WindDownCoachRequest } from "./coachContract";
import type { LiveFunctionCall } from "@/features/mona-vnext/live/liveToolBridge";
import type { WindDownVoiceSessionResponse } from "./sessionContract";

export async function consultWindDownTeacher(args: {
  call: LiveFunctionCall; signal: AbortSignal; session: WindDownVoiceSessionResponse;
  learnerText: string; history: WindDownCoachRequest["history"];
  fetch?: typeof fetch; onUnavailable?: (message: string | null) => void;
}): Promise<Record<string, unknown>> {
  if (args.call.name !== "consult_teacher" || args.session.activity !== "live-talk" || args.session.coach?.provider !== "groq") {
    return { ok: false, error: "TOOL_UNSUPPORTED" };
  }
  const learnerText = args.learnerText.trim() || (typeof args.call.args.learnerText === "string" ? args.call.args.learnerText.trim() : "");
  if (!learnerText || learnerText.length > 1500) return { ok: false, error: "LEARNER_TEXT_REQUIRED" };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  args.signal.addEventListener("abort", cancel, { once: true });
  if (args.signal.aborted) cancel();
  const timeout = setTimeout(cancel, 9500);
  try {
    const response = await (args.fetch ?? fetch)(WIND_DOWN_COACH_ENDPOINT, {
      method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productSessionId: args.session.productSessionId, conversationId: args.session.conversationId,
        proof: args.session.reportProof, learnerText,
        history: args.history.slice(-8).map(item => ({ role: item.role, text: item.text.slice(0, 600) })),
      } satisfies WindDownCoachRequest),
    });
    const payload = await response.json().catch(() => null) as { decision?: unknown; error?: string } | null;
    if (args.signal.aborted) return { ok: false, error: "COACH_CANCELLED" };
    if (!response.ok) {
      args.onUnavailable?.(response.status === 429 ? "대화 도우미의 사용 한도에 잠시 걸렸어. 조금 뒤 다시 말해줘." : "대화 도우미 연결이 늦어지고 있어. 다시 말해줘.");
      return { ok: false, error: response.status === 429 ? "COACH_RATE_LIMITED" : "COACH_UNAVAILABLE" };
    }
    const decision = parseWindDownCoachDecision(payload?.decision, learnerText);
    if (!decision) throw new Error("COACH_INVALID_RESPONSE");
    if (!args.signal.aborted) args.onUnavailable?.(null);
    return { ok: true, decision };
  } catch {
    if (!args.signal.aborted) args.onUnavailable?.("대화 도우미 연결이 늦어지고 있어. 다시 말해줘.");
    return { ok: false, error: "COACH_UNAVAILABLE" };
  } finally {
    clearTimeout(timeout);
    args.signal.removeEventListener("abort", cancel);
  }
}
