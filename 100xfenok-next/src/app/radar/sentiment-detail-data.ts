import type { MarketChartSeries } from "@/lib/market-valuation/charts/types";

export type SentimentRow = { date: string; [field: string]: string | number | null };
export type SentimentView = { id: string; label: string; file: string; field: string; unit: string; description: string };
export const SENTIMENT_VIEWS: SentimentView[] = [
  { id: "cnn-fg", label: "CNN Fear & Greed", file: "cnn-fear-greed", field: "score", unit: "점 (0–100)", description: "7개 시장 심리 구성요소의 종합 지수. 차트 기준: 극단 공포 ≤15, 공포 ≤25, 탐욕 ≥75, 극단 탐욕 ≥85." },
  { id: "cftc", label: "CFTC S&P 500 선물", file: "cftc-sp500", field: "net", unit: "계약", description: "주간 투기적 순포지션 = Long − Short. Heavy Long ≥50,000, Extreme Long ≥100,000, Heavy Short ≤−100,000, Extreme Short ≤−150,000계약. 금요일 발표 자료의 화요일 관측일입니다." },
  { id: "aaii", label: "AAII 투자자 설문", file: "aaii", field: "spread", unit: "% / %p", description: "Bullish·Neutral·Bearish는 응답 비율(%), Spread는 Bullish − Bearish(%p). Spread ≥20은 극도 낙관, ≤−20은 극도 비관입니다." },
  { id: "vix-move", label: "VIX + MOVE", file: "vix", field: "value", unit: "VIX 지수", description: "주식 옵션 변동성 VIX와 국채 옵션 변동성 MOVE. 차트 기준: VIX 공포 ≥30 / 극단 ≥40, MOVE 스트레스 ≥120 / 극단 ≥150. 각 축은 독립적입니다." },
  { id: "crypto-fg", label: "Crypto Fear & Greed", file: "crypto-fear-greed", field: "value", unit: "점 (0–100)", description: "Alternative.me 암호화폐 심리 지수. 차트 기준: 극단 공포 ≤25, 공포 ≤40, 탐욕 ≥60, 극단 탐욕 ≥75." },
  { id: "cnn-momentum", label: "Market Momentum", file: "cnn-momentum", field: "value", unit: "S&P 500 지수", description: "S&P 500과 125개 관측값 이동평균을 비교합니다. 전체 이력에서 이동평균을 먼저 계산합니다. MA 대비 ±5% 밖은 강한 탐욕/공포 구간입니다." },
  { id: "cnn-strength", label: "Stock Price Strength", file: "cnn-strength", field: "value", unit: "비율", description: "52주 신고가와 신저가의 강도 비율. 양수는 탐욕, 음수는 공포, +3 초과 / −3 미만은 강한 탐욕 / 공포입니다. 정규화한 0–100 점수와 다른 원시 값입니다." },
  { id: "cnn-breadth", label: "Stock Price Breadth", file: "cnn-breadth", field: "value", unit: "McClellan 지수", description: "상승·하락 거래량의 시장 폭. 전체 이력의 33백분위 이하는 공포, 67백분위 이상은 탐욕입니다." },
  { id: "cnn-put-call", label: "Put/Call Options", file: "cnn-put-call", field: "value", unit: "비율", description: "풋/콜 비율 ≥1.0은 공포, ≤0.7은 탐욕입니다. 높은 값은 하락 대비 수요를 나타냅니다." },
  { id: "cnn-safe-haven", label: "Safe Haven Demand", file: "cnn-safe-haven", field: "value", unit: "%p", description: "주식과 국채의 수익률 차이. ≥2%p는 탐욕, ≤−2%p는 공포입니다." },
  { id: "cnn-junk-bond", label: "Junk Bond Demand", file: "cnn-junk-bond", field: "value", unit: "%", description: "정크본드 스프레드. 전체 이력의 33백분위 이하는 탐욕, 67백분위 이상은 공포입니다. 낮을수록 위험 선호가 강합니다." },
];
export const CNN_COMPONENTS = [
  ["market_momentum", "Market Momentum"], ["stock_strength", "Stock Price Strength"],
  ["stock_breadth", "Stock Price Breadth"], ["put_call", "Put/Call Options"],
  ["volatility", "Market Volatility"], ["safe_haven", "Safe Haven Demand"], ["junk_bond", "Junk Bond Demand"],
] as const;

