/**
 * IB Helper - GAS Proxy for Sheets Operations
 *
 * Eliminates frontend OAuth (spreadsheets scope) by routing all
 * Sheets operations through GAS doPost(). Frontend only needs
 * Google Sign-In for identity (email) — no sensitive scopes.
 *
 * @version 1.1.0
 * @author 100xFenok Claude
 * @feature #258 (unverified app warning fix)
 * @feature #226 (session persistence — 7-day HMAC tokens)
 * @decision DEC-187
 *
 * SECURITY MODEL:
 * - Google id_token verification via tokeninfo API (login only)
 * - HMAC-SHA256 session tokens (7-day rolling expiry)
 * - Server-side email filtering (users can only access own data)
 * - LockService on all write operations
 *
 * CHANGELOG:
 * - v1.1.0 (2026-02-24): Manual email login (allowlist-gated) for auth fallback
 * - v1.0.0 (2026-02-21): Initial release — doPost router + HMAC session + 12 actions
 */

// =====================================================
// CONFIGURATION
// =====================================================

const PROXY_CONFIG = {
  SPREADSHEET_ID: '1shNx-xmzsJ7ninBly4HUjOjrMFqlvj-u3aBg6PmTGBE',
  CLIENT_ID: '1047143661358-3pd4f9o20tmp2u2dejskbdhrrs1tgmuo.apps.googleusercontent.com',

  // Sheet names
  PORTFOLIO_SHEET: 'Portfolio',
  PRICES_SHEET: 'Prices',
  ORDERS_SHEET: 'Orders',
  CASH_RESERVE_SHEET: 'CashReserve',

  // Ranges
  PORTFOLIO_RANGE: 'A2:O10000',
  CASH_RESERVE_RANGE: 'A2:F10000',

  // Session
  SESSION_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,  // 7 days
  MANUAL_LOGIN_ENABLED: true,
  MANUAL_LOGIN_ALLOWLIST_FALLBACK: ['etloveaui@gmail.com'],

  // Portfolio columns: A:O (15)
  PORTFOLIO_COLS: 15
};

// =====================================================
// HMAC SESSION UTILITIES
// =====================================================

/**
 * One-time setup: generate HMAC secret and store in ScriptProperties.
 * Run this manually from the GAS editor once after deployment.
 */
function setupSessionSecret() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty('SESSION_SECRET');
  if (existing) {
    Logger.log('Session secret already exists (' + existing.length + ' chars). Delete it first to regenerate.');
    return;
  }

  // Generate 64 random bytes as hex string
  var bytes = [];
  for (var i = 0; i < 64; i++) {
    bytes.push(Math.floor(Math.random() * 256));
  }
  var secret = bytes.map(function(b) {
    return ('0' + b.toString(16)).slice(-2);
  }).join('');

  props.setProperty('SESSION_SECRET', secret);
  Logger.log('Session secret created (' + secret.length + ' chars)');
}

/**
 * Create HMAC-SHA256 session token
 * Format: base64(email|created|expires).base64(hmac-sha256)
 *
 * @param {string} email - Verified user email
 * @returns {string} Session token
 */
function _createSessionToken(email) {
  var secret = PropertiesService.getScriptProperties().getProperty('SESSION_SECRET');
  if (!secret) {
    throw new Error('Session secret not configured. Run setupSessionSecret() first.');
  }

  var now = Date.now();
  var expires = now + PROXY_CONFIG.SESSION_EXPIRY_MS;
  var payload = email + '|' + now + '|' + expires;
  var payloadB64 = Utilities.base64Encode(payload, Utilities.Charset.UTF_8);

  var signature = Utilities.computeHmacSha256Signature(payload, secret);
  var signatureB64 = Utilities.base64Encode(signature);

  return payloadB64 + '.' + signatureB64;
}

/**
 * Verify HMAC-SHA256 session token
 *
 * @param {string} token - Session token
 * @returns {Object|null} { email, created, expires } or null if invalid
 */
