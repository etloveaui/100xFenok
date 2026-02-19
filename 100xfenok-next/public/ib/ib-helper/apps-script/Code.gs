/**
 * IB Helper - Order Execution Automation
 * Google Apps Script for Google Sheets
 *
 * @version 3.1.0
 * @author 100xFenok Claude
 * @decision DEC-153 (2026-02-03), DEC-155 (2026-02-04), DEC-162 (2026-02-04)
 *
 * HOW TO USE:
 * 1. Open your Google Sheet
 * 2. Extensions > Apps Script
 * 3. Paste this code (replace all)
 * 4. Save (Ctrl+S)
 * 5. Run `setupTrigger()` once for daily auto execution (09:00 KST)
 *
 * SHEET STRUCTURE REQUIRED:
 * - Sheet1 "Portfolio": Portfolio (A:O)
 * - Sheet2 "Prices": GOOGLEFINANCE prices (manual setup)
 * - Sheet3 "Orders": Order history (A:M - auto-created)
 *
 * CHANGELOG:
 * - v3.1.0 (2026-02-20): ExecutionLog noise reduction (EXECUTED-only), 30-day log rotation, ARCHIVE_DAYS 14→7
 * - v3.0.0 (2026-02-19): Pipeline reliability overhaul — 10 fixes (S-1, S-2, S-3, D-1~D-4, R-1, R-2)
 * - v2.9.0 (2026-02-12): CRITICAL fix — removeStaleOrders moved AFTER checkExecutions (was deleting before checking)
 * - v2.8.1 (2026-02-12): removeStaleOrders Phase1 fix — date<today = all stale (not per-group)
 * - v2.8.0 (2026-02-12): removeStaleOrders() - stale BUY+SELL cleanup before execution
 * - v2.7.0 (2026-02-10): ExecutionLog + Orders Archive (14-day rolling)
 * - v2.5.0 (2026-02-08): NYSE holiday detection (Rule-based, no API)
 * - v2.4.0 (2026-02-08): shouldProcessToday() weekend guard + defensive trim/toUpperCase
 * - v2.3.3 (2026-02-08): totalInvested commission fix (balance consistency)
 * - v2.3.2 (2026-02-06): Portfolio revision(O열) 갱신 + 문서 주석 A:O 반영
 * - v2.3.1 (2026-02-04): Dedupe key simplified (drop price/qty)
 * - v2.3.0 (2026-02-04): Balance migration + commission per profile
 * - v2.2.0 (2026-02-04): Auto balance update on execution + commission config
 * - v2.1.0 (2026-02-04): Added dedupeOrders() for duplicate prevention
 * - v2.0.0 (2026-02-03): Initial release
 */

// =====================================================
// CONFIGURATION
// =====================================================

const CONFIG = {
  PORTFOLIO_SHEET: 'Portfolio',
  PRICES_SHEET: 'Prices',
  ORDERS_SHEET: 'Orders',
  BALANCE_SHEET: 'Balance',  // Optional
  TIMEZONE: 'Asia/Seoul',
  COMMISSION_RATE: 0.0007,  // 0.07%
  EXECUTION_LOG_SHEET: 'ExecutionLog',
  ORDERS_ARCHIVE_SHEET: 'Orders_Archive',
  ARCHIVE_DAYS: 7,  // Days to keep executed orders before archiving
  EXECUTION_LOG_RETENTION_DAYS: 30  // Days to keep ExecutionLog entries
};

// =====================================================
// UTILITY: Date Parsing
// =====================================================

/**
 * Parse order date from various formats
 * Supports: Date object, 'yyyy-MM-dd' (ISO), 'yyyy. M. d' (Korean locale)
 */
function parseOrderDate(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') return value;
  if (typeof value === 'string') {
    var trimmed = value.trim();
    // 1) yyyy-MM-dd (ISO format from Code.gs trigger)
    try {
      var parsed = Utilities.parseDate(trimmed, CONFIG.TIMEZONE, 'yyyy-MM-dd');
      if (!isNaN(parsed.getTime())) return parsed;
    } catch (e) {}
    // 2) "2026. 2. 4" (Korean locale from manual/browser execution)
    var m = trimmed.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})$/);
    if (m) {
      var d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
      if (!isNaN(d.getTime())) return d;
    }
  }
  // 3) Fallback: native JS Date parsing
  var fallback = new Date(value);
  return isNaN(fallback.getTime()) ? null : fallback;
}

// =====================================================
// MAIN ENTRY POINTS
// =====================================================

function normalizeCommissionRate(input) {
  const rate = parseFloat(input);
  if (isNaN(rate)) return 0;
  return rate > 0.01 ? rate / 100 : rate;
}

/**
 * Weekend + NYSE holiday guard
 * Checks if US market was open yesterday (KST today = US yesterday)
 * @returns {boolean} true if today should be processed
 */
function shouldProcessToday() {
  const now = new Date();
  const kstDay = parseInt(Utilities.formatDate(now, CONFIG.TIMEZONE, 'u')); // ISO: 1=Mon..7=Sun

  // KST Sunday(7) = US Saturday, KST Monday(1) = US Sunday
  if (kstDay === 7 || kstDay === 1) {
    Logger.log('shouldProcessToday: SKIP (KST day=' + kstDay + ', US market closed - weekend)');
    return false;
  }

  // Check NYSE holiday (US yesterday = KST today - 1 day adjusted)
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (isNyseHoliday(yesterday)) {
    const dateStr = Utilities.formatDate(yesterday, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    Logger.log('shouldProcessToday: SKIP (US date=' + dateStr + ', NYSE holiday)');
    return false;
  }

  return true;
}

// =====================================================
// NYSE HOLIDAY DETECTION (Rule-based, no API)
// Reference: github.com/tsekityam/nyse-holidays (MIT License)
// =====================================================

/**
 * Easter Sunday calculation using Anonymous Gregorian Algorithm (Gauss)
 * @param {number} year - Full year (e.g., 2026)
 * @returns {Date} Easter Sunday date
 */
function getEasterSunday(year) {
  const f = Math.floor;
  const G = year % 19;
  const C = f(year / 100);
  const H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30;
  const I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11));
  const J = (year + f(year / 4) + I + 2 - C + f(C / 4)) % 7;
  const L = I - J;
  const month = 3 + f((L + 40) / 44); // 3=Mar, 4=Apr
  const day = L + 28 - 31 * f(month / 4);
  return new Date(year, month - 1, day); // month is 0-indexed
}

/**
 * Get N-th occurrence of a weekday in a month
 * @param {number} year - Full year
 * @param {number} month - Month (1-12)
 * @param {number} dayOfWeek - Day of week (0=Sun, 1=Mon, ..., 6=Sat)
 * @param {number} n - Occurrence (1=first, 2=second, 3=third, 4=fourth)
 * @returns {Date} Target date
 */
