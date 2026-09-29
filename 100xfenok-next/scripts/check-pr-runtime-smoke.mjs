import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

// Only the ephemeral hosted runtime is admitted, never the owner's live site.
const origin = "http://127.0.0.1:3107";
const output = ".qa-artifacts/pr-runtime";
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [390, 768, 1440]) {
    for (const route of ["/", "/market/events", "/screener", "/sectors", "/stock/NVDA", "/macro-chart"]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.addInitScript(() => {
        // Initial-load lab observation only, not a field/p75 CLS claim.
        window.__prCls = { value: 0, shifts: 0 };
        let start = 0, last = 0, sum = 0;
        if (!PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
          window.__prCls = null;
          return;
        }
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue;
            if (sum > 0 && entry.startTime - last < 1000 && entry.startTime - start < 5000) sum += entry.value;
            else { start = entry.startTime; sum = entry.value; }
            last = entry.startTime;
            window.__prCls.value = Math.max(window.__prCls.value, sum);
            window.__prCls.shifts += 1;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      const errors = [];
      let externalRequestsBlocked = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/*", (request) => {
        const url = new URL(request.request().url());
        if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
          externalRequestsBlocked += 1;
          return request.abort();
        }
        return request.continue();
      });
      const row = { width, route, ok: false, status: null, pageErrors: errors };
      try {
        const response = await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        row.status = response?.status() ?? null;
        assert.equal(row.status, 200, "page must return HTTP 200");
        assert.equal(new URL(page.url()).pathname.replace(/\/$/, ""), route.replace(/\/$/, ""), "unexpected redirect");
        await page.locator("main").first().waitFor({ state: "visible", timeout: 15_000 });
        await page.waitForTimeout(5500);
        row.initialLoadCls = await page.evaluate(() => window.__prCls);
        const text = await page.locator("main").first().innerText();
        assert.ok(text.trim().length > 80, "main content must not be blank or a bare spinner");
        assert.deepEqual(errors, [], "uncaught page errors");
        row.ok = true;
        if ((route === "/" && width === 390) || (route === "/market/events" && width === 1440)) {
          await page.screenshot({ path: `${output}/${route === "/" ? "home" : "events"}-${width}.png` });
        }
      } catch (error) {
        row.failure = error.message;
      } finally {
        row.externalRequestsBlocked = externalRequestsBlocked;
        results.push(row);
        console.log(JSON.stringify(row));
        await context.close();
      }
    }
  }
  // Synthetic browser regression: malformed calendar -> visible failure ->
  // reconnect/focus -> recovered calendar, without reloading the page.
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: "block" });
  let recover = false;
  let calls = 0;
  await context.route("**/*", (request) => {
    const url = new URL(request.request().url());
    if (url.origin !== origin) return request.abort();
    if (url.pathname === "/data/calendar/usd-calendar.json") {
      calls += 1;
      const body = recover ? {
        generated_at: new Date().toISOString(),
        range: { time_max: new Date(Date.now() + 180 * 86_400_000).toISOString() },
        events: [{ id: "return-regression", status: "confirmed", importance: "H", category: "EMP",
          date_kst: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
          time_kst: "21:30", title_ko: "탭 복귀 검증 일정" }],
      } : { error: "synthetic unavailable" };
      return request.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    return request.continue();
  });
  const page = await context.newPage();
  const row = { scenario: "synthetic-calendar-return", ok: false };
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("[data-home-week-ahead]")?.textContent?.includes("캘린더를 읽지 못했습니다"));
    recover = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(() => document.querySelector("[data-home-week-ahead]")?.textContent?.includes("탭 복귀 검증 일정"));
    assert.ok(calls >= 2, "tab return must issue a recovery request");
    row.ok = true;
  } catch (error) {
    row.failure = error.message;
  } finally {
    results.push(row);
    console.log(JSON.stringify(row));
    await context.close();
  }
} finally {
  await browser.close();
  fs.writeFileSync(`${output}/summary.json`, `${JSON.stringify(results, null, 2)}\n`);
}
assert.ok(results.every((row) => row.ok), "runtime route smoke failed; inspect the per-route results");
