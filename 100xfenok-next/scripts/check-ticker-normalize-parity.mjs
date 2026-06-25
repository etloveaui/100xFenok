#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isValidEntityKey, makeEntityKey, normalizeEntitySymbol } from "../../scripts/lib/entity-key-policy.mjs";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TSX_BIN = path.join(APP_ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

const cases = [
  { label: "empty", input: "", mjs: "", entity: "", route: "", file: "", mjsValid: false, entityValid: false, routeValid: false },
  { label: "whitespace", input: " ", mjs: "", entity: "", route: "", file: "", mjsValid: false, entityValid: false, routeValid: false },
  { label: "null", kind: "null", mjs: "", entity: "", route: "", file: "", mjsValid: false, entityValid: false, routeValid: false },
  { label: "undefined", kind: "undefined", mjs: "", entity: "", route: "", file: "", mjsValid: false, entityValid: false, routeValid: false },
  { label: "lowercase", input: "aapl", mjs: "AAPL", entity: "AAPL", route: "AAPL", file: "AAPL", mjsValid: true, entityValid: true, routeValid: true },
  { label: "trim", input: " AAPL ", mjs: "AAPL", entity: "AAPL", route: "AAPL", file: "AAPL", mjsValid: true, entityValid: true, routeValid: true },
  { label: "dollar-prefix", input: " $AAPL ", mjs: "$AAPL", entity: "AAPL", route: "AAPL", file: "AAPL", mjsValid: false, entityValid: true, routeValid: true },
  { label: "index-caret", input: "^GSPC", mjs: "^GSPC", entity: "^GSPC", route: "GSPC", file: "GSPC", mjsValid: false, entityValid: false, routeValid: false },
  { label: "brk-dot", input: "BRK.B", mjs: "BRK.B", entity: "BRK.B", route: "BRK.B", file: "BRK.B", mjsValid: true, entityValid: true, routeValid: true },
  { label: "brk-dash", input: "BRK-B", mjs: "BRK-B", entity: "BRK-B", route: "BRK-B", file: "BRK-B", mjsValid: true, entityValid: true, routeValid: true },
  { label: "googl", input: "GOOGL", mjs: "GOOGL", entity: "GOOGL", route: "GOOGL", file: "GOOGL", mjsValid: true, entityValid: true, routeValid: true },
  { label: "kr-leading-zero", input: "005930.KS", mjs: "005930.KS", entity: "005930.KS", route: "005930.KS", file: "005930.KS", mjsValid: true, entityValid: true, routeValid: true },
  { label: "cn-leading-zero", input: "000001.SZ", mjs: "000001.SZ", entity: "000001.SZ", route: "000001.SZ", file: "000001.SZ", mjsValid: true, entityValid: true, routeValid: true },
  { label: "bf-dot", input: "BF.B", mjs: "BF.B", entity: "BF.B", route: "BF.B", file: "BF.B", mjsValid: true, entityValid: true, routeValid: true },
  { label: "single-stock-etf-conl", input: "CONL", mjs: "CONL", entity: "CONL", route: "CONL", file: "CONL", mjsValid: true, entityValid: true, routeValid: true },
  { label: "single-stock-etf-nvdl", input: "NVDL", mjs: "NVDL", entity: "NVDL", route: "NVDL", file: "NVDL", mjsValid: true, entityValid: true, routeValid: true },
  { label: "single-stock-etf-tslz", input: "TSLZ", mjs: "TSLZ", entity: "TSLZ", route: "TSLZ", file: "TSLZ", mjsValid: true, entityValid: true, routeValid: true },
  { label: "hangul", input: "삼성전자", mjs: "삼성전자", entity: "삼성전자", route: "", file: "", mjsValid: false, entityValid: false, routeValid: false },
  { label: "short-leading-zero", input: "007", mjs: "007", entity: "007", route: "007", file: "007", mjsValid: true, entityValid: true, routeValid: true },
  { label: "padded-leading-zero", input: "0007", mjs: "0007", entity: "0007", route: "0007", file: "0007", mjsValid: true, entityValid: true, routeValid: true },
  { label: "embedded-dollar", input: "A.B-C$1", mjs: "A.B-C$1", entity: "A.B-C$1", route: "A.B-C1", file: "A.B-C1", mjsValid: false, entityValid: false, routeValid: true },
];

