/**
 * Yahoo Quotes - Universal Stock Price Fetcher
 *
 * Fallback Chain: Yahoo Finance → Stooq → GOOGLEFINANCE
 *
 * Features:
 * - Real-time quotes (Yahoo/Stooq)
 * - Pre-market & After-hours support (Yahoo only)
 * - Multi-symbol batch fetch
 * - Automatic fallback on failure
 * - 🔴 getBestPrice(): MarketState 기반 최적 가격 선택
 * - 🔴 updatePricesSheet(): Prices 시트 자동 업데이트
 *
 * Usage:
 *   const quote = getQuote('TQQQ');
 *   const quotes = getQuotes(['TQQQ', 'SOXL', 'BITU']);
 *   const bestPrice = getBestPrice(quote);  // PRE→preMarket, POST→afterHours
 *   updatePricesSheet(['TQQQ', 'SOXL']);    // Prices 시트 업데이트
 *
 * @version 1.2.0
 * @created 2026-02-03
 * @updated 2026-02-03 (#211-P3: 프리마켓 가격 우선 로직)
 * @see vix.gs (original pattern)
 */

// =============================================================================
// Configuration
// =============================================================================

const YAHOO_QUOTES_CONFIG = {
  // Stooq Proxy (Cloudflare Worker)
  STOOQ_PROXY: 'https://stooq-proxy.etloveaui.workers.dev',

  // Yahoo Finance API
  YAHOO_BASE_URL: 'https://query1.finance.yahoo.com/v8/finance/chart/',

  // Timeouts
  TIMEOUT_MS: 10000,

  // Cache TTL (5 minutes)
  CACHE_TTL_SECONDS: 300
};

// =============================================================================
// Main API Functions
// =============================================================================

/**
 * Get quote for a single symbol
 * Fallback: Yahoo → Stooq → GOOGLEFINANCE
 *
 * @param {string} symbol - Stock symbol (e.g., 'TQQQ', 'SOXL')
 * @returns {Object} { symbol, price, previousClose, high, low, preMarket, afterHours, source, timestamp }
 */
