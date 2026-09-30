import assert from "node:assert/strict";
import { chromium } from "playwright";

// Only the ephemeral hosted runtime is admitted, never the owner's live site.
const origin = "http://127.0.0.1:3107";
const browser = await chromium.launch();
const results = [];
try {
  for (const route of ["/", "/market/events"]) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", (request) => {
      const url = new URL(request.request().url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
        return request.abort();
      }
      return request.continue();
    });
    const row = { route, ok: false, status: null, pageErrors: errors };
    try {
      const response = await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      row.status = response?.status() ?? null;
      assert.equal(row.status, 200, "page must return HTTP 200");
      assert.equal(new URL(page.url()).pathname.replace(/\/$/, ""), route.replace(/\/$/, ""), "unexpected redirect");
      await page.locator("main").first().waitFor({ state: "visible", timeout: 15_000 });
    // Observe client hydration and its asynchronous render errors before closing.
    await page.waitForTimeout(5500);
      const text = await page.locator("main").first().innerText();
      assert.ok(text.trim().length > 0, "main content must not be blank");
      assert.deepEqual(errors, [], "uncaught page errors");
      row.ok = true;
    } catch (error) {
      row.failure = error.message;
    } finally {
      results.push(row);
      console.log(JSON.stringify(row));
      await context.close();
    }
  }
  // Synthetic browser regression: malformed calendar -> visible failure ->
  // reconnect/focus -> recovered calendar, without reloading the page.
  const context = await browser.newContext({ serviceWorkers: "block" });
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
}
assert.ok(results.every((row) => row.ok), "runtime route smoke failed; inspect the per-route results");
