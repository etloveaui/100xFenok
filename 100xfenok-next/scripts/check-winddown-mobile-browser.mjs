#!/usr/bin/env node

import { chromium } from "playwright";

const args = process.argv.slice(2);
const baseUrl = readArg("--base-url");
const adminPassword = process.env.QA_ADMIN_PASSWORD ?? "";
const executablePath = process.env.QA_BROWSER_EXECUTABLE_PATH?.trim() || undefined;

const ROUTES = [
  { id: "home", path: "/winddown/" },
  { id: "learn", path: "/winddown/learn/" },
  { id: "review", path: "/winddown/review/" },
  { id: "drill", path: "/winddown/drill/" },
  { id: "game", path: "/winddown/game/" },
  { id: "roleplay", path: "/winddown/roleplay/" },
  { id: "live-talk", path: "/winddown/live-talk/" },
];

const VIEWPORTS = [
  {
    id: "iphone-390",
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    reducedMotion: "no-preference",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  {
    id: "iphone-375",
    viewport: { width: 375, height: 667 },
    screen: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  },
  {
    id: "android-360",
    viewport: { width: 360, height: 800 },
    screen: { width: 360, height: 800 },
    deviceScaleFactor: 3,
    reducedMotion: "no-preference",
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  },
];

const LIVE_URL = /(?:\/api\/(?:mona-vnext\/session|winddown\/live\/(?:session|report))|generativelanguage\.googleapis\.com|google\.ai\.generativelanguage)/i;
const IDLE_HINT_WAIT_MS = 3_300;

function readArg(name) {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).replace(/\/+$/, "");
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1]?.replace(/\/+$/, "") ?? "";
  return "";
}

function result(status, id, detail) {
  return { status, id, detail };
}

function print(item) {
  console.log(`${item.status} ${item.id} - ${item.detail}`);
}

function assertArgs() {
  if (!baseUrl) throw new Error("usage: node scripts/check-winddown-mobile-browser.mjs --base-url <https://host>");
  if (!adminPassword) throw new Error("QA_ADMIN_PASSWORD is required to create the browser-only admin session");
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`unsupported --base-url protocol: ${parsed.protocol}`);
  }
  return parsed;
}

async function createAdminSession(base) {
  const response = await fetch(new URL("/api/admin/session/", base), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Cache-Control": "no-cache, no-store",
    },
    body: JSON.stringify({ password: adminPassword }),
    redirect: "manual",
  });
  if (!response.ok) throw new Error(`admin session login returned HTTP ${response.status}`);
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/\bfenok_admin_session=([^;]+)/);
  if (!match) throw new Error("admin session login did not return fenok_admin_session");
  return match[1];
}