const dataConsistencyCases = [
  { kind: "stock", input: "AAPL" },
  { kind: "stock", input: "NVDA" },
  { kind: "stock", input: "BRK.B" },
  { kind: "stock", input: "005930.KS" },
  { kind: "stock", input: "000001.SZ" },
  { kind: "etf", input: "CONL" },
  { kind: "etf", input: "NVDL" },
  { kind: "etf", input: "TSLZ" },
  { kind: "etf", input: "SPY" },
  {
    kind: "stock",
    input: "BRK-B",
    flagged: "class-share-dot-dash-edgar-fallback",
    fallback: "BRK.B",
  },
];

function fail(message, details = []) {
  console.error(`[qa:routes] ticker-normalize parity failed: ${message}`);
  for (const detail of details) console.error(`  - ${detail}`);
  process.exit(1);
}

if (!fs.existsSync(TSX_BIN)) {
  fail(`tsx binary missing: ${TSX_BIN}`);
}

const tsProbe = `
  import { ROUTES } from "./src/lib/routes.ts";
  import { isValidEntityTicker, isValidRouteTicker, normalizeForEntityKey, normalizeForFilePath, normalizeForRouteTicker } from "./src/lib/ticker.ts";
  const cases = ${JSON.stringify(cases)};
  const valueFor = (item) => item.kind === "undefined" ? undefined : item.kind === "null" ? null : item.input;
  console.log(JSON.stringify(cases.map((item) => {
    const value = valueFor(item);
    return {
      label: item.label,
      entity: normalizeForEntityKey(value),
      route: normalizeForRouteTicker(value),
      file: normalizeForFilePath(value),
      entityValid: isValidEntityTicker(value),
      routeValid: isValidRouteTicker(value),
      stockRoute: ROUTES.stock(value ?? ""),
      etfRoute: ROUTES.etf(value ?? ""),
    };
  })));
`;

const result = spawnSync(TSX_BIN, ["--eval", tsProbe], {
  cwd: APP_ROOT,
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});

if (result.status !== 0) {
  fail("could not evaluate TS runtime normalizer", [result.stderr || result.stdout || "no output"]);
}

let runtimeRows;
try {
  runtimeRows = JSON.parse(result.stdout);
} catch (error) {
  fail("TS runtime normalizer returned invalid JSON", [String(error), result.stdout]);
}

const runtime = new Map(runtimeRows.map((row) => [row.label, row]));
const errors = [];
function valueFor(item) {
  if (item.kind === "undefined") return undefined;
  if (item.kind === "null") return null;
  return item.input;
}

