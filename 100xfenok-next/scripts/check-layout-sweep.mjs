#!/usr/bin/env node
/**
 * Layout sweep: the defects a reader notices first, on every public product
 * route at the widths people use (320 to 1440), in one pass.
 *
 *   overflow   the page scrolls sideways (scrollWidth > clientWidth)
 *   offscreen  an element hangs past the viewport edge outside any scroll/clip box
 *   clipped    text cut off by overflow hidden/clip without an ellipsis
 *   overlap    two tap targets overlap and neither contains the other
 *   tiny       a tap target under 24x24 CSS px at a touch width (WCAG 2.2 AA
 *              2.5.8); links inside running text are exempt, as in the rule
 *   cls        cumulative layout shift while the page loads
 *
 * It is a ratchet, like the changed-file lint gate: no route x width may get
 * worse than qa-baselines/layout-sweep.json (counts may not rise).
 * `--update-baseline` writes the current run as the new bar, so a fix lowers
 * it for every later change. CLS is recorded but only gated with
 * QA_LAYOUT_GATE_CLS=1 (limit max(0.1, baseline + 0.05)): a single cold load
 * swings by 0.2 on the heavier pages, which would make the gate flap.
 *
 * Env: QA_BASE_URL (default http://127.0.0.1:3105), QA_LAYOUT_ROUTES,
 * QA_LAYOUT_WIDTHS, QA_LAYOUT_CONCURRENCY, QA_CHROMIUM_EXECUTABLE_PATH,
 * QA_LAYOUT_OUTPUT (report path).
 */
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = resolve(APP_ROOT, "qa-baselines/layout-sweep.json");
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3105";
const updateBaseline = process.argv.includes("--update-baseline");
const reportPath = resolve(process.env.QA_LAYOUT_OUTPUT || resolve(APP_ROOT, "test-results/layout-sweep/report.json"));
const concurrency = Math.max(1, Number(process.env.QA_LAYOUT_CONCURRENCY || 3));

export const DEFAULT_ROUTES = [
  "/",
  "/changes",
  "/market-valuation",
  "/market-valuation/structure",
  "/regime",
  "/market/events",
  "/sectors",
  "/macro-chart",
  "/screener",
  "/etfs",
  "/etfs/SPY",
  "/etfs/new",
  "/etfs/compare",
  "/superinvestors",
  "/portfolio",
  "/stock/NVDA",
  "/stock/NVDA?tab=financials",
  "/stock/NVDA?tab=estimates",
  "/research",
  "/vr",
];
export const DEFAULT_WIDTHS = [320, 375, 390, 430, 768, 1024, 1440];
const TOUCH_MAX_WIDTH = 767;
const METRICS = ["overflow", "offscreen", "clipped", "overlap", "tiny"];

const routes = (process.env.QA_LAYOUT_ROUTES ? process.env.QA_LAYOUT_ROUTES.split(",") : DEFAULT_ROUTES)
  .map((route) => route.trim())
  .filter(Boolean);
const widths = (process.env.QA_LAYOUT_WIDTHS ? process.env.QA_LAYOUT_WIDTHS.split(",") : DEFAULT_WIDTHS)
  .map((width) => Number(width))
  .filter((width) => Number.isFinite(width) && width > 0);

