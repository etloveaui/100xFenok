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
  const panel = page.locator("[data-earnings-overview]:visible");
  const box = await panel.boundingBox();
  assert.ok(box && box.x >= -1 && box.x + box.width <= dimensions.width + 2, `earnings panel stays inside viewport: ${JSON.stringify({ box, dimensions })}`);
}

async function verifyDocument(page: Page, ticker: string, compact: boolean) {
  const document = documents.get(ticker)!;
  // The screener retains desktop and mobile trees across CSS breakpoints.
  // Assert uniqueness in the active surface, excluding its hidden peer tree.
  const panel = page.locator(`[data-earnings-overview="${ticker}"]:visible`);
  try {
    await panel.waitFor({ state: "visible", timeout: 90_000 });
  } catch (error) {
    console.error("[earnings-browser] missing panel", { url: page.url(), ticker, compact, body: (await page.locator("body").innerText()).slice(0, 3000) });
    await page.screenshot({ path: `${out}/failure-${ticker}-${compact ? "screener" : "stock"}.png`, fullPage: true });
    throw error;
  }
  assert.equal(await panel.count(), 1, "exactly one visible shared earnings panel per surface");
  assert.equal(await panel.getAttribute("data-earnings-compact"), String(compact));
  assert.equal(await panel.locator("[data-earnings-metric]").count(), 4);
  const select = panel.locator("select");
  assert.equal(await select.inputValue(), document.periods[0].end);
  const source = panel.locator(`a[href="${document.periods[0].source.url}"]`);
  assert.equal(await source.count(), 1, "selected period links to its primary source");
  if (compact) {
    assert.equal(await panel.locator("[data-earnings-flow]").count(), 0, "compact flow is lazy");
    await panel.getByText("상세 손익 흐름 보기", { exact: false }).focus();
    await page.keyboard.press("Space");
  }
  await panel.locator('[data-earnings-flow="sankey"]').waitFor();
  for (const metric of ["revenue", "operatingIncome", "netIncome"] as const) {
    assert.equal(await panel.locator(`[data-earnings-flow-node="${metric}"]`).getAttribute("data-flow-value"), String(document.periods[0].income[metric]), `${ticker} ${metric} matches the verified official document`);
  }
  assert.equal(await panel.locator('[data-earnings-metric="dilutedEps"] strong').textContent(), `$${document.periods[0].income.dilutedEps!.toFixed(2)}`, `${ticker} displayed EPS is official GAAP`);
  if (document.periods.length > 1) {
    await select.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await select.inputValue(), document.periods[1].end);
    assert.equal(await panel.locator(`a[href="${document.periods[1].source.url}"]`).count(), 1);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    if (compact) await panel.getByText("상세 손익 흐름 보기", { exact: false }).click();
  }
  const scrollRegion = panel.getByRole("region", { name: "손익 흐름 가로 스크롤" });
  if (await scrollRegion.count()) {
    const bounds = await scrollRegion.evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
    if (page.viewportSize()!.width < 600) {
      assert.ok(bounds.content > bounds.width, "mobile income flow has reachable horizontal content");
      await scrollRegion.focus();
      await page.keyboard.press("End");
    } else if (page.viewportSize()!.width >= 1200) {
      assert.ok(bounds.content <= bounds.width + 2, "desktop income flow includes the final profit labels without horizontal clipping");
    }
    assert.equal(await scrollRegion.getAttribute("tabindex"), "0");
  }
  if (page.viewportSize()!.width < 600) {
    for (const comparison of await panel.locator("[data-earnings-comparison]").getByText(/^직전 분기 /).all()) {
      const textFits = await comparison.evaluate(el => el.scrollWidth <= el.clientWidth + 1);
      assert.ok(textFits, "mobile previous-quarter value and change remain fully readable");
    }
  }
  await assertNoOverflow(page);
}

