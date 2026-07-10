#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LIMIT = 40;

function normalizeTickers(values) {
  const seen = new Set();
  const tickers = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const ticker = String(raw ?? "").trim().toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    tickers.push(ticker);
  }
  return tickers;
}

export function planCoreBasketDelta({ selectedTickers, fetchedTickers, limit = DEFAULT_LIMIT }) {
  const selected = normalizeTickers(selectedTickers);
  const fetched = normalizeTickers(fetchedTickers);
  const numericLimit = Number(limit);
  if (!Number.isInteger(numericLimit) || numericLimit < 1) {
    throw new Error(`Core Basket delta limit must be a positive integer; received ${limit}`);
  }

  const fetchedSet = new Set(fetched);
  const deltaTickers = selected.filter((ticker) => !fetchedSet.has(ticker));
  if (deltaTickers.length > numericLimit) {
    throw new Error(
      `Core Basket delta ${deltaTickers.length} exceeds limit ${numericLimit}; refusing silent truncation`,
    );
  }

  return {
    selected_count: selected.length,
    fetched_count: fetched.length,
    delta_count: deltaTickers.length,
    delta_limit: numericLimit,
    delta_tickers: deltaTickers,
  };
}

function parseArgs(argv) {
  const args = { basket: "", fetched: "", output: "", limit: DEFAULT_LIMIT, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (!["--basket", "--fetched", "--output", "--limit"].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (value == null) throw new Error(`${arg} requires a value`);
    index += 1;
    if (arg === "--limit") args.limit = Number(value);
    else args[arg.slice(2)] = value;
  }
  for (const key of ["basket", "fetched", "output"]) {
    if (!args[key]) throw new Error(`--${key} is required`);
  }
  return args;
}

function readBasketTickers(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (Array.isArray(payload?.daily_refresh_universe?.tickers)) {
    return payload.daily_refresh_universe.tickers;
  }
  if (Array.isArray(payload?.rows)) return payload.rows.map((row) => row?.ticker);
  throw new Error(`Core Basket has no ticker list: ${filePath}`);
}

function readFetchedTickers(filePath) {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/);
}

function main(argv) {
  const args = parseArgs(argv);
  const plan = planCoreBasketDelta({
    selectedTickers: readBasketTickers(args.basket),
    fetchedTickers: readFetchedTickers(args.fetched),
    limit: args.limit,
  });
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, plan.delta_tickers.length ? `${plan.delta_tickers.join("\n")}\n` : "", "utf8");
  if (args.json) console.log(JSON.stringify(plan));
  else console.log(`[core-basket-delta] selected=${plan.selected_count} fetched=${plan.fetched_count} delta=${plan.delta_count} limit=${plan.delta_limit}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[core-basket-delta] FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