function getNthDayOfMonth(year, month, dayOfWeek, n) {
  const firstDay = new Date(year, month - 1, 1);
  const firstDayOfWeek = firstDay.getDay();
  let offset = dayOfWeek - firstDayOfWeek;
  if (offset < 0) offset += 7;
  const day = 1 + offset + (n - 1) * 7;
  return new Date(year, month - 1, day);
}

/**
 * Get last occurrence of a weekday in a month
 * @param {number} year - Full year
 * @param {number} month - Month (1-12)
 * @param {number} dayOfWeek - Day of week (0=Sun, 1=Mon, ..., 6=Sat)
 * @returns {Date} Target date
 */
function getLastDayOfMonth(year, month, dayOfWeek) {
  const lastDay = new Date(year, month, 0); // Last day of month
  const lastDayOfWeek = lastDay.getDay();
  let offset = lastDayOfWeek - dayOfWeek;
  if (offset < 0) offset += 7;
  return new Date(year, month - 1, lastDay.getDate() - offset);
}

/**
 * Adjust date for weekend observance
 * NYSE Rule: Saturday → Friday, Sunday → Monday
 * @param {Date} date - Original holiday date
 * @returns {Date} Observed holiday date
 */
function adjustForWeekend(date) {
  const dow = date.getDay();
  if (dow === 6) { // Saturday → Friday
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
  }
  if (dow === 0) { // Sunday → Monday
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  }
  return date;
}

/**
 * Check if given date is NYSE holiday
 * 10 Fixed NYSE Holidays (2022+, after Juneteenth addition)
 * @param {Date} date - Date to check
 * @returns {boolean} true if NYSE is closed
 */
function isNyseHoliday(date) {
  const year = date.getFullYear();
  const dateStr = Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd');

  // Helper to format Date as yyyy-MM-dd string
  const fmt = (d) => Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');

  // 1. New Year's Day (Jan 1)
  if (dateStr === fmt(adjustForWeekend(new Date(year, 0, 1)))) return true;

  // 2. MLK Day (3rd Monday of January, since 1998)
  if (year >= 1998 && dateStr === fmt(getNthDayOfMonth(year, 1, 1, 3))) return true;

  // 3. Presidents' Day (3rd Monday of February)
  if (dateStr === fmt(getNthDayOfMonth(year, 2, 1, 3))) return true;

  // 4. Good Friday (2 days before Easter Sunday)
  const easter = getEasterSunday(year);
  const goodFriday = new Date(easter.getTime() - 2 * 24 * 60 * 60 * 1000);
  if (dateStr === fmt(goodFriday)) return true;

  // 5. Memorial Day (Last Monday of May)
  if (dateStr === fmt(getLastDayOfMonth(year, 5, 1))) return true;

  // 6. Juneteenth (June 19, since 2022)
  if (year >= 2022 && dateStr === fmt(adjustForWeekend(new Date(year, 5, 19)))) return true;

  // 7. Independence Day (July 4)
  if (dateStr === fmt(adjustForWeekend(new Date(year, 6, 4)))) return true;

  // 8. Labor Day (1st Monday of September)
  if (dateStr === fmt(getNthDayOfMonth(year, 9, 1, 1))) return true;

  // 9. Thanksgiving (4th Thursday of November)
  if (dateStr === fmt(getNthDayOfMonth(year, 11, 4, 4))) return true;

  // 10. Christmas (Dec 25)
  if (dateStr === fmt(adjustForWeekend(new Date(year, 11, 25)))) return true;

  return false;
}

/**
 * Process order executions
 * Main function - run daily at 09:00 KST (after US market close)
 */
function processOrderExecutions() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    Logger.log('processOrderExecutions: skipped (could not acquire lock)');
    return;
  }

  try {
    if (!shouldProcessToday()) {
      return;
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ordersSheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);
    const pricesSheet = ss.getSheetByName(CONFIG.PRICES_SHEET);

    if (!ordersSheet) {
      Logger.log('Orders sheet not found');
      return;
    }

    // 🔴 v2.1.0: Orders dedupe before processing
    try {
      dedupeOrders(ordersSheet);
    } catch (error) {
      Logger.log('dedupeOrders error (ignored): ' + error.message);
    }

    if (!pricesSheet) {
      Logger.log('Prices sheet not found - please create it with GOOGLEFINANCE formulas');
      return;
    }

    // 1. Load yesterday's prices
    const prices = loadYesterdayPrices(pricesSheet);
    // v3.0.0 (D-4): Zero-price guard — null means all prices are 0
    if (!prices) {
      Logger.log('Pipeline HALTED: all prices are 0 — aborting to prevent false executions');
      return;
    }
    Logger.log('Loaded prices: ' + JSON.stringify(prices));

    // 2. Load pending orders (execution column = empty) — includes old-date orders
    const pendingOrders = loadPendingOrders(ordersSheet);
    Logger.log('Pending orders: ' + pendingOrders.length);

    // 3. Check executions FIRST (marks Y for executed orders)
    //    🔴 v2.9.0: Must run BEFORE removeStaleOrders so yesterday's orders
    //    get checked against yesterday's prices before cleanup
    const logEntries = [];
    const executedOrders = checkExecutions(pendingOrders, prices, logEntries);
    Logger.log('Executed orders: ' + executedOrders.length);

    // 4. Update Orders sheet (write Y back to sheet)
    if (executedOrders.length > 0) {
      updateOrdersSheet(ordersSheet, executedOrders);

      // 5. Update Portfolio
      updatePortfolio(ss, executedOrders);
    }

    // 6. 🔴 v2.9.0: Remove stale orders AFTER checkExecutions
    //    Now executed orders have Y → removeStaleOrders skips them
    //    Only non-executed old-date orders get deleted
    try {
      removeStaleSellOrders(ordersSheet, ss.getSheetByName(CONFIG.PORTFOLIO_SHEET));
    } catch (error) {
      Logger.log('removeStaleOrders error (ignored): ' + error.message);
    }

    // 7. Write execution log (failure won't break main pipeline)
    try {
      writeExecutionLog(ss, logEntries);
    } catch (logError) {
      Logger.log('writeExecutionLog error (ignored): ' + logError.message);
    }

    // 8. Archive old executed orders (failure won't break main pipeline)
    try {
      archiveOldOrders(ss, ordersSheet);
    } catch (archiveError) {
      Logger.log('archiveOldOrders error (ignored): ' + archiveError.message);
    }

    // 9. v3.1.0: Rotate old ExecutionLog entries (failure won't break main pipeline)
    try {
      rotateExecutionLog(ss);
    } catch (rotateError) {
      Logger.log('rotateExecutionLog error (ignored): ' + rotateError.message);
    }

    Logger.log('Process complete: ' + executedOrders.length + ' orders executed');
  } finally {
    lock.releaseLock();
  }
}

// =====================================================
// PRICE LOADING
// =====================================================

/**
 * Load yesterday's prices from Prices sheet
 * Expected structure:
 * | A: Ticker | B: Price | C: Close | D: High |
 *
 * @param {Sheet} sheet - Prices sheet
 * @returns {Object} { TICKER: { close: number, high: number } }
 */