export function numberAt(row: SentimentRow | undefined, key: string): number | null {
  const value = row?.[key];
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function sentimentRows(raw: unknown, file: string): SentimentRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => row && typeof row === "object" && /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .map((row) => {
      const copy: SentimentRow = { ...row };
      if (file === "aaii") {
        const bull = numberAt(copy, "bullish"), bear = numberAt(copy, "bearish");
        copy.spread = bull === null || bear === null ? null : bull - bear;
      }
      return copy;
    }).sort((a, b) => a.date.localeCompare(b.date));
}
export function movingAverage125(rows: SentimentRow[]): SentimentRow[] {
  return rows.map((row, index) => {
    if (index < 124) return { date: row.date, value: null };
    const values = rows.slice(index - 124, index + 1).map((point) => numberAt(point, "value"));
    return { date: row.date, value: values.some((value) => value === null) ? null : (values as number[]).reduce((sum, value) => sum + value, 0) / 125 };
  });
}
export function sentimentThresholds(view: SentimentView, rows: SentimentRow[]): number[] {
  const fixed: Record<string, number[]> = { "cnn-fg": [15, 25, 75, 85], "crypto-fg": [25, 40, 60, 75], cftc: [-150000, -100000, 50000, 100000], aaii: [-20, 20], "vix-move": [30, 40], "cnn-strength": [-3, 0, 3], "cnn-put-call": [.7, 1], "cnn-safe-haven": [-2, 2] };
  if (fixed[view.id]) return fixed[view.id];
  if (view.id === "cnn-breadth" || view.id === "cnn-junk-bond") {
    const values = rows.map((row) => numberAt(row, view.field)).filter((value): value is number => value !== null).sort((a, b) => a - b);
    return values.length ? [values[Math.floor(values.length * .33)], values[Math.floor(values.length * .67)]] : [];
  }
  return [];
}
export function sentimentStatus(view: SentimentView, rows: SentimentRow[]): string {
  const value = numberAt(rows.at(-1), view.field);
  if (value === null) return "미확인";
  const t = sentimentThresholds(view, rows);
  switch (view.id) {
    case "cnn-fg": case "crypto-fg": return value >= t[3] ? "Extreme Greed" : value >= t[2] ? "Greed" : value <= t[0] ? "Extreme Fear" : value <= t[1] ? "Fear" : "Neutral";
    case "cftc": return value >= 100000 ? "Extreme Long" : value >= 50000 ? "Heavy Long" : value <= -150000 ? "Extreme Short" : value <= -100000 ? "Heavy Short" : value > 0 ? "Net Long" : value < 0 ? "Net Short" : "Neutral";
    case "aaii": return value >= 20 ? "Extreme Bullish" : value <= -20 ? "Extreme Bearish" : value > 0 ? "Bullish" : value < 0 ? "Bearish" : "Neutral";
    case "vix-move": return value >= 40 ? "Extreme Fear" : value >= 30 ? "Fear" : "Normal";
    case "cnn-momentum": {
      const ma = numberAt(movingAverage125(rows).at(-1), "value");
      if (!ma) return "미확인";
      const gap = (value / ma - 1) * 100;
      return gap > 5 ? "Strong Greed" : gap < -5 ? "Strong Fear" : gap > 0 ? "Greed" : gap < 0 ? "Fear" : "Neutral";
    }
    case "cnn-strength": return value > 3 ? "Strong Greed" : value < -3 ? "Strong Fear" : value > 0 ? "Greed" : value < 0 ? "Fear" : "Neutral";
    case "cnn-put-call": case "cnn-junk-bond": return value <= t[0] ? "Greed" : value >= t[1] ? "Fear" : "Neutral";
    default: return value <= t[0] ? "Fear" : value >= t[1] ? "Greed" : "Neutral";
  }
}
export function sentimentSeries(id: string, label: string, rows: SentimentRow[], field = "value", extra: Partial<MarketChartSeries> = {}): MarketChartSeries {
  return { id, label, points: rows.map((row) => ({ label: row.date, value: numberAt(row, field) })), ...extra };
}
export function returnSinceStart(rows: SentimentRow[]): SentimentRow[] {
  const base = rows.map((row) => numberAt(row, "value")).find((value) => value !== null && value > 0);
  return rows.map((row) => { const value = numberAt(row, "value"); return { date: row.date, value: base && value !== null ? (value / base - 1) * 100 : null }; });
}
