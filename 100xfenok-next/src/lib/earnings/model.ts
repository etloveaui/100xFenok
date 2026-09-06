import type { EarningsDocument, EarningsMetric, EarningsPeriod, IncomeFlow, IncomeFlowLink, IncomeFlowNode } from "./types";

const metrics: EarningsMetric[] = ["revenue", "costOfRevenue", "grossProfit", "operatingExpenses", "operatingIncome", "pretaxIncome", "incomeTax", "netIncome", "dilutedEps"];
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const near = (left: number, right: number): boolean => Math.abs(left - right) <= Math.max(0.01, Math.abs(left) * 1e-8, Math.abs(right) * 1e-8);

function incomeErrors(period: EarningsPeriod): string[] {
  const i = period.income;
  const errors: string[] = [];
  for (const metric of metrics) if (i[metric] !== null && !finite(i[metric])) errors.push(`invalid ${metric}`);
  if (!finite(i.revenue) || i.revenue <= 0) errors.push("positive revenue required");
  for (const [a, b, result] of [["revenue", "costOfRevenue", "grossProfit"], ["grossProfit", "operatingExpenses", "operatingIncome"]] as const) {
    if (finite(i[a]) && finite(i[b]) && finite(i[result]) && !near(i[a] - i[b], i[result])) errors.push(`${a}-${b} must equal ${result}`);
  }
  const afterTaxOther = i.afterTaxOther ?? 0;
  if (!finite(afterTaxOther)) errors.push("invalid after-tax adjustment");
  if (finite(i.pretaxIncome) && finite(i.incomeTax) && finite(i.netIncome) && finite(afterTaxOther)
    && !near(i.pretaxIncome - i.incomeTax + afterTaxOther, i.netIncome)) errors.push("after-tax income must reconcile");
  return errors;
}

export function validEarningsSegments(period: EarningsPeriod): boolean {
  return period.segments.length > 0 && finite(period.income.revenue)
    && period.segments.every(s => typeof s.name === "string" && s.name.length > 0 && finite(s.revenue) && s.revenue >= 0)
    && near(period.segments.reduce((sum, s) => sum + s.revenue, 0), period.income.revenue);
}

export function validateEarningsDocument(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isObject(value)) return { ok: false, errors: ["document required"] };
  if (value.schemaVersion !== 1 || value.currency !== "USD" || !["current", "retained"].includes(String(value.status))) errors.push("unsupported document contract");
  if (typeof value.ticker !== "string" || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(value.ticker)) errors.push("invalid ticker");
  if (typeof value.companyName !== "string" || !value.companyName.trim() || value.companyName.length > 160) errors.push("invalid company name");
  if (typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt))) errors.push("invalid update time");
  if (value.notice !== null && typeof value.notice !== "string") errors.push("invalid notice");
  if (!Array.isArray(value.periods) || value.periods.length === 0 || value.periods.length > 20) return { ok: false, errors: [...errors, "one to twenty periods required"] };
  const seen = new Set<string>();
  for (const raw of value.periods) {
    if (!isObject(raw) || !isObject(raw.income) || !isObject(raw.source) || !Array.isArray(raw.segments) || !Array.isArray(raw.notes)) { errors.push("invalid period structure"); continue; }
    if (!date(raw.end) || seen.has(String(raw.end))) errors.push("invalid or duplicate period");
    seen.add(String(raw.end));
    if (typeof value.updatedAt === "string" && date(raw.end) && raw.end > value.updatedAt.slice(0, 10)) errors.push("period ends after observation");
    if (typeof raw.label !== "string" || !raw.label.trim() || raw.label.length > 100) errors.push("invalid period label");
    if (typeof raw.source.name !== "string" || !raw.source.name.trim()) errors.push("missing source name");
    try { if (new URL(String(raw.source.url)).protocol !== "https:") errors.push("unsafe source URL"); } catch { errors.push("invalid source URL"); }
    if (raw.source.filedAt !== null && !date(raw.source.filedAt)) errors.push("invalid filing date");
    if (!raw.notes.every(n => typeof n === "string") || raw.notes.length > 30) errors.push("invalid notes");
    if (raw.segmentBasis !== null && typeof raw.segmentBasis !== "string") errors.push("invalid segment basis");
    if (raw.segments.length > 30 || raw.segments.some(s => !isObject(s) || typeof s.name !== "string" || !finite(s.revenue))) { errors.push("invalid segments"); continue; }
    const period = raw as unknown as EarningsPeriod;
    errors.push(...incomeErrors(period));
    if (period.segments.length && !validEarningsSegments(period)) errors.push("segment revenue does not reconcile");
  }
  return { ok: errors.length === 0, errors };
}

