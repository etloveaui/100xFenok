export type AdminLiveOutputSafetyResult = {
  blocked: boolean;
  reason: string | null;
  text: string;
};

const UNSAFE_OUTPUT_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "CONTROL_TOKEN", pattern: /\[(?:CONTROL|coach_control)\]/i },
  { reason: "SHOW_CARD_TOKEN", pattern: /\bshowCard\b/i },
  { reason: "CARD_STATE_TOKEN", pattern: /\bstate\s*=\s*(?:prompt|reveal|drill|clear)\b/i },
  { reason: "CARD_STATE_TOKEN", pattern: /\b(?:prompt|reveal|drill|clear)\s*상태/i },
  { reason: "ROUND_LABEL", pattern: /\bR[1-5]\b/ },
  { reason: "INTERNAL_PLAN", pattern: /(?:프롬프트 규칙을 지적|페르소나를 유지|자연스럽게 학습으로 유도|힌트를 제공|제공 방식.*불만|강력히 항의|실수를 인정|분위기를 전환|카드 상태가 바뀌지|기술적 문제를 인지|질문함|부드럽게 교정|자연스러운 표현인)/ },
  { reason: "INTERNAL_PLAN", pattern: /(?:호출하여|호출한다|진행한다|유도한다|제시한다|유지한다|전환한다|저장한다|인정하고|사과한 후)/ },
];

export function inspectAdminLiveModelOutput(value: unknown): AdminLiveOutputSafetyResult {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!text) return { blocked: false, reason: null, text: "" };

  const match = UNSAFE_OUTPUT_PATTERNS.find((item) => item.pattern.test(text));
  if (match) {
    return { blocked: true, reason: match.reason, text: "" };
  }

  return { blocked: false, reason: null, text };
}
