/**
 * 100x Market Data - Main Application
 *
 * Standalone GAS project serving real-time market data via WebApp.
 * Fetches major indices, 11 sector ETFs, and VIX from Yahoo Finance.
 *
 * WebApp Endpoint:
 *   GET /exec                    → all data
 *   GET /exec?type=indices       → indices only
 *   GET /exec?type=sectors       → sectors only
 *   GET /exec?type=vix           → VIX only
 *   GET /exec?callback=fn        → JSONP wrapper
 *
 * @version 1.1.0
 * @created 2026-02-11
 * @project 100x Market Data (standalone GAS)
 */

// =============================================================================
// Constants
// =============================================================================

var INDICES = [
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^IXIC', name: 'NASDAQ' },
  { symbol: '^DJI',  name: 'Dow Jones' }
];

var SECTOR_ETFS = [
  { symbol: 'XLK',  name: 'Technology',       bloombergKey: 'information_technology' },
  { symbol: 'XLF',  name: 'Financials',       bloombergKey: 'financials' },
  { symbol: 'XLV',  name: 'Healthcare',       bloombergKey: 'health_care' },
  { symbol: 'XLE',  name: 'Energy',           bloombergKey: 'energy' },
  { symbol: 'XLI',  name: 'Industrials',      bloombergKey: 'industrials' },
  { symbol: 'XLC',  name: 'Communication',    bloombergKey: 'communication_services' },
  { symbol: 'XLY',  name: 'Consumer Disc.',   bloombergKey: 'consumer_discretionary' },
  { symbol: 'XLP',  name: 'Consumer Staples', bloombergKey: 'consumer_staples' },
  { symbol: 'XLRE', name: 'Real Estate',      bloombergKey: 'real_estate' },
  { symbol: 'XLB',  name: 'Materials',        bloombergKey: 'materials' },
  { symbol: 'XLU',  name: 'Utilities',        bloombergKey: 'utilities' }
];

var VIX_SYMBOL = '^VIX';

// Market regime thresholds (VIX-based)
var REGIME_THRESHOLDS = {
  GROWTH:    { max: 20, label: 'Growth',    color: 'green' },
  NEUTRAL:   { max: 25, label: 'Neutral',   color: 'blue' },
  DEFENSIVE: { max: 30, label: 'Defensive', color: 'orange' },
  RISK_OFF:  { max: 999, label: 'Risk-Off', color: 'red' }
};

// =============================================================================
// Data Fetch Functions
// =============================================================================

/**
 * Fetch major indices (S&P 500, NASDAQ, Dow Jones).
 * @returns {Object} Map of symbol → quote with name
 */
function fetchIndices() {
  var symbols = INDICES.map(function(i) { return i.symbol; });
  var quotes = yahooGetQuotes(symbols);
  var result = {};

  INDICES.forEach(function(idx) {
    var q = quotes[idx.symbol];
    result[idx.symbol] = q ? {
      name: idx.name,
      price: q.price,
      change: q.change,
      changePercent: q.changePercent,
      marketState: q.marketState
    } : {
      name: idx.name,
      price: 0, change: 0, changePercent: 0,
      marketState: 'ERROR', error: 'Fetch failed'
    };
  });

  return result;
}

/**
 * Fetch 11 sector ETFs.
 * @returns {Object} Map of symbol → quote with name and bloombergKey
 */
function fetchSectors() {
  var symbols = SECTOR_ETFS.map(function(s) { return s.symbol; });
  var quotes = yahooGetQuotes(symbols);
  var result = {};

  SECTOR_ETFS.forEach(function(etf) {
    var q = quotes[etf.symbol];
    result[etf.symbol] = q ? {
      name: etf.name,
      bloombergKey: etf.bloombergKey,
      price: q.price,
      change: q.change,
      changePercent: q.changePercent,
      marketState: q.marketState
    } : {
      name: etf.name,
      bloombergKey: etf.bloombergKey,
      price: 0, change: 0, changePercent: 0,
      marketState: 'ERROR', error: 'Fetch failed'
    };
  });

  return result;
}

/**
 * Fetch VIX and calculate market regime.
 * @returns {Object} VIX data + regime
 */
function fetchVIX() {
  var q = yahooGetQuote(VIX_SYMBOL);

  var vixValue = q ? q.price : 0;
  var regime = calculateRegime(vixValue);

  return {
    price: vixValue,
    change: q ? q.change : 0,
    changePercent: q ? q.changePercent : 0,
    regime: regime,
    marketState: q ? q.marketState : 'ERROR',
    timestamp: q ? q.timestamp : new Date().toISOString()
  };
}

/**
 * Fetch all market data (indices + sectors + VIX).
 * @returns {Object} Combined data object
 */
function fetchAll() {
  var data = {
    indices: fetchIndices(),
    sectors: fetchSectors(),
    vix: fetchVIX(),
    timestamp: new Date().toISOString(),
    version: '1.1.0'
  };

  // Use time-based market state (consistent across all responses)
  data.marketState = getMarketState();

  return data;
}

// =============================================================================
// Market Regime
// =============================================================================

/**
 * Calculate market regime from VIX level.
 * @param {number} vix - Current VIX value
 * @returns {Object} { label, color }
 */