function loadYesterdayPrices(sheet) {
  const data = sheet.getDataRange().getValues();
  const prices = {};

  // Skip header row
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const ticker = String(row[0]).trim().toUpperCase();
    if (!ticker) continue;

    prices[ticker] = {
      close: parseFloat(row[2]) || 0,  // C: Close
      high: parseFloat(row[3]) || 0    // D: High
    };
  }

  // v3.0.0 (D-4): Zero-price validation — halt pipeline if ALL prices are 0
  const tickers = Object.keys(prices);
  if (tickers.length > 0) {
    let allZero = true;
    for (let t = 0; t < tickers.length; t++) {
      const p = prices[tickers[t]];
      if (p.close !== 0 || p.high !== 0) {
        allZero = false;
        break;
      }
      Logger.log('⚠️ Zero price: ' + tickers[t] + ' close=0, high=0');
    }
    if (allZero) {
      Logger.log('🛑 HALT: ALL prices are 0 — pipeline aborted to prevent false executions');
      return null;
    }
  }

  return prices;
}

// =====================================================
// ORDER LOADING
// =====================================================

/**
 * Load pending orders from Orders sheet
 * Pending = execution column (K) is empty
 *
 * @param {Sheet} sheet - Orders sheet
 * @returns {Array} Array of order objects
 */
function loadPendingOrders(sheet) {
  const data = sheet.getDataRange().getValues();
  const allPending = [];

  // Phase 1: Load all pending orders (K=empty/N)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const execution = String(row[10]).trim();  // K: execution

    // Only pending orders
    if (execution !== '' && execution !== 'N') continue;

    allPending.push({
      rowIndex: i + 1,  // 1-indexed for Sheet
      date: row[0],          // A: date
      googleId: row[1],      // B: googleId
      profileId: row[2],     // C: profileId
      ticker: String(row[3]).trim().toUpperCase(),  // D: ticker
      orderType: row[4],     // E: orderType
      side: row[5],          // F: side (BUY/SELL)
      price: parseFloat(row[6]) || 0,    // G: price
      quantity: parseInt(row[7]) || 0,   // H: quantity
      total: parseFloat(row[8]) || 0,    // I: total
      executionBasis: row[9], // J: executionBasis (CLOSE/HIGH)
      execution: row[10],    // K: execution
      executionDate: row[11],// L: executionDate
      actualPrice: row[12]   // M: actualPrice
    });
  }

  // v3.0.0 (S-2): Latest-date filter — keep only the most recent push per group
  // Group key: googleId|profileId|ticker|side (NOT including orderType)
  const maxDateByGroup = {};
  allPending.forEach(order => {
    const orderDate = parseOrderDate(order.date);
    if (!orderDate) return;
    const dateStr = Utilities.formatDate(orderDate, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    const groupKey = `${order.googleId}|${order.profileId}|${order.ticker}|${order.side}`;
    if (!maxDateByGroup[groupKey] || dateStr > maxDateByGroup[groupKey]) {
      maxDateByGroup[groupKey] = dateStr;
    }
  });

  // Phase 3: Filter — keep only orders matching MAX(date) for their group
  const filtered = allPending.filter(order => {
    const orderDate = parseOrderDate(order.date);
    if (!orderDate) return true;  // keep unparseable dates
    const dateStr = Utilities.formatDate(orderDate, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    const groupKey = `${order.googleId}|${order.profileId}|${order.ticker}|${order.side}`;
    return dateStr === maxDateByGroup[groupKey];
  });

  Logger.log('loadPendingOrders: total=' + allPending.length + ' → filtered=' + filtered.length);
  return filtered;
}

// =====================================================
// ORDER DEDUPE (v2.1.0)
// =====================================================

/**
 * Remove duplicate orders from Orders sheet
 * Duplicate key: date + googleId + profileId + ticker + orderType + side + executionBasis
 *
 * @param {Sheet} sheet - Orders sheet (optional)
 */
function dedupeOrders(sheet, daysLimit = 30) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ordersSheet = sheet || ss.getSheetByName(CONFIG.ORDERS_SHEET);

  if (!ordersSheet) {
    Logger.log('dedupeOrders: Orders sheet not found');
    return;
  }

  const data = ordersSheet.getDataRange().getValues();
  if (!data || data.length <= 1) return;

  const header = data[0];
  const colCount = header.length;
  const executedKeys = {};
  const dedupeCandidates = {};
  const keepFlags = new Array(data.length).fill(false);
  keepFlags[0] = true; // header placeholder

  const hasDaysLimit = typeof daysLimit === 'number' && daysLimit > 0;
  const cutoffDate = hasDaysLimit ? new Date() : null;
  if (hasDaysLimit && cutoffDate) {
    cutoffDate.setDate(cutoffDate.getDate() - daysLimit);
  }

  const buildKey = (row) => {
    const date = row[0];
    const googleId = row[1];
    const profileId = row[2];
    const ticker = String(row[3] || '').trim().toUpperCase();
    const orderType = String(row[4] || '').trim();
    const side = String(row[5] || '').trim().toUpperCase();
    const executionBasis = String(row[9] || '').trim().toUpperCase();

    if (!date || !googleId || !profileId || !ticker || !orderType || !side || !executionBasis) {
      return null;
    }

    return `${date}|${googleId}|${profileId}|${ticker}|${orderType}|${side}|${executionBasis}`;
  };

  const withinWindow = (orderDate) => {
    if (!hasDaysLimit) return true;
    if (!orderDate || !cutoffDate) return false;
    return orderDate >= cutoffDate;
  };

  const byPriority = (a, b) => {
    const execScore = (meta) => (meta.execution === 'Y' ? 2 : 1);
    const execDiff = execScore(b) - execScore(a);
    if (execDiff !== 0) return execDiff;
    return b.idx - a.idx; // 최신 우선
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const isEmpty = row.every(cell => cell === '' || cell === null);
    if (isEmpty) continue;

    const execution = String(row[10] || '').trim().toUpperCase();
    const idx = i;
    const key = buildKey(row);
    const orderDate = parseOrderDate(row[0]);

    if (execution === 'Y') {
      keepFlags[idx] = true;
      if (key) executedKeys[key] = true;
      continue;
    }

    if (!key) {
      keepFlags[idx] = true;  // malformed rows: keep
      continue;
    }
    if (!withinWindow(orderDate)) {
      keepFlags[idx] = false;  // v3.0.0 (S-1): DELETE ancient orders (>30 days)
      continue;
    }

    if (!dedupeCandidates[key]) dedupeCandidates[key] = [];
    dedupeCandidates[key].push({ row, idx, execution });
  }

  Object.keys(dedupeCandidates).forEach((key) => {
    if (executedKeys[key]) {
      return; // 체결된 주문이 있으면 non-Y는 제거
    }
    const group = dedupeCandidates[key];
    group.sort(byPriority);
    const winner = group[0];
    keepFlags[winner.idx] = true;
  });

  const uniqueRows = [header];
  for (let i = 1; i < data.length; i++) {
    if (keepFlags[i]) {
      uniqueRows.push(data[i]);
    }
  }

  if (uniqueRows.length === data.length) {
    Logger.log('dedupeOrders: No duplicates found');
    return;
  }

  const normalizedRows = uniqueRows.map(row => {
    const newRow = row.slice(0, colCount);
    while (newRow.length < colCount) newRow.push('');
    return newRow;
  });

  // v3.0.0 (S-3): Save original for recovery before clearContents
  const normalizedOriginal = data.map(row => {
    const newRow = row.slice(0, colCount);
    while (newRow.length < colCount) newRow.push('');
    return newRow;
  });

  ordersSheet.clearContents();
  try {
    ordersSheet.getRange(1, 1, normalizedRows.length, colCount).setValues(normalizedRows);
  } catch (rewriteError) {
    Logger.log('CRITICAL: dedupeOrders rewrite failed, restoring: ' + rewriteError.message);
    try {
      ordersSheet.getRange(1, 1, normalizedOriginal.length, colCount).setValues(normalizedOriginal);
    } catch (restoreError) {
      Logger.log('FATAL: dedupeOrders restore also failed: ' + restoreError.message);
    }
    throw rewriteError;
  }
  Logger.log(`dedupeOrders: Removed ${data.length - uniqueRows.length} duplicate rows`);
}