function getQuote(symbol) {
  if (!symbol) {
    throw new Error('Symbol is required');
  }

  symbol = symbol.toUpperCase().trim();

  // Try Yahoo Finance first (supports pre/after hours)
  try {
    const yahooResult = fetchFromYahoo(symbol);
    if (yahooResult && yahooResult.price > 0) {
      Logger.log(`✅ ${symbol}: Yahoo Finance (${yahooResult.price})`);
      return yahooResult;
    }
  } catch (e) {
    Logger.log(`⚠️ ${symbol}: Yahoo failed - ${e.message}`);
  }

  // Fallback to Stooq (real-time, no pre/after)
  try {
    const stooqResult = fetchFromStooq(symbol);
    if (stooqResult && stooqResult.price > 0) {
      Logger.log(`✅ ${symbol}: Stooq fallback (${stooqResult.price})`);
      return stooqResult;
    }
  } catch (e) {
    Logger.log(`⚠️ ${symbol}: Stooq failed - ${e.message}`);
  }

  // Last resort: GOOGLEFINANCE (15min delay)
  try {
    const googleResult = fetchFromGoogleFinance(symbol);
    if (googleResult && googleResult.price > 0) {
      Logger.log(`✅ ${symbol}: GOOGLEFINANCE fallback (${googleResult.price})`);
      return googleResult;
    }
  } catch (e) {
    Logger.log(`❌ ${symbol}: All sources failed - ${e.message}`);
  }

  // All failed
  return {
    symbol: symbol,
    price: 0,
    previousClose: 0,
    high: 0,
    low: 0,
    preMarket: null,
    afterHours: null,
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
 * @returns {Object} { TQQQ: {...}, SOXL: {...}, BITU: {...} }
 */
function getIBHelperQuotes() {
  return getQuotes(['TQQQ', 'SOXL', 'BITU']);
}

// =============================================================================
// Data Source: Yahoo Finance
// =============================================================================

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

  return {
    symbol: symbol,
    price: roundPrice(meta.regularMarketPrice || quote.close[lastIndex]),
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
 * 🔴 Get best available price based on market state
 *
 * Priority (프리장/애프터장 가격 우선):
 * - PRE state + preMarket available → preMarket price
 * - POST state + afterHours available → afterHours price
 * - Otherwise → regular market price
 *
 * 한국 시간 기준:
 * - 프리장: 18:00-23:30 KST (EST 04:00-09:30)
 * - 정규장: 23:30-06:00 KST (EST 09:30-16:00)
 * - 애프터: 06:00-09:00 KST (EST 16:00-20:00)
 *
 * @param {Object} quote - Quote object from getQuote()
 * @returns {number} Best available price
 */
function getBestPrice(quote) {
  if (!quote || quote.price <= 0) {
    return 0;
  }

  const marketState = quote.marketState || 'REGULAR';

  // 🔴 프리장: preMarket 가격 우선
  if (marketState === 'PRE' && quote.preMarket && quote.preMarket > 0) {
    Logger.log(`📊 ${quote.symbol}: Using preMarket price ${quote.preMarket} (state: ${marketState})`);
    return quote.preMarket;
  }

  // 🟡 애프터장: afterHours 가격 사용
  if (marketState === 'POST' && quote.afterHours && quote.afterHours > 0) {
    Logger.log(`📊 ${quote.symbol}: Using afterHours price ${quote.afterHours} (state: ${marketState})`);
    return quote.afterHours;
  }

  // 🟢 정규장 또는 종장: 정규장 가격
  Logger.log(`📊 ${quote.symbol}: Using regular price ${quote.price} (state: ${marketState})`);
  return quote.price;
}

/**
 * Get current market state
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
// Prices Sheet Management (#211-P3: Prices 시트 자동 업데이트)
// =============================================================================

/**
 * Update Prices sheet with current quotes
 * Uses getBestPrice() to determine the best available price
 *
 * Sheet structure: | Ticker | Current | Close | High | Low | MarketState | UpdatedAt |
 *
 * @param {string[]} symbols - Array of symbols to update (default: IB Helper tickers)
 * @returns {Object} Update result
 */
function updatePricesSheet(symbols) {
  symbols = symbols || ['TQQQ', 'SOXL', 'BITU'];

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('updatePricesSheet requires spreadsheet context');
  }

  // Get or create Prices sheet
  let sheet = ss.getSheetByName('Prices');
  if (!sheet) {
    sheet = ss.insertSheet('Prices');
    // Add headers
    sheet.getRange('A1:G1').setValues([['Ticker', 'Current', 'Close', 'High', 'Low', 'MarketState', 'UpdatedAt']]);
    sheet.getRange('A1:G1').setFontWeight('bold');
  }

  // Fetch quotes
  const quotes = getQuotes(symbols);

  // Build data rows
  const rows = symbols.map(symbol => {
    const quote = quotes[symbol];
    if (!quote || quote.price <= 0) {
      return [symbol, 0, 0, 0, 0, 'ERROR', new Date().toISOString()];
    }

    // 🔴 Use getBestPrice() for Current column
    const bestPrice = getBestPrice(quote);

    return [
      symbol,
      bestPrice,                        // Current: best available price
      quote.previousClose || 0,         // Close: previous close
      quote.high || 0,                  // High
      quote.low || 0,                   // Low
      quote.marketState || 'UNKNOWN',   // MarketState: PRE/REGULAR/POST/CLOSED
      new Date().toISOString()          // UpdatedAt
    ];
  });

  // Clear existing data (keep header)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 7).clear();
  }

  // Write data
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  }

  const result = {
    success: true,
    updated: rows.length,
    timestamp: new Date().toISOString()
  };

  Logger.log(`✅ Prices sheet updated: ${rows.length} symbols`);
  return result;
}

/**
 * Update Prices sheet for IB Helper tickers
 * Convenience function for common use case
 */
function updateIBHelperPrices() {
  return updatePricesSheet(['TQQQ', 'SOXL', 'BITU']);
}

/**
 * Setup auto-update trigger (every 5 minutes during market hours)
 */
function setupPricesUpdateTrigger() {
  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'updateIBHelperPrices') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create new trigger (every 5 minutes)
  ScriptApp.newTrigger('updateIBHelperPrices')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('✅ Prices update trigger set: every 5 minutes');
}

/**
 * Remove auto-update trigger
 */
function removePricesUpdateTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'updateIBHelperPrices') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  Logger.log('✅ Prices update trigger removed');
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
  Logger.log('Current market state: ' + getMarketState());
}

/**
 * Test getBestPrice logic
 */
function testGetBestPrice() {
  const quote = getQuote('TQQQ');
  Logger.log('Full quote:');
  Logger.log(JSON.stringify(quote, null, 2));
  Logger.log('');
  Logger.log('Best price: ' + getBestPrice(quote));
  Logger.log('Market state: ' + quote.marketState);
  Logger.log('Pre-market: ' + (quote.preMarket || 'N/A'));
  Logger.log('After-hours: ' + (quote.afterHours || 'N/A'));
  Logger.log('Regular: ' + quote.price);
}

/**
 * Test Prices sheet update
 */
function testUpdatePricesSheet() {
  const result = updatePricesSheet(['TQQQ', 'SOXL']);
  Logger.log('Update result:');
  Logger.log(JSON.stringify(result, null, 2));
}