function calculateRegime(vix) {
  if (!vix || vix <= 0) return { label: 'Unknown', color: 'gray' };

  if (vix < REGIME_THRESHOLDS.GROWTH.max) return REGIME_THRESHOLDS.GROWTH;
  if (vix < REGIME_THRESHOLDS.NEUTRAL.max) return REGIME_THRESHOLDS.NEUTRAL;
  if (vix < REGIME_THRESHOLDS.DEFENSIVE.max) return REGIME_THRESHOLDS.DEFENSIVE;
  return REGIME_THRESHOLDS.RISK_OFF;
}

// =============================================================================
// WebApp Endpoint
// =============================================================================

/**
 * WebApp GET handler.
 *
 * Parameters:
 *   type     = 'all' (default) | 'indices' | 'sectors' | 'vix'
 *   callback = JSONP callback function name (optional)
 *
 * @param {Object} e - Event object from Apps Script
 * @returns {TextOutput} JSON or JSONP response
 */
function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var type = (params.type || 'all').toLowerCase();
  var callback = params.callback || '';

  var data;
  try {
    switch (type) {
      case 'indices':
        data = { indices: fetchIndices(), timestamp: new Date().toISOString() };
        break;
      case 'sectors':
        data = { sectors: fetchSectors(), timestamp: new Date().toISOString() };
        break;
      case 'vix':
        data = fetchVIX();
        break;
      default:
        data = fetchAll();
    }
  } catch (err) {
    data = { error: err.message, timestamp: new Date().toISOString() };
  }

  var json = JSON.stringify(data);

  // JSONP support (with security filter)
  if (callback && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================================================
// Sheet Management
// =============================================================================

/**
 * Update Market Data sheet with current data.
 * Creates sheets if they don't exist.
 */
function updateMarketDataSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log('No active spreadsheet');
    return;
  }

  var data = fetchAll();

  // --- Indices sheet ---
  var indicesSheet = _getOrCreateSheet(ss, 'Indices', ['Symbol', 'Name', 'Price', 'Change', 'Change%', 'MarketState', 'Updated']);
  var indicesRows = INDICES.map(function(idx) {
    var d = data.indices[idx.symbol] || {};
    return [idx.symbol, idx.name, d.price || 0, d.change || 0, d.changePercent || 0, d.marketState || '', new Date().toISOString()];
  });
  _writeRows(indicesSheet, indicesRows);

  // --- Sectors sheet ---
  var sectorsSheet = _getOrCreateSheet(ss, 'Sectors', ['Symbol', 'Name', 'BloombergKey', 'Price', 'Change', 'Change%', 'MarketState', 'Updated']);
  var sectorRows = SECTOR_ETFS.map(function(etf) {
    var d = data.sectors[etf.symbol] || {};
    return [etf.symbol, etf.name, etf.bloombergKey, d.price || 0, d.change || 0, d.changePercent || 0, d.marketState || '', new Date().toISOString()];
  });
  _writeRows(sectorsSheet, sectorRows);

  // --- VIX sheet ---
  var vixSheet = _getOrCreateSheet(ss, 'VIX', ['Price', 'Change', 'Change%', 'Regime', 'RegimeColor', 'MarketState', 'Updated']);
  var vixData = data.vix || {};
  var vixRow = [[
    vixData.price || 0,
    vixData.change || 0,
    vixData.changePercent || 0,
    vixData.regime ? vixData.regime.label : '',
    vixData.regime ? vixData.regime.color : '',
    vixData.marketState || '',
    new Date().toISOString()
  ]];
  _writeRows(vixSheet, vixRow);

  Logger.log('Market Data sheet updated: ' + data.timestamp);
}

// =============================================================================
// Sheet Helpers
// =============================================================================

/**
 * Get existing sheet or create with headers.
 */
function _getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Write rows to sheet (row 2 onwards, clearing old data).
 */
function _writeRows(sheet, rows) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clear();
  }
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

// =============================================================================
// Trigger Management
// =============================================================================

/**
 * Setup 5-minute trigger for sheet updates.
 * Only runs during US market hours (adjust via shouldRun check).
 */
function setupTrigger() {
  removeTrigger();
  ScriptApp.newTrigger('updateMarketDataSheet')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Trigger set: updateMarketDataSheet every 5 minutes');
}

/**
 * Remove existing triggers.
 */
function removeTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'updateMarketDataSheet') {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log('Triggers removed');
}

// =============================================================================
// Test Functions
// =============================================================================

function testFetchAll() {
  var data = fetchAll();
  Logger.log(JSON.stringify(data, null, 2));
}

function testFetchIndices() {
  var data = fetchIndices();
  Logger.log(JSON.stringify(data, null, 2));
}

function testFetchSectors() {
  var data = fetchSectors();
  Logger.log(JSON.stringify(data, null, 2));
}

function testFetchVIX() {
  var data = fetchVIX();
  Logger.log(JSON.stringify(data, null, 2));
}

function testDoGet() {
  // Simulate WebApp call
  var mockEvent = { parameter: { type: 'all' } };
  var output = doGet(mockEvent);
  Logger.log(output.getContent());
}

function testDoGetSectors() {
  var mockEvent = { parameter: { type: 'sectors' } };
  var output = doGet(mockEvent);
  Logger.log(output.getContent());
}

function testDoGetJsonp() {
  var mockEvent = { parameter: { type: 'all', callback: 'handleMarketData' } };
  var output = doGet(mockEvent);
  Logger.log(output.getContent());
}
