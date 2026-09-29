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
        await page.waitForTimeout(1500);
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
} finally {
  await browser.close();
  fs.writeFileSync(`${output}/summary.json`, `${JSON.stringify(results, null, 2)}\n`);
}
assert.ok(results.every((row) => row.ok), "runtime route smoke failed; inspect the per-route results");
