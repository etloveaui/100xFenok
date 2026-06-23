#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const CONTRACT_FILES = [
  {
    path: "src/lib/quote-contract.ts",
    required: [
      'QUOTE_CONTRACT_VERSION = "quote.v1"',
      'QUOTE_ENDPOINT_PATTERN = "/api/ticker/{symbol}/"',
      "QUOTE_CACHE_CONTROL",
      "QUOTE_STALE_AFTER_MINUTES",
      "QUOTE_SYMBOL_PATTERN",
      "type QuotePayload",
      "type QuoteErrorPayload",
      "type QuoteDataState",
      "lastUpdated: string",
      "staleAfter: string",
      "state: QuoteDataState",
      "quoteErrorState",
    ],
  },
  {
    path: "src/lib/server/ticker.ts",
    required: [
      "QUOTE_CONTRACT_VERSION",
      "normalizeQuoteSymbol",
      "isValidQuoteSymbol",
      "schemaVersion: QUOTE_CONTRACT_VERSION",
      "export type TickerQuote = QuotePayload",
      "quoteState",
      "lastUpdated",
      "staleAfter",
    ],
  },
  {
    path: "src/app/api/ticker/[symbol]/route.ts",
    required: [
      "QUOTE_CACHE_CONTROL",
      "QUOTE_CONTRACT_VERSION",
      "normalizeQuoteSymbol",
      "isValidQuoteSymbol",
      'error: "INVALID_SYMBOL"',
      'error: "TICKER_FETCH_FAILED"',
    ],
  },
  {
    path: "src/app/api/ticker/route.ts",
    required: [
      "QUOTE_CACHE_CONTROL",
      "QUOTE_CONTRACT_VERSION",
      "normalizeQuoteSymbol",
      "isValidQuoteSymbol",
      'error: "SYMBOL_REQUIRED"',
      'error: "INVALID_SYMBOL"',
      'error: "TICKER_FETCH_FAILED"',
    ],
  },
  {
    path: "src/lib/dashboard/types.ts",
    required: [
      'import type { QuotePayload } from "@/lib/quote-contract"',
      "export type TickerQuotePayload = QuotePayload",
    ],
  },
  {
    path: "src/hooks/useSectorData.ts",
    required: [
      'import type { QuotePayload } from "@/lib/quote-contract"',
      "fetchJson<QuotePayload>",
      "Record<string, QuotePayload | null>",
    ],
    forbidden: ["interface TickerQuote"],
  },
  {
    path: "src/components/footer/FooterTickerBar.tsx",
    required: [
      "import type { QuotePayload } from '@/lib/quote-contract'",
      "as QuotePayload",
    ],
    forbidden: ["FooterTickerQuotePayload"],
  },
  {
    path: "../ib/ib-total-guide-calculator.html",
    required: ["/api/ticker/"],
    forbidden: ["api.allorigins.win", "query1.finance.yahoo.com/v8/finance/chart"],
  },
  {
    path: "../admin/market-data/yahoo-quotes.gs",
    required: [
      "QUOTE_GATEWAY_URL",
      "https://100xfenok.etloveaui.workers.dev/api/ticker/",
      "function fetchFrom100xQuote(symbol)",
      "function fetchFromYahooQuote(symbol)",
      "schemaVersion !== 'quote.v1'",
      "100X_QUOTE+YAHOO_OHLC",
      "json.postMarket",
      "json.fetchedAt",
    ],
  },
  {
    path: "../admin/market-radar/scripts/yahoo-quotes.gs",
    required: [
      "QUOTE_GATEWAY_URL",
      "https://100xfenok.etloveaui.workers.dev/api/ticker/",
      "function fetchFrom100xQuote(symbol)",
      "schemaVersion !== 'quote.v1'",
      "100X_QUOTE+YAHOO_OHLC",
      "json.postMarket",
      "json.fetchedAt",
    ],
  },
  {
    path: "../ib/ib-helper/apps-script/yahoo-quotes.gs",
    required: [
      "CNBC stays primary for IB Helper",
      "QUOTE_GATEWAY_URL",
      "https://100xfenok.etloveaui.workers.dev/api/ticker/",
      "function fetchFrom100xQuote(symbol)",
      "schemaVersion !== 'quote.v1'",
      "100X_QUOTE+YAHOO_OHLC",
      "json.postMarket",
      "json.fetchedAt",
    ],
  },
  {
    path: "public/ib/ib-total-guide-calculator.html",
    required: ["/api/ticker/"],
    forbidden: ["api.allorigins.win", "query1.finance.yahoo.com/v8/finance/chart"],
  },
  {
    path: "public/admin/market-data/yahoo-quotes.gs",
    required: [
      "QUOTE_GATEWAY_URL",
      "https://100xfenok.etloveaui.workers.dev/api/ticker/",
      "function fetchFrom100xQuote(symbol)",
      "function fetchFromYahooQuote(symbol)",
      "schemaVersion !== 'quote.v1'",
      "100X_QUOTE+YAHOO_OHLC",
    ],
  },
  {
    path: "public/admin/market-radar/scripts/yahoo-quotes.gs",
    required: [
      "QUOTE_GATEWAY_URL",
      "https://100xfenok.etloveaui.workers.dev/api/ticker/",
      "function fetchFrom100xQuote(symbol)",
      "100X_QUOTE+YAHOO_OHLC",
      "schemaVersion !== 'quote.v1'",
    ],
  },
  {
    path: "public/ib/ib-helper/apps-script/yahoo-quotes.gs",
    required: [
      "CNBC stays primary for IB Helper",
      "QUOTE_GATEWAY_URL",
      "https://100xfenok.etloveaui.workers.dev/api/ticker/",
      "function fetchFrom100xQuote(symbol)",
      "100X_QUOTE+YAHOO_OHLC",
      "schemaVersion !== 'quote.v1'",
    ],
  },
  {
    path: "public/ib-helper/apps-script/yahoo-quotes.gs",
    required: [
      "CNBC stays primary for IB Helper",
      "QUOTE_GATEWAY_URL",
      "https://100xfenok.etloveaui.workers.dev/api/ticker/",
      "function fetchFrom100xQuote(symbol)",
      "100X_QUOTE+YAHOO_OHLC",
      "schemaVersion !== 'quote.v1'",
    ],
  },
];

function readRelative(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing file: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

const errors = [];

for (const contract of CONTRACT_FILES) {
  let text = "";
  try {
    text = readRelative(contract.path);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    continue;
  }

  for (const needle of contract.required ?? []) {
    if (!text.includes(needle)) {
      errors.push(`${contract.path}: missing '${needle}'`);
    }
  }

  for (const needle of contract.forbidden ?? []) {
    if (text.includes(needle)) {
      errors.push(`${contract.path}: forbidden '${needle}'`);
    }
  }
}

if (errors.length > 0) {
  console.error("quote contract check failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("quote contract check passed");
