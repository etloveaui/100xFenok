import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium, webkit, type Page } from "playwright";
import { asEarningsDocument } from "../src/lib/earnings/model";
import type { EarningsDocument } from "../src/lib/earnings/types";

const base = (process.env.QA_BASE_URL ?? "http://127.0.0.1:3107").replace(/\/$/, "");
const live = process.env.EARNINGS_QA_LIVE === "1";
if (!live && !/^http:\/\/(127\.0\.0\.1|localhost):3107$/.test(base)) throw new Error("isolated earnings QA requires its own local hosted server");
if (live && new URL(base).hostname !== "100xfenok.etloveaui.workers.dev") throw new Error("live earnings QA requires the approved public origin");
const out = "test-results/earnings-overview";
mkdirSync(out, { recursive: true });
const tickers = ["AAPL", "AMZN", "MSFT", "META"];
const documents = new Map(tickers.map(ticker => {
  const document = asEarningsDocument(JSON.parse(readFileSync(path.resolve("../data/earnings-overview", `${ticker}.json`), "utf8")));
  assert.ok(document && document.ticker === ticker, `${ticker} must have a validated official document`);
  return [ticker, document] as const;
}));

async function assertNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.width + 2, `page overflows: ${JSON.stringify(dimensions)}`);
  const panel = page.locator("[data-earnings-overview]").first();
  const box = await panel.boundingBox();
  assert.ok(box && box.x >= -1 && box.x + box.width <= dimensions.width + 2, "earnings panel stays inside viewport");
}

async function verifyDocument(page: Page, ticker: string, compact: boolean) {
  const document = documents.get(ticker)!;
  const panel = page.locator(`[data-earnings-overview="${ticker}"]`);
  await panel.waitFor({ state: "visible", timeout: 90_000 });
  assert.equal(await panel.count(), 1, "exactly one shared earnings panel per surface");
  assert.equal(await panel.getAttribute("data-earnings-compact"), String(compact));
  assert.equal(await panel.locator("[data-earnings-metric]").count(), 4);
  const select = panel.locator("select");
  assert.equal(await select.inputValue(), document.periods[0].end);
  const source = panel.locator(`a[href="${document.periods[0].source.url}"]`);
  assert.equal(await source.count(), 1, "selected period links to its primary source");
  if (compact) {
    assert.equal(await panel.locator("[data-earnings-flow]").count(), 0, "compact flow is lazy");
    await panel.getByText("상세 손익 흐름 보기", { exact: false }).click();
  }
  await panel.locator('[data-earnings-flow="sankey"]').waitFor();
  if (document.periods.length > 1) {
    await select.focus();
    await select.selectOption(document.periods[1].end);
    assert.equal(await select.inputValue(), document.periods[1].end);
    assert.equal(await panel.locator(`a[href="${document.periods[1].source.url}"]`).count(), 1);
    await select.selectOption(document.periods[0].end);
    if (compact) await panel.getByText("상세 손익 흐름 보기", { exact: false }).click();
  }
  await assertNoOverflow(page);
}

async function main() {
  for (const engine of [{ name: "chromium", type: chromium }, { name: "webkit", type: webkit }]) {
    const browser = await engine.type.launch();
    try {
      for (const viewport of [{ name: "desktop", width: 1440, height: 1100 }, { name: "mobile", width: 390, height: 844 }]) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: "reduce" });
        if (!live) await context.route("**/data/earnings-overview/*.json", async route => {
          const ticker = new URL(route.request().url()).pathname.split("/").pop()!.replace(".json", "");
          const document = documents.get(ticker);
          await route.fulfill({ status: document ? 200 : 404, contentType: "application/json", body: JSON.stringify(document ?? {}) });
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        for (const ticker of viewport.name === "desktop" && engine.name === "chromium" ? tickers : ["AAPL"]) {
          await page.goto(`${base}/stock/${ticker}?tab=financials`, { waitUntil: "domcontentloaded" });
          await verifyDocument(page, ticker, false);
          await page.locator(`[data-earnings-overview="${ticker}"]`).screenshot({ path: `${out}/${engine.name}-${viewport.name}-${ticker}.png` });
        }
        await page.goto(`${base}/screener?ticker=AAPL`, { waitUntil: "domcontentloaded" });
        await verifyDocument(page, "AAPL", true);
        await page.locator('[data-earnings-overview="AAPL"]').screenshot({ path: `${out}/${engine.name}-${viewport.name}-screener.png` });
        assert.deepEqual(errors, [], "no uncaught browser exceptions");
        await context.close();
      }
      if (!live && engine.name === "chromium") {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        let requests = 0;
        await context.route("**/data/earnings-overview/AAPL.json", async route => {
          requests += 1;
          await route.fulfill({ status: requests === 1 ? 503 : 200, contentType: "application/json", body: JSON.stringify(requests === 1 ? {} : documents.get("AAPL")) });
        });
        const page = await context.newPage();
        await page.goto(`${base}/stock/AAPL?tab=financials`, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: "다시 불러오기", exact: true }).click({ timeout: 90_000 });
        await verifyDocument(page, "AAPL", false);
        assert.equal(requests, 2, "retry re-fetches a failed official document");
        await context.close();

        const lossContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const loss: EarningsDocument = structuredClone(documents.get("META")!);
        const income = loss.periods[0].income;
        income.operatingExpenses = income.grossProfit! + 5_000_000_000;
        income.operatingIncome = -5_000_000_000; income.pretaxIncome = -4_000_000_000;
        income.incomeTax = -1_000_000_000; income.netIncome = -3_000_000_000; income.dilutedEps = -1;
        await lossContext.route("**/data/earnings-overview/META.json", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(loss) }));
        const lossPage = await lossContext.newPage();
        await lossPage.goto(`${base}/stock/META?tab=financials`, { waitUntil: "domcontentloaded" });
        await lossPage.locator('[data-earnings-flow="bridge"]').waitFor({ timeout: 90_000 });
        await assertNoOverflow(lossPage);
        await lossPage.locator('[data-earnings-overview="META"]').screenshot({ path: `${out}/chromium-mobile-loss.png` });
        await lossContext.close();
      }
    } finally { await browser.close(); }
  }
  console.log("[earnings-browser] four official companies, shared surfaces, period selection, desktop/mobile, Chromium/WebKit, retry and signed loss passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