// =====================================================
// STALE ORDER CLEANUP (v2.8.0)
// =====================================================

/**
 * Remove stale orders (BUY + SELL) to prevent balance miscalculation
 *
 * ROOT CAUSE: Each daily push creates orders for ALL positions.
 * Old pending orders accumulate across push dates. When price triggers,
 * ALL sets execute simultaneously — causing over-buy or balance inflation.
 *
 * Phase 1: For each googleId|profileId|ticker|side group with multiple push dates,
 *          keep only the latest date's orders, delete the rest.
 * Phase 2: For SELL only — positions with holdings=0 in Portfolio, delete ALL pending SELLs.
 *
 * @param {Sheet} ordersSheet - Orders sheet
 * @param {Sheet} portfolioSheet - Portfolio sheet (for holdings check)
 */
function removeStaleOrders(ordersSheet, portfolioSheet) {
  if (!ordersSheet) {
    Logger.log('removeStaleOrders: Orders sheet not found');
    return;
  }

  var data = ordersSheet.getDataRange().getValues();
  if (!data || data.length <= 1) return;

  var header = data[0];
  var colCount = header.length;

  // Build holdings map from Portfolio sheet (Phase 2 - SELL only)
  var holdingsMap = {};
  if (portfolioSheet) {
    var portfolioData = portfolioSheet.getDataRange().getValues();
    for (var p = 1; p < portfolioData.length; p++) {
      var pRow = portfolioData[p];
      if (!pRow || pRow.length === 0) continue;
      var pKey = String(pRow[0]).trim() + '|' + String(pRow[1]).trim() + '|' + String(pRow[3]).trim().toUpperCase();
      var h = parseInt(pRow[5]) || 0;
      holdingsMap[pKey] = (holdingsMap[pKey] || 0) + h;
    }
  }

  // Phase 1: Remove ALL pending orders older than today
  // Rationale: each day's push creates fresh orders with updated prices.
  // If an order didn't execute on its day, it's stale — next push replaces it.
  var today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  var keepFlags = new Array(data.length).fill(true);
  var removedPhase1 = 0;
  var removedPhase2 = 0;

  // Phase 2 prep: collect pending SELL info for zero-holdings check
  var pendingSells = [];  // { idx, posKey }

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row || row.length === 0) continue;

    var execution = String(row[10] || '').trim().toUpperCase();
    if (execution === 'Y') continue;  // Already executed, skip

    var side = String(row[5] || '').trim().toUpperCase();
    if (side !== 'BUY' && side !== 'SELL') continue;

    var googleId = String(row[1] || '').trim();
    var profileId = String(row[2] || '').trim();
    var ticker = String(row[3] || '').trim().toUpperCase();

    if (!googleId || !profileId || !ticker) continue;

    var orderDate = parseOrderDate(row[0]);
    var dateStr = orderDate
      ? Utilities.formatDate(orderDate, CONFIG.TIMEZONE, 'yyyy-MM-dd')
      : String(row[0]);

    // Phase 1: any pending order from before today = stale
    if (dateStr < today) {
      keepFlags[i] = false;
      removedPhase1++;
      continue;
    }

    // Phase 2 candidate: today's pending SELL with zero holdings
    if (side === 'SELL') {
      pendingSells.push({ idx: i, posKey: googleId + '|' + profileId + '|' + ticker });
    }
  }

  // Phase 2 (SELL only): Remove today's pending SELLs for holdings=0 positions
  pendingSells.forEach(function(item) {
    if (holdingsMap[item.posKey] !== undefined && holdingsMap[item.posKey] <= 0) {
      keepFlags[item.idx] = false;
      removedPhase2++;
    }
  });

  var totalRemoved = removedPhase1 + removedPhase2;
  if (totalRemoved === 0) {
    Logger.log('removeStaleOrders: No stale orders found');
    return;
  }

  // Build kept rows
  var keepRows = [header];
  for (var j = 1; j < data.length; j++) {
    if (keepFlags[j]) {
      keepRows.push(data[j]);
    }
  }

  // Normalize rows for consistent column count
  var normalizedKeep = keepRows.map(function(r) {
    var nr = r.slice(0, colCount);
    while (nr.length < colCount) nr.push('');
    return nr;
  });

  // Save original for recovery
  var normalizedOriginal = data.map(function(r) {
    var nr = r.slice(0, colCount);
    while (nr.length < colCount) nr.push('');
    return nr;
  });

  // Rewrite Orders sheet with recovery safety
  ordersSheet.clearContents();
  try {
    ordersSheet.getRange(1, 1, normalizedKeep.length, colCount).setValues(normalizedKeep);
  } catch (rewriteError) {
    Logger.log('CRITICAL: removeStaleOrders rewrite failed, restoring: ' + rewriteError.message);
    try {
      ordersSheet.getRange(1, 1, normalizedOriginal.length, colCount).setValues(normalizedOriginal);
    } catch (restoreError) {
      Logger.log('FATAL: Restore also failed: ' + restoreError.message);
    }
    throw rewriteError;
  }

  Logger.log('removeStaleOrders: Removed ' + totalRemoved +
    ' stale orders (Phase1=' + removedPhase1 + ' older-than-' + today + ', Phase2=' + removedPhase2 + ' zero-holdings-sell)');
}

// Backward compat alias
function removeStaleSellOrders(ordersSheet, portfolioSheet) {
  return removeStaleOrders(ordersSheet, portfolioSheet);
}

// =====================================================
// EXECUTION CHECK
// =====================================================

