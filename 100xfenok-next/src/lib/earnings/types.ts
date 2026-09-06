export type EarningsMetric = "revenue" | "costOfRevenue" | "grossProfit" | "operatingExpenses" | "operatingIncome" | "pretaxIncome" | "incomeTax" | "netIncome" | "dilutedEps";
export type EarningsIncome = Record<EarningsMetric, number | null> & { afterTaxOther?: number | null };
export type EarningsSource = { name: string; url: string; filedAt: string | null };
export type EarningsSegment = { name: string; revenue: number };
export type EarningsPeriod = {
  end: string;
  label: string;
  income: EarningsIncome;
  source: EarningsSource;
  segments: EarningsSegment[];
  segmentBasis: string | null;
  notes: string[];
};
export type EarningsDocument = {
  schemaVersion: 1;
  ticker: string;
  companyName: string;
  currency: "USD";
  updatedAt: string;
  status: "current" | "retained";
  notice: string | null;
  periods: EarningsPeriod[];
};
export type IncomeFlowNode = {
  id: string; label: string; value: number; column: number;
  kind: "income" | "profit" | "expense";
};
export type IncomeFlowLink = { from: string; to: string; value: number };
export type IncomeFlow = {
  kind: "sankey" | "bridge" | "unavailable";
  nodes: IncomeFlowNode[];
  links: IncomeFlowLink[];
  reason: string | null;
};
