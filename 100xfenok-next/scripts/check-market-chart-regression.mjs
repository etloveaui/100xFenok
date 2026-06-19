/* eslint-disable no-console */
import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:4173";
const routes = (process.env.QA_MARKET_CHART_ROUTES || "/market-valuation,/market-valuation/structure")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);

function routeUrl(route) {
  return new URL(route, baseUrl).toString();
}

async function readText(locator) {
  try {
    return (await locator.innerText()).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

async function inspectRoute(page, route) {
  const response = await page.goto(routeUrl(route), { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[role="group"][aria-label*="방향키"] canvas', { timeout: 10_000 });
  await page.waitForTimeout(500);

  const chartGroups = page.locator('[role="group"][aria-label*="방향키"]');
  const statusRegions = page.locator('[role="status"][aria-atomic="true"]');
  const groupCount = await chartGroups.count();
  const statusCount = await statusRegions.count();
  const failures = [];

  if (response?.status() !== 200) {
    failures.push(`HTTP ${response?.status() ?? "unknown"}`);
  }
  if (groupCount === 0) {
    failures.push("no keyboard chart group");
  }
  if (statusCount === 0) {
    failures.push("no aria-live chart status region");
  }

  const sampleCount = Math.min(groupCount, 3);
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const group = chartGroups.nth(index);
    const canvas = group.locator('canvas[role="img"][aria-label]');
    const relatedStatus = statusRegions.nth(Math.min(index, Math.max(statusCount - 1, 0)));
    const canvasCount = await canvas.count();
    const before = await readText(relatedStatus);

    if (canvasCount === 0) {
      failures.push(`chart ${index + 1}: canvas missing role=img aria-label`);
      continue;
    }

    await group.scrollIntoViewIfNeeded();
    await group.focus();
    const hasFocus = await group.evaluate((node) => document.activeElement === node);
    if (!hasFocus) {
      failures.push(`chart ${index + 1}: chart group did not receive focus`);
      continue;
    }
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    const afterRight = await readText(relatedStatus);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(200);
    const afterLeft = await readText(relatedStatus);

    const keyboardReadoutChanged =
      (Boolean(afterRight) && afterRight !== before) ||
      (Boolean(afterLeft) && afterLeft !== before);
    if (!keyboardReadoutChanged) {
      failures.push(`chart ${index + 1}: arrow keys did not update status readout`);
    }

    samples.push({
      index: index + 1,
      canvasCount,
      before,
      afterLeft,
      afterRight,
    });
  }

  return {
    route,
    status: response?.status() ?? null,
    groupCount,
    statusCount,
    sampledCharts: sampleCount,
    failures,
    samples,
  };
}

async function main() {
  if (routes.length === 0) {
    throw new Error("No market chart routes configured.");
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const results = [];
  try {
    for (const route of routes) {
      results.push(await inspectRoute(page, route));
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const failures = results.flatMap((result) => result.failures.map((failure) => `${result.route}: ${failure}`));
  console.log(JSON.stringify({ total: results.length, failures: failures.length, failuresDetail: failures, results }, null, 2));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
