import { test, expect } from "@playwright/test";

// Deliberately bypass ./fixtures: live dates, live responses, no HAR or stubs.
// One dispatch observes each route/viewport once. Findings remain in artifacts.
test.setTimeout(90_000);
let editionDates: Record<string, string> = {};
let indexError: string | null = null;
let verificationHeaders: Record<string, string> = {};
test.beforeEach(async ({ context }) => {
  const origin = new URL(process.env.QA_BASE_URL!).origin;
  await context.route(url => url.origin === origin, async route => {
    await route.continue({ headers: { ...route.request().headers(), ...verificationHeaders } });
  });
});

function expectedSandboxServiceWorkerError(routeName: string, message: string): boolean {
  return routeName === "digest" && /service\s*worker/i.test(message)
    && /sandbox/i.test(message) && /allow-same-origin/i.test(message);
}
test.beforeAll(async ({ request }) => {
  if (!process.env.QA_BASE_URL) throw new Error("Live observation requires QA_BASE_URL");
  const { liveRequestHeaders } = await import("../../../scripts/lib/live-request-headers.mjs");
  verificationHeaders = liveRequestHeaders();
  try {
    const response = await request.get("/data/briefing/index.json", { timeout: 30_000, headers: verificationHeaders });
    if (!response.ok()) throw new Error(`briefing index HTTP ${response.status()}`);
    const index = await response.json();
    for (const product of ["morning", "digest"]) {
      const date = index?.latest?.[product];
      if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
          && index.editions?.some((row: { product: string; edition_date: string }) => row.product === product && row.edition_date === date)) {
        editionDates[product] = date;
      }
    }
  } catch (error) { indexError = String(error); }
});

const routes = [
  ["home", "/"], ["screener", "/screener"],
  ["screener-detail", "/screener?ticker=NVDA"], ["stock-nvda", "/stock/NVDA"],
  ["market-valuation", "/market-valuation"], ["market-events", "/market/events"],
  ["regime", "/regime"], ["sectors", "/sectors"], ["etfs", "/etfs"],
  ["etf-spy", "/etfs/SPY"], ["superinvestors", "/superinvestors"],
  ["macro-chart", "/macro-chart"], ["brief", "/brief"],
  ["morning", null], ["digest", null],
] as const;