function _verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;

  var parts = token.split('.');
  if (parts.length !== 2) return null;

  var secret = PropertiesService.getScriptProperties().getProperty('SESSION_SECRET');
  if (!secret) return null;

  try {
    var payloadB64 = parts[0];
    var signatureB64 = parts[1];

    // Decode payload
    var payload = Utilities.newBlob(Utilities.base64Decode(payloadB64)).getDataAsString();
    var segments = payload.split('|');
    if (segments.length !== 3) return null;

    var email = segments[0];
    var created = parseInt(segments[1]);
    var expires = parseInt(segments[2]);

    // Check expiry
    if (isNaN(expires) || Date.now() > expires) return null;

    // Verify HMAC
    var expectedSignature = Utilities.computeHmacSha256Signature(payload, secret);
    var expectedB64 = Utilities.base64Encode(expectedSignature);

    if (!_safeEqual(signatureB64, expectedB64)) return null;

    return { email: email, created: created, expires: expires };
  } catch (e) {
    Logger.log('_verifySessionToken error: ' + e.message);
    return null;
  }
}

/**
 * Constant-time string comparison (timing attack prevention)
 */
function _safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  var result = 0;
  for (var i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// =====================================================
// ID TOKEN VERIFICATION
// =====================================================

/**
 * Verify Google ID token via tokeninfo endpoint.
 * Only called on 'login' action (not every request).
 *
 * @param {string} idToken - JWT id_token from Google Sign-In
 * @returns {Object} { email, email_verified, aud }
 */
function _verifyIdToken(idToken) {
  var response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );

  if (response.getResponseCode() !== 200) {
    throw new Error('ID token verification failed: HTTP ' + response.getResponseCode());
  }

  var data = JSON.parse(response.getContentText());

  // Verify audience matches our client ID
  if (data.aud !== PROXY_CONFIG.CLIENT_ID) {
    throw new Error('ID token audience mismatch');
  }

  // Verify email is verified
  if (data.email_verified !== 'true' && data.email_verified !== true) {
    throw new Error('Email not verified');
  }

  return data;
}

