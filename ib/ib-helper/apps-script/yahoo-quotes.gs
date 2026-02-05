/**
 * Yahoo Quotes - Universal Stock Price Fetcher
 *
 * Fallback Chain: CNBC → Yahoo Finance → Stooq → GOOGLEFINANCE
 *
 * Features:
 * - Real-time quotes (CNBC/Yahoo/Stooq)
 * - Pre-market & After-hours support (CNBC)
 * - Multi-symbol batch fetch
 * - Automatic fallback on failure
 * - WebApp API with JSONP support
 *
 * Usage:
 *   const quote = getQuote('TQQQ');
 *   const quotes = getQuotes(['TQQQ', 'SOXL', 'BITU']);
 *
 * @version 3.0.0
 * @created 2026-02-03
 * @updated 2026-02-05
 * @see vix.gs (original pattern)
 *
 * CHANGELOG:
 * - v3.0.0 (2026-02-05): CNBC API added as primary source (pre/post market support)
 * - v2.1.0 (2026-02-04): Added JSONP callback security filter (XSS prevention)
 * - v2.0.0 (2026-02-04): WebApp API with JSONP support
 * - v1.0.0 (2026-02-03): Initial release
 */

// =============================================================================
// Configuration
// =============================================================================

const YAHOO_QUOTES_CONFIG = {
  // CNBC API (Primary - supports pre/post market)
  CNBC_BASE_URL: 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol',

  // Stooq Proxy (Cloudflare Worker)
  STOOQ_PROXY: 'https://stooq-proxy.etloveaui.workers.dev',

  // Yahoo Finance API
  YAHOO_BASE_URL: 'https://query1.finance.yahoo.com/v8/finance/chart/',

  // Timeouts
  TIMEOUT_MS: 10000,

  // Cache TTL (5 minutes)
  CACHE_TTL_SECONDS: 300
};

// IB Helper tickers
const CASH_ETFS = ['SGOV', 'BIL', 'BILS'];
const IB_HELPER_TICKERS = ['TQQQ', 'SOXL', 'BITU'].concat(CASH_ETFS);

// =============================================================================
// Main API Functions
// =============================================================================

/**
 * Get quote for a single symbol
 * Fallback: CNBC → Yahoo → Stooq → GOOGLEFINANCE
 *
 * @param {string} symbol - Stock symbol (e.g., 'TQQQ', 'SOXL')
 * @returns {Object} { symbol, price, previousClose, high, low, preMarket, afterHours, marketState, source, timestamp }
 */
