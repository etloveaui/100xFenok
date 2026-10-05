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
  // SEC Schedule 13G cover CUSIP of the subject's common stock, ticker from SEC company_tickers by CIK.
  ["718172109", { symbol: "PM", source: "sec-13g-2024-pm-common" }],
  ["459200101", { symbol: "IBM", source: "sec-13g-2024-ibm-common" }],
  ["655844108", { symbol: "NSC", source: "sec-13g-2024-nsc-common" }],
  ["026874784", { symbol: "AIG", source: "sec-13g-2024-aig-common" }],
  ["609207105", { symbol: "MDLZ", source: "sec-13g-2024-mdlz-common" }],
  ["910047109", { symbol: "UAL", source: "sec-13g-2025-ual-common" }],
  ["G87110105", { symbol: "FTI", source: "sec-13g-2024-fti-ordinary" }],
  ["907818108", { symbol: "UNP", source: "sec-13g-2026-unp-common" }],
  ["053015103", { symbol: "ADP", source: "sec-13g-2026-adp-common" }],
  ["06849F108", { symbol: "B", source: "sec-13g-2026-barrick-common" }],
  ["136385101", { symbol: "CNQ", source: "sec-13g-2026-cnq-common" }],
  ["D18190898", { symbol: "DB", source: "sec-13g-2025-db-ordinary" }],
  ["136375102", { symbol: "CNI", source: "sec-13d-2024-cni-common" }],
  ["758750103", { symbol: "RRX", source: "sec-13g-2026-rrx-common" }],
  ["009158106", { symbol: "APD", source: "sec-13g-2026-apd-common" }],
  ["828806109", { symbol: "SPG", source: "sec-13g-2026-spg-common" }],
  ["571903202", { symbol: "MAR", source: "sec-13g-2026-mar-class-a-common" }],
  ["929740108", { symbol: "WAB", source: "sec-13g-2026-wab-common" }],
  ["12769G100", { symbol: "CZR", source: "sec-13g-2026-czr-common" }],
  ["228368106", { symbol: "CCK", source: "sec-13g-2026-cck-common" }],
  ["281020107", { symbol: "EIX", source: "sec-13g-2026-eix-common" }],
  ["31620M106", { symbol: "FIS", source: "sec-13g-2026-fis-common" }],
  ["857477103", { symbol: "STT", source: "sec-13g-2026-stt-common" }],
  ["398182303", { symbol: "AHR", source: "sec-13g-2026-ahr-common" }],
  ["55825T103", { symbol: "MSGS", source: "sec-13g-2026-msgs-class-a-common" }],
  ["45168D104", { symbol: "IDXX", source: "sec-13g-2026-idxx-common" }],
  ["77311W101", { symbol: "RKT", source: "sec-13g-2026-rkt-common" }],
  ["526107107", { symbol: "LII", source: "sec-13g-2026-lii-common" }],
  ["136069101", { symbol: "CM", source: "sec-13g-2026-cm-common" }],
  ["051774107", { symbol: "AUR", source: "sec-13g-2026-aur-common" }],
  ["72348N109", { symbol: "PNFP", source: "sec-13g-2026-pnfp-common" }],
  ["171484108", { symbol: "CHDN", source: "sec-13g-2026-chdn-common" }],
  ["302130109", { symbol: "EXPD", source: "sec-13g-2026-expd-common" }],
  ["741623102", { symbol: "PRMB", source: "sec-13g-2026-prmb-common" }],
  ["649445400", { symbol: "FLG", source: "sec-13g-2026-flg-common" }],
  ["538034109", { symbol: "LYV", source: "sec-13g-2026-lyv-common" }],
  ["679580100", { symbol: "ODFL", source: "sec-13g-2026-odfl-common" }],
  ["09228F103", { symbol: "BB", source: "sec-13g-2026-bb-common" }],
  ["44916Y106", { symbol: "PURR", source: "sec-13g-2026-purr-common" }],
  ["00650F109", { symbol: "ADPT", source: "sec-13g-2026-adpt-common" }],
  ["42806J700", { symbol: "HTZ", source: "sec-13g-2026-htz-common" }],
  ["812215200", { symbol: "SEG", source: "sec-13g-2025-seg-common" }],
  ["31620R303", { symbol: "FNF", source: "sec-13g-2026-fnf-common" }],
  ["608190104", { symbol: "MHK", source: "sec-13g-2026-mhk-common" }],
  ["749685103", { symbol: "RPM", source: "sec-13g-2026-rpm-common" }],
  ["558256103", { symbol: "MSGE", source: "sec-13g-2026-msge-common" }],
  ["302520101", { symbol: "FNB", source: "sec-13g-2026-fnb-common" }],
  ["913903100", { symbol: "UHS", source: "sec-13g-2026-uhs-common" }],
  ["007973100", { symbol: "AEIS", source: "sec-13g-2026-aeis-common" }],
  ["07782B104", { symbol: "BLTE", source: "sec-13g-2026-blte-common" }],
  ["67080N101", { symbol: "NUVB", source: "sec-13g-2025-nuvb-common" }],
  ["91823B109", { symbol: "UWMC", source: "sec-13g-2026-uwmc-common" }],
  ["74144T108", { symbol: "TROW", source: "sec-13g-2026-trow-common" }],
  ["032095101", { symbol: "APH", source: "sec-13g-2026-aph-common" }],
  ["N20944109", { symbol: "CNH", source: "sec-13g-2026-cnh-common" }],
  ["426281101", { symbol: "JKHY", source: "sec-13g-2026-jkhy-common" }],
  ["042735100", { symbol: "ARW", source: "sec-13g-2026-arw-common" }],
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

