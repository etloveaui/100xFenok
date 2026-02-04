/**
 * IB Helper - Order Execution Automation
 * Google Apps Script for Google Sheets
 *
 * @version 2.3.1
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
 * - Sheet1 "Portfolio": Portfolio (A:L)
 * - Sheet2 "Prices": GOOGLEFINANCE prices (manual setup)
 * - Sheet3 "Orders": Order history (A:M - auto-created)
 *
 * CHANGELOG:
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
  COMMISSION_RATE: 0.0007  // 0.07%
};

// =====================================================
// MAIN ENTRY POINTS
// =====================================================

function normalizeCommissionRate(input) {
  const rate = parseFloat(input);
  if (isNaN(rate)) return 0;
  return rate > 0.01 ? rate / 100 : rate;
}

/**
 * Process order executions
 * Main function - run daily at 09:00 KST (after US market close)
 */
function processOrderExecutions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ordersSheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);
  const pricesSheet = ss.getSheetByName(CONFIG.PRICES_SHEET);

  if (!ordersSheet) {
    Logger.log('Orders sheet not found');
    return;
  }

  // 🔴 v2.1.0: Orders dedupe before processing (date+googleId+profileId+ticker+orderType+price+qty)
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
  Logger.log('Loaded prices: ' + JSON.stringify(prices));

  // 2. Load pending orders (execution column = empty)
  const pendingOrders = loadPendingOrders(ordersSheet);
  Logger.log('Pending orders: ' + pendingOrders.length);

  // 3. Check executions
  const executedOrders = checkExecutions(pendingOrders, prices);
  Logger.log('Executed orders: ' + executedOrders.length);

  // 4. Update Orders sheet
  if (executedOrders.length > 0) {
    updateOrdersSheet(ordersSheet, executedOrders);

    // 5. Update Portfolio
    updatePortfolio(ss, executedOrders);
  }

  Logger.log('Process complete: ' + executedOrders.length + ' orders executed');
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
  const orders = [];

  // Skip header row
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const execution = String(row[10]).trim();  // K: execution

    // Only pending orders
    if (execution !== '' && execution !== 'N') continue;

    orders.push({
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

  return orders;
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

  const parseOrderDate = (value) => {
    if (!value) return null;
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      try {
        const parsedKst = Utilities.parseDate(trimmed, CONFIG.TIMEZONE, 'yyyy-MM-dd');
        if (!isNaN(parsedKst.getTime())) return parsedKst;
      } catch (error) {
        // Fallback to native Date parsing below.
      }
    }
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
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

    if (!key || !withinWindow(orderDate)) {
      keepFlags[idx] = true;
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

  ordersSheet.clearContents();
  ordersSheet.getRange(1, 1, normalizedRows.length, colCount).setValues(normalizedRows);
  Logger.log(`dedupeOrders: Removed ${data.length - uniqueRows.length} duplicate rows`);
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
function checkExecutions(orders, prices) {
  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const executedOrders = [];
  const highWarned = {};

  orders.forEach(order => {
    const priceData = prices[order.ticker];
    if (!priceData) {
      Logger.log('No price data for: ' + order.ticker);
      return;
    }

    if (order.executionBasis === 'HIGH' &&
        priceData.high === 0 &&
        !highWarned[order.ticker]) {
      Logger.log(`⚠️ HIGH ${order.ticker}: priceData.high=0 → limit sell may not execute`);
      highWarned[order.ticker] = true;
    }

    let executed = false;
    let actualPrice = 0;

    if (order.side === 'BUY') {
      // BUY: close <= orderPrice
      if (order.executionBasis === 'CLOSE' && priceData.close <= order.price) {
        executed = true;
        actualPrice = priceData.close;
      }
    } else if (order.side === 'SELL') {
      if (order.executionBasis === 'CLOSE') {
        // LOC SELL: close >= orderPrice
        if (priceData.close >= order.price) {
          executed = true;
          actualPrice = priceData.close;
        }
      } else if (order.executionBasis === 'HIGH') {
        // Limit SELL: high >= orderPrice
        if (priceData.high >= order.price) {
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
  });

  return executedOrders;
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
  executedOrders.forEach(order => {
    const row = order.rowIndex;

    // K: execution = 'Y'
    sheet.getRange(row, 11).setValue('Y');

    // L: executionDate
    sheet.getRange(row, 12).setValue(order.executionDate);

    // M: actualPrice
    sheet.getRange(row, 13).setValue(order.actualPrice);
  });
}

/**
 * Update Portfolio sheet based on executed orders
 *
 * Portfolio columns (v3.7 - 13 columns):
 * | A: googleId | B: profileId | C: profileName | D: ticker | E: avgPrice | F: holdings | G: totalInvested | H: principal | I: AFTER% | J: LOC% | K: date | L: balance | M: commissionRate |
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
    const profileKey = `${row[0]}|${row[1]}`;
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

  // Update each portfolio row
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // Portfolio v3.6: A=googleId, B=profileId, C=profileName, D=ticker
    const profileKey = `${row[0]}|${row[1]}`;
    const key = `${row[0]}|${row[1]}|${row[3]}`;  // A|B|D (skip C=profileName)
    const orders = ordersByKey[key];

    const rowNum = i + 1;

    if (orders) {
      let avgPrice = parseFloat(row[4]) || 0;    // E: avgPrice
      let holdings = parseInt(row[5]) || 0;       // F: holdings
      let totalInvested = parseFloat(row[6]) || 0; // G: totalInvested

      // Process buys: increase holdings, recalculate avgPrice
      orders.buys.forEach(order => {
        const newCost = order.actualPrice * order.quantity;
        totalInvested += newCost;
        holdings += order.quantity;
      });

      // Process sells: decrease holdings, reduce totalInvested
      orders.sells.forEach(order => {
        // Reduce holdings
        holdings -= order.quantity;
        // Reduce totalInvested proportionally
        if (holdings > 0 && avgPrice > 0) {
          totalInvested = avgPrice * holdings;
        } else if (holdings <= 0) {
          totalInvested = 0;
          holdings = 0;
        }
      });

      // Recalculate avgPrice
      if (holdings > 0 && totalInvested > 0) {
        avgPrice = totalInvested / holdings;
      } else {
        avgPrice = 0;
      }

      portfolioSheet.getRange(rowNum, 5).setValue(avgPrice);      // E: avgPrice
      portfolioSheet.getRange(rowNum, 6).setValue(holdings);      // F: holdings
      portfolioSheet.getRange(rowNum, 7).setValue(totalInvested); // G: totalInvested
      portfolioSheet.getRange(rowNum, 11).setValue(today);        // K: date

      Logger.log('Updated portfolio: ' + key + ' → holdings=' + holdings + ', avgPrice=' + avgPrice);
    }

    if (balanceByProfile[profileKey] !== undefined &&
        balanceRowByProfile[profileKey] === i) {
      portfolioSheet.getRange(rowNum, 12).setValue(balanceByProfile[profileKey]); // L: balance
    }
  }
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
    const profileKey = `${row[0]}|${row[1]}`;
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
    .addItem('체결 예수금 마이그레이션', 'migrateExecutedOrdersBalance')
    .addSeparator()
    .addItem('매일 자동 실행 설정', 'setupTrigger')
    .addItem('자동 실행 해제', 'removeTrigger')
    .addToUi();
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