function getQuote(symbol) {
  if (!symbol) {
    throw new Error('Symbol is required');
  }

  symbol = symbol.toUpperCase().trim();

  // Cache (60s) to reduce UrlFetch and rate limit risk
  const cache = CacheService.getScriptCache();
  const cacheKey = 'quote_' + symbol;
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.price > 0) {
        return parsed;
      }
    } catch (e) {
      // ignore cache parse errors
    }
  }

  const cacheResult = (result) => {
    if (result && result.price > 0) {
      try {
        cache.put(cacheKey, JSON.stringify(result), 60);
      } catch (e) {
        // ignore cache write errors
      }
    }
    return result;
  };

  // 1. Try CNBC first (supports pre/post market) - PRIMARY
  try {
    const cnbcResult = fetchFromCNBC(symbol);
    if (cnbcResult && cnbcResult.price > 0) {
      Logger.log(`✅ ${symbol}: CNBC (${cnbcResult.price}) [${cnbcResult.marketState}]`);
      return cacheResult(cnbcResult);
    }
  } catch (e) {
    Logger.log(`⚠️ ${symbol}: CNBC failed - ${e.message}`);
  }

  // 2. Fallback to Yahoo Finance
  try {
    const yahooResult = fetchFromYahoo(symbol);
    if (yahooResult && yahooResult.price > 0) {
      Logger.log(`✅ ${symbol}: Yahoo Finance fallback (${yahooResult.price})`);
      return cacheResult(yahooResult);
    }
  } catch (e) {
    Logger.log(`⚠️ ${symbol}: Yahoo failed - ${e.message}`);
  }

  // 3. Fallback to Stooq (real-time, no pre/after)
  try {
    const stooqResult = fetchFromStooq(symbol);
    if (stooqResult && stooqResult.price > 0) {
      Logger.log(`✅ ${symbol}: Stooq fallback (${stooqResult.price})`);
      return cacheResult(stooqResult);
    }
  } catch (e) {
    Logger.log(`⚠️ ${symbol}: Stooq failed - ${e.message}`);
  }

  // 4. Last resort: GOOGLEFINANCE (15min delay)
  try {
    const googleResult = fetchFromGoogleFinance(symbol);
    if (googleResult && googleResult.price > 0) {
      Logger.log(`✅ ${symbol}: GOOGLEFINANCE fallback (${googleResult.price})`);
      return cacheResult(googleResult);
    }
  } catch (e) {
    Logger.log(`❌ ${symbol}: All sources failed - ${e.message}`);
  }

  // All failed
  return {
    symbol: symbol,
    price: 0,
    priceSource: 'NONE',
    previousClose: 0,
    high: 0,
    low: 0,
    preMarket: null,
    afterHours: null,
    marketState: 'UNKNOWN',
    source: 'NONE',
    error: 'All data sources failed',
    timestamp: new Date().toISOString()
  };
}

/**
 * Get quotes for multiple symbols
 *
 * @param {string[]} symbols - Array of stock symbols
 * @returns {Object} Map of symbol → quote
 */
function getQuotes(symbols) {
  if (!symbols || !Array.isArray(symbols)) {
    throw new Error('Symbols array is required');
  }

  const results = {};

  symbols.forEach(function(symbol) {
    try {
      results[symbol] = getQuote(symbol);
    } catch (e) {
      results[symbol] = {
        symbol: symbol,
        price: 0,
        error: e.message,
        source: 'ERROR'
      };
    }
  });

  return results;
}

/**
 * Get quotes for IB Helper tickers
 * Convenience function for common use case
 *
 * @returns {Object} { TQQQ: {...}, SOXL: {...}, BITU: {...}, SGOV: {...}, BIL: {...}, BILS: {...} }
 */
function getIBHelperQuotes() {
  return getQuotes(IB_HELPER_TICKERS);
}

// =============================================================================
// Data Source: CNBC (PRIMARY - supports Pre/Post Market)
// =============================================================================

/**
 * Fetch quote from CNBC API
 * Supports pre-market and after-hours data via ExtendedMktQuote
 *
 * @param {string} symbol
 * @returns {Object|null}
 */
