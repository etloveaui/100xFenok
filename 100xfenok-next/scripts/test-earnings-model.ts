import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EarningsDocument, EarningsPeriod } from "../src/lib/earnings/types";

async function main() {
  const path = new URL("../src/lib/earnings/model.ts", import.meta.url);
  assert.ok(existsSync(fileURLToPath(path)), "shared earnings model must exist");
  const { validateEarningsDocument, buildIncomeFlow, earningsYearOverYear } = await import(path.href);
  const period: EarningsPeriod = {
    end: "2026-06-30", label: "2026년 2분기", source: { name: "Company filing", url: "https://www.sec.gov/Archives/example", filedAt: "2026-07-30" },
    income: { revenue: 100, costOfRevenue: 40, grossProfit: 60, operatingExpenses: 20, operatingIncome: 40, pretaxIncome: 45, incomeTax: 10, netIncome: 35, dilutedEps: 2 },
    segments: [{ name: "Products", revenue: 70 }, { name: "Services", revenue: 30 }], segmentBasis: "Product revenue", notes: [],
  };
  const document: EarningsDocument = { schemaVersion: 1, ticker: "AAPL", companyName: "Apple", currency: "USD", updatedAt: "2026-07-30T20:00:00Z", status: "current", notice: null, periods: [period] };
  assert.equal(validateEarningsDocument(document).ok, true);
  const invalid = (change: (d: EarningsDocument) => void) => { const d = structuredClone(document); change(d); return validateEarningsDocument(d).ok; };
  assert.equal(invalid(d => { d.periods[0].income.revenue = Number.NaN; }), false, "NaN is not a usable financial observation");
  assert.equal(invalid(d => { d.periods[0].income.grossProfit = 59; }), false, "income statement must reconcile");
  assert.equal(invalid(d => { d.periods[0].end = "2026-02-30"; }), false, "calendar-invalid period rejected");
  assert.equal(invalid(d => { d.periods[0].source.url = "javascript:alert(1)"; }), false, "only safe primary source links");
  assert.equal(invalid(d => { d.periods.push(structuredClone(d.periods[0])); }), false, "duplicate quarter rejected");
  assert.equal(invalid(d => { d.periods[0].segments[0].revenue = 69; }), false, "segment subtotal cannot silently miss revenue");
  const missing = structuredClone(period); missing.income.dilutedEps = null;
  assert.equal(validateEarningsDocument({ ...document, periods: [missing] }).ok, true, "missing EPS stays unavailable, not zero");
  const flow = buildIncomeFlow(period);
  assert.equal(flow.kind, "sankey");
  assert.ok(flow.links.every((l: {value: number}) => Number.isFinite(l.value) && l.value > 0));
  assert.equal(flow.links.find((l: {from: string}) => l.from === "nonOperatingIncome")?.value, 5, "other income enters before tax");
  for (const node of flow.nodes) {
    const incoming = flow.links.filter((l: {to: string}) => l.to === node.id).reduce((s: number,l: {value: number}) => s+l.value,0);
    const outgoing = flow.links.filter((l: {from: string}) => l.from === node.id).reduce((s: number,l: {value: number}) => s+l.value,0);
    if (incoming > 0 && outgoing > 0) assert.ok(Math.abs(incoming-outgoing) < 1e-9, node.id+" conserves its flow");
  }
  const loss = structuredClone(period); loss.segments=[]; loss.segmentBasis=null;
  loss.income.operatingExpenses=80; loss.income.operatingIncome=-20; loss.income.pretaxIncome=-15; loss.income.incomeTax=0; loss.income.netIncome=-15;
  assert.equal(buildIncomeFlow(loss).kind,"bridge", "losses require signed presentation instead of negative Sankey widths");
  assert.equal(buildIncomeFlow(loss).nodes.find((n: {id: string}) => n.id === "nonOperatingIncome")?.value, 5, "signed bridge preserves non-operating income");
  const taxCredit=structuredClone(period); taxCredit.income.incomeTax=-5;taxCredit.income.netIncome=50;
  assert.equal(buildIncomeFlow(taxCredit).kind,"bridge", "tax credit remains explicitly signed");
  const otherExpense=structuredClone(period);otherExpense.income.pretaxIncome=35;otherExpense.income.netIncome=25;
  const expenseFlow=buildIncomeFlow(otherExpense);
  assert.equal(expenseFlow.kind,"sankey");
  assert.equal(expenseFlow.links.find((l: {to: string})=>l.to==="nonOperatingExpense")?.value,5);
  const unavailable=structuredClone(period);unavailable.income.grossProfit=null;
  assert.equal(buildIncomeFlow(unavailable).kind,"unavailable");
  const prior=structuredClone(period); prior.end="2025-06-30";prior.income.revenue=80;prior.income.dilutedEps=1.5;
  assert.equal(earningsYearOverYear(period,[period,prior],"revenue"),25);
  const wrongQuarter=structuredClone(prior);wrongQuarter.end="2025-03-31";
  assert.equal(earningsYearOverYear(period,[period,wrongQuarter],"revenue"),null,"do not compare adjacent fiscal quarters");
  prior.income.dilutedEps=-1;
  assert.equal(earningsYearOverYear(period,[prior],"dilutedEps"),null,"negative baseline needs turnaround disclosure, not misleading percentage");
  console.log("[earnings-model] validation, flow conservation, missing/loss cases and period-aware growth passed");
}
main().catch(error => { console.error(error); process.exitCode=1; });