async function capturePanel(page: Page, ticker: string, name: string) {
  const viewport = page.viewportSize()!;
  const panel = page.locator(`[data-earnings-overview="${ticker}"]:visible`);
  if (await panel.getAttribute("data-earnings-compact") === "true") {
    // Capture real scroll positions inside the screener's bounded table/list;
    // a full element screenshot would include regions clipped by that ancestor.
    await panel.locator("header").evaluate(el => el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
    await page.screenshot({ path: `${out}/${name}-summary.png` });
    await panel.locator("[data-earnings-comparison]").evaluate(el => el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
    await page.screenshot({ path: `${out}/${name}-comparison.png` });
    const flow = panel.getByRole("region", { name: "손익 흐름 가로 스크롤" });
    await flow.evaluate(el => {
      el.scrollLeft = 0;
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    });
    await page.screenshot({ path: `${out}/${name}-flow-start.png` });
    if (viewport.width < 600) {
      await flow.evaluate(el => { el.scrollLeft = el.scrollWidth; });
      await page.screenshot({ path: `${out}/${name}-flow-end.png` });
    }
    return;
  }
  const box = await panel.boundingBox();
  assert.ok(box);
  try {
    // Preserve the tested width while giving the complete panel room below
    // the app's fixed navigation in the evidence capture.
    await page.setViewportSize({ width: viewport.width, height: Math.ceil(box.height) + 220 });
    await panel.evaluate(el => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 150, behavior: "instant" }));
    await panel.screenshot({ path: `${out}/${name}.png` });
  } finally {
    await page.setViewportSize(viewport);
  }
}

