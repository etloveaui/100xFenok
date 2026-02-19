/**
 * Yahoo Quotes - Market Data Fetcher
 *
 * Reusable Yahoo Finance API wrapper for indices, ETFs, and stocks.
 * Adapted from IB Helper yahoo-quotes.gs, simplified for market data use.
 *
 * Features:
 * - Single and batch symbol fetching
 * - Pre-market / After-hours price support
 * - 5-minute CacheService for rate limiting
 * - Clean error handling with null returns (no throws)
 *
 * @version 1.1.0
 * @created 2026-02-11
 * @project 100x Market Data (standalone GAS)
 */

// =============================================================================
// Configuration
// =============================================================================

var YAHOO_CONFIG = {
  BASE_URL: 'https://query1.finance.yahoo.com/v8/finance/chart/',
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  TIMEOUT_MS: 10000,
  CACHE_TTL_SECONDS: 300  // 5 minutes
};

// =============================================================================
// Market State (Time-Based)
// =============================================================================

/**
 * Calculate market state from EST time.
 * Yahoo's meta.marketState is unreliable (returns UNKNOWN outside hours).
 * This is the proven IB Helper solution.
 *
 * @returns {string} 'PRE' | 'REGULAR' | 'POST' | 'CLOSED'
 */
function getMarketState() {
  var now = new Date();
  var estOffset = -5; // EST offset from UTC
  var utcHours = now.getUTCHours();
  var utcMinutes = now.getUTCMinutes();
  var estHours = ((utcHours + estOffset + 24) % 24) + (utcMinutes / 60);
  var day = now.getUTCDay();

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
// Core API
// =============================================================================

/**
 * Fetch quote for a single symbol from Yahoo Finance.
 *
 * @param {string} symbol - Ticker (e.g. 'XLK', '^GSPC', '^VIX')
 * @returns {Object|null} Quote object or null on failure
 */
function yahooGetQuote(symbol) {
  if (!symbol) return null;
  symbol = String(symbol).trim().toUpperCase();

  // Check cache first
  var cache = CacheService.getScriptCache();
  var cacheKey = 'yq_' + symbol;
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* stale cache, refetch */ }
  }

  // Fetch from Yahoo
  var url = YAHOO_CONFIG.BASE_URL +
    encodeURIComponent(symbol) +
    '?interval=1d&range=1d&includePrePost=true';

  try {
    var response = UrlFetchApp.fetch(url, {
      headers: { 'User-Agent': YAHOO_CONFIG.USER_AGENT },
      muteHttpExceptions: true,
      followRedirects: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('Yahoo HTTP ' + response.getResponseCode() + ' for ' + symbol);
      return null;
    }

    var json = JSON.parse(response.getContentText());
    var result = json.chart && json.chart.result;
    if (!result || result.length === 0) {
      Logger.log('Yahoo empty result for ' + symbol);
      return null;
    }

    var meta = result[0].meta;
    var indicators = result[0].indicators;
    var quote = indicators && indicators.quote && indicators.quote[0];

    // Build quote object
    var lastIdx = quote ? quote.close.length - 1 : 0;
    var price = meta.regularMarketPrice || (quote ? quote.close[lastIdx] : 0);
    var previousClose = meta.previousClose || meta.chartPreviousClose || 0;

    // Use time-based market state (Yahoo's meta.marketState is unreliable)
    var marketState = getMarketState();

    var obj = {
      symbol: symbol,
      price: _round(price),
      previousClose: _round(previousClose),
      change: _round(price - previousClose),
      changePercent: previousClose > 0 ? _round((price - previousClose) / previousClose * 100) : 0,
      high: quote ? _round(quote.high[lastIdx]) : 0,
      low: quote ? _round(quote.low[lastIdx]) : 0,
      open: quote ? _round(quote.open[lastIdx]) : 0,
      volume: quote ? (quote.volume[lastIdx] || 0) : 0,
      preMarket: meta.preMarketPrice ? _round(meta.preMarketPrice) : null,
      afterHours: meta.postMarketPrice ? _round(meta.postMarketPrice) : null,
      marketState: marketState,
      source: 'YAHOO',
      timestamp: new Date().toISOString()
    };

    // Cache result
    try {
      cache.put(cacheKey, JSON.stringify(obj), YAHOO_CONFIG.CACHE_TTL_SECONDS);
    } catch (e) { /* cache write failure is non-fatal */ }

    return obj;

  } catch (e) {
    Logger.log('Yahoo fetch error for ' + symbol + ': ' + e.message);
    return null;
  }
}

/**
 * Fetch quotes for multiple symbols.
 * Processes sequentially (GAS doesn't support true async).
 *
 * @param {string[]} symbols - Array of tickers
 * @returns {Object} Map of symbol → quote (null for failures)
 */
function yahooGetQuotes(symbols) {
  if (!symbols || !Array.isArray(symbols)) return {};

  var results = {};
  for (var i = 0; i < symbols.length; i++) {
    results[symbols[i]] = yahooGetQuote(symbols[i]);
  }
  return results;
}

/**
 * Get best available price based on market state.
 * PRE → preMarket, POST → afterHours, else → regular price.
 * Uses time-based getMarketState() for reliable state detection.
 *
 * @param {Object} quote - Quote from yahooGetQuote()
 * @returns {number} Best price or 0
 */
function yahooBestPrice(quote) {
  if (!quote || !quote.price) return 0;

  var state = getMarketState();

  if (state === 'PRE' && quote.preMarket && quote.preMarket > 0) {
    return quote.preMarket;
  }
  if (state === 'POST' && quote.afterHours && quote.afterHours > 0) {
    return quote.afterHours;
  }
  return quote.price;
}

// =============================================================================
// Utility
// =============================================================================

/**
 * Round to 2 decimal places.
 * @param {number} v
 * @returns {number}
 */
function _round(v) {
  if (!v || isNaN(v)) return 0;
  return Math.round(parseFloat(v) * 100) / 100;
}