function fetchFromCNBC(symbol) {
  const url = YAHOO_QUOTES_CONFIG.CNBC_BASE_URL +
    '?symbols=' + encodeURIComponent(symbol) +
    '&requestMethod=itv&noForm=1&partnerId=2&fund=1&exthrs=1&output=json';

  const response = UrlFetchApp.fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    muteHttpExceptions: true,
    timeout: YAHOO_QUOTES_CONFIG.TIMEOUT_MS
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('CNBC API error: ' + response.getResponseCode());
  }

  const json = JSON.parse(response.getContentText());
  const quotes = json.FormattedQuoteResult && json.FormattedQuoteResult.FormattedQuote;

  if (!quotes || quotes.length === 0) {
    throw new Error('No data returned from CNBC');
  }

  const q = quotes[0];

  // Parse market state
  const marketState = (q.curmktstatus || 'REGULAR').toUpperCase();

  // Parse regular market data
  const regularPrice = parseFloat(q.last) || 0;
  const previousClose = parseFloat(q.previous_day_closing) || regularPrice;
  const high = parseFloat(q.high) || 0;
  const low = parseFloat(q.low) || 0;
  const open = parseFloat(q.open) || 0;
  const volume = parseVolume(q.volume);

  // Parse extended hours data
  let preMarket = null;
  let afterHours = null;
  let extendedPrice = null;
  let extendedType = null;

  if (q.ExtendedMktQuote) {
    const ext = q.ExtendedMktQuote;
    const extType = (ext.type || '').toUpperCase();
    const extPrice = parseFloat(ext.last) || 0;

    if (extType === 'PRE_MKT' || extType === 'PRE-MKT' || extType === 'PREMARKET') {
      preMarket = extPrice;
      extendedPrice = extPrice;
      extendedType = 'PRE';
    } else if (extType === 'POST_MKT' || extType === 'POST-MKT' || extType === 'POSTMARKET' || extType === 'AFTER_MKT') {
      afterHours = extPrice;
      extendedPrice = extPrice;
      extendedType = 'POST';
    }
  }

  // Determine best price based on market state
  let bestPrice = regularPrice;
  let priceSource = 'REGULAR';

  if (marketState === 'PRE_MKT' || marketState === 'PRE-MKT' || marketState === 'PREMARKET') {
    if (preMarket && preMarket > 0) {
      bestPrice = preMarket;
      priceSource = 'PRE';
    }
  } else if (marketState === 'POST_MKT' || marketState === 'POST-MKT' || marketState === 'POSTMARKET' || marketState === 'AFTER_MKT') {
    if (afterHours && afterHours > 0) {
      bestPrice = afterHours;
      priceSource = 'POST';
    }
  }

  return {
    symbol: symbol,
    price: roundPrice(bestPrice),
    priceSource: priceSource,
    previousClose: roundPrice(previousClose),
    high: roundPrice(high),
    low: roundPrice(low),
    open: roundPrice(open),
    volume: volume,

    // Extended hours
    preMarket: preMarket ? roundPrice(preMarket) : null,
    afterHours: afterHours ? roundPrice(afterHours) : null,

    // Market state from CNBC
    marketState: normalizeMarketState(marketState),

    source: 'CNBC',
    timestamp: new Date().toISOString()
  };
}

/**
 * Parse volume string (e.g., "133,472,148" → 133472148)
 */
function parseVolume(volStr) {
  if (!volStr) return 0;
  return parseInt(String(volStr).replace(/,/g, '')) || 0;
}

/**
 * Normalize market state to standard format
 */
function normalizeMarketState(state) {
  if (!state) return 'UNKNOWN';
  state = state.toUpperCase().replace(/[-_]/g, '');

  if (state.includes('PRE')) return 'PRE';
  if (state.includes('POST') || state.includes('AFTER')) return 'POST';
  if (state.includes('REG') || state === 'OPEN') return 'REGULAR';
  if (state.includes('CLOSE')) return 'CLOSED';

  return state;
}

// =============================================================================
// Data Source: Yahoo Finance (Fallback)
// =============================================================================

/**
 * Select best price based on market state
 * @param {Object} meta - Yahoo API meta object
 * @param {number} lastClose - Fallback price from chart data
 * @returns {Object} { price: number, source: string }
 */
function getBestPrice(meta, lastClose) {
  const marketState = (meta.marketState || 'UNKNOWN').toUpperCase();

  // Pre-market: prefer preMarketPrice
  if (marketState === 'PRE' || marketState === 'PREPRE') {
    if (meta.preMarketPrice && meta.preMarketPrice > 0) {
      return { price: meta.preMarketPrice, source: 'PRE' };
    }
  }

  // Post-market: prefer postMarketPrice
  if (marketState === 'POST' || marketState === 'POSTPOST') {
    if (meta.postMarketPrice && meta.postMarketPrice > 0) {
      return { price: meta.postMarketPrice, source: 'POST' };
    }
  }

  // Regular market or fallback
  const regularPrice = meta.regularMarketPrice || lastClose;
  return { price: regularPrice, source: 'REGULAR' };
}