/**
 * Check which orders were executed based on price
 *
 * Execution Rules:
 * - BUY + CLOSE: close <= orderPrice -> executed
 * - SELL + CLOSE (LOC 25%): close >= orderPrice -> executed
 * - SELL + HIGH (limit 75%): high >= orderPrice -> executed
 *
 * @param {Array} orders - Pending orders
 * @param {Object} prices - Price data { TICKER: { close, high } }
 * @returns {Array} Orders that were executed
 */
function checkExecutions(orders, prices, logEntries) {
  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const user = Session.getEffectiveUser().getEmail() || 'trigger';
  const executedOrders = [];
  const highWarned = {};
  const closeWarned = {};

  orders.forEach(order => {
    const priceData = prices[order.ticker];
    if (!priceData) {
      Logger.log('No price data for: ' + order.ticker);
      if (logEntries) {
        logEntries.push({
          timestamp: new Date(), user: user, ticker: order.ticker,
          orderPrice: order.price, closePrice: null, highPrice: null,
          result: 'SKIPPED', reason: 'no price data for ' + order.ticker
        });
      }
      return;
    }

    const closePrice = parseFloat(priceData.close) || 0;
    const highPrice = parseFloat(priceData.high) || 0;

    if (order.executionBasis === 'HIGH' &&
        highPrice <= 0 &&
        !highWarned[order.ticker]) {
      Logger.log(`⚠️ HIGH ${order.ticker}: priceData.high=0 → limit sell may not execute`);
      highWarned[order.ticker] = true;
    }

    if (order.executionBasis === 'CLOSE' &&
        closePrice <= 0 &&
        !closeWarned[order.ticker]) {
      Logger.log(`⚠️ CLOSE ${order.ticker}: priceData.close<=0 → execution skipped for safety`);
      closeWarned[order.ticker] = true;
    }

    let executed = false;
    let actualPrice = 0;

    if (order.side === 'BUY') {
      // BUY: close <= orderPrice
      if (order.executionBasis === 'CLOSE' &&
          closePrice > 0 &&
          order.price > 0 &&
          closePrice <= order.price) {
        executed = true;
        actualPrice = closePrice;
      }
    } else if (order.side === 'SELL') {
      if (order.executionBasis === 'CLOSE') {
        // LOC SELL: close >= orderPrice
        if (closePrice > 0 && order.price > 0 && closePrice >= order.price) {
          executed = true;
          actualPrice = closePrice;
        }
      } else if (order.executionBasis === 'HIGH') {
        // Limit SELL: high >= orderPrice
        if (highPrice > 0 && order.price > 0 && highPrice >= order.price) {
          executed = true;
          actualPrice = order.price;  // Execute at limit price
        }
      }
    }

    if (executed) {
      order.execution = 'Y';
      order.executionDate = today;
      order.actualPrice = actualPrice;
      executedOrders.push(order);
    }

    // Collect execution log entry
    if (logEntries) {
      var basis = order.executionBasis;
      var checkPrice = (basis === 'HIGH') ? highPrice : closePrice;
      var op = order.side === 'BUY' ? '<=' : '>=';
      logEntries.push({
        timestamp: new Date(), user: user, ticker: order.ticker,
        orderPrice: order.price, closePrice: closePrice, highPrice: highPrice,
        result: executed ? 'EXECUTED' : 'PENDING',
        reason: executed
          ? basis.toLowerCase() + '(' + checkPrice + ') ' + op + ' order(' + order.price + ')'
          : basis.toLowerCase() + '(' + checkPrice + ') not ' + op + ' order(' + order.price + ')'
      });
    }
  });

  return executedOrders;
}

// =====================================================
// EXECUTION LOG
// =====================================================

/**
 * Write execution check results to ExecutionLog sheet
 * Batch write for performance. Failure doesn't affect main pipeline.
 */
function writeExecutionLog(ss, logEntries) {
  if (!logEntries || logEntries.length === 0) return;

  var HEADERS = [
    'timestamp', 'user', 'action', 'ticker', 'orderPrice',
    'closePrice', 'highPrice', 'result', 'reason'
  ];

  var sheet = ss.getSheetByName(CONFIG.EXECUTION_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.EXECUTION_LOG_SHEET);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }

  // v3.1.0: Only log EXECUTED entries (filter out PENDING/SKIPPED noise)
  var executedEntries = logEntries.filter(function(e) {
    return e.result === 'EXECUTED';
  });
  if (executedEntries.length === 0) {
    Logger.log('writeExecutionLog: 0 EXECUTED entries (skipped ' + logEntries.length + ' non-executed)');
    return;
  }

  var rows = executedEntries.map(function(e) {
    return [
      e.timestamp, e.user, 'execution_check', e.ticker,
      e.orderPrice, e.closePrice, e.highPrice, e.result, e.reason
    ];
  });

  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, HEADERS.length).setValues(rows);
  Logger.log('writeExecutionLog: ' + rows.length + ' entries written');
}

/**
 * Rotate ExecutionLog: delete entries older than EXECUTION_LOG_RETENTION_DAYS
 * v3.1.0: Prevents ExecutionLog sheet from growing unbounded (~120 rows/day)
 *
 * @param {Spreadsheet} ss - Spreadsheet
 */
function rotateExecutionLog(ss) {
  var sheet = ss.getSheetByName(CONFIG.EXECUTION_LOG_SHEET);
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  if (!data || data.length <= 1) return;

  var header = data[0];
  var colCount = header.length;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CONFIG.EXECUTION_LOG_RETENTION_DAYS);

  var keepRows = [header];
  for (var i = 1; i < data.length; i++) {
    var timestamp = data[i][0];
    if (!timestamp) { keepRows.push(data[i]); continue; }
    var ts = (Object.prototype.toString.call(timestamp) === '[object Date]')
      ? timestamp : new Date(timestamp);
    if (isNaN(ts.getTime()) || ts >= cutoff) {
      keepRows.push(data[i]);
    }
  }

  var removed = data.length - keepRows.length;
  if (removed === 0) {
    Logger.log('rotateExecutionLog: nothing to rotate');
    return;
  }

  var normalizedKeep = keepRows.map(function(r) {
    var nr = r.slice(0, colCount);
    while (nr.length < colCount) nr.push('');
    return nr;
  });

  sheet.clearContents();
  sheet.getRange(1, 1, normalizedKeep.length, colCount).setValues(normalizedKeep);
  Logger.log('rotateExecutionLog: removed ' + removed + ' entries older than ' +
    CONFIG.EXECUTION_LOG_RETENTION_DAYS + ' days');
}

// =====================================================
// ORDERS ARCHIVE
// =====================================================

/**
 * Archive executed orders older than ARCHIVE_DAYS to Orders_Archive sheet
 * Uses executionDate (L column), NOT orderDate (A column) for cutoff comparison.
 * ONLY archives rows where K column = 'Y' (executed).
 * Pending orders (K='' or 'N') are NEVER archived regardless of age.
 * Safety: On rewrite failure, attempts to restore original data.
 */
