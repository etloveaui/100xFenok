export type SeriesPoint = { date: string; val: number };

export type FlowSnapshot = {
  status: "rising" | "stable" | "falling";
  overallLabel: string;
  m2YoY: number | null;
  m2Total: number;
  netLiquidity: number;
  weeklyNetFlow: number;
  stablecoinMcap: number;
  scM2Ratio: number;
  as_of: string | null;
};

export type StressSnapshot = {
  overallStatus: "normal" | "caution" | "warning" | "danger";
  overallLabel: string;
  tier1: { status: "normal" | "caution" | "warning" | "danger"; value: number; unit: "bp" };
  tier2: { status: "normal" | "caution" | "warning" | "danger"; value: number; unit: "%" };
  as_of: string | null;
};

export type BankingSnapshot = {
  overallStatus: "normal" | "caution" | "warning" | "danger";
  overallLabel: string;
  delinquency: { value: number; status: "normal" | "caution" | "warning" | "danger" };
  tier1: { value: number; status: "normal" | "caution" | "warning" | "danger" };
  loanDeposit: { value: number; status: "normal" | "caution" | "warning" | "danger" };
  as_of: string | null;
};

export type ComboCondition = {
  indicator: string;
  operator: string;
  value: number;
  label?: string;
  current: number | null;
  status: "met" | "near" | "unmet" | "unknown";
};

export type ComboResult = {
  id: string;
  name: string;
  category: string;
  priority: number;
  status: "active" | "near" | "inactive";
  conditions: ComboCondition[];
};

export type SentimentSnapshot = {
  overallStatus: "neutral" | "opportunity" | "warning";
  buy_active: number;
  buy_near: number;
  warn_active: number;
  warn_near: number;
  values: Record<string, number | null>;
  combos: ComboResult[];
};

export type ComboSignal = {
  id: string;
  name: string;
  category: string;
  priority: number;
  conditions: Array<{ indicator: string; operator: string; value: number; label?: string }>;
};

declare module "../../../public/tools/macro-monitor/shared/signals-core.mjs" {
  export const COMBO_SIGNALS: ComboSignal[];
  export function computeLiquidityFlowSnapshot(
    input: {
      m2: SeriesPoint[];
      fedBs: SeriesPoint[];
      tga: SeriesPoint[];
      rrp: SeriesPoint[];
      stablecoin: { current: number; series: SeriesPoint[] } | null;
    },
    now?: Date,
  ): FlowSnapshot;
  export function computeLiquidityStressSnapshot(input: {
    sofr: SeriesPoint[];
    iorb: SeriesPoint[];
    reserves: SeriesPoint[];
    gdp: SeriesPoint[];
  }): StressSnapshot;
  export function computeBankingHealthSnapshot(input: {
    delinquency: SeriesPoint[];
    loans: SeriesPoint[];
    deposits: SeriesPoint[];
    fedTier1: SeriesPoint[];
    fdicTier1: SeriesPoint[];
  }): BankingSnapshot;
  export function computeSentimentSignalSnapshot(
    currentValues: Record<string, number | null>,
    combos?: ComboSignal[],
  ): SentimentSnapshot;
}
