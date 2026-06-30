const DIRECTION_LABELS: Record<string, string> = {
  strong: "강함",
  constructive: "양호",
  neutral: "중립",
  weak: "약함",
  stressed: "압력 큼",
  positive: "상",
  negative: "하",
  upside_bias: "상방 편중",
  downside_bias: "하방 편중",
  balanced: "균형",
  unavailable: "미확인",
};

export function directionKo(
  value: string | null | undefined,
  fallback = "미확인",
): string {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  return DIRECTION_LABELS[normalized] ?? fallback;
}