function archiveOldOrders(ss, ordersSheet) {
  var data = ordersSheet.getDataRange().getValues();
  if (!data || data.length <= 1) return;

  var header = data[0];
  var colCount = header.length;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CONFIG.ARCHIVE_DAYS);

  var keepRows = [header];
  var archiveRows = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var execution = String(row[10] || '').trim().toUpperCase();  // K: execution
    var executionDate = parseOrderDate(row[11]);  // L: executionDate

    // ONLY archive executed orders older than cutoff
    if (execution === 'Y' && executionDate && executionDate < cutoff) {
      archiveRows.push(row);
    } else {
      keepRows.push(row);
    }
  }

  if (archiveRows.length === 0) return;  // Fast path: nothing to archive

  // Write to archive sheet
  var archiveSheet = ss.getSheetByName(CONFIG.ORDERS_ARCHIVE_SHEET);
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet(CONFIG.ORDERS_ARCHIVE_SHEET);
    archiveSheet.getRange(1, 1, 1, colCount).setValues([header]);
  }

  var normalizedArchive = archiveRows.map(function(r) {
    var nr = r.slice(0, colCount);
    while (nr.length < colCount) nr.push('');
    return nr;
  });
  var archiveLastRow = archiveSheet.getLastRow();
  archiveSheet.getRange(archiveLastRow + 1, 1, normalizedArchive.length, colCount)
    .setValues(normalizedArchive);

  // Rewrite Orders sheet with recovery safety
  var normalizedKeep = keepRows.map(function(r) {
    var nr = r.slice(0, colCount);
    while (nr.length < colCount) nr.push('');
    return nr;
  });

  // Normalize original data for potential recovery
  var normalizedOriginal = data.map(function(r) {
    var nr = r.slice(0, colCount);
    while (nr.length < colCount) nr.push('');
    return nr;
  });

  ordersSheet.clearContents();
  try {
    ordersSheet.getRange(1, 1, normalizedKeep.length, colCount).setValues(normalizedKeep);
  } catch (rewriteError) {
    // CRITICAL: clearContents succeeded but setValues failed -> restore original data
    Logger.log('CRITICAL: Orders rewrite failed, restoring original data: ' + rewriteError.message);
    try {
      ordersSheet.getRange(1, 1, normalizedOriginal.length, colCount).setValues(normalizedOriginal);
    } catch (restoreError) {
      Logger.log('FATAL: Restore also failed: ' + restoreError.message);
    }
    throw rewriteError;  // Re-throw to be caught by outer try/catch in processOrderExecutions
  }

  Logger.log('archiveOldOrders: Moved ' + archiveRows.length + ' executed rows to ' + CONFIG.ORDERS_ARCHIVE_SHEET);
}

// =====================================================
// SHEET UPDATES
// =====================================================

/**
 * Update Orders sheet with execution results
 *
 * @param {Sheet} sheet - Orders sheet
 * @param {Array} executedOrders - Orders that were executed
 */
function updateOrdersSheet(sheet, executedOrders) {
  // v3.0.0 (R-1): Batch setValue — 3N→N API calls
  executedOrders.forEach(order => {
    const row = order.rowIndex;
    sheet.getRange(row, 11, 1, 3).setValues([['Y', order.executionDate, order.actualPrice]]);
  });
}

/**
 * Update Portfolio sheet based on executed orders
 *
 * Portfolio columns (v3.8 - 15 columns):
 * | A: googleId | B: profileId | C: profileName | D: ticker | E: avgPrice | F: holdings | G: totalInvested | H: principal | I: AFTER% | J: LOC% | K: date | L: balance | M: commissionRate | N: divisions | O: revision |
 *
 * @param {Spreadsheet} ss - Spreadsheet
 * @param {Array} executedOrders - Orders that were executed
 */
function updatePortfolio(ss, executedOrders) {
  const portfolioSheet = ss.getSheetByName(CONFIG.PORTFOLIO_SHEET);
  if (!portfolioSheet) {
    Logger.log('Portfolio sheet not found');
    return;
  }

  const data = portfolioSheet.getDataRange().getValues();
  const colCount = data[0].length;
  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const defaultCommissionRate = normalizeCommissionRate(CONFIG.COMMISSION_RATE);

  // Group executed orders by googleId + profileId + ticker
  const ordersByKey = {};
  executedOrders.forEach(order => {
    const key = `${order.googleId}|${order.profileId}|${order.ticker}`;
    if (!ordersByKey[key]) {
      ordersByKey[key] = { buys: [], sells: [] };
    }
    if (order.side === 'BUY') {
      ordersByKey[key].buys.push(order);
    } else {
      ordersByKey[key].sells.push(order);
    }
  });

  // Balance update per profile (first row only)
  const balanceRowByProfile = {};
  const balanceByProfile = {};
  const commissionByProfile = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    const profileKey = `${String(row[0]).trim()}|${String(row[1]).trim()}`;
    if (!balanceRowByProfile[profileKey]) {
      balanceRowByProfile[profileKey] = i;
      balanceByProfile[profileKey] = parseFloat(row[11]) || 0;  // L: balance
      const hasCommission = row.length > 12 && row[12] !== '' && row[12] !== null && row[12] !== undefined;
      commissionByProfile[profileKey] = hasCommission
        ? normalizeCommissionRate(row[12])
        : defaultCommissionRate;
    }
  }

  const ordersByProfile = {};
  executedOrders.forEach(order => {
    const profileKey = `${order.googleId}|${order.profileId}`;
    if (!ordersByProfile[profileKey]) ordersByProfile[profileKey] = [];
    ordersByProfile[profileKey].push(order);
  });

  Object.keys(ordersByProfile).forEach(profileKey => {
    if (balanceByProfile[profileKey] === undefined) {
      Logger.log('Balance row not found for profile: ' + profileKey);
      return;
    }

    let balance = balanceByProfile[profileKey];
    const commissionRate = commissionByProfile[profileKey] ?? defaultCommissionRate;
    ordersByProfile[profileKey].forEach(order => {
      const basePrice = parseFloat(order.actualPrice) || parseFloat(order.price) || 0;
      const qty = parseFloat(order.quantity) || 0;
      const multiplier = order.side === 'BUY' ? (1 + commissionRate) : (1 - commissionRate);
      const amount = basePrice * qty * multiplier;
      if (order.side === 'BUY') {
        balance -= amount;
      } else {
        balance += amount;
      }
      Logger.log(`💰 ${order.ticker}: Balance ${order.side} ${amount} → new balance: ${balance}`);
    });
    balanceByProfile[profileKey] = balance;
  });

  // v3.0.0 (R-2): Batch update — modify data[] in-memory, single setValues at end
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const profileKey = `${String(row[0]).trim()}|${String(row[1]).trim()}`;
    const key = `${String(row[0]).trim()}|${String(row[1]).trim()}|${String(row[3]).trim().toUpperCase()}`;
    const orders = ordersByKey[key];
    const commissionRate = commissionByProfile[profileKey] ?? defaultCommissionRate;

    let touched = false;

    if (orders) {
      let avgPrice = parseFloat(row[4]) || 0;    // E: avgPrice
      let holdings = parseInt(row[5]) || 0;       // F: holdings
      let totalInvested = parseFloat(row[6]) || 0; // G: totalInvested

      // Process buys: increase holdings, recalculate avgPrice
      orders.buys.forEach(order => {
        const buyQty = Math.max(parseFloat(order.quantity) || 0, 0);
        const executionPrice = parseFloat(order.actualPrice) || parseFloat(order.price) || 0;
        if (buyQty <= 0 || executionPrice <= 0) {
          return;
        }
        // v3.0.0 (D-1): Commission included in totalInvested
        const newCost = executionPrice * buyQty * (1 + commissionRate);
        totalInvested += newCost;
        holdings += buyQty;
      });

      avgPrice = holdings > 0 && totalInvested > 0 ? totalInvested / holdings : 0;

      // Process sells: decrease holdings, reduce totalInvested proportionally
      orders.sells.forEach(order => {
        const sellQtyRaw = Math.max(parseFloat(order.quantity) || 0, 0);
        if (sellQtyRaw <= 0 || holdings <= 0 || avgPrice <= 0) {
          return;
        }
        // v3.0.0 (D-2): SELL clamp logging
        if (sellQtyRaw > holdings) {
          Logger.log(`⚠️ SELL clamp: ${key} sellQty=${sellQtyRaw} > holdings=${holdings}, clamping to ${holdings}`);
        }
        const sellQty = Math.min(sellQtyRaw, holdings);
        totalInvested -= avgPrice * sellQty;
        holdings -= sellQty;
        if (holdings <= 0 || totalInvested <= 0) {
          holdings = 0;
          totalInvested = 0;
          avgPrice = 0;
        } else {
          avgPrice = totalInvested / holdings;
        }
      });

      data[i][4] = avgPrice;        // E: avgPrice
      data[i][5] = holdings;        // F: holdings
      data[i][6] = totalInvested;   // G: totalInvested
      data[i][10] = today;          // K: date
      touched = true;

      Logger.log('Updated portfolio: ' + key + ' → holdings=' + holdings + ', avgPrice=' + avgPrice);
    }

    // Balance: first row of profile only
    if (balanceByProfile[profileKey] !== undefined &&
        balanceRowByProfile[profileKey] === i) {
      data[i][11] = balanceByProfile[profileKey];  // L: balance
      touched = true;
    }

    if (touched) {
      data[i][14] = Date.now();  // O: revision
    }
  }

  // v3.0.0 (R-2): Single batch write — 6N→1 API call
  const normalizedData = data.map(row => {
    const newRow = row.slice(0, colCount);
    while (newRow.length < colCount) newRow.push('');
    return newRow;
  });
  portfolioSheet.getRange(1, 1, normalizedData.length, colCount).setValues(normalizedData);
}

