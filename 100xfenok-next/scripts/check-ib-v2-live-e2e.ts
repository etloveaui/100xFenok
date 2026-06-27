import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  DAILY_MULTI_SOXL,
  DAILY_MULTI_TQQQ,
  PROFILE_MULTI,
} from "../src/components/ib/v2/lib/__fixtures__/ib-v2-fixtures";

const baseUrl = process.env.IB_V2_E2E_BASE_URL || "http://127.0.0.1:3100";

function jsonpBody(callback: string | null, payload: unknown): string {
  const json = JSON.stringify(payload);
  return callback ? `${callback}(${json})` : json;
}

const prices: Record<string, number> = {
  TQQQ: DAILY_MULTI_TQQQ.payload.currentPrice,
  SOXL: DAILY_MULTI_SOXL.payload.currentPrice,
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  await page.route("https://script.google.com/**", async (route) => {
    const url = new URL(route.request().url());
    const callback = url.searchParams.get("callback");
    const ticker = String(url.searchParams.get("ticker") || "").toUpperCase();
    const current = prices[ticker] || 1;

    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: jsonpBody(callback, {
        ticker,
        current,
        priceSource: "FIXTURE",
      }),
    });
  });

  await page.addInitScript(
    ({ profile, dailyTqqq, dailySoxl }) => {
      localStorage.setItem("ib_profiles", JSON.stringify(profile));
      localStorage.setItem(dailyTqqq.storageKey, JSON.stringify(dailyTqqq.payload));
      localStorage.setItem(dailySoxl.storageKey, JSON.stringify(dailySoxl.payload));
    },
    {
      profile: PROFILE_MULTI,
      dailyTqqq: DAILY_MULTI_TQQQ,
      dailySoxl: DAILY_MULTI_SOXL,
    },
  );

  await page.goto(`${baseUrl}/ib?v2=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=멀티 티커", { timeout: 15_000 });
  await page.waitForSelector("text=TQQQ", { timeout: 15_000 });
  await page.waitForSelector("text=SOXL", { timeout: 15_000 });
  await page.waitForSelector("text=WEBAPP:FIXTURE", { timeout: 15_000 });

  const shellText = await page.locator(".ib-v2-shell").innerText({ timeout: 15_000 });
  for (const expected of ["멀티 티커", "TQQQ", "SOXL", "Order Plan", "WEBAPP:FIXTURE"]) {
    assert.ok(shellText.includes(expected), `missing expected UI text: ${expected}`);
  }

  assert.equal(shellText.includes("UPRO"), false, "disabled UPRO should not render");
  console.log(`[ib-v2-live-e2e] PASS fixture localStorage -> ${baseUrl}/ib?v2=1`);

  await browser.close();
}

main().catch((error) => {
  console.error("[ib-v2-live-e2e] FAIL", error);
  process.exit(1);
});
