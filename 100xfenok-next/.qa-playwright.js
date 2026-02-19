/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");

const base = process.env.QA_BASE_URL || "http://127.0.0.1:4173";
const baseOrigin = new URL(base).origin;

function isExternalUrl(url) {
  try {
    return new URL(url, base).origin !== baseOrigin;
  } catch {
    return false;
  }
}

function isExternalFetchNoise(message) {
  return (
    /\[DataFetcher\]\s*FRED/i.test(message) ||
    /Treasury API 실패/i.test(message) ||
    /TypeError:\s*Failed to fetch/i.test(message)
  );
}

function isNonBlockingConsoleNoise(message) {
  return (
    // 404 resource loading failures (Cloudflare "File not found" or Next.js "Not Found")
    // Covers: daily-wrap data JSON missing, admin sub-frame stubs, etc.
    /Failed to load resource: the server responded with a status of 404/i.test(message) ||
    // Daily wrap: JS console.error when today's report data file is missing
    /리포트 데이터를 불러오는 데 실패했습니다/i.test(message)
  );
}

function isDevServerNoise(message) {
  return (
    // HMR / Fast Refresh messages
    /\[HMR\]/i.test(message) ||
    /\[Fast Refresh\]/i.test(message) ||
    /webpack-hmr/i.test(message) ||
    // Turbopack compilation messages
    /turbopack/i.test(message) ||
    /\[Turbopack\]/i.test(message) ||
    // React hydration mismatch warnings (dev-only)
    /Hydration failed because/i.test(message) ||
    /There was an error while hydrating/i.test(message) ||
    /Text content does not match/i.test(message) ||
    /did not match\. Server/i.test(message) ||
    // Next.js internal dev messages
    /__nextjs/i.test(message) ||
    /__next/i.test(message) ||
    /next-router-state-tree/i.test(message) ||
    // Chunk load errors from hot reload
    /ChunkLoadError/i.test(message) ||
    /Loading chunk/i.test(message) ||
    // Dev server WebSocket reconnection
    /WebSocket connection/i.test(message) ||
    /\[webpack-dev-server\]/i.test(message) ||
    // React dev mode warnings
    /Warning: Each child in a list/i.test(message) ||
    /Warning: validateDOMNesting/i.test(message) ||
    /Download the React DevTools/i.test(message)
  );
}

const routes = [
  "/",
  "/market",
  "/alpha-scout",
  "/multichart",
  "/radar",
  "/ib",
  "/infinite-buying",
  "/vr",
  "/posts",
  "/sectors",
  // Week 2 routes
  "/100x/daily-wrap",
  "/admin/design-lab",
  "/admin/data-lab",
  "/admin/macro-monitor",
  "/this-route-should-not-exist",
];

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
  { name: "fold", width: 540, height: 720 },
];

const isDevServer = base.includes(":3000") || process.env.QA_DEV === "1";

