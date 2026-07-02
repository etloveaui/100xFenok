#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_OUTPUT = path.resolve(APP_ROOT, "../data/admin/pro-density-baseline.json");

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3105";
const browserChannel = process.env.QA_BROWSER_CHANNEL || "";
const browserExecutablePath = process.env.QA_CHROMIUM_EXECUTABLE_PATH || "";
const outputPath = path.resolve(process.env.QA_PRO_DENSITY_OUTPUT || DEFAULT_OUTPUT);

const routes = (process.env.QA_PRO_DENSITY_ROUTES || "/stock/NVDA?tab=financials,/screener,/superinvestors?tab=insights,/portfolio,/market-valuation")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);

const viewportCatalog = {
  mobile: { width: 390, height: 844 },
  narrow: { width: 375, height: 812 },
  desktop: { width: 1280, height: 900 },
};

const requestedViewports = (process.env.QA_PRO_DENSITY_VIEWPORTS || process.env.QA_MOBILE_UX_VIEWPORTS || "mobile,narrow,desktop")
  .split(",")
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);

const viewports = requestedViewports
  .map((name) => ({ name, viewport: viewportCatalog[name] }))
  .filter((entry) => entry.viewport);

function routeUrl(route) {
  return new URL(route, baseUrl).toString();
}

function fail(message) {
  console.error(`[qa:pro-density-audit] ${message}`);
  process.exit(1);
}

if (routes.length === 0) fail("No QA_PRO_DENSITY_ROUTES configured.");
if (viewports.length === 0) fail("No valid QA_PRO_DENSITY_VIEWPORTS configured.");

async function collectDensityMetrics(page, route) {
  return page.evaluate((currentRoute) => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const rectOf = (node) => {
      const rect = node.getBoundingClientRect();
      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    const dataLabel = (node) => {
      for (const attr of Array.from(node.attributes || [])) {
        if (attr.name.startsWith("data-")) return `[${attr.name}${attr.value ? `=${attr.value}` : ""}]`;
      }
      return node.tagName.toLowerCase();
    };
    const nearestHorizontalScroll = (node) => {
      let current = node.parentElement;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (/(auto|scroll)/.test(style.overflowX) && current.scrollWidth > current.clientWidth + 1) {
          return current;
        }
        current = current.parentElement;
      }
      return document.documentElement;
    };
    const tableMetrics = Array.from(document.querySelectorAll("table"))
      .filter(visible)
      .map((table, tableIndex) => {
        const rows = Array.from(table.querySelectorAll("tbody tr")).filter(visible);
        const firstRowCells = Array.from((table.querySelector("tbody tr") || table.querySelector("thead tr"))?.children || [])
          .filter(visible);
        const scrollParent = nearestHorizontalScroll(table);
        const containerRect = scrollParent === document.documentElement
          ? { left: 0, right: window.innerWidth }
          : scrollParent.getBoundingClientRect();
        const visibleColumnCount = firstRowCells.filter((cell) => {
          const rect = cell.getBoundingClientRect();
          return rect.right > containerRect.left && rect.left < containerRect.right;
        }).length;
        const firstHeader = table.querySelector("thead th:first-child");
        const firstCell = table.querySelector("tbody tr td:first-child");
        const stickyNodes = [firstHeader, firstCell].filter(Boolean).map((node) => {
          const style = window.getComputedStyle(node);
          return {
            node: dataLabel(node),
            position: style.position,
            left: style.left,
            isSticky: style.position === "sticky",
          };
        });
        const cells = Array.from(table.querySelectorAll("th,td")).filter(visible);
        return {
          tableIndex,
          label: dataLabel(table),
          rect: rectOf(table),
          rowHeightsPx: rows.slice(0, 20).map((row) => row.getBoundingClientRect().height),
          cellFontSizesPx: cells.slice(0, 30).map((cell) => Number.parseFloat(window.getComputedStyle(cell).fontSize)),
          firstColumnSticky: stickyNodes,
          visibleColumnCountBeforeScroll: visibleColumnCount,
          totalColumnCount: firstRowCells.length,
          scrollParent: {
            label: scrollParent === document.documentElement ? "documentElement" : dataLabel(scrollParent),
            clientWidth: scrollParent.clientWidth,
            scrollWidth: scrollParent.scrollWidth,
            scrollLeft: scrollParent.scrollLeft,
          },
        };
      });

    const cardSelectors = [
      "[data-screener-stock-card]",
      "[data-superinvestor-accumulation-tile]",
      "[data-superinvestor-guru-card]",
      "[data-superinvestor-ticker-kpi]",
      "[data-superinvestor-trades-kpi]",
      "[data-portfolio-section]",
      "[data-market-index-card]",
      "[data-market-valuation-row]",
      "[data-stock-dividend-panel]",
      ".panel",
      "article",
    ];
    const seenCards = new Set();
    const cardRects = [];
    for (const selector of cardSelectors) {
      for (const node of Array.from(document.querySelectorAll(selector)).filter(visible)) {
        if (seenCards.has(node)) continue;
        seenCards.add(node);
        const rect = node.getBoundingClientRect();
        cardRects.push({
          selector,
          label: dataLabel(node),
          width: rect.width,
          height: rect.height,
        });
      }
    }

    const numericNodes = Array.from(document.querySelectorAll("td,th,p,span,div"))
      .filter(visible)
      .filter((node) => /\d/.test((node.textContent || "").trim()))
      .slice(0, 400);
    const tabularNodes = numericNodes.filter((node) => {
      const style = window.getComputedStyle(node);
      const className = typeof node.className === "string" ? node.className : "";
      return className.includes("tabular-nums") || style.fontVariantNumeric.includes("tabular-nums");
    });

    return {
      route: currentRoute,
      viewportWidth: window.innerWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
      tableMetrics,
      cardDensity: {
        count: cardRects.length,
        heightsPx: cardRects.map((entry) => entry.height),
        averageHeightPx: cardRects.length > 0 ? cardRects.reduce((sum, entry) => sum + entry.height, 0) / cardRects.length : null,
        samples: cardRects.slice(0, 30),
      },
      tabularNumberUsage: {
        numericNodeCount: numericNodes.length,
        tabularNodeCount: tabularNodes.length,
        ratio: numericNodes.length > 0 ? tabularNodes.length / numericNodes.length : null,
      },
    };
  }, route);
}

