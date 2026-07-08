#!/usr/bin/env node
/**
 * Stock Analyzer remap readiness guard.
 *
 * The current product contract intentionally keeps /tools/stock-analyzer on
 * the legacy iframe while the native dashboard remains a preview route. This
 * script makes that state explicit and lists the gates that must close before
 * the default route can be flipped.
 */

import fs from "node:fs";
import path from "node:path";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const FILES = {
  defaultRoute: "src/app/tools/stock-analyzer/page.tsx",
  nativeRoute: "src/app/tools/stock-analyzer/native/page.tsx",
  nativeDashboard: "src/features/stock-analyzer/components/stock-analyzer-dashboard.tsx",
  staticProvider: "src/features/stock-analyzer/data/static-data-provider.ts",
  contractReadme: "src/lib/stock-analyzer/README.md",
  routeCatalog: "scripts/qa-route-catalog.mjs",
  mobileUx: "scripts/check-mobile-ux-contract.mjs",
  appShell: "src/components/shell/AppShell.tsx",
  dataAsset: "public/data/global-scouter/core/stocks_analyzer.json",
};

const CHECKS = [
  {
    id: "default-route-still-owns-legacy-iframe",
    file: "defaultRoute",
    required: [
      'data-stock-analyzer-route-owner="legacy-iframe"',
      "/tools/stock_analyzer/stock_analyzer.html",
      "data-stock-analyzer-legacy-frame",
      "ROUTES.stockAnalyzerNative",
    ],
  },
  {
    id: "native-route-is-separate-preview-surface",
    file: "nativeRoute",
    required: [
      'data-stock-analyzer-native-route-owner="native-dashboard"',
      "StockAnalyzerDashboard",
      "ROUTES.stockAnalyzer",
    ],
  },
  {
    id: "native-dashboard-has-a-real-surface-contract",
    file: "nativeDashboard",
    required: [
      "data-stock-analyzer-native",
      "data-stock-analyzer-native-tab",
      "data-stock-analyzer-native-summary-card",
      "data-stock-analyzer-native-filtered-universe",
    ],
  },
  {
    id: "native-provider-uses-current-static-stock-analyzer-data",
    file: "staticProvider",
    required: [
      "/data/global-scouter/core/stocks_analyzer.json",
      "action-summary",
      "StockAnalyzerDataProvider",
    ],
  },
  {
    id: "contract-readme-still-requires-legacy-kpi-parity",
    file: "contractReadme",
    required: [
      "stock_analyzer.html",
      "KPI",
      "public/tools/stock_analyzer/*",
    ],
  },
  {
    id: "qa-catalog-still-maps-default-route-to-legacy-iframe",
    file: "routeCatalog",
    required: [
      '"/tools/stock-analyzer": "/tools/stock_analyzer/stock_analyzer.html"',
      '"/tools/stock-analyzer/native"',
    ],
  },
  {
    id: "mobile-ux-contract-separates-legacy-default-and-native-preview",
    file: "mobileUx",
    required: [
      'data-stock-analyzer-route-owner") !== "legacy-iframe"',
      "/tools/stock_analyzer/stock_analyzer.html",
      'data-stock-analyzer-native-route-owner") !== "native-dashboard"',
      "/tools/stock-analyzer/native",
    ],
  },
  {
    id: "navigation-still-points-at-default-stock-analyzer-route",
    file: "appShell",
    required: [
      "stockAnalyzer",
      "ROUTES.stockAnalyzer",
    ],
  },
];

const PROMOTION_GATES = [
  {
    id: "legacy-kpi-parity",
    status: "open",
    gate: "Compare native dashboard metrics against legacy stock_analyzer.html for representative tickers and empty/error states.",
  },
  {
    id: "qa-contract-remap",
    status: "open",
    gate: "Update qa-route-catalog, mobile UX contract, app nav labels, and fallback links in the same change that flips the default route.",
  },
  {
    id: "legacy-fallback-path",
    status: "open",
    gate: "Keep a reachable legacy fallback path until owner smoke confirms native default behavior.",
  },
  {
    id: "post-flip-soak-and-delete",
    status: "open",
    gate: "Only delete public/tools/stock_analyzer after direct URL smoke, soak, and explicit owner approval.",
  },
];

function parseArgs(argv) {
  const args = {
    json: false,
    requireReady: false,
  };

  for (const arg of argv) {
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--require-ready") {
      args.requireReady = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return args;
}

function readRelativeFile(relativePath) {
  const absolutePath = path.join(APP_ROOT, relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

function checkRequiredStrings(fileContents) {
  const rows = [];
  const failures = [];

  for (const check of CHECKS) {
    const relativePath = FILES[check.file];
    const contents = fileContents[check.file];
    const missing = check.required.filter((needle) => !contents.includes(needle));
    const ok = missing.length === 0;

    rows.push({
      id: check.id,
      file: relativePath,
      ok,
      missing,
    });

    if (!ok) {
      failures.push(`${check.id}: ${relativePath} missing ${missing.join(", ")}`);
    }
  }

  return { rows, failures };
}

function buildReport() {
  const fileContents = Object.fromEntries(
    Object.entries(FILES)
      .filter(([key]) => key !== "dataAsset")
      .map(([key, relativePath]) => [key, readRelativeFile(relativePath)]),
  );

  const { rows, failures } = checkRequiredStrings(fileContents);
  const dataAssetPath = path.join(APP_ROOT, FILES.dataAsset);
  const dataAssetExists = fs.existsSync(dataAssetPath);
  if (!dataAssetExists) {
    failures.push(`data asset missing: ${FILES.dataAsset}`);
  }

  return {
    ok: failures.length === 0,
    ready_to_flip_default: false,
    current_default: "legacy-iframe",
    native_route_status: "preview",
    data_asset: {
      path: FILES.dataAsset,
      exists: dataAssetExists,
    },
    checks: rows,
    promotion_gates: PROMOTION_GATES,
    failures,
  };
}

function printHuman(report) {
  const status = report.ok ? "OK" : "FAIL";
  console.log(`[qa:stock-analyzer-remap-readiness] ${status}`);
  console.log(`current_default=${report.current_default}`);
  console.log(`native_route_status=${report.native_route_status}`);
  console.log(`ready_to_flip_default=${report.ready_to_flip_default}`);
  console.log(`checks=${report.checks.filter((row) => row.ok).length}/${report.checks.length}`);
  console.log("promotion_gates=open");
  for (const gate of report.promotion_gates) {
    console.log(`  - ${gate.id}: ${gate.gate}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport();

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }

  if (!report.ok) process.exit(1);
  if (args.requireReady && !report.ready_to_flip_default) process.exit(1);
}

main();
