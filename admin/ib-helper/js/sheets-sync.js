/**
 * IB Helper Google Sheets Sync - Phase 2B
 *
 * Google Sheets 연동 모듈 (선택적 기능)
 *
 * @version 1.0.0
 * @author 100xFenok Claude
 * @spec _tmp/PHASE2_SPEC.md (Asset Allocator)
 *
 * ⚠️ SETUP REQUIRED:
 * 1. Google Cloud Console에서 프로젝트 생성
 * 2. Google Sheets API 활성화
 * 3. OAuth 2.0 Client ID 생성
 * 4. 아래 CLIENT_ID와 API_KEY 설정
 */

const SheetsSync = (function() {

  // =====================================================
  // CONFIGURATION - ⚠️ 사용자 설정 필요!
  // =====================================================

  const CONFIG = {
    // Google Cloud Console - xfenok-analytics project
    CLIENT_ID: '1047143661358-3pd4f9o20tmp2u2dejskbdhrrs1tgmuo.apps.googleusercontent.com',
    API_KEY: 'AIzaSyCmaRwyiBnWWZf8mSp8g4Io8E0nqyWQnlI',

    DISCOVERY_DOC: 'https://sheets.googleapis.com/$discovery/rest?version=v4',
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets',

    // Sheet 구조
    SHEET_NAME: 'Data',
    RANGE: 'Data!A2:G1000'  // Skip header row
  };

  // =====================================================
  // STATE
  // =====================================================

  let currentProfileId = null;  // Set by setCurrentProfile()
  let tokenClient = null;
  let gapiInited = false;
  let gisInited = false;
  let isSignedIn = false;

  /**
   * Get storage key for profile's spreadsheet ID
   * @param {string} profileId
   * @returns {string}
   */
  function getStorageKey(profileId) {
    return `ib_sheets_id_${profileId || currentProfileId || 'default'}`;
  }

  /**
   * Set current profile for Sheets operations
   * @param {string} profileId
   */
  function setCurrentProfile(profileId) {
    currentProfileId = profileId;
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  /**
   * Initialize Google APIs
   * @returns {Promise<boolean>} Success status
   */
  async function init() {
    if (!CONFIG.CLIENT_ID || !CONFIG.API_KEY) {
      console.warn('SheetsSync: CLIENT_ID or API_KEY not configured');
      return false;
    }

    try {
      await loadGapiScript();
      await loadGisScript();
      return true;
    } catch (error) {
      console.error('SheetsSync init error:', error);
      return false;
    }
  }

  /**
   * Load Google API client library
   */
  function loadGapiScript() {
    return new Promise((resolve, reject) => {
      if (typeof gapi !== 'undefined') {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => {
        gapi.load('client', async () => {
          try {
            await gapi.client.init({
              apiKey: CONFIG.API_KEY,
              discoveryDocs: [CONFIG.DISCOVERY_DOC],
            });
            gapiInited = true;
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      };
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  /**
   * Load Google Identity Services library
   */
  function loadGisScript() {
    return new Promise((resolve, reject) => {
      if (typeof google !== 'undefined' && google.accounts) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.CLIENT_ID,
          scope: CONFIG.SCOPES,
          callback: '', // defined at request time
        });
        gisInited = true;
        resolve();
      };
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  /**
   * Sign in to Google
   * @returns {Promise<Object>} Token response
   */
  function signIn() {
    return new Promise((resolve, reject) => {
      if (!gisInited) {
        reject(new Error('Google Identity Services not initialized'));
        return;
      }

      tokenClient.callback = (response) => {
        if (response.error) {
          isSignedIn = false;
          reject(response);
        } else {
          isSignedIn = true;
          resolve(response);
        }
      };

      if (gapi.client.getToken() === null) {
        // First time sign in
        tokenClient.requestAccessToken({ prompt: 'consent' });
      } else {
        // Already have token, just refresh
        tokenClient.requestAccessToken({ prompt: '' });
      }
    });
  }

  /**
   * Sign out from Google
   */
  function signOut() {
    const token = gapi.client.getToken();
    if (token) {
      google.accounts.oauth2.revoke(token.access_token);
      gapi.client.setToken('');
    }
    isSignedIn = false;
  }

  /**
   * Check if user is signed in
   * @returns {boolean}
   */
  function isAuthenticated() {
    return isSignedIn && gapi.client.getToken() !== null;
  }

  // =====================================================
  // SPREADSHEET MANAGEMENT
  // =====================================================

  /**
   * Set spreadsheet ID for current profile
   * @param {string} id - Google Sheets ID
   * @param {string} [profileId] - Optional profile ID (uses current if not provided)
   */
  function setSpreadsheet(id, profileId) {
    const key = getStorageKey(profileId);
    localStorage.setItem(key, id);
  }

  /**
   * Get spreadsheet ID for current profile
   * @param {string} [profileId] - Optional profile ID (uses current if not provided)
   * @returns {string|null}
   */
  function getSpreadsheetId(profileId) {
    const key = getStorageKey(profileId);
    return localStorage.getItem(key) || null;
  }

  /**
   * Extract spreadsheet ID from URL
   * @param {string} url - Google Sheets URL
   * @returns {string|null}
   */
  function extractIdFromUrl(url) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  // =====================================================
  // READ OPERATIONS
  // =====================================================

  /**
   * Read all data from sheet
   * @returns {Promise<Object>} Parsed profiles data
   */
  async function readAll() {
    const sheetId = getSpreadsheetId();
    if (!sheetId) {
      throw new Error('Spreadsheet ID not set for this profile');
    }

    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: CONFIG.RANGE,
    });

    return parseRows(response.result.values || []);
  }

  /**
   * Parse sheet rows to profile format
   * @param {Array} rows - Raw sheet rows
   * @returns {Object} Profiles object
   */
  function parseRows(rows) {
    const profiles = {};

    rows.forEach(row => {
      const [profileId, symbol, principal, avgPrice, quantity, currentPrice, updated] = row;

      if (!profileId || !symbol) return;

      if (!profiles[profileId]) {
        profiles[profileId] = {
          id: profileId,
          stocks: []
        };
      }

      profiles[profileId].stocks.push({
        symbol: symbol,
        principal: parseFloat(principal) || 0,
        avgPrice: parseFloat(avgPrice) || 0,
        quantity: parseInt(quantity) || 0,
        currentPrice: parseFloat(currentPrice) || 0,
        lastUpdated: updated
      });
    });

    return profiles;
  }

  // =====================================================
  // WRITE OPERATIONS
  // =====================================================

  /**
   * Write profile data to sheet
   * @param {Object} profile - Profile object with stocks
   */
  async function writeProfile(profile) {
    const sheetId = getSpreadsheetId();
    if (!sheetId) {
      throw new Error('Spreadsheet ID not set for this profile');
    }

    // First clear existing profile rows
    await clearProfileRows(profile.id);

    // Prepare rows
    const rows = profile.stocks.map(stock => [
      profile.id,
      stock.symbol,
      stock.principal || 0,
      stock.avgPrice || 0,
      stock.quantity || 0,
      stock.currentPrice || 0,
      new Date().toISOString().split('T')[0]
    ]);

    if (rows.length === 0) return;

    // Append rows
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${CONFIG.SHEET_NAME}!A:G`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: rows }
    });
  }

  /**
   * Clear rows for a specific profile
   * @param {string} profileId - Profile ID to clear
   */
  async function clearProfileRows(profileId) {
    const sheetId = getSpreadsheetId();
    if (!sheetId) return;

    // Read all data
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: CONFIG.RANGE,
    });

    const rows = response.result.values || [];
    const rowsToKeep = rows.filter(row => row[0] !== profileId);

    // Clear and rewrite
    await gapi.client.sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: CONFIG.RANGE,
    });

    if (rowsToKeep.length > 0) {
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${CONFIG.SHEET_NAME}!A2`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: rowsToKeep }
      });
    }
  }

  /**
   * Write all profiles to sheet
   * @param {Object} profilesData - All profiles from ProfileManager
   */
  async function writeAll(profilesData) {
    const sheetId = getSpreadsheetId();
    if (!sheetId) {
      throw new Error('Spreadsheet ID not set for this profile');
    }

    const allRows = [];

    Object.values(profilesData.profiles).forEach(profile => {
      profile.stocks.forEach(stock => {
        allRows.push([
          profile.id,
          stock.symbol,
          stock.principal || 0,
          stock.avgPrice || 0,
          stock.quantity || 0,
          stock.currentPrice || 0,
          new Date().toISOString().split('T')[0]
        ]);
      });
    });

    // Clear all and write
    await gapi.client.sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: CONFIG.RANGE,
    });

    if (allRows.length > 0) {
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${CONFIG.SHEET_NAME}!A2`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: allRows }
      });
    }
  }

  // =====================================================
  // SYNC OPERATIONS
  // =====================================================

  /**
   * Sync local and cloud data
   * Strategy: Cloud stocks data wins, Local settings preserved
   * @returns {Promise<Object>} Merged profiles data
   */
  async function sync() {
    const local = ProfileManager.getAll();
    const cloud = await readAll();

    // Merge: Update local stocks with cloud data
    Object.keys(cloud).forEach(profileId => {
      if (local.profiles[profileId]) {
        // Profile exists locally - update stocks from cloud
        local.profiles[profileId].stocks = cloud[profileId].stocks;
        local.profiles[profileId].updated = new Date().toISOString();
      } else {
        // New profile from cloud - create locally
        local.profiles[profileId] = {
          ...ProfileManager.createDefault(profileId, profileId, ''),
          stocks: cloud[profileId].stocks
        };
      }
    });

    // Save merged data locally
    ProfileManager.save(local);

    // Push local-only profiles to cloud
    await writeAll(local);

    return local;
  }

  /**
   * Push local data to cloud (overwrite)
   */
  async function push() {
    const local = ProfileManager.getAll();
    await writeAll(local);
  }

  /**
   * Pull cloud data to local (overwrite stocks)
   */
  async function pull() {
    const local = ProfileManager.getAll();
    const cloud = await readAll();

    Object.keys(cloud).forEach(profileId => {
      if (local.profiles[profileId]) {
        local.profiles[profileId].stocks = cloud[profileId].stocks;
      }
    });

    ProfileManager.save(local);
    return local;
  }

  // =====================================================
  // UTILITY
  // =====================================================

  /**
   * Check if configuration is valid
   * @returns {boolean}
   */
  function isConfigured() {
    return CONFIG.CLIENT_ID && CONFIG.API_KEY &&
           CONFIG.CLIENT_ID !== '' && CONFIG.API_KEY !== '';
  }

  /**
   * Get status info
   * @returns {Object}
   */
  function getStatus() {
    return {
      configured: isConfigured(),
      gapiLoaded: gapiInited,
      gisLoaded: gisInited,
      signedIn: isSignedIn,
      spreadsheetId: getSpreadsheetId(),
      currentProfileId: currentProfileId
    };
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  return {
    // Initialization
    init,
    isConfigured,
    getStatus,

    // Authentication
    signIn,
    signOut,
    isAuthenticated,

    // Profile (for multi-user support)
    setCurrentProfile,

    // Spreadsheet (per-profile)
    setSpreadsheet,
    getSpreadsheetId,
    extractIdFromUrl,

    // CRUD
    readAll,
    writeProfile,
    writeAll,

    // Sync
    sync,
    push,
    pull,

    // Config (for setup)
    CONFIG
  };

})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SheetsSync;
}