export function earningsYearOverYear(period: EarningsPeriod, periods: EarningsPeriod[], metric: EarningsMetric): number | null {
  if (!date(period.end)) return null;
  const end = new Date(`${period.end}T00:00:00Z`);
  const current = period.income[metric];
  if (!finite(current)) return null;
  const prior = periods.filter(p => {
    if (!date(p.end)) return false;
    const gap = (end.getTime() - Date.parse(p.end)) / 86_400_000;
    return gap >= 350 && gap <= 380;
  }).sort((a, b) => Math.abs((end.getTime() - Date.parse(a.end)) / 86_400_000 - 365) - Math.abs((end.getTime() - Date.parse(b.end)) / 86_400_000 - 365))[0];
  const baseline = prior?.income[metric];
  return finite(baseline) && baseline > 0 ? ((current - baseline) / baseline) * 100 : null;
}

export function buildIncomeFlow(period: EarningsPeriod): IncomeFlow {
  const i = period.income;
  const nodes: IncomeFlowNode[] = [];
  const links: IncomeFlowLink[] = [];
  if (incomeErrors(period).length || metrics.filter(m => m !== "dilutedEps").some(m => !finite(i[m]))) {
    return { kind: "unavailable", nodes, links, reason: "손익 흐름을 연결할 수 있는 수치를 아직 확인하지 못했습니다." };
  }
  const amount = (key: EarningsMetric) => i[key] as number;
  const stages: [string, string][] = [["revenue", "매출"], ["grossProfit", "매출총이익"], ["operatingIncome", "영업이익"], ["pretaxIncome", "세전이익"], ["netIncome", "순이익"]];
  const hasSegments = validEarningsSegments(period);
  const offset = hasSegments ? 1 : 0;
  const node = (id: string, label: string, value: number, column: number, kind: IncomeFlowNode["kind"]) => nodes.push({ id, label, value, column, kind });
  const link = (from: string, to: string, value: number) => { if (value > 0) links.push({ from, to, value }); };
  for (const [index, [id, label]] of stages.entries()) node(id, label, amount(id as EarningsMetric), index + offset, index === 0 ? "income" : "profit");
  const other = amount("pretaxIncome") - amount("operatingIncome");
  const afterTaxOther = i.afterTaxOther ?? 0;
  if (metrics.filter(m => m !== "dilutedEps").some(m => amount(m) < 0)) {
    if (other !== 0) node(other > 0 ? "nonOperatingIncome" : "nonOperatingExpense", "영업외손익", other, offset + 3, other > 0 ? "income" : "expense");
    if (afterTaxOther !== 0) node("afterTaxOther", "세후 지분법손익", afterTaxOther, offset + 4, afterTaxOther > 0 ? "income" : "expense");
    return { kind: "bridge", nodes, links: [], reason: "적자·세금 환급을 포함한 실제 부호로 표시합니다." };
  }
  if (hasSegments) period.segments.forEach((segment, index) => { node(`segment-${index}`, segment.name, segment.revenue, 0, "income"); link(`segment-${index}`, "revenue", segment.revenue); });
  node("costOfRevenue", "매출원가", amount("costOfRevenue"), offset + 1, "expense");
  node("operatingExpenses", "영업비용", amount("operatingExpenses"), offset + 2, "expense");
  node("incomeTax", "법인세", amount("incomeTax"), offset + 4, "expense");
  link("revenue", "grossProfit", amount("grossProfit"));
  link("revenue", "costOfRevenue", amount("costOfRevenue"));
  link("grossProfit", "operatingIncome", amount("operatingIncome"));
  link("grossProfit", "operatingExpenses", amount("operatingExpenses"));
  if (other >= 0) {
    link("operatingIncome", "pretaxIncome", amount("operatingIncome"));
    if (other > 0) { node("nonOperatingIncome", "영업외손익·순증", other, offset + 2, "income"); link("nonOperatingIncome", "pretaxIncome", other); }
  } else {
    link("operatingIncome", "pretaxIncome", amount("pretaxIncome"));
    node("nonOperatingExpense", "영업외손익·순감", -other, offset + 3, "expense");
    link("operatingIncome", "nonOperatingExpense", -other);
  }
  link("pretaxIncome", "netIncome", amount("netIncome") - Math.max(0, afterTaxOther));
  if (afterTaxOther !== 0) {
    node("afterTaxOther", "세후 지분법손익", Math.abs(afterTaxOther), offset + (afterTaxOther > 0 ? 3 : 4), afterTaxOther > 0 ? "income" : "expense");
    if (afterTaxOther > 0) link("afterTaxOther", "netIncome", afterTaxOther);
    else link("pretaxIncome", "afterTaxOther", -afterTaxOther);
  }
  link("pretaxIncome", "incomeTax", amount("incomeTax"));
  return { kind: "sankey", nodes, links, reason: null };
}

export function asEarningsDocument(value: unknown): EarningsDocument | null {
  return validateEarningsDocument(value).ok ? value as EarningsDocument : null;
}
