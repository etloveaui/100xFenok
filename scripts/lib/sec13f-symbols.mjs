import fs from "node:fs";
import path from "node:path";

export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

// Exact primary-source security identities. October 4/5 additions and same-class
// CUSIP/ticker source pairs are recorded in the platform's data-recovery receipt.
// Trust shares (SLV) retain their security identity; this map assigns no sector.
const AUTHORITATIVE_CUSIP_SYMBOLS = new Map([
  ["530909100", { symbol: "LLYVA", source: "sec-liberty-live-2025-annual-report" }],
  ["530909308", { symbol: "LLYVK", source: "sec-liberty-live-2025-annual-report" }],
  ["025537101", { symbol: "AEP", source: "issuer-aep-2025-cdp-security-identifiers" }],
  ["064058100", { symbol: "BNY", source: "sec-nport-2026-bny-common" }],
  ["12504L109", { symbol: "CBRE", source: "sec-nport-2026-cbre-class-a" }],
  ["219350105", { symbol: "GLW", source: "sec-nport-2026-corning-common" }],
  ["46428Q109", { symbol: "SLV", source: "issuer-ishares-2026-silver-trust" }],
  ["49177J102", { symbol: "KVUE", source: "sec-kenvue-13g-2025-10q-2026-common" }],
  ["56585A102", { symbol: "MPC", source: "sec-marathon-13g-2025-10k-2026-common" }],
  ["693475105", { symbol: "PNC", source: "issuer-pnc-common-stock-faq" }],
  ["74762E102", { symbol: "PWR", source: "sec-nport-2026-quanta-common" }],
  ["77543R102", { symbol: "ROKU", source: "sec-roku-13g-2026-10k-2026-class-a" }],
  ["780087102", { symbol: "RY", source: "sec-nport-2026-rbc-common" }],
  ["872540109", { symbol: "TJX", source: "issuer-tjx-13g-2025-8k-2026-common" }],
  ["00187Y100", { symbol: "APG", source: "sec-issuer-2026-apg-common" }],
  ["030420103", { symbol: "AWK", source: "sec-issuer-2026-awk-common" }],
  ["03076C106", { symbol: "AMP", source: "sec-issuer-2026-amp-common" }],
  ["03820C105", { symbol: "AIT", source: "sec-issuer-2026-ait-common" }],
  ["063671101", { symbol: "BMO", source: "sec-issuer-2026-bmo-common-shares" }],
  ["143130102", { symbol: "KMX", source: "sec-issuer-2026-kmx-common" }],
  ["15675D103", { symbol: "CBRS", source: "sec-issuer-2026-cbrs-class-a-common" }],
  ["25459W458", { symbol: "SOXL", source: "sec-issuer-2026-soxl-etf-shares" }],
  ["25459Y165", { symbol: "SPUU", source: "sec-issuer-2026-spuu-etf-shares" }],
  ["291011104", { symbol: "EMR", source: "sec-issuer-2026-emr-common" }],
  ["33939L100", { symbol: "TILT", source: "sec-issuer-2026-tilt-etf-shares" }],
  ["33939L407", { symbol: "GUNR", source: "sec-issuer-2026-gunr-etf-shares" }],
  ["33939L506", { symbol: "TDTT", source: "sec-issuer-2026-tdtt-etf-shares" }],
  ["33939L795", { symbol: "NFRA", source: "sec-issuer-2026-nfra-etf-shares" }],
  ["33939L860", { symbol: "QDF", source: "sec-issuer-2026-qdf-etf-shares" }],
  ["33939L886", { symbol: "RAVI", source: "sec-issuer-2026-ravi-etf-shares" }],
  ["34631F102", { symbol: "FPS", source: "sec-issuer-2026-fps-class-a-common" }],
  ["45104G104", { symbol: "IBN", source: "sec-issuer-2026-ibn-adr" }],
  ["452308109", { symbol: "ITW", source: "sec-issuer-2026-itw-common" }],
  ["45866F104", { symbol: "ICE", source: "sec-issuer-2026-ice-common" }],
  ["464288737", { symbol: "KXI", source: "sec-issuer-2026-kxi-etf-shares" }],
  ["464289180", { symbol: "EUFN", source: "sec-issuer-2026-eufn-etf-shares" }],
  ["565394103", { symbol: "CART", source: "sec-issuer-2026-cart-common" }],
  ["571748102", { symbol: "MRSH", source: "sec-issuer-2026-mrsh-common" }],
  ["58507V107", { symbol: "MDLN", source: "sec-issuer-2026-mdln-class-a-common" }],
  ["606822104", { symbol: "MUFG", source: "sec-issuer-2026-mufg-adr" }],
  ["695156109", { symbol: "PKG", source: "sec-issuer-2026-pkg-common" }],
  ["744573106", { symbol: "PEG", source: "sec-issuer-2026-peg-common" }],
  ["780287108", { symbol: "RGLD", source: "sec-issuer-2026-rgld-common" }],
  ["866966104", { symbol: "SUNB", source: "sec-issuer-2026-sunb-common" }],
  ["87612G101", { symbol: "TRGP", source: "sec-issuer-2026-trgp-common" }],
  ["88023B103", { symbol: "TEM", source: "sec-issuer-2026-tem-class-a-common" }],
  ["88635A105", { symbol: "PBEU", source: "sec-issuer-2026-pbeu-etf-shares" }],
  ["88635A204", { symbol: "PBPH", source: "sec-issuer-2026-pbph-etf-shares" }],
  ["88635A303", { symbol: "PBOG", source: "sec-issuer-2026-pbog-etf-shares" }],
  ["911312106", { symbol: "UPS", source: "sec-issuer-2026-ups-class-b-common" }],
  ["912008109", { symbol: "USFD", source: "sec-issuer-2026-usfd-common" }],
  ["94106L109", { symbol: "WM", source: "sec-issuer-2026-wm-common" }],
  ["G4705A100", { symbol: "ICLR", source: "sec-issuer-2026-iclr-ordinary-shares" }],
  ["G6700G107", { symbol: "NVT", source: "sec-issuer-2026-nvt-ordinary-shares" }],
  ["42824C109", { symbol: "HPE", source: "issuer-hpe-common-stock-identifiers" }],
  ["H25662182", { symbol: "CFRHF", source: "sec-nport-2026-richemont-ordinary-shares" }],
  ["00508Y102", { symbol: "AYI", source: "sec-13g-2026-acuity-issuer-current-common" }],
]);
const LIBERTY_LIVE_NAME = "LIBERTY LIVE";
const AUTHORITATIVE_ALIAS_SOURCES = new Set(
  Array.from(AUTHORITATIVE_CUSIP_SYMBOLS.values(), (identity) => identity.source),
);

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
      // Exact security evidence must not become an issuer/fund-family guess
      // for another class or CUSIP when generated aliases are loaded again.
      if (AUTHORITATIVE_ALIAS_SOURCES.has(alias.source) || Array.isArray(alias.cusips) && alias.cusips.some(
        (cusip) => AUTHORITATIVE_CUSIP_SYMBOLS.has(normalizeCusip(cusip)),
      )) continue;
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
        const cusip = normalizeCusip(holding?.cusip);
        const authoritative = AUTHORITATIVE_CUSIP_SYMBOLS.get(cusip);
        if (authoritative) {
          addSymbol(symbols, authoritative.symbol);
          cusipMap.set(cusip, authoritative);
          continue;
        }
        const symbol = addSymbol(symbols, holding?.ticker);
        if (!symbol) continue;

        addName(nameMap, holding?.name, symbol, "13f-history");
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

  function result(symbol, rawKey, normalizedKey, source, authoritative = false) {
    return {
      symbol: normalizeSymbol(symbol),
      rawKey: String(rawKey ?? "").trim(),
      normalizedKey: String(normalizedKey ?? "").trim(),
      source,
      authoritative,
    };
  }

  function resolveHoldingSymbol(holding) {
    const rawTicker = String(holding?.ticker ?? "").trim().toUpperCase();
    const rawName = String(holding?.name ?? "").trim();
    const rawCusip = normalizeCusip(holding?.cusip);
    const normalizedName = normalizeCompanyName(rawName);
    const rawKey = rawTicker || rawName || rawCusip;
    const normalizedKey = rawTicker || normalizedName || rawCusip;

    const authoritative = AUTHORITATIVE_CUSIP_SYMBOLS.get(rawCusip);
    if (authoritative) {
      return result(authoritative.symbol, rawKey, normalizedKey, authoritative.source, true);
    }
    if (normalizedName === LIBERTY_LIVE_NAME) {
      return result(null, rawKey, normalizedKey, "unmapped-liberty-live-without-exact-cusip");
    }

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