/** Runs in the page. Keep it self-contained: it is serialized into the browser. */
function measureLayout(touch) {
  const vw = document.documentElement.clientWidth;
  const clipsX = (el) => {
    const cs = getComputedStyle(el);
    return ["auto", "scroll", "hidden", "clip"].includes(cs.overflowX);
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    return !el.closest("[inert], [aria-hidden='true']");
  };
  const pinned = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") return true;
    }
    return false;
  };
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : "";
    const text = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24);
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
  };

  const overflow = Math.max(0, document.documentElement.scrollWidth - vw);

  const offscreenEls = [];
  const clippedEls = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !pinned(el)) {
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (clipsX(p)) { clipped = true; break; }
      }
      if (!clipped) offscreenEls.push(el);
    }
    const cs = getComputedStyle(el);
    // Screen-reader-only text is clipped to 1px on purpose.
    const srOnly = r.width <= 2 && r.height <= 2;
    if (!srOnly && (cs.overflowX === "hidden" || cs.overflowX === "clip") && cs.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 2) {
      const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
      if (ownText) clippedEls.push(el);
    }
  }
  // Report the outermost offender only: its descendants hang off for the same reason.
  const offscreen = offscreenEls.filter((el) => !offscreenEls.some((other) => other !== el && other.contains(el)));

  // The part of an element its scroll/clip ancestors let through; a card
  // scrolled out of an inner list is not on screen even though its box is.
  const shownRect = (el) => {
    const r = el.getBoundingClientRect();
    let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const pr = p.getBoundingClientRect();
      left = Math.max(left, pr.left); top = Math.max(top, pr.top);
      right = Math.min(right, pr.right); bottom = Math.min(bottom, pr.bottom);
    }
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };
  const targets = [...document.body.querySelectorAll("a[href], button, input:not([type='hidden']), select, textarea, summary, [role='button'], [role='tab'], [role='checkbox'], [role='switch']")]
    .filter((el) => visible(el) && !el.disabled)
    .filter((el) => { const r = shownRect(el); return r.width > 0 && r.height > 0; });
  const inlineLink = (el) => {
    if (el.tagName !== "A" || getComputedStyle(el).display !== "inline") return false;
    const parentText = (el.parentElement?.textContent || "").trim().length;
    return parentText > (el.textContent || "").trim().length + 10;
  };
  // A control wrapped in a <label> is tapped through the label, so the label's
  // box is the target (the screener's 18px checkboxes sit in 44px labels).
  const hitBox = (el) => {
    const label = el.tagName === "INPUT" ? el.closest("label") : null;
    const r = el.getBoundingClientRect();
    if (!label) return r;
    const lr = label.getBoundingClientRect();
    return lr.width * lr.height > r.width * r.height ? lr : r;
  };
  const tiny = touch
    ? targets.filter((el) => {
        const r = hitBox(el);
        return (r.width < 24 || r.height < 24) && !inlineLink(el);
      })
    : [];

  const flow = targets.filter((el) => !pinned(el));
  const overlapPairs = [];
  for (let i = 0; i < flow.length; i += 1) {
    const a = flow[i];
    const ra = shownRect(a);
    for (let j = i + 1; j < flow.length; j += 1) {
      const b = flow[j];
      if (a.contains(b) || b.contains(a)) continue;
      const rb = shownRect(b);
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 4 && h > 4) overlapPairs.push(`${describe(a)} × ${describe(b)}`);
    }
  }

  return {
    overflow,
    offscreen: offscreen.length,
    clipped: clippedEls.length,
    overlap: overlapPairs.length,
    tiny: tiny.length,
    cls: Math.round((window.__layoutSweepCls || 0) * 1000) / 1000,
    samples: {
      offscreen: offscreen.slice(0, 3).map(describe),
      clipped: clippedEls.slice(0, 3).map(describe),
      overlap: overlapPairs.slice(0, 3),
      tiny: tiny.slice(0, 5).map((el) => {
        const r = hitBox(el);
        return `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      }),
    },
  };
}

async function measure(browser, route, width) {
  const touch = width <= TOUCH_MAX_WIDTH;
  const context = await browser.newContext({
    viewport: { width, height: touch ? 844 : 900 },
    isMobile: touch,
    hasTouch: touch,
    deviceScaleFactor: 1,
  });
  await context.addCookies([{ name: "fx_browse", value: "1", url: baseUrl }]);
  await context.addInitScript(() => {
    window.__layoutSweepCls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__layoutSweepCls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // layout-shift unsupported: CLS reads 0
    }
  });
  const page = await context.newPage();
  try {
    await page.goto(new URL(route, baseUrl).toString(), { waitUntil: "load", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    return { route, width, ...(await page.evaluate(measureLayout, touch)) };
  } catch (error) {
    return { route, width, error: String(error).slice(0, 200) };
  } finally {
    await context.close();
  }
}

function key(route, width) {
  return `${route}@${width}`;
}

export function compareToBaseline(results, baseline, gateCls = process.env.QA_LAYOUT_GATE_CLS === "1") {
  const regressions = [];
  for (const result of results) {
    const previous = baseline?.entries?.[key(result.route, result.width)];
    if (result.error) {
      regressions.push({ key: key(result.route, result.width), metric: "error", was: previous ? "ok" : "n/a", now: result.error });
      continue;
    }
    if (!previous) continue;
    for (const metric of METRICS) {
      if (result[metric] > (previous[metric] ?? 0)) {
        regressions.push({ key: key(result.route, result.width), metric, was: previous[metric] ?? 0, now: result[metric] });
      }
    }
    const clsLimit = Math.max(0.1, (previous.cls ?? 0) + 0.05);
    if (gateCls && result.cls > clsLimit) {
      regressions.push({ key: key(result.route, result.width), metric: "cls", was: previous.cls ?? 0, now: result.cls });
    }
  }
  return regressions;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.QA_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const jobs = routes.flatMap((route) => widths.map((width) => ({ route, width })));
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next];
        next += 1;
        const result = await measure(browser, job.route, job.width);
        results.push(result);
        const flags = result.error
          ? `ERROR ${result.error.slice(0, 80)}`
          : METRICS.filter((metric) => result[metric] > 0).map((metric) => `${metric}=${result[metric]}`).join(" ");
        console.log(`[layout-sweep] ${key(job.route, job.width)} cls=${result.cls ?? "-"} ${flags}`);
      }
    }),
  );
  await browser.close();
  results.sort((a, b) => a.route.localeCompare(b.route) || a.width - b.width);

  const totals = Object.fromEntries(METRICS.map((metric) => [metric, results.reduce((sum, r) => sum + (r[metric] ?? 0), 0)]));
  const report = { schema: "layout-sweep/v1", base_url: baseUrl, measured_at: new Date().toISOString(), widths, routes, totals, results };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`[layout-sweep] ${results.length} pages · totals ${JSON.stringify(totals)} · report ${reportPath}`);

  if (updateBaseline) {
    const entries = Object.fromEntries(
      results
        .filter((r) => !r.error)
        .map((r) => [key(r.route, r.width), Object.fromEntries([...METRICS, "cls"].map((metric) => [metric, r[metric]]))]),
    );
    await mkdir(dirname(BASELINE_PATH), { recursive: true });
    await writeFile(BASELINE_PATH, `${JSON.stringify({ schema: "layout-sweep/v1", widths, routes, entries }, null, 1)}\n`);
    console.log(`[layout-sweep] baseline written: ${BASELINE_PATH} (${Object.keys(entries).length} entries)`);
    return;
  }

  let baseline = null;
  try {
    baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
  } catch {
    console.log("[layout-sweep] no baseline yet; run with --update-baseline to record one");
  }
  const regressions = compareToBaseline(results, baseline);
  if (regressions.length > 0) {
    for (const r of regressions) console.error(`[layout-sweep] REGRESSION ${r.key} ${r.metric}: ${r.was} -> ${r.now}`);
    process.exitCode = 1;
  } else {
    console.log("[layout-sweep] no regressions against the baseline");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