async function inspectViewport(page, route, viewport) {
  const consoleErrors = [];
  const pageErrors = [];
  const blockedPosts = [];
  const blockedLiveRequests = [];
  const blockedFailures = new Set();
  let learnResumeIntercepted = 0;
  let learnCardCount = null;

  const recordBlocked = (request, target) => {
    const entry = `${request.method()} ${request.url()}`;
    target.push(entry);
    blockedFailures.add(request.url());
  };

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (blockedFailures.has(request.url())) return;
    const failure = request.failure()?.errorText ?? "unknown";
    const requestUrl = new URL(request.url());
    if (failure.includes("ERR_ABORTED") && requestUrl.searchParams.has("_rsc")) {
      return;
    }
    pageErrors.push(`request failed ${request.method()} ${request.url()}: ${failure}`);
  });
  page.on("websocket", (socket) => {
    if (LIVE_URL.test(socket.url())) blockedLiveRequests.push(`WebSocket ${socket.url()}`);
  });

  await page.route("**/*", async (handler) => {
    const request = handler.request();
    const requestUrl = request.url();
    if (request.method() === "POST") {
      recordBlocked(request, blockedPosts);
      await handler.abort("blockedbyclient");
      return;
    }
    if (LIVE_URL.test(requestUrl)) {
      recordBlocked(request, blockedLiveRequests);
      await handler.abort("blockedbyclient");
      return;
    }

    const url = new URL(requestUrl);
    if (
      route.id === "learn"
      && request.method() === "GET"
      && url.pathname === "/api/winddown/study"
      && url.searchParams.get("mode") === "learn"
    ) {
      const response = await handler.fetch();
      const body = await response.json().catch(() => null);
      if (
        response.ok
        && body
        && typeof body === "object"
        && body.learnSession
        && typeof body.learnSession === "object"
      ) {
        learnCardCount = Array.isArray(body.cards) ? body.cards.length : null;
        body.learnSession.resumeState = null;
        learnResumeIntercepted += 1;
        await handler.fulfill({ response, json: body });
        return;
      }
      await handler.fulfill({ response });
      return;
    }
    await handler.continue();
  });

  const response = await page.goto(new URL(route.path, baseUrl).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  if (!response || response.status() >= 400) {
    return result("FAIL", `${viewport.id}-${route.id}-navigation`, `GET ${route.path} returned HTTP ${response?.status() ?? "no-response"}`);
  }

  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(350);
  const initial = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    layoutShiftCount: window.__windDownLayoutShifts?.length ?? 0,
    marker: performance.now(),
  }));

  if (route.id === "learn") await page.waitForTimeout(IDLE_HINT_WAIT_MS);

  const inspection = await page.evaluate(({ initialMarker, initialShiftCount, expectIdleHint }) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const controls = [...document.querySelectorAll("button, a, input[type=button], input[type=submit], [role=button]")]
      .map((element) => {
        const html = element;
        const style = window.getComputedStyle(html);
        const rect = html.getBoundingClientRect();
        const text = (html.textContent || html.getAttribute("aria-label") || "").trim();
        const tag = html.tagName;
        const className = typeof html.className === "string" ? html.className : "";
        const visible = style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0
          && rect.width > 0
          && rect.height > 0
          && rect.bottom > 0
          && rect.right > 0
          && rect.top < viewportHeight
          && rect.left < viewportWidth;
        const anchorLooksPrimary = tag !== "A" || /(?:rounded|\bbtn\b|min-h-|bg-\[|border)/.test(className);
        return {
          tag,
          text: text.slice(0, 80),
          className,
          visible,
          primary: tag !== "A" || anchorLooksPrimary,
          rect: { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom },
          viewportHeight,
        };
      })
      .filter((control) => control.visible && control.primary);
    const undersized = controls.filter((control) => {
      const skip = control.tag === "A"
        && /^\s*(skip|본문으로|콘텐츠로)/i.test(control.text)
        && (control.rect.bottom <= 0 || control.rect.top >= control.viewportHeight || control.className.includes("sr-only"));
      return !skip && (control.rect.width < 44 || control.rect.height < 44);
    });
    const infiniteAnimations = document.getAnimations()
      .filter((animation) => {
        const effect = animation.effect;
        if (!effect) return false;
        return effect.getTiming().iterations === Infinity && animation.playState === "running";
      })
      .map((animation) => animation.effect?.target instanceof Element
        ? animation.effect.target.tagName.toLowerCase()
        : "unknown")
      .slice(0, 8);
    const idleHintVisible = expectIdleHint
      ? [...document.querySelectorAll("[role=status]")].some((element) => {
          const style = window.getComputedStyle(element);
          return style.display !== "none"
            && style.visibility !== "hidden"
            && element.textContent?.includes("루미 힌트:");
        })
      : null;
    const lateLayoutShifts = (window.__windDownLayoutShifts ?? [])
      .slice(initialShiftCount)
      .filter((entry) => entry.startTime >= initialMarker && entry.value > 0.001)
      .map((entry) => entry.value);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth,
      undersized,
      infiniteAnimations,
      idleHintVisible,
      lateLayoutShifts,
    };
  }, {
    initialMarker: initial.marker,
    initialShiftCount: initial.layoutShiftCount,
    expectIdleHint: route.id === "learn",
  });

  const failures = [];
  if (initial.scrollWidth > initial.viewportWidth + 1 || inspection.scrollWidth > inspection.viewportWidth + 1) {
    failures.push(`horizontal overflow ${inspection.scrollWidth}/${inspection.viewportWidth}`);
  }
  if (inspection.undersized.length > 0) {
    failures.push(`controls under 44x44: ${inspection.undersized.map((control) => `${control.tag}:${control.text || "unlabelled"} ${Math.round(control.rect.width)}x${Math.round(control.rect.height)}`).join(", ")}`);
  }
  if (inspection.infiniteAnimations.length > 0) {
    failures.push(`infinite animations: ${inspection.infiniteAnimations.join(", ")}`);
  }
  if (route.id === "learn" && learnResumeIntercepted !== 1) {
    failures.push(`Learn GET resumeState interception count ${learnResumeIntercepted}, expected 1`);
  }
  if (route.id === "learn" && learnCardCount !== 5) {
    failures.push(`Learn GET card count ${learnCardCount ?? "missing"}, expected 5`);
  }
  if (route.id === "learn" && inspection.idleHintVisible !== true) {
    failures.push("idle hint was not visible after the idle delay");
  }
  if (route.id === "learn" && inspection.lateLayoutShifts.length > 0) {
    failures.push(`layout shift after idle hint: ${inspection.lateLayoutShifts.join(", ")}`);
  }
  if (blockedPosts.length > 0) failures.push(`page POST blocked: ${blockedPosts.join(", ")}`);
  if (blockedLiveRequests.length > 0) failures.push(`automatic Live request blocked: ${blockedLiveRequests.join(", ")}`);
  if (consoleErrors.length > 0) failures.push(`console errors: ${consoleErrors.join(" | ")}`);
  if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(" | ")}`);

  return result(
    failures.length === 0 ? "PASS" : "FAIL",
    `${viewport.id}-${route.id}`,
    failures.length === 0
      ? `GET-only inspection passed at ${viewport.viewport.width}x${viewport.viewport.height} (${viewport.reducedMotion})`
      : failures.join("; "),
  );
}

async function inspectAllRoutes(browser, base, sessionCookie) {
  const results = [];
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: viewport.viewport,
      screen: viewport.screen,
      deviceScaleFactor: viewport.deviceScaleFactor,
      userAgent: viewport.userAgent,
      isMobile: true,
      hasTouch: true,
      reducedMotion: viewport.reducedMotion,
    });
    await context.addCookies([{
      name: "fenok_admin_session",
      value: sessionCookie,
      domain: base.hostname,
      path: "/",
      secure: base.protocol === "https:",
      sameSite: "Lax",
    }]);
    for (const route of ROUTES) {
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__windDownLayoutShifts = [];
        if (typeof PerformanceObserver === "undefined") return;
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) {
                window.__windDownLayoutShifts.push({
                  startTime: entry.startTime,
                  value: entry.value,
                });
              }
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch {
          // Older mobile engines may not expose layout-shift entries.
        }
      });
      try {
        results.push(await inspectViewport(page, route, viewport));
      } finally {
        await page.close();
      }
    }
    await context.close();
  }
  return results;
}

async function main() {
  const base = assertArgs();
  const sessionCookie = await createAdminSession(base);
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const results = await inspectAllRoutes(browser, base, sessionCookie);
    for (const item of results) print(item);
    for (const item of [
      result("WARN", "physical-microphone", "[not verified] browser preflight never requests microphone permission"),
      result("WARN", "physical-iphone-stt", "[not verified] emulation cannot prove iPhone Safari STT"),
      result("WARN", "physical-gemini-live", "[not verified] automatic Gemini/live-session requests are blocked by design"),
      result("WARN", "physical-background-resume", "[not verified] requires a real device background/resume observation"),
    ]) print(item);
    if (results.some((item) => item.status === "FAIL")) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(`FAIL mobile-browser-preflight - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
