type SourceDateLabelOptions = {
  pending?: boolean;
};

function shortSourceDate(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof value === "string" ? value.trim() : "");
  return match ? `${match[2]}-${match[3]}` : null;
}

export function formatScreenerSourceDateLabel(
  analyzerDate: string | null | undefined,
  marketFactsDate: string | null | undefined,
  { pending = false }: SourceDateLabelOptions = {},
): string {
  if (pending) return "분석 확인 중 · 시세 확인 중";
  return [
    `분석 ${shortSourceDate(analyzerDate) ?? "미제공"}`,
    `시세 ${shortSourceDate(marketFactsDate) ?? "미제공"}`,
  ].join(" · ");
}