/**
 * Migrate balance for already executed orders (idempotent)
 * Orders sheet requires N column: balanceApplied
 */
function migrateExecutedOrdersBalance() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ordersSheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);
  const portfolioSheet = ss.getSheetByName(CONFIG.PORTFOLIO_SHEET);

  if (!ordersSheet || !portfolioSheet) {
    Logger.log('migrateExecutedOrdersBalance: required sheets not found');
    return;
  }

  const ordersData = ordersSheet.getDataRange().getValues();
  if (!ordersData || ordersData.length <= 1) {
    Logger.log('migrateExecutedOrdersBalance: no orders data');
    return;
  }

  const header = ordersData[0];
  const balanceAppliedCol = 14; // N
  if (header.length < balanceAppliedCol || header[balanceAppliedCol - 1] !== 'balanceApplied') {
    ordersSheet.getRange(1, balanceAppliedCol).setValue('balanceApplied');
  }

  const portfolioData = portfolioSheet.getDataRange().getValues();
  if (!portfolioData || portfolioData.length <= 1) {
    Logger.log('migrateExecutedOrdersBalance: no portfolio data');
    return;
  }

  const balanceRowByProfile = {};
  const balanceByProfile = {};
  const commissionByProfile = {};
  const defaultCommissionRate = normalizeCommissionRate(CONFIG.COMMISSION_RATE);

  for (let i = 1; i < portfolioData.length; i++) {
    const row = portfolioData[i];
    if (!row || row.length === 0) continue;
    const profileKey = `${String(row[0]).trim()}|${String(row[1]).trim()}`;
    if (!balanceRowByProfile[profileKey]) {
      balanceRowByProfile[profileKey] = i;
      balanceByProfile[profileKey] = parseFloat(row[11]) || 0;
      const hasCommission = row.length > 12 && row[12] !== '' && row[12] !== null && row[12] !== undefined;
      commissionByProfile[profileKey] = hasCommission
        ? normalizeCommissionRate(row[12])
        : defaultCommissionRate;
    }
  }

  const appliedValues = [];
  let processed = 0;

  for (let i = 1; i < ordersData.length; i++) {
    const row = ordersData[i];
    if (!row || row.length === 0) {
      appliedValues.push(['']);
      continue;
    }

    const execution = String(row[10] || '').trim();
    let balanceApplied = String(row[13] || '').trim();

    if (execution !== 'Y' || balanceApplied === 'Y') {
      appliedValues.push([balanceApplied]);
      continue;
    }

    const googleId = row[1];
    const profileId = row[2];
    const profileKey = `${googleId}|${profileId}`;
    if (balanceByProfile[profileKey] === undefined) {
      Logger.log('Balance row not found for profile: ' + profileKey);
      appliedValues.push([balanceApplied]);
      continue;
    }

    const side = String(row[5] || '').trim().toUpperCase();
    const qty = parseFloat(row[7]) || 0;
    const basePrice = parseFloat(row[12]) || parseFloat(row[6]) || 0;

    if (!qty || !basePrice || (side !== 'BUY' && side !== 'SELL')) {
      appliedValues.push([balanceApplied]);
      continue;
    }

    const commissionRate = commissionByProfile[profileKey] ?? defaultCommissionRate;
    const multiplier = side === 'BUY' ? (1 + commissionRate) : (1 - commissionRate);
    const amount = basePrice * qty * multiplier;

    if (side === 'BUY') {
      balanceByProfile[profileKey] -= amount;
    } else {
      balanceByProfile[profileKey] += amount;
    }

    Logger.log(`💰 ${row[3]}: Balance ${side} ${amount} → new balance: ${balanceByProfile[profileKey]}`);
    balanceApplied = 'Y';
    processed += 1;
    appliedValues.push([balanceApplied]);
  }

  if (appliedValues.length > 0) {
    ordersSheet.getRange(2, balanceAppliedCol, appliedValues.length, 1).setValues(appliedValues);
  }

  Object.keys(balanceByProfile).forEach(profileKey => {
    const rowIndex = balanceRowByProfile[profileKey];
    if (rowIndex === undefined) return;
    portfolioSheet.getRange(rowIndex + 1, 12).setValue(balanceByProfile[profileKey]); // L: balance
  });

  Logger.log(`migrateExecutedOrdersBalance: processed ${processed} rows`);
}