/**
 * Fetch quote from Yahoo Finance
 * Supports pre-market and after-hours data
 *
 * @param {string} symbol
 * @returns {Object|null}
 */
function fetchFromYahoo(symbol) {
  const url = YAHOO_QUOTES_CONFIG.YAHOO_BASE_URL +
    encodeURIComponent(symbol) +
    '?interval=1d&range=1d&includePrePost=true';

  const response = UrlFetchApp.fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    muteHttpExceptions: true,
    timeout: YAHOO_QUOTES_CONFIG.TIMEOUT_MS
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Yahoo API error: ' + response.getResponseCode());
  }

  const json = JSON.parse(response.getContentText());
  const result = json.chart.result;

  if (!result || result.length === 0) {
    throw new Error('No data returned');
  }

  const meta = result[0].meta;
  const quote = result[0].indicators.quote[0];

  // Get the most recent values
  const lastIndex = quote.close.length - 1;
  const lastClose = quote.close[lastIndex] || 0;
  const bestPrice = getBestPrice(meta, lastClose);

  return {
    symbol: symbol,
    price: roundPrice(bestPrice.price),
    priceSource: bestPrice.source,
    previousClose: roundPrice(meta.previousClose || meta.chartPreviousClose),
    high: roundPrice(quote.high[lastIndex]),
    low: roundPrice(quote.low[lastIndex]),
    open: roundPrice(quote.open[lastIndex]),
    volume: quote.volume[lastIndex],

    // Extended hours (Yahoo exclusive)
    preMarket: meta.preMarketPrice ? roundPrice(meta.preMarketPrice) : null,
    afterHours: meta.postMarketPrice ? roundPrice(meta.postMarketPrice) : null,

    // Market state: PRE, REGULAR, POST, CLOSED
    marketState: meta.marketState || 'UNKNOWN',

    source: 'YAHOO',
    timestamp: new Date().toISOString()
  };
}

// =============================================================================
// Data Source: Stooq (via Cloudflare Proxy)
// =============================================================================

/**
 * Fetch quote from Stooq via proxy
 * Real-time data, no pre/after hours
 *
 * @param {string} symbol
 * @returns {Object|null}
 */
function fetchFromStooq(symbol) {
  // Stooq uses .US suffix for US stocks
  const stooqSymbol = symbol.toLowerCase() + '.us';
  const url = YAHOO_QUOTES_CONFIG.STOOQ_PROXY + '/q/l/?s=' + stooqSymbol + '&f=sd2t2ohlcv&e=json';

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    timeout: YAHOO_QUOTES_CONFIG.TIMEOUT_MS
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Stooq proxy error: ' + response.getResponseCode());
  }

  const text = response.getContentText();

  // Stooq returns CSV-like format or JSON depending on endpoint
  // Parse the response
  const data = parseStooqResponse(text, symbol);

  if (!data || !data.close) {
    throw new Error('Invalid Stooq response');
  }

  return {
    symbol: symbol,
    price: roundPrice(data.close),
    priceSource: 'REGULAR',
    previousClose: roundPrice(data.previousClose || 0),
    high: roundPrice(data.high),
    low: roundPrice(data.low),
    open: roundPrice(data.open),
    volume: data.volume,

    // Stooq doesn't support extended hours
    preMarket: null,
    afterHours: null,
    marketState: 'REGULAR',

    source: 'STOOQ',
    timestamp: new Date().toISOString()
  };
}

/**
 * Parse Stooq response (CSV or JSON)
 * Enhanced with schema validation
 */