// Fund-family and descriptor words name no single issuer, so they cannot
// confirm which security a stored ticker belongs to.
const NON_IDENTIFYING_WORDS = new Set([
  "AND",
  "AMERICA",
  "AMERICAN",
  "DIREXION",
  "FOR",
  "FUND",
  "FUNDS",
  "INDEX",
  "INVESCO",
  "ISHARES",
  "PORTFOLIO",
  "PROSHARES",
  "SCHWAB",
  "SECTOR",
  "SELECT",
  "SERIES",
  "SHARES",
  "SPDR",
  "VANECK",
  "VANGUARD",
  "WISDOMTREE",
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

function identityTokens(value) {
  return normalizeCompanyName(value)
    .split(" ")
    .filter((word) => word.length >= 2 && !NON_IDENTIFYING_WORDS.has(word));
}

// Short words must match exactly; filings abbreviate longer ones (AMER, MATLS).
function tokensAgree(a, b) {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 4 && longer.startsWith(shorter);
}

// Stored 13F tickers and the aliases generated from them are not identity
// evidence: historical rows carry tickers such as ATI for IBM or Philip Morris.
// A non-authoritative symbol is admitted only when the filing's issuer name
// shares a distinctive word with that symbol's own universe name.
function issuerNameConfirms(symbolNames, symbol, issuerName) {
  const names = symbolNames.get(symbol);
  if (!names) return false;
  const issuerTokens = identityTokens(issuerName);
  if (!issuerTokens.length) return false;
  for (const name of names) {
    for (const token of identityTokens(name)) {
      if (issuerTokens.some((issuerToken) => tokensAgree(issuerToken, token))) return true;
    }
  }
  return false;
}

function addSymbolName(symbolNames, symbol, name) {
  if (!symbol || !String(name ?? "").trim()) return;
  if (!symbolNames.has(symbol)) symbolNames.set(symbol, new Set());
  symbolNames.get(symbol).add(String(name));
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

function loadStockUniverse(root, symbols, nameMap, symbolNames) {
  const analyzer = readJson(path.join(root, "data/global-scouter/core/stocks_analyzer.json"), {});
  for (const row of analyzer.data ?? []) {
    const symbol = addSymbol(symbols, row?.symbol);
    if (!symbol) continue;
    addName(nameMap, row?.companyName, symbol, "global-scouter");
    addSymbolName(symbolNames, symbol, row?.companyName);
  }

  const index = readJson(path.join(root, "data/global-scouter/core/stocks_index.json"), {});
  for (const [symbolKey, row] of Object.entries(index.stocks ?? {})) {
    const symbol = addSymbol(symbols, symbolKey);
    if (!symbol) continue;
    addName(nameMap, row?.n, symbol, "global-scouter");
    addSymbolName(symbolNames, symbol, row?.n);
  }
}

function loadYfUniverse(root, symbols, nameMap, symbolNames) {
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
    addSymbolName(symbolNames, symbol, info.longName);
    addSymbolName(symbolNames, symbol, info.shortName);
  }
}

// SEC's ticker-to-registrant table supplies issuer names for confirmation only;
// it never creates a name join on its own.
function loadSecIssuerNames(root, symbolNames) {
  const doc = readJson(path.join(root, "data/edgar/company_tickers.json"), {});
  for (const row of doc.rows ?? []) {
    const ticker = String(row?.ticker ?? "").trim().toUpperCase();
    for (const symbol of new Set([normalizeSymbol(ticker), normalizeSymbol(ticker.replace("-", "."))])) {
      addSymbolName(symbolNames, symbol, row?.title);
    }
  }
}

function loadExistingAliases(root, aliasMap, nameMap, symbolNames) {
  const aliasDoc = readJson(path.join(root, "data/sec-13f/analytics/ticker_aliases.json"), {});

  if (Array.isArray(aliasDoc.aliases)) {
    for (const alias of aliasDoc.aliases) {
      // Exact security evidence must not become an issuer/fund-family guess
      // for another class or CUSIP when generated aliases are loaded again.
      if (AUTHORITATIVE_ALIAS_SOURCES.has(alias.source) || Array.isArray(alias.cusips) && alias.cusips.some(
        (cusip) => AUTHORITATIVE_CUSIP_SYMBOLS.has(normalizeCusip(cusip)),
      )) continue;
      if (!issuerNameConfirms(symbolNames, normalizeSymbol(alias.symbol), alias.raw_key)) continue;
      addAlias(aliasMap, alias.raw_key, alias.normalized_key, alias.symbol, alias.source ?? "alias-history");
      addName(nameMap, alias.raw_key, alias.symbol, alias.source ?? "alias-history");
    }
    return;
  }

  if (aliasDoc.aliases && typeof aliasDoc.aliases === "object") {
    for (const [rawKey, symbol] of Object.entries(aliasDoc.aliases)) {
      if (!issuerNameConfirms(symbolNames, normalizeSymbol(symbol), rawKey)) continue;
      addAlias(aliasMap, rawKey, rawKey, symbol, "alias-history");
      addName(nameMap, rawKey, symbol, "alias-history");
    }
  }
}

function loadInvestorHistory(root, symbols, nameMap, cusipMap, symbolNames) {
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
        const symbol = normalizeSymbol(holding?.ticker);
        if (!symbol || !issuerNameConfirms(symbolNames, symbol, holding?.name)) continue;
        addSymbol(symbols, symbol);

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
  const symbolNames = new Map();

  loadStockUniverse(root, symbols, nameMap, symbolNames);
  loadYfUniverse(root, symbols, nameMap, symbolNames);
  loadSecIssuerNames(root, symbolNames);
  loadExistingAliases(root, aliasMap, nameMap, symbolNames);
  loadInvestorHistory(root, symbols, nameMap, cusipMap, symbolNames);
  const confirmed = (symbol, issuerName) => issuerNameConfirms(symbolNames, normalizeSymbol(symbol), issuerName);

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
      if (direct && confirmed(direct, rawName)) return result(direct, rawTicker, rawTicker, "ticker-direct");

      const alias = aliasMap.get(rawTicker) ?? aliasMap.get(normalizeCompanyName(rawTicker));
      if (alias?.symbol && confirmed(alias.symbol, rawName)) {
        return result(alias.symbol, rawTicker, normalizeCompanyName(rawTicker), alias.source);
      }
    }

    if (rawName) {
      const alias = aliasMap.get(rawName.toUpperCase()) ?? aliasMap.get(normalizedName);
      if (alias?.symbol && confirmed(alias.symbol, rawName)) return result(alias.symbol, rawName, normalizedName, alias.source);
    }

    if (rawCusip) {
      const hit = cusipMap.get(rawCusip);
      if (hit?.symbol && confirmed(hit.symbol, rawName)) return result(hit.symbol, rawKey, normalizedKey, hit.source);
    }

    if (rawName) {
      const hit = nameMap.get(normalizedName);
      if (hit?.symbol && confirmed(hit.symbol, rawName)) return result(hit.symbol, rawName, normalizedName, hit.source);
    }

    // A rejected stored ticker is not an identity key for the unmapped audit list.
    return result(null, rawName || rawCusip || rawTicker, normalizedName || rawCusip || rawTicker, "unmapped");
  }

  return {
    confirmed,
    symbols,
    nameMap,
    aliasMap,
    cusipMap,
    resolveHoldingSymbol,
  };
}