function expectEqual(actual, expected, detail) {
  if (actual !== expected) errors.push(`${detail}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function existingDataSnapshot() {
  const dataRoot = path.join(APP_ROOT, "public", "data");
  const stockIndexPath = path.join(dataRoot, "computed", "entity_graph_stock_index.json");
  const graphPath = path.join(dataRoot, "computed", "entity_graph.json");
  const edgarIndexPath = path.join(dataRoot, "edgar-korean-summaries", "index.json");
  return {
    dataRoot,
    stocks: readJson(stockIndexPath).stocks ?? {},
    etfIds: new Set((readJson(graphPath).nodes?.etfs ?? []).map((node) => node.id)),
    edgarIndex: fs.existsSync(edgarIndexPath) ? readJson(edgarIndexPath) : null,
  };
}

for (const item of cases) {
  const value = valueFor(item);
  const row = runtime.get(item.label);
  const mjsSymbol = normalizeEntitySymbol(value);
  const mjsKey = makeEntityKey("stock", value);
  expectEqual(mjsSymbol, item.mjs, `${item.label} .mjs normalizeEntitySymbol`);
  expectEqual(isValidEntityKey("stock", mjsKey), item.mjsValid, `${item.label} .mjs stock validity`);
  expectEqual(row?.entity, item.entity, `${item.label} .ts normalizeForEntityKey`);
  expectEqual(row?.route, item.route, `${item.label} .ts normalizeForRouteTicker`);
  expectEqual(row?.file, item.file, `${item.label} .ts normalizeForFilePath`);
  expectEqual(row?.entityValid, item.entityValid, `${item.label} .ts entity validity`);
  expectEqual(row?.routeValid, item.routeValid, `${item.label} .ts route validity`);
}

const brkDot = runtime.get("brk-dot");
const brkDash = runtime.get("brk-dash");
if (brkDot?.entity === brkDash?.entity || brkDot?.route === brkDash?.route) {
  errors.push("BRK.B and BRK-B must stay distinct; no dot/dash collapse allowed");
}

for (const ticker of ["CONL", "NVDL", "TSLZ"]) {
  const etfKey = makeEntityKey("etf", ticker);
  const row = [...runtime.values()].find((item) => item.entity === ticker);
  expectEqual(etfKey, `etf:${ticker}`, `${ticker} .mjs ETF key`);
  expectEqual(row?.etfRoute, `/etfs/${ticker}`, `${ticker} ROUTES.etf`);
}

const snapshot = existingDataSnapshot();
const flaggedMismatches = [];
for (const item of dataConsistencyCases) {
  const row = runtimeRows.find((candidate) => candidate.route === item.input || candidate.entity === item.input)
    ?? runtimeRows.find((candidate) => candidate.label === item.label);
  const routeTicker = row?.route ?? item.input;
  if (!routeTicker) {
    errors.push(`${item.input}: route-normalized ticker is empty in data consistency case`);
    continue;
  }
  if (item.kind === "stock") {
    const stockEntry = snapshot.stocks[routeTicker];
    const yfFileExists = fs.existsSync(path.join(snapshot.dataRoot, "yf", "finance", `${routeTicker}.json`));
    if (stockEntry || yfFileExists) continue;
    if (item.flagged && item.fallback) {
      const fallbackEntry = snapshot.stocks[item.fallback];
      const edgarFallback = snapshot.edgarIndex?.byTicker?.[item.fallback];
      const edgarSource = fs.readFileSync(path.join(APP_ROOT, "src", "lib", "edgarKoreanSummaries.ts"), "utf8");
      if (fallbackEntry && edgarFallback && edgarSource.includes("edgarTickerCandidates")) {
        flaggedMismatches.push(`${item.input}->${item.fallback}:${item.flagged}`);
        continue;
      }
      errors.push(`${item.input}: flagged mismatch ${item.flagged} lacks fallback data/source guard`);
      continue;
    }
    errors.push(`${item.input}: route ticker ${routeTicker} has no stock index or yf data file and is not explicitly flagged`);
    continue;
  }
  if (item.kind === "etf") {
    if (!snapshot.etfIds.has(`etf:${routeTicker}`)) {
      errors.push(`${item.input}: route ticker ${routeTicker} has no ETF entity key`);
    }
  }
}

const tickerTypeaheadPath = path.join(APP_ROOT, "src", "components", "TickerTypeahead.tsx");
const tickerTypeaheadSource = fs.readFileSync(tickerTypeaheadPath, "utf8");
if (/`\/stock\/\$\{/.test(tickerTypeaheadSource) || /router\.push\(`\/stock\//.test(tickerTypeaheadSource)) {
  errors.push("TickerTypeahead must use ROUTES.stock() for every stock navigation path");
}

if (errors.length) fail("normalization contract drift", errors);

console.log(`[qa:routes] ticker-normalize parity OK (${cases.length} vectors + ${dataConsistencyCases.length} data consistency cases, flagged=${flaggedMismatches.length})`);