function parseStooqResponse(text, symbol) {
  // Try JSON first
  try {
    const json = JSON.parse(text);

    // Schema validation: check required structure
    if (!json.symbols || !Array.isArray(json.symbols) || json.symbols.length === 0) {
      throw new Error('Invalid JSON schema: missing symbols array');
    }

    const s = json.symbols[0];

    // Required fields validation
    const requiredFields = ['open', 'high', 'low', 'close'];
    for (const field of requiredFields) {
      if (s[field] === undefined || s[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Parse and validate numeric values
    const data = {
      open: parseFloat(s.open),
      high: parseFloat(s.high),
      low: parseFloat(s.low),
      close: parseFloat(s.close),
      volume: parseInt(s.volume) || 0,
      previousClose: parseFloat(s.prev_close || 0)
    };

    // Validate parsed numbers
    if (isNaN(data.close) || data.close <= 0) {
      throw new Error('Invalid close price');
    }

    return data;

  } catch (jsonError) {
    // Fallback: Try CSV parsing
    try {
      const lines = text.trim().split('\n');

      // CSV must have header + at least 1 data row
      if (lines.length < 2) {
        throw new Error('CSV too short');
      }

      // Validate header (expected: Symbol,Date,Time,Open,High,Low,Close,Volume)
      const header = lines[0].toLowerCase();
      if (!header.includes('close') && !header.includes('symbol')) {
        throw new Error('Invalid CSV header');
      }

      const values = lines[1].split(',');

      // Need at least 7 columns
      if (values.length < 7) {
        throw new Error('CSV row too short');
      }

      const data = {
        open: parseFloat(values[3]) || 0,
        high: parseFloat(values[4]) || 0,
        low: parseFloat(values[5]) || 0,
        close: parseFloat(values[6]) || 0,
        volume: parseInt(values[7]) || 0,
        previousClose: 0
      };

      // Validate close price
      if (isNaN(data.close) || data.close <= 0) {
        throw new Error('Invalid close price in CSV');
      }

      return data;

    } catch (csvError) {
      Logger.log(`Stooq parse failed - JSON: ${jsonError.message}, CSV: ${csvError.message}`);
      return null;
    }
  }
}

// =============================================================================
// Data Source: GOOGLEFINANCE (Sheets)
// =============================================================================

/**
 * Fetch quote from GOOGLEFINANCE
 * 15-minute delay, last resort fallback
 *
 * @param {string} symbol
 * @returns {Object|null}
 */
function fetchFromGoogleFinance(symbol) {
  // This requires being called from a Sheet context
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error('GOOGLEFINANCE requires spreadsheet context. Run from a Google Sheet.');
  }

  let sheet = null;
  let createdNew = false;

  try {
    // Use existing hidden sheet or create temporary one
    sheet = ss.getSheetByName('_QuotesTemp');

    if (!sheet) {
      sheet = ss.insertSheet('_QuotesTemp');
      createdNew = true;
      // Hide the temp sheet from users
      sheet.hideSheet();
    }

    // Clear any previous data
    sheet.clear();

    // Set formulas
    sheet.getRange('A1').setFormula(`=GOOGLEFINANCE("${symbol}", "price")`);
    sheet.getRange('B1').setFormula(`=GOOGLEFINANCE("${symbol}", "closeyest")`);
    sheet.getRange('C1').setFormula(`=GOOGLEFINANCE("${symbol}", "high")`);
    sheet.getRange('D1').setFormula(`=GOOGLEFINANCE("${symbol}", "low")`);

    // Wait for calculation
    SpreadsheetApp.flush();
    Utilities.sleep(1500);  // Increased wait time for reliability

    // Read values
    const values = sheet.getRange('A1:D1').getValues()[0];

    // Validate we got actual data (not #N/A or errors)
    const price = parseFloat(values[0]);
    if (isNaN(price) || price <= 0) {
      throw new Error(`GOOGLEFINANCE returned invalid price for ${symbol}`);
    }

    const result = {
      symbol: symbol,
      price: roundPrice(price),
      priceSource: 'REGULAR',
      previousClose: roundPrice(values[1]),
      high: roundPrice(values[2]),
      low: roundPrice(values[3]),
      open: 0,
      volume: 0,

      preMarket: null,
      afterHours: null,
      marketState: 'DELAYED',

      source: 'GOOGLEFINANCE',
      timestamp: new Date().toISOString()
    };

    return result;

  } finally {
    // Always clean up: clear data and optionally delete sheet
    if (sheet) {
      try {
        sheet.clear();

        // Delete the sheet if we just created it (keep workspace clean)
        // If it existed before, just leave it hidden for reuse
        if (createdNew) {
          ss.deleteSheet(sheet);
        }
      } catch (cleanupError) {
        Logger.log('Cleanup warning: ' + cleanupError.message);
      }
    }
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Round price to 2 decimal places
 */
function roundPrice(value) {
  if (!value || isNaN(value)) return 0;
  return Math.round(parseFloat(value) * 100) / 100;
}

/**
 * Get current market state (time-based calculation)
 * @returns {string} PRE | REGULAR | POST | CLOSED
 */
function getMarketState() {
  const now = new Date();
  const estOffset = -5; // EST offset from UTC
  const utcHours = now.getUTCHours();
  const estHours = (utcHours + estOffset + 24) % 24;
  const day = now.getUTCDay();

  // Weekend
  if (day === 0 || day === 6) return 'CLOSED';

  // Pre-market: 4:00 - 9:30 EST
  if (estHours >= 4 && estHours < 9.5) return 'PRE';

  // Regular: 9:30 - 16:00 EST
  if (estHours >= 9.5 && estHours < 16) return 'REGULAR';

  // After-hours: 16:00 - 20:00 EST
  if (estHours >= 16 && estHours < 20) return 'POST';

  return 'CLOSED';
}

// =============================================================================
// Test Functions
// =============================================================================

/**
 * Test single quote fetch
 */
function testGetQuote() {
  const quote = getQuote('TQQQ');
  Logger.log(JSON.stringify(quote, null, 2));
}

/**
 * Test multiple quotes fetch
 */
function testGetQuotes() {
  const quotes = getQuotes(['TQQQ', 'SOXL', 'BITU']);
  Logger.log(JSON.stringify(quotes, null, 2));
}

/**
 * Test IB Helper quotes
 */
function testIBHelperQuotes() {
  const quotes = getIBHelperQuotes();
  Logger.log(JSON.stringify(quotes, null, 2));
}

/**
 * Test CNBC directly
 */
function testCNBC() {
  const result = fetchFromCNBC('TQQQ');
  Logger.log('CNBC result:');
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * Test Yahoo directly
 */
function testYahoo() {
  const result = fetchFromYahoo('TQQQ');
  Logger.log('Yahoo result:');
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * Test market state detection
 */
function testMarketState() {
  Logger.log('Current market state (time-based): ' + getMarketState());
}

// =============================================================================
// WebApp API (Public Price Endpoint) - v3.0.0
// =============================================================================
//
// Deploy: "New deployment" → "Web app" → "Anyone" access
//
// v3.0.0: CNBC as primary source (pre/post market support)
// v2.1.0: Added JSONP callback security filter (XSS prevention)
// v2.0.0: Direct getQuotes() call (Yahoo → Stooq → GOOGLEFINANCE)
//
// Endpoint: https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec
// Response: { TQQQ: { current, close, ... }, SOXL: { ... }, SGOV: { ... }, ... }
//
// @version 3.0.0
// @created 2026-02-04
// @feature #221 Public Price API, #232 CNBC Pre/Post Market
// =============================================================================

/**
 * WebApp entry point - GET request handler
 *
 * Query parameters:
 * - ?ticker=TQQQ : Get single ticker (optional)
 * - ?callback=jsonp_cb_xxx : JSONP response (optional, for CORS bypass)
 * - No params : Get all IB Helper tickers (TQQQ, SOXL, BITU, SGOV, BIL, BILS)
 *
 * @param {Object} e - Event object from Apps Script
 * @returns {TextOutput} JSON or JSONP response
 */
function doGet(e) {
  try {
    const requestedTicker = (e && e.parameter && e.parameter.ticker)
      ? e.parameter.ticker.toUpperCase().trim()
      : null;

    // Single ticker request
    if (requestedTicker) {
      const quote = getQuote(requestedTicker);

      if (!quote || quote.price <= 0) {
        return createResponse({
          error: `Ticker ${requestedTicker} not found or price unavailable`,
          ticker: requestedTicker
        }, e);
      }

      return createResponse({
        ticker: requestedTicker,
        current: quote.price,
        priceSource: quote.priceSource || 'REGULAR',
        close: quote.previousClose,
        high: quote.high,
        low: quote.low,
        preMarket: quote.preMarket || null,
        afterHours: quote.afterHours || null,
        marketState: quote.marketState || 'UNKNOWN',
        source: quote.source,
        updatedAt: quote.timestamp
      }, e);
    }

    // All tickers (IB Helper default: TQQQ, SOXL, BITU, SGOV, BIL, BILS)
    const quotes = getIBHelperQuotes();
    const prices = {};

    Object.keys(quotes).forEach(ticker => {
      const q = quotes[ticker];
      if (q && q.price > 0) {
        prices[ticker] = {
          current: q.price,
          priceSource: q.priceSource || 'REGULAR',
          close: q.previousClose,
          high: q.high,
          low: q.low,
          preMarket: q.preMarket || null,
          afterHours: q.afterHours || null,
          marketState: q.marketState || 'UNKNOWN',
          source: q.source,
          updatedAt: q.timestamp
        };
      }
    });

    return createResponse({
      count: Object.keys(prices).length,
      timestamp: new Date().toISOString(),
      prices: prices
    }, e);

  } catch (error) {
    Logger.log('doGet error: ' + error.message);
    return createResponse({ error: error.message }, e);
  }
}

/**
 * Create JSON or JSONP response
 * 🔴 v2.1.0: Added callback whitelist validation (XSS prevention)
 *
 * @param {Object} data - Response data
 * @param {Object} e - Event object (for callback parameter)
 * @returns {TextOutput}
 */
function createResponse(data, e) {
  const jsonStr = JSON.stringify(data);

  // JSONP support: ?callback=funcName → funcName({...})
  const callback = e && e.parameter && e.parameter.callback;
  if (callback) {
    // 🔴 Security: callback whitelist validation (XSS prevention)
    // Only allow: jsonp_cb_ prefix + alphanumeric/underscore/$
    const callbackPattern = /^jsonp_cb_[A-Za-z0-9_$.]+$/;
    if (!callbackPattern.test(callback)) {
      // Invalid callback → return JSON only (no JSONP execution)
      Logger.log('Invalid JSONP callback rejected: ' + callback);
      return ContentService
        .createTextOutput(jsonStr)
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Valid JSONP: callback(data)
    return ContentService
      .createTextOutput(callback + '(' + jsonStr + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // Regular JSON
  return ContentService
    .createTextOutput(jsonStr)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Test doGet locally
 */
function testDoGet() {
  // Test: all prices
  const result1 = doGet(null);
  Logger.log('All prices:');
  Logger.log(result1.getContent());

  // Test: single ticker
  const result2 = doGet({ parameter: { ticker: 'TQQQ' } });
  Logger.log('TQQQ price:');
  Logger.log(result2.getContent());

  // Test: single ticker SOXL
  const result3 = doGet({ parameter: { ticker: 'SOXL' } });
  Logger.log('SOXL price:');
  Logger.log(result3.getContent());

  // Test: invalid JSONP callback (should return JSON)
  const result4 = doGet({ parameter: { callback: 'alert("xss")' } });
  Logger.log('Invalid callback test:');
  Logger.log(result4.getContent());

  // Test: valid JSONP callback
  const result5 = doGet({ parameter: { callback: 'jsonp_cb_12345' } });
  Logger.log('Valid JSONP callback test:');
  Logger.log(result5.getContent());
}