// =====================================================
// TRIGGER SETUP
// =====================================================

/**
 * Setup daily trigger - run once to enable auto-execution
 * Runs at 09:00 KST (after US market close)
 */
function setupTrigger() {
  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processOrderExecutions') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create new daily trigger
  ScriptApp.newTrigger('processOrderExecutions')
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  Logger.log('Daily trigger set for 09:00 KST');
}

/**
 * Remove daily trigger
 */
function removeTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processOrderExecutions') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  Logger.log('Trigger removed');
}

// =====================================================
// MENU (for manual execution)
// =====================================================

/**
 * Add custom menu when spreadsheet opens
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📊 IB Helper')
    .addItem('체결 확인 실행', 'processOrderExecutions')
    .addItem('중복 주문 정리', 'dedupeOrders')
    .addItem('🧹 Stale 주문 정리', 'manualRemoveStaleOrders')
    .addItem('체결 예수금 마이그레이션', 'migrateExecutedOrdersBalance')
    .addItem('📦 Archive Old Orders', 'manualArchiveOldOrders')
    .addItem('🔄 Rotate ExecutionLog (30d)', 'manualRotateExecutionLog')
    .addSeparator()
    .addItem('매일 자동 실행 설정', 'setupTrigger')
    .addItem('자동 실행 해제', 'removeTrigger')
    .addToUi();
}

/**
 * Manual archive execution with LockService protection
 */
function manualArchiveOldOrders() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    SpreadsheetApp.getUi().alert('Another process is running. Please try again later.');
    return;
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ordersSheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);
    if (!ordersSheet) {
      SpreadsheetApp.getUi().alert('Orders sheet not found');
      return;
    }
    archiveOldOrders(ss, ordersSheet);
    SpreadsheetApp.getUi().alert('Archive complete. Check Orders_Archive sheet.');
  } catch (e) {
    SpreadsheetApp.getUi().alert('Archive failed: ' + e.message);
    Logger.log('manualArchiveOldOrders error: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Manual ExecutionLog rotation with LockService protection
 */
function manualRotateExecutionLog() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    SpreadsheetApp.getUi().alert('Another process is running. Please try again later.');
    return;
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    rotateExecutionLog(ss);
    SpreadsheetApp.getUi().alert('ExecutionLog rotation complete. Entries older than ' +
      CONFIG.EXECUTION_LOG_RETENTION_DAYS + ' days removed.');
  } catch (e) {
    SpreadsheetApp.getUi().alert('Rotation failed: ' + e.message);
    Logger.log('manualRotateExecutionLog error: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Manual stale order cleanup with LockService protection
 */
function manualRemoveStaleOrders() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    SpreadsheetApp.getUi().alert('Another process is running. Please try again later.');
    return;
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ordersSheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);
    var portfolioSheet = ss.getSheetByName(CONFIG.PORTFOLIO_SHEET);
    if (!ordersSheet) {
      SpreadsheetApp.getUi().alert('Orders sheet not found');
      return;
    }
    removeStaleOrders(ordersSheet, portfolioSheet);
    SpreadsheetApp.getUi().alert('Stale order cleanup complete. Check Logs for details.');
  } catch (e) {
    SpreadsheetApp.getUi().alert('Stale order cleanup failed: ' + e.message);
    Logger.log('manualRemoveStaleOrders error: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

// =====================================================
// UTILITIES
// =====================================================

/**
 * Manual test function
 */
function testPriceLoading() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pricesSheet = ss.getSheetByName(CONFIG.PRICES_SHEET);

  if (!pricesSheet) {
    Logger.log('Prices sheet not found');
    return;
  }

  const prices = loadYesterdayPrices(pricesSheet);
  Logger.log('Prices: ' + JSON.stringify(prices, null, 2));
}

/**
 * Create Prices sheet template
 * Run this once to set up the Prices sheet structure
 */
function createPricesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.PRICES_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.PRICES_SHEET);
  }

  // Headers
  sheet.getRange('A1:D1').setValues([['Ticker', 'Price', 'Close', 'High']]);

  // Example formulas for common tickers
  const tickers = ['TQQQ', 'SOXL', 'BITU'];
  tickers.forEach((ticker, i) => {
    const row = i + 2;
    sheet.getRange(row, 1).setValue(ticker);
    sheet.getRange(row, 2).setFormula(`=GOOGLEFINANCE("${ticker}", "price")`);
    sheet.getRange(row, 3).setFormula(`=INDEX(GOOGLEFINANCE("${ticker}","close",TODAY()-1),2,2)`);
    sheet.getRange(row, 4).setFormula(`=INDEX(GOOGLEFINANCE("${ticker}","high",TODAY()-1),2,2)`);
  });

  // Formatting
  sheet.getRange('A1:D1').setFontWeight('bold').setBackground('#f3f4f6');
  sheet.setFrozenRows(1);

  Logger.log('Prices sheet created with GOOGLEFINANCE formulas');
}

/**
 * One-time utility: Purge non-EXECUTED entries from ExecutionLog
 * Removes PENDING/SKIPPED rows to clean up historical noise.
 * Safe to run multiple times (idempotent).
 */
function purgeNonExecutedLogs() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    SpreadsheetApp.getUi().alert('Another process is running.');
    return;
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.EXECUTION_LOG_SHEET);
    if (!sheet) {
      SpreadsheetApp.getUi().alert('ExecutionLog sheet not found');
      return;
    }

    var data = sheet.getDataRange().getValues();
    if (!data || data.length <= 1) return;

    var header = data[0];
    var colCount = header.length;
    var keepRows = [header];

    for (var i = 1; i < data.length; i++) {
      var result = String(data[i][7] || '').trim().toUpperCase();  // H: result
      if (result === 'EXECUTED') {
        keepRows.push(data[i]);
      }
    }

    var removed = data.length - keepRows.length;
    if (removed === 0) {
      SpreadsheetApp.getUi().alert('No non-EXECUTED entries found.');
      return;
    }

    var normalizedKeep = keepRows.map(function(r) {
      var nr = r.slice(0, colCount);
      while (nr.length < colCount) nr.push('');
      return nr;
    });

    sheet.clearContents();
    sheet.getRange(1, 1, normalizedKeep.length, colCount).setValues(normalizedKeep);
    SpreadsheetApp.getUi().alert('Purged ' + removed + ' non-EXECUTED entries. ' +
      keepRows.length + ' rows remaining (including header).');
    Logger.log('purgeNonExecutedLogs: removed ' + removed + ' rows');
  } catch (e) {
    SpreadsheetApp.getUi().alert('Purge failed: ' + e.message);
    Logger.log('purgeNonExecutedLogs error: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}
