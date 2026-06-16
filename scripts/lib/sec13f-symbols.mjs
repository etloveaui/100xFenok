import fs from "node:fs";
import path from "node:path";

export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

const LEGAL_WORDS = new Set([
  "ADR",
  "ADS",
  "AG",
  "BANCORP",
  "BK",
  "CAP",
  "CL",
  "CO",
  "COM",
  "COMPANY",
  "CORP",
  "CORPORATION",
  "DEL",
  "ETF",
  "ETP",
  "FD",
  "FDS",
  "FINL",
  "GROUP",
  "HLDG",
  "HLDGS",
  "HOLDING",
  "HOLDINGS",
  "INC",
  "INTL",
  "L P",
  "LP",
  "LTD",
  "MGMT",
  "NEW",
  "NV",
  "ORD",
  "PLC",
  "SA",
  "SHS",
  "SPONSORED",
  "STK",
  "THE",
  "TR",
  "TRUST",
]);

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeSymbol(value) {
  const symbol = String(value ?? "").trim().toUpperCase();
  return SYMBOL_RE.test(symbol) ? symbol : null;
}

function normalizeCusip(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizeCompanyName(value) {
  const raw = String(value ?? "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\bU\.?S\.?\b/g, " US ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return "";

  const words = raw
    .split(" ")
    .filter((word) => word && !LEGAL_WORDS.has(word));

  return words.join(" ").trim();
}

function addMapValue(map, key, value) {
  if (!key || !value?.symbol) return;
  if (!map.has(key)) map.set(key, value);
}

function addSymbol(symbols, value) {
  const symbol = normalizeSymbol(value);
  if (symbol) symbols.add(symbol);
  return symbol;
}

function addName(nameMap, rawName, symbol, source) {
  const cleanSymbol = normalizeSymbol(symbol);
  if (!cleanSymbol) return;
  const normalized = normalizeCompanyName(rawName);
  addMapValue(nameMap, normalized, { symbol: cleanSymbol, source });
}

function addAlias(aliasMap, rawKey, normalizedKey, symbol, source) {
  const cleanSymbol = normalizeSymbol(symbol);
  if (!cleanSymbol) return;
  const value = { symbol: cleanSymbol, source };
  const raw = String(rawKey ?? "").trim();
  if (raw) {
    addMapValue(aliasMap, raw.toUpperCase(), value);
    addMapValue(aliasMap, normalizeCompanyName(raw), value);
  }
  const normalized = String(normalizedKey ?? "").trim();
  if (normalized) {
    addMapValue(aliasMap, normalized.toUpperCase(), value);
    addMapValue(aliasMap, normalizeCompanyName(normalized), value);
  }
}

function loadStockUniverse(root, symbols, nameMap) {
  const analyzer = readJson(path.join(root, "data/global-scouter/core/stocks_analyzer.json"), {});
  for (const row of analyzer.data ?? []) {
    const symbol = addSymbol(symbols, row?.symbol);
    if (symbol) addName(nameMap, row?.companyName, symbol, "global-scouter");
  }

  const index = readJson(path.join(root, "data/global-scouter/core/stocks_index.json"), {});
  for (const [symbolKey, row] of Object.entries(index.stocks ?? {})) {
    const symbol = addSymbol(symbols, symbolKey);
    if (symbol) addName(nameMap, row?.n, symbol, "global-scouter");
  }
}

function loadYfUniverse(root, symbols, nameMap) {
  const yfDir = path.join(root, "data/yf/finance");
  if (!fs.existsSync(yfDir)) return;

  for (const file of fs.readdirSync(yfDir)) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    const symbol = addSymbol(symbols, path.basename(file, ".json"));
    if (!symbol) continue;

    const payload = readJson(path.join(yfDir, file), {});
    const info = payload.data?.info ?? {};
    addName(nameMap, info.longName, symbol, "yf-local");
    addName(nameMap, info.shortName, symbol, "yf-local");
  }
}

function loadExistingAliases(root, aliasMap, nameMap) {
  const aliasDoc = readJson(path.join(root, "data/sec-13f/analytics/ticker_aliases.json"), {});

  if (Array.isArray(aliasDoc.aliases)) {
    for (const alias of aliasDoc.aliases) {
      addAlias(aliasMap, alias.raw_key, alias.normalized_key, alias.symbol, alias.source ?? "alias-history");
      addName(nameMap, alias.raw_key, alias.symbol, alias.source ?? "alias-history");
    }
    return;
  }

  if (aliasDoc.aliases && typeof aliasDoc.aliases === "object") {
    for (const [rawKey, symbol] of Object.entries(aliasDoc.aliases)) {
      addAlias(aliasMap, rawKey, rawKey, symbol, "alias-history");
      addName(nameMap, rawKey, symbol, "alias-history");
    }
  }
}

function loadInvestorHistory(root, symbols, nameMap, cusipMap) {
  const investorsDir = path.join(root, "data/sec-13f/investors");
  if (!fs.existsSync(investorsDir)) return;

  for (const file of fs.readdirSync(investorsDir)) {
    if (!file.endsWith(".json")) continue;
    const payload = readJson(path.join(investorsDir, file), {});
    for (const filing of payload.investor?.filings ?? []) {
      for (const holding of filing.holdings ?? []) {
        const symbol = addSymbol(symbols, holding?.ticker);
        if (!symbol) continue;

        addName(nameMap, holding?.name, symbol, "13f-history");
        const cusip = normalizeCusip(holding?.cusip);
        if (cusip && !cusipMap.has(cusip)) {
          cusipMap.set(cusip, { symbol, source: "13f-history" });
        }
      }
    }
  }
}

export function loadTickerResolver(rootPath) {
  const root = path.resolve(rootPath);
  const symbols = new Set();
  const nameMap = new Map();
  const aliasMap = new Map();
  const cusipMap = new Map();

  loadStockUniverse(root, symbols, nameMap);
  loadYfUniverse(root, symbols, nameMap);
  loadExistingAliases(root, aliasMap, nameMap);
  loadInvestorHistory(root, symbols, nameMap, cusipMap);

  function result(symbol, rawKey, normalizedKey, source) {
    return {
      symbol: normalizeSymbol(symbol),
      rawKey: String(rawKey ?? "").trim(),
      normalizedKey: String(normalizedKey ?? "").trim(),
      source,
    };
  }

  function resolveHoldingSymbol(holding) {
    const rawTicker = String(holding?.ticker ?? "").trim().toUpperCase();
    const rawName = String(holding?.name ?? "").trim();
    const rawCusip = normalizeCusip(holding?.cusip);
    const normalizedName = normalizeCompanyName(rawName);
    const rawKey = rawTicker || rawName || rawCusip;
    const normalizedKey = rawTicker || normalizedName || rawCusip;

    if (rawTicker) {
      const direct = normalizeSymbol(rawTicker);
      if (direct) return result(direct, rawTicker, rawTicker, "ticker-direct");

      const alias = aliasMap.get(rawTicker) ?? aliasMap.get(normalizeCompanyName(rawTicker));
      if (alias?.symbol) return result(alias.symbol, rawTicker, normalizeCompanyName(rawTicker), alias.source);
    }

    if (rawName) {
      const alias = aliasMap.get(rawName.toUpperCase()) ?? aliasMap.get(normalizedName);
      if (alias?.symbol) return result(alias.symbol, rawName, normalizedName, alias.source);
    }

    if (rawCusip) {
      const hit = cusipMap.get(rawCusip);
      if (hit?.symbol) return result(hit.symbol, rawKey, normalizedKey, hit.source);
    }

    if (rawName) {
      const hit = nameMap.get(normalizedName);
      if (hit?.symbol) return result(hit.symbol, rawName, normalizedName, hit.source);
    }

    return result(null, rawKey, normalizedKey, "unmapped");
  }

  return {
    symbols,
    nameMap,
    aliasMap,
    cusipMap,
    resolveHoldingSymbol,
  };
}
