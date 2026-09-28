import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

async function main() {
// Public browse mode only. Run after the audited revision has deployed.
const origin = "https://100xfenok.etloveaui.workers.dev";
const output = "test-results/data-integrity";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const receipts: Record<string, unknown>[] = [];
let failed = false;
try {
  for (const width of [390, 1440]) {
    for (const mode of ["unavailable", "live"] as const) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.addCookies([{ name: "fx_browse", value: "1", url: origin }]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        if (mode === "unavailable") {
          await context.route("**/*", (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin === origin && ["fetch", "xhr"].includes(request.resourceType())
              && (url.pathname.startsWith("/data/") || url.pathname.startsWith("/api/data/"))) {
              return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
            }
            return route.continue();
          });
        }
        await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.getByRole("heading", { name: "오늘 시장", exact: true }).waitFor({ timeout: 30000 });
        if (mode === "unavailable") {
          await page.getByText("필수 시장 입력을 확인한 뒤 시장 판단을 표시합니다.", { exact: true }).waitFor({ timeout: 15000 });
          const text = await page.locator("body").innerText();
          assert.ok(text.includes("판단 대기"));
          assert.doesNotMatch(text, /현재 스트레스 0점|11개 중 0개 상승/);
        } else {
          for (const ticker of ["SPY", "QQQ"]) {
            const signal = await context.request.get(`${origin}/api/data/fenok-etf-signals/${ticker}?audit=${Date.now()}`);
            assert.equal(signal.status(), 200, `${ticker} signal API`);
            assert.equal((await signal.json()).ticker, ticker);
          }
          // Give the dashboard's bounded requests time to settle; legitimate
          // partial-source waiting remains acceptable, fabricated verdicts do not.
          await page.waitForTimeout(4000);
        }
        assert.deepEqual(errors, [], "hydrated page must not throw");
        await page.screenshot({ path: `${output}/home-${mode}-${width}.png`, fullPage: true });
        receipts.push({ width, mode, result: "passed", errors });
      } catch (error) {
        failed = true;
        receipts.push({ width, mode, result: "failed", error: String(error), errors });
        await page.screenshot({ path: `${output}/home-${mode}-${width}-failed.png`, fullPage: true }).catch(() => {});
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  writeFileSync(`${output}/receipt.json`, JSON.stringify(receipts, null, 2));
  console.log(JSON.stringify(receipts));
}
if (failed) process.exitCode = 1;
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