async function prewarmRoutes() {
  if (!isDevServer) return;
  console.error("[QA] Dev server detected — pre-warming routes for Turbopack compilation...");
  const http = require("http");
  for (const route of routes) {
    await new Promise((resolve) => {
      const req = http.get(`${base}${route}`, (res) => {
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", resolve);
      req.setTimeout(60000, () => { req.destroy(); resolve(); });
    });
  }
  // Extra wait for compilation to settle
  await new Promise((r) => setTimeout(r, 3000));
  console.error("[QA] Pre-warm complete.");
}

(async () => {
  await prewarmRoutes();
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const vp of viewports) {
    let context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    let page = await context.newPage();

    for (const route of routes) {
      const item = {
        viewport: vp.name,
        route,
        status: null,
        navigationError: null,
        hasNav: null,
        hasFooter: null,
        hasIframe: null,
        iframeOverlapFooter: null,
        hasHorizontalScroll: null,
        hasMobileMenuButton: null,
        linkedChecks: [],
        errorCount: 0,
        warningCount: 0,
        blockingConsoleErrorCount: 0,
        nonBlockingConsoleErrorCount: 0,
        externalFetchErrorCount: 0,
        sameOriginRequestFailureCount: 0,
        externalRequestFailureCount: 0,
        blockingConsoleErrors: [],
        consoleErrors: [],
      };

      const consoleErrors = [];
      const consoleWarnings = [];
      const requestFailures = [];

      page.removeAllListeners("console");
      page.removeAllListeners("requestfailed");

      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
        if (msg.type() === "warning") consoleWarnings.push(msg.text());
      });
      page.on("requestfailed", (req) => {
        requestFailures.push({
          url: req.url(),
          errorText: req.failure()?.errorText || "request_failed",
        });
      });

      try {
        const response = await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded", timeout: isDevServer ? 90000 : 45000 });
        item.status = response ? response.status() : null;
      } catch (err) {
        item.navigationError = String(err);
        // Dev server: recover from page crash by recreating context
        if (isDevServer && /Page crashed|ERR_CONNECTION_REFUSED/i.test(String(err))) {
          try { await context.close(); } catch { /* ignore */ }
          context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
          page = await context.newPage();
        }
      }

      if (!item.navigationError) {
        try {
          await page.waitForTimeout(700);
          const snapshot = await page.evaluate(() => {
            const nav = document.querySelector("#mainNav");
            const footer = document.querySelector("footer");
            const iframe = document.querySelector("iframe");
            const menuOpen = document.querySelector('button[aria-label="Open menu"]');
            const html = document.documentElement;
            const isScrollable = html.scrollHeight > window.innerHeight + 1;

            let iframeOverlapFooter = null;
            if (iframe && footer) {
              const i = iframe.getBoundingClientRect();
              const f = footer.getBoundingClientRect();
              iframeOverlapFooter = i.bottom > f.top + 1 && !isScrollable;
            }

            return {
              hasNav: !!nav,
              hasFooter: !!footer,
              hasIframe: !!iframe,
              iframeOverlapFooter,
              isScrollable,
              hasHorizontalScroll: html.scrollWidth > window.innerWidth + 1,
              hasMobileMenuButton: !!menuOpen,
            };
          });
          Object.assign(item, snapshot);
        } catch (err) {
          item.navigationError = `snapshot_error: ${String(err)}`;
        }

        if (route === "/vr" || route === "/posts") {
          try {
            const hrefs = await page.$$eval("a[href]", (anchors) =>
              anchors
                .map((a) => a.getAttribute("href"))
                .filter((href) => !!href && href.startsWith("/"))
            );
            const unique = [...new Set(hrefs)].filter((href) =>
              route === "/vr" ? href.startsWith("/vr/") : href.startsWith("/posts/")
            );
            for (const href of unique.slice(0, 5)) {
              const res = await page.request.get(`${base}${href}`);
              item.linkedChecks.push({ href, status: res.status() });
            }
          } catch (err) {
            item.linkedChecks.push({ href: "__link_check_error__", status: 0, error: String(err) });
          }
        }
      }

      const blockingConsoleErrors = consoleErrors.filter(
        (msg) => !isExternalFetchNoise(msg) && !isNonBlockingConsoleNoise(msg) && !isDevServerNoise(msg)
      );
      const nonBlockingConsoleErrors = consoleErrors.filter((msg) => isNonBlockingConsoleNoise(msg));
      const externalFetchErrors = consoleErrors.filter((msg) => isExternalFetchNoise(msg));
      const sameOriginRequestFailures = requestFailures.filter((req) => !isExternalUrl(req.url));
      const externalRequestFailures = requestFailures.filter((req) => isExternalUrl(req.url));

      item.errorCount = consoleErrors.length;
      item.warningCount = consoleWarnings.length;
      item.blockingConsoleErrorCount = blockingConsoleErrors.length;
      item.nonBlockingConsoleErrorCount = nonBlockingConsoleErrors.length;
      item.externalFetchErrorCount = externalFetchErrors.length;
      item.sameOriginRequestFailureCount = sameOriginRequestFailures.length;
      item.externalRequestFailureCount = externalRequestFailures.length;
      item.blockingConsoleErrors = blockingConsoleErrors.slice(0, 3);
      item.consoleErrors = consoleErrors.slice(0, 3);

      results.push(item);

      if (route === "/" && vp.name !== "desktop" && !item.navigationError) {
        try {
          const open = page.locator('button[aria-label="Open menu"]');
          if (await open.count()) {
            await open.click();
            await page.waitForTimeout(200);
            const menuState = await page.evaluate(() => ({
              bodyOverflow: document.body.style.overflow || "",
              overlayVisible: document.querySelector(".mobile-overlay.visible") !== null,
            }));

            const overlay = page.locator('button[aria-label="Close mobile menu overlay"]');
            const closeButton = page.locator('button[aria-label="Close menu"]');
            let closeMethod = "overlay-left-click";

            if (await overlay.count()) {
              await page.mouse.click(12, Math.max(12, Math.floor(vp.height / 2)));
              await page.waitForTimeout(200);
            }

            let afterClose = await page.evaluate(() => ({
              bodyOverflow: document.body.style.overflow || "",
              overlayVisible: document.querySelector(".mobile-overlay.visible") !== null,
            }));

            if (afterClose.overlayVisible && (await closeButton.count())) {
              closeMethod = "close-button-fallback";
              await closeButton.click();
              await page.waitForTimeout(200);
              afterClose = await page.evaluate(() => ({
                bodyOverflow: document.body.style.overflow || "",
                overlayVisible: document.querySelector(".mobile-overlay.visible") !== null,
              }));
            }

            results.push({ viewport: vp.name, route: "/", check: "mobileMenuToggle", closeMethod, menuState, afterClose });
          }
        } catch (err) {
          results.push({ viewport: vp.name, route: "/", check: "mobileMenuToggle", error: String(err) });
        }
      }
    }

    await context.close();
  }

  await browser.close();

  const failures = results.filter((r) => {
    if (r.check === "mobileMenuToggle") return false;
    if (r.navigationError) return true;
    if (r.status && r.status >= 400 && r.route !== "/this-route-should-not-exist") return true;
    if (r.hasHorizontalScroll) return true;
    if (r.iframeOverlapFooter === true) return true;
    if (r.linkedChecks && r.linkedChecks.some((c) => c.status >= 400)) return true;
    // 404 test route: console errors from the 404 page itself are expected
    if (r.blockingConsoleErrorCount > 0 && r.route !== "/this-route-should-not-exist") return true;
    return false;
  });

  console.log(JSON.stringify({ total: results.length, failures: failures.length, failuresDetail: failures.slice(0, 60), results }, null, 2));
})();