const browser = await chromium.launch({
  headless: true,
  ...(browserChannel ? { channel: browserChannel } : {}),
  ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
});

const results = [];
const harnessErrors = [];

try {
  for (const { name, viewport } of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    for (const route of routes) {
      try {
        const response = await page.goto(routeUrl(route), {
          waitUntil: "networkidle",
          timeout: 45000,
        });
        await page.waitForTimeout(350);
        if (!response || response.status() >= 400) {
          throw new Error(`navigation status=${response ? response.status() : "missing"}`);
        }
        const metrics = await collectDensityMetrics(page, route);
        results.push({
          viewport: name,
          route,
          status: response.status(),
          ...metrics,
        });
      } catch (error) {
        harnessErrors.push({ viewport: name, route, error: String(error) });
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const baseline = {
  schema_version: "pro-density-baseline/v1",
  generated_at: new Date().toISOString(),
  base_url: baseUrl,
  routes,
  viewports: viewports.map((entry) => ({ name: entry.name, ...entry.viewport })),
  output_path: path.relative(APP_ROOT, outputPath),
  harness_errors: harnessErrors,
  results,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`);

const summary = {
  total: results.length,
  harness_errors: harnessErrors.length,
  output: outputPath,
  routes,
  viewports: viewports.map((entry) => entry.name),
  table_counts: results.map((result) => ({
    viewport: result.viewport,
    route: result.route,
    tables: result.tableMetrics.length,
    cards: result.cardDensity.count,
    tabular_ratio: result.tabularNumberUsage.ratio,
  })),
};

console.log(JSON.stringify(summary, null, 2));

if (harnessErrors.length > 0) {
  process.exit(1);
}