for (const viewport of [{ width: 412, height: 844 }, { width: 1920, height: 1080 }]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport, isMobile: viewport.width === 412, hasTouch: viewport.width === 412 });
    for (const [name, staticPath] of routes) {
      test(name, async ({ page }, testInfo) => {
        const route = staticPath ?? (editionDates[name] ? `/brief/${name}/${editionDates[name]}` : null);
        const pageErrors: string[] = [];
        const expectedPageErrors: string[] = [];
        const unexpectedPageErrors: string[] = [];
        const consoleErrors: Array<{ text: string; location: unknown }> = [];
        const failedRequests: Array<{ url: string; method: string; error: string | null }> = [];
        const httpErrors: Array<{ url: string; status: number }> = [];
        const observation: Record<string, unknown> = {
          name, route, viewport, observed_at: new Date().toISOString(),
          briefing_index_error: indexError, pageErrors, expectedPageErrors, unexpectedPageErrors, consoleErrors, failedRequests, httpErrors,
          expected_data_notes: "Anonymous /api/user/me 401 and partial-data source-date badges are observations, not failures.",
          date_interpretation: "Raw visible dates; compare with source cadence/calendar, not simply today.",
        };
        page.on("pageerror", error => {
          pageErrors.push(error.message);
          (expectedSandboxServiceWorkerError(name, error.message) ? expectedPageErrors : unexpectedPageErrors).push(error.message);
        });
        page.on("console", message => {
          if (message.type() === "error") consoleErrors.push({ text: message.text(), location: message.location() });
        });
        page.on("requestfailed", request => failedRequests.push({
          url: request.url(), method: request.method(), error: request.failure()?.errorText ?? null,
        }));
        page.on("response", response => {
          if (response.status() < 200 || response.status() >= 300) httpErrors.push({ url: response.url(), status: response.status() });
        });
        let failure: string | null = null;
        try {
          if (!route) throw new Error(`No valid latest ${name} edition in live index`);
          const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 30_000 });
          observation.status = response?.status() ?? null;
          await page.locator("main").first().waitFor({ state: "visible", timeout: 15_000 });
          await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
          await page.waitForTimeout(1500);
          if (name === "screener-detail") {
            // The ticker query filters rows; expanding the row opens the panel.
            if (viewport.width === 412) {
              await page.getByRole("button", { name: "NVDA 상세 펼치기", exact: true }).click();
            } else {
              await page.locator('[data-testid="screener-desktop-row"][data-ticker="NVDA"]:visible').first().click();
            }
            await expect(page.getByText("단기·장기 독립 진단", { exact: true }).first()).toBeVisible();
            observation.detail_open_action = "expanded NVDA result row";
          }
          // Trigger below-fold widgets without navigation or data mutation.
          let scannedToBottom = false;
          for (let step = 0; step < 20; step++) {
            scannedToBottom = await page.evaluate(() => {
              window.scrollBy(0, window.innerHeight * 0.8);
              return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
            });
            await page.waitForTimeout(150);
            if (scannedToBottom) break;
          }
          observation.scanned_to_bottom = scannedToBottom;
          await page.evaluate(() => window.scrollTo(0, 0));
          observation.content = await page.evaluate(() => {
            const main = document.querySelector("main") as HTMLElement | null;
            const visible = (element: Element) => {
              const style = getComputedStyle(element);
              return element.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none";
            };
            const text = main?.innerText ?? "";
            const candidates = main?.querySelectorAll("section, article, [role=region], [data-slot=panel]") ?? [];
            const widgets = Array.from(candidates).filter(visible).map(element => ({
              tag: element.tagName, id: element.id,
              heading: element.querySelector("h1,h2,h3,h4")?.textContent?.trim() ?? null,
              text: (element as HTMLElement).innerText,
              charts: element.querySelectorAll("canvas,svg").length,
              busy: element.querySelectorAll('[aria-busy="true"],[role="progressbar"]').length,
            }));
            return {
              text,
              headings: Array.from(main?.querySelectorAll("h1,h2,h3,h4") ?? []).filter(visible).map(el => el.textContent?.trim()),
              widgets,
              empty_widget_candidates: widgets.filter(widget => !widget.text.trim() && widget.charts === 0),
              date_lines: text.split("\n").filter(line => /\d{4}[-./년]\s*\d{1,2}|기준일|기준 시|업데이트|as.of|updated/i.test(line)),
              times: Array.from(main?.querySelectorAll("time") ?? []).filter(visible).map(el => ({ text: el.textContent, datetime: el.getAttribute("datetime") })),
              unavailable_or_stale_lines: text.split("\n").filter(line => /데이터 없음|불러오지 못|오래됨|갱신 필요|stale|unavailable|no data/i.test(line)),
            };
          });
          if (name === "screener-detail") {
            observation.detail_panel_visible = await page.getByText("단기·장기 독립 진단", { exact: true }).first().isVisible();
          }
          expect(response?.status(), "document HTTP status").toBeLessThan(400);
          expect(await page.locator("main").first().innerText(), "main must contain visible text").not.toMatch(/^\s*$/);
          if (name === "screener-detail") expect(observation.detail_panel_visible, "NVDA detail panel").toBe(true);
          expect(unexpectedPageErrors, "uncaught page errors excluding the recorded digest sandbox serviceWorker restriction").toEqual([]);
        } catch (error) { failure = String(error); }
        finally {
          observation.final_url = page.url();
          observation.failure = failure;
          try {
            await testInfo.attach("screen", { body: await page.screenshot({ fullPage: true, timeout: 10_000 }), contentType: "image/png" });
          } catch (error) { observation.screenshot_error = String(error); }
          await testInfo.attach("observation", { body: Buffer.from(JSON.stringify(observation, null, 2)), contentType: "application/json" });
        }
        expect(failure, "inspect attached observation and screen").toBeNull();
      });
    }
  });
}