async function main() {
  const failures: string[] = [];
  for (const engine of [{ name: "chromium", type: chromium }, { name: "webkit", type: webkit }]) {
    const browser = await engine.type.launch();
    let activePage: Page | undefined;
    try {
      for (const viewport of [{ name: "desktop", width: 1440, height: 1100 }, { name: "mobile", width: 390, height: 844 }]) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: "reduce" });
        if (!live) await context.route("**/data/earnings-overview/*.json", async route => {
          const ticker = new URL(route.request().url()).pathname.split("/").pop()!.replace(".json", "");
          const document = documents.get(ticker);
          await route.fulfill({ status: document ? 200 : 404, contentType: "application/json", body: JSON.stringify(document ?? {}) });
        });
        const page = await context.newPage();
        activePage = page;
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        for (const ticker of viewport.name === "desktop" && engine.name === "chromium" ? tickers : ["AAPL"]) {
          await page.goto(`${base}/stock/${ticker}?tab=financials`, { waitUntil: "domcontentloaded" });
          await verifyDocument(page, ticker, false);
          await capturePanel(page, ticker, `${engine.name}-${viewport.name}-${ticker}`);
          console.log(`[earnings-browser] passed ${engine.name}/${viewport.name}/stock/${ticker}`);
        }
        if (engine.name === "chromium" && viewport.name === "desktop") {
          await page.goto(`${base}/stock/NVDA?tab=financials`, { waitUntil: "domcontentloaded" });
          await page.getByRole("tab", { name: "재무", exact: true }).waitFor({ timeout: 90_000 });
          assert.equal(await page.locator("[data-earnings-overview], [data-testid=earnings-overview-state]").count(), 0, "unsupported tickers keep the existing financial view without an empty earnings feature");
        }
        await page.goto(`${base}/screener?ticker=AAPL&mode=analyze`, { waitUntil: "domcontentloaded" });
        const expansion = page.getByRole("button", { name: /^AAPL 상세 (접기|펼치기)$/ });
        await expansion.waitFor({ state: "visible", timeout: 90_000 });
        if (await expansion.getAttribute("aria-expanded") === "true") await expansion.click();
        await page.getByRole("button", { name: "AAPL 상세 펼치기", exact: true }).click({ timeout: 90_000 });
        await verifyDocument(page, "AAPL", true);
        await capturePanel(page, "AAPL", `${engine.name}-${viewport.name}-screener`);
        assert.deepEqual(errors, [], "no uncaught browser exceptions");
        console.log(`[earnings-browser] passed ${engine.name}/${viewport.name}/screener`);
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
        activePage = page;
        await page.goto(`${base}/stock/AAPL?tab=financials`, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: "다시 불러오기", exact: true }).click({ timeout: 90_000 });
        await verifyDocument(page, "AAPL", false);
        assert.equal(requests, 2, "retry re-fetches a failed official document");
        await context.close();

        const refreshContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await refreshContext.addInitScript(() => {
          const originalNow = Date.now;
          (window as unknown as { earningsClockOffset: number }).earningsClockOffset = 0;
          Date.now = () => originalNow() + (window as unknown as { earningsClockOffset: number }).earningsClockOffset;
        });
        const oldDocument = structuredClone(documents.get("AAPL")!);
        oldDocument.periods = oldDocument.periods.slice(1);
        let refreshRequests = 0;
        await refreshContext.route("**/data/earnings-overview/AAPL.json", async route => {
          refreshRequests += 1;
          const failed = refreshRequests === 2;
          await route.fulfill({ status: failed ? 503 : 200, contentType: "application/json", body: JSON.stringify(failed ? {} : refreshRequests === 1 ? oldDocument : documents.get("AAPL")) });
        });
        const refreshPage = await refreshContext.newPage();
        activePage = refreshPage;
        await refreshPage.goto(`${base}/stock/AAPL?tab=financials`, { waitUntil: "domcontentloaded" });
        const refreshPanel = refreshPage.locator('[data-earnings-overview="AAPL"]');
        await refreshPanel.waitFor({ timeout: 90_000 });
        assert.equal(await refreshPanel.locator("select").inputValue(), oldDocument.periods[0].end);
        await refreshPage.getByRole("tab", { name: "요약", exact: true }).click();
        await refreshPage.evaluate(() => { (window as unknown as { earningsClockOffset: number }).earningsClockOffset = 360_000; });
        await refreshPage.getByRole("tab", { name: "재무", exact: true }).click();
        await refreshPage.getByRole("button", { name: "다시 불러오기", exact: true }).click({ timeout: 90_000 });
        await refreshPage.waitForFunction(end => document.querySelector('[data-earnings-overview="AAPL"] select') instanceof HTMLSelectElement && (document.querySelector('[data-earnings-overview="AAPL"] select') as HTMLSelectElement).value === end, documents.get("AAPL")!.periods[0].end);
        assert.equal(refreshRequests, 3, "cached source failure retains data, offers retry, and refresh selects latest quarter");
        await refreshContext.close();

        const lossContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const loss: EarningsDocument = structuredClone(documents.get("META")!);
        const income = loss.periods[0].income;
        income.operatingExpenses = income.grossProfit! + 5_000_000_000;
        income.operatingIncome = -5_000_000_000; income.pretaxIncome = -4_000_000_000;
        income.incomeTax = -1_000_000_000; income.netIncome = -3_000_000_000; income.dilutedEps = -1;
        await lossContext.route("**/data/earnings-overview/META.json", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(loss) }));
        const lossPage = await lossContext.newPage();
        activePage = lossPage;
        await lossPage.goto(`${base}/stock/META?tab=financials`, { waitUntil: "domcontentloaded" });
        await lossPage.locator('[data-earnings-flow="bridge"]').waitFor({ timeout: 90_000 });
        assert.equal(await lossPage.locator('[data-earnings-flow-node="nonOperatingIncome"]').getAttribute("data-flow-value"), "1000000000");
        const lossLabels = await lossPage.locator('[data-earnings-flow="bridge"] [data-earnings-flow-node] > span').allTextContents();
        assert.ok(lossLabels.length > 0 && lossLabels.every(label => label.trim().length > 0), "every signed financial value has an explicit label, including zero after-tax adjustments");
        await assertNoOverflow(lossPage);
        await capturePanel(lossPage, "META", "chromium-mobile-loss");
        await lossContext.close();
      }
    } catch (error) {
      if (activePage && !activePage.isClosed()) {
        const layout = await activePage.locator("[data-earnings-overview]:visible").first().evaluate(el => {
          const chain = [];
          for (let node: Element | null = el; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            chain.push({ tag: node.tagName, class: node.className, width: node.getBoundingClientRect().width, minWidth: style.minWidth, columns: style.gridTemplateColumns, overflow: style.overflow });
          }
          return chain;
        }).catch(() => []);
        console.error("[earnings-browser] failed interaction", { url: activePage.url(), layout, body: (await activePage.locator("body").innerText()).slice(0, 3000) });
        await activePage.screenshot({ path: `${out}/failure-${engine.name}.png`, fullPage: true }).catch(() => {});
      }
      failures.push(`${engine.name}: ${String(error)}`);
    } finally { await browser.close(); }
  }
  assert.deepEqual(failures, [], "all browser engines must pass; failures in one engine do not suppress evidence from the other");
  console.log("[earnings-browser] four official companies, shared surfaces, period selection, desktop/mobile, Chromium/WebKit, retry and signed loss passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