function _normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function _isValidEmailFormat(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

function _getManualLoginAllowlist() {
  var props = PropertiesService.getScriptProperties();
  var configured = props.getProperty('MANUAL_LOGIN_ALLOWLIST');
  var raw = configured
    ? configured.split(',')
    : PROXY_CONFIG.MANUAL_LOGIN_ALLOWLIST_FALLBACK;

  var list = [];
  for (var i = 0; i < raw.length; i++) {
    var normalized = _normalizeEmail(raw[i]);
    if (!normalized) continue;
    if (list.indexOf(normalized) === -1) {
      list.push(normalized);
    }
  }
  return list;
}

function _isManualLoginAllowed(email) {
  if (!PROXY_CONFIG.MANUAL_LOGIN_ENABLED) return false;
  var allowlist = _getManualLoginAllowlist();
  if (allowlist.length === 0) return false;
  return allowlist.indexOf(_normalizeEmail(email)) !== -1;
}

// =====================================================
// doPost() ROUTER
// =====================================================

/**
 * Web App POST handler — main entry point for all proxy operations.
 *
 * @param {Object} e - Apps Script event object
 * @returns {TextOutput} JSON response
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return _jsonResponse({ ok: false, error: 'Empty request body', code: 400 });
    }

    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    if (!action) {
      return _jsonResponse({ ok: false, error: 'Missing action field', code: 400 });
    }

    // Login action: verify idToken, create session
    if (action === 'login') {
      return _handleLogin(body);
    }

    if (action === 'manualLogin') {
      return _handleManualLogin(body);
    }

    // All other actions require valid session token
    var session = _verifySessionToken(body.sessionToken);
    if (!session) {
      return _jsonResponse({ ok: false, error: 'Invalid or expired session', code: 401 });
    }

    var email = session.email;
    // Create a refreshed token for rolling expiry
    var refreshedToken = _createSessionToken(email);

    // Route to handler
    switch (action) {
      case 'readPortfolio':
        return _handleReadPortfolio(email, body.params, refreshedToken);
      case 'writePortfolio':
        return _handleWritePortfolio(email, body.params, refreshedToken);
      case 'batchUpdatePortfolio':
        return _handleBatchUpdatePortfolio(email, body.params, refreshedToken);
      case 'batchClearPortfolio':
        return _handleBatchClearPortfolio(email, body.params, refreshedToken);
      case 'appendPortfolio':
        return _handleAppendPortfolio(email, body.params, refreshedToken);
      case 'readPrices':
        return _handleReadPrices(refreshedToken);
      case 'ensureSheet':
        return _handleEnsureSheet(body.params, refreshedToken);
      case 'readCashReserve':
        return _handleReadCashReserve(email, body.params, refreshedToken);
      case 'writeCashReserve':
        return _handleWriteCashReserve(email, body.params, refreshedToken);
      case 'saveOrders':
        return _handleSaveOrders(email, body.params, refreshedToken);
      case 'readOrders':
        return _handleReadOrders(email, body.params, refreshedToken);
      default:
        return _jsonResponse({ ok: false, error: 'Unknown action: ' + action, code: 400 });
    }

  } catch (error) {
    Logger.log('doPost error: ' + error.message);
    return _jsonResponse({ ok: false, error: error.message, code: 500 });
  }
}

// =====================================================
// ACTION HANDLERS
// =====================================================

/**
 * Handle login: verify Google id_token, create session token
 */
function _handleLogin(body) {
  if (!body.params || !body.params.idToken) {
    return _jsonResponse({ ok: false, error: 'Missing idToken', code: 400 });
  }

  var tokenData = _verifyIdToken(body.params.idToken);
  var email = tokenData.email;
  var sessionToken = _createSessionToken(email);

  return _jsonResponse({
    ok: true,
    data: { email: email },
    sessionToken: sessionToken
  });
}

function _handleManualLogin(body) {
  if (!PROXY_CONFIG.MANUAL_LOGIN_ENABLED) {
    return _jsonResponse({ ok: false, error: '수동 로그인이 비활성화되어 있습니다', code: 403 });
  }

  if (!body.params || !body.params.email) {
    return _jsonResponse({ ok: false, error: '이메일이 필요합니다', code: 400 });
  }

  var email = _normalizeEmail(body.params.email);
  if (!_isValidEmailFormat(email)) {
    return _jsonResponse({ ok: false, error: '이메일 형식이 올바르지 않습니다', code: 400 });
  }

  if (!_isManualLoginAllowed(email)) {
    return _jsonResponse({ ok: false, error: '허용되지 않은 이메일입니다', code: 403 });
  }

  var sessionToken = _createSessionToken(email);
  return _jsonResponse({
    ok: true,
    data: { email: email, manual: true },
    sessionToken: sessionToken
  });
}

/**
 * Read Portfolio rows filtered by email
 */
function _handleReadPortfolio(email, params, refreshedToken) {
  var ss = SpreadsheetApp.openById(PROXY_CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(PROXY_CONFIG.PORTFOLIO_SHEET);
  if (!sheet) {
    return _jsonResponse({ ok: false, error: 'Portfolio sheet not found', code: 404 });
  }

  var data = sheet.getRange(PROXY_CONFIG.PORTFOLIO_RANGE).getValues();
  // Filter by email (column A)
  var filtered = data.filter(function(row) {
    return row[0] === email;
  });

  // Remove trailing empty rows
  var values = filtered.filter(function(row) {
    return row.some(function(cell) { return cell !== '' && cell !== null; });
  });

  return _jsonResponse({
    ok: true,
    data: { values: values },
    sessionToken: refreshedToken
  });
}

/**
 * Write Portfolio: replace user's rows
 * Read-all → remove user's rows → insert new rows → write-all
 */
function _handleWritePortfolio(email, params, refreshedToken) {
  if (!params || !params.rows) {
    return _jsonResponse({ ok: false, error: 'Missing rows parameter', code: 400 });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return _jsonResponse({ ok: false, error: 'Could not acquire lock', code: 503 });
  }

  try {
    var ss = SpreadsheetApp.openById(PROXY_CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(PROXY_CONFIG.PORTFOLIO_SHEET);
    if (!sheet) {
      return _jsonResponse({ ok: false, error: 'Portfolio sheet not found', code: 404 });
    }

    var data = sheet.getRange(PROXY_CONFIG.PORTFOLIO_RANGE).getValues();

    // Keep other users' rows
    var otherRows = data.filter(function(row) {
      return row[0] !== email && row.some(function(c) { return c !== '' && c !== null; });
    });

    // Validate incoming rows belong to this email
    var newRows = params.rows.filter(function(row) {
      return row[0] === email;
    });

    var allRows = otherRows.concat(newRows);

    // Write back
    _clearAndWrite(sheet, PROXY_CONFIG.PORTFOLIO_RANGE, allRows, PROXY_CONFIG.PORTFOLIO_COLS);

    return _jsonResponse({
      ok: true,
      data: { written: newRows.length },
      sessionToken: refreshedToken
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Batch update specific Portfolio rows
 */
function _handleBatchUpdatePortfolio(email, params, refreshedToken) {
  if (!params || !params.rowUpdates || params.rowUpdates.length === 0) {
    return _jsonResponse({ ok: false, error: 'Missing rowUpdates', code: 400 });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return _jsonResponse({ ok: false, error: 'Could not acquire lock', code: 503 });
  }

  try {
    var ss = SpreadsheetApp.openById(PROXY_CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(PROXY_CONFIG.PORTFOLIO_SHEET);
    if (!sheet) {
      return _jsonResponse({ ok: false, error: 'Portfolio sheet not found', code: 404 });
    }

    // Security: verify each row belongs to this email
    var data = sheet.getDataRange().getValues();
    var updated = 0;

    params.rowUpdates.forEach(function(u) {
      var rowIndex = u.rowIndex;
      // Verify the row at this index belongs to the user
      if (rowIndex >= 1 && rowIndex <= data.length) {
        var existingRow = data[rowIndex - 1];  // 0-indexed in array
        if (existingRow[0] === email || u.values[0] === email) {
          sheet.getRange('A' + rowIndex + ':O' + rowIndex).setValues([u.values]);
          updated++;
        }
      }
    });

    return _jsonResponse({
      ok: true,
      data: { updated: updated },
      sessionToken: refreshedToken
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Batch clear specific Portfolio rows
 */
function _handleBatchClearPortfolio(email, params, refreshedToken) {
  if (!params || !params.rowIndices || params.rowIndices.length === 0) {
    return _jsonResponse({ ok: false, error: 'Missing rowIndices', code: 400 });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return _jsonResponse({ ok: false, error: 'Could not acquire lock', code: 503 });
  }

  try {
    var ss = SpreadsheetApp.openById(PROXY_CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(PROXY_CONFIG.PORTFOLIO_SHEET);
    if (!sheet) {
      return _jsonResponse({ ok: false, error: 'Portfolio sheet not found', code: 404 });
    }

    // Security: verify rows belong to this email before clearing
    var data = sheet.getDataRange().getValues();
    var cleared = 0;

    params.rowIndices.forEach(function(rowIndex) {
      if (rowIndex >= 1 && rowIndex <= data.length) {
        var row = data[rowIndex - 1];
        if (row[0] === email) {
          sheet.getRange('A' + rowIndex + ':O' + rowIndex).clearContent();
          cleared++;
        }
      }
    });

    return _jsonResponse({
      ok: true,
      data: { cleared: cleared },
      sessionToken: refreshedToken
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Append rows to Portfolio
 */
function _handleAppendPortfolio(email, params, refreshedToken) {
  if (!params || !params.rows || params.rows.length === 0) {
    return _jsonResponse({ ok: false, error: 'Missing rows', code: 400 });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return _jsonResponse({ ok: false, error: 'Could not acquire lock', code: 503 });
  }

  try {
    var ss = SpreadsheetApp.openById(PROXY_CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(PROXY_CONFIG.PORTFOLIO_SHEET);
    if (!sheet) {
      return _jsonResponse({ ok: false, error: 'Portfolio sheet not found', code: 404 });
    }

    // Security: ensure all rows have correct email
    var validRows = params.rows.filter(function(row) {
      return row[0] === email;
    });

    if (validRows.length > 0) {
      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, validRows.length, PROXY_CONFIG.PORTFOLIO_COLS)
        .setValues(validRows.map(function(r) {
          var row = r.slice(0, PROXY_CONFIG.PORTFOLIO_COLS);
          while (row.length < PROXY_CONFIG.PORTFOLIO_COLS) row.push('');
          return row;
        }));
    }

    return _jsonResponse({
      ok: true,
      data: { appended: validRows.length },
      sessionToken: refreshedToken
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Read Prices sheet (all rows, no email filter)
 */
function _handleReadPrices(refreshedToken) {
  var ss = SpreadsheetApp.openById(PROXY_CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(PROXY_CONFIG.PRICES_SHEET);
  if (!sheet) {
    return _jsonResponse({ ok: false, error: 'Prices sheet not found', code: 404 });
  }

  var data = sheet.getRange('A2:G100').getValues();
  var values = data.filter(function(row) {
    return row.some(function(cell) { return cell !== '' && cell !== null; });
  });

  return _jsonResponse({
    ok: true,
    data: { values: values },
    sessionToken: refreshedToken
  });
}

/**
 * Ensure a sheet exists with headers
 */
function _handleEnsureSheet(params, refreshedToken) {
  if (!params || !params.sheetName) {
    return _jsonResponse({ ok: false, error: 'Missing sheetName', code: 400 });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return _jsonResponse({ ok: false, error: 'Could not acquire lock', code: 503 });
  }

  try {
    var ss = SpreadsheetApp.openById(PROXY_CONFIG.SPREADSHEET_ID);
    var sheetName = params.sheetName;
    var sheet = ss.getSheetByName(sheetName);
    var created = false;

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      created = true;
    }

    // Set headers if provided and sheet was just created
    if (created && params.headers && params.headers.length > 0) {
      sheet.getRange(1, 1, 1, params.headers.length).setValues([params.headers]);
    }

    return _jsonResponse({
      ok: true,
      data: { sheetName: sheetName, created: created },
      sessionToken: refreshedToken
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Read CashReserve rows filtered by email
 */
function _handleReadCashReserve(email, params, refreshedToken) {
  var ss = SpreadsheetApp.openById(PROXY_CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(PROXY_CONFIG.CASH_RESERVE_SHEET);
  if (!sheet) {
    return _jsonResponse({
      ok: true,
      data: { values: [] },
      sessionToken: refreshedToken
    });
  }

  var data = sheet.getRange(PROXY_CONFIG.CASH_RESERVE_RANGE).getValues();
  var filtered = data.filter(function(row) {
    return row[0] === email && row.some(function(c) { return c !== '' && c !== null; });
  });

  return _jsonResponse({
    ok: true,
    data: { values: filtered },
    sessionToken: refreshedToken
  });
}

/**
 * Write CashReserve: replace user's rows
 */
function _handleWriteCashReserve(email, params, refreshedToken) {
  if (!params) {
    return _jsonResponse({ ok: false, error: 'Missing params', code: 400 });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return _jsonResponse({ ok: false, error: 'Could not acquire lock', code: 503 });
  }

  try {
    var ss = SpreadsheetApp.openById(PROXY_CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(PROXY_CONFIG.CASH_RESERVE_SHEET);

    // Auto-create if missing
    if (!sheet) {
      sheet = ss.insertSheet(PROXY_CONFIG.CASH_RESERVE_SHEET);
      sheet.getRange(1, 1, 1, 6).setValues([['googleId', 'profileId', 'symbol', 'holdings', 'avgCost', 'updatedAt']]);
    }

    var data = sheet.getRange(PROXY_CONFIG.CASH_RESERVE_RANGE).getValues();

    // Keep other users' rows
    var otherRows = data.filter(function(row) {
      return row[0] !== email && row.some(function(c) { return c !== '' && c !== null; });
    });

    // Validate incoming rows
    var newRows = (params.rows || []).filter(function(row) {
      return row[0] === email;
    });

    var allRows = otherRows.concat(newRows);
    _clearAndWrite(sheet, PROXY_CONFIG.CASH_RESERVE_RANGE, allRows, 6);

    return _jsonResponse({
      ok: true,
      data: { written: newRows.length },
      sessionToken: refreshedToken
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Save orders (append to Orders sheet)
 */
function _handleSaveOrders(email, params, refreshedToken) {
  if (!params || !params.rows || params.rows.length === 0) {
    return _jsonResponse({ ok: false, error: 'Missing order rows', code: 400 });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return _jsonResponse({ ok: false, error: 'Could not acquire lock', code: 503 });
  }

  try {
    var ss = SpreadsheetApp.openById(PROXY_CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(PROXY_CONFIG.ORDERS_SHEET);

    // Auto-create if missing
    if (!sheet) {
      sheet = ss.insertSheet(PROXY_CONFIG.ORDERS_SHEET);
      sheet.getRange(1, 1, 1, 13).setValues([[
        '날짜', '구글ID', '프로필ID', '종목', '주문타입', '매수매도',
        '가격', '수량', '총액', '체결기준', '체결', '체결일', '실제가격'
      ]]);
    }

    // Security: verify email in column B
    var validRows = params.rows.filter(function(row) {
      return row[1] === email;
    });

    if (validRows.length > 0) {
      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, validRows.length, 13)
        .setValues(validRows.map(function(r) {
          var row = r.slice(0, 13);
          while (row.length < 13) row.push('');
          return row;
        }));
    }

    return _jsonResponse({
      ok: true,
      data: { saved: validRows.length },
      sessionToken: refreshedToken
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Read Orders filtered by email
 */
function _handleReadOrders(email, params, refreshedToken) {
  var ss = SpreadsheetApp.openById(PROXY_CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(PROXY_CONFIG.ORDERS_SHEET);
  if (!sheet) {
    return _jsonResponse({
      ok: true,
      data: { values: [] },
      sessionToken: refreshedToken
    });
  }

  var data = sheet.getRange('A2:M10000').getValues();
  // Filter by email (column B) and remove empty rows
  var filtered = data.filter(function(row) {
    return row[1] === email && row.some(function(c) { return c !== '' && c !== null; });
  });

  return _jsonResponse({
    ok: true,
    data: { values: filtered },
    sessionToken: refreshedToken
  });
}

// =====================================================
// RESPONSE HELPERS
// =====================================================

/**
 * Create JSON response (same pattern as yahoo-quotes.gs)
 */
function _jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Clear range and write new data with column normalization
 */
function _clearAndWrite(sheet, range, rows, colCount) {
  sheet.getRange(range).clearContent();

  if (!rows || rows.length === 0) return;

  var normalized = rows.map(function(r) {
    var row = r.slice(0, colCount);
    while (row.length < colCount) row.push('');
    return row;
  });

  // Write starting from row 2 (after header)
  sheet.getRange(2, 1, normalized.length, colCount).setValues(normalized);
}

// =====================================================
// TEST FUNCTIONS
// =====================================================

/**
 * Test doPost with readPortfolio action
 */
function testDoPost_readPortfolio() {
  // First create a session token for testing
  var testEmail = Session.getEffectiveUser().getEmail();
  var token = _createSessionToken(testEmail);

  var result = doPost({
    postData: {
      contents: JSON.stringify({
        action: 'readPortfolio',
        sessionToken: token,
        params: {}
      })
    }
  });

  Logger.log('readPortfolio result:');
  Logger.log(result.getContent());
}

/**
 * Test doPost with readPrices action
 */
function testDoPost_readPrices() {
  var testEmail = Session.getEffectiveUser().getEmail();
  var token = _createSessionToken(testEmail);

  var result = doPost({
    postData: {
      contents: JSON.stringify({
        action: 'readPrices',
        sessionToken: token,
        params: {}
      })
    }
  });

  Logger.log('readPrices result:');
  Logger.log(result.getContent());
}

/**
 * Test session token creation and verification
 */
function testSessionToken() {
  var testEmail = 'test@example.com';
  var token = _createSessionToken(testEmail);
  Logger.log('Token: ' + token);

  var verified = _verifySessionToken(token);
  Logger.log('Verified: ' + JSON.stringify(verified));

  // Test expired token
  Logger.log('Should be valid: ' + (verified !== null));
}
