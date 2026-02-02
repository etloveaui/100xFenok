/**
 * IB Helper Google Sheets Sync - v2.0 (DEC-150)
 *
 * Multi-user Google Sheets 동기화 모듈
 * Dual-Key Structure: GoogleID + ProfileID
 *
 * @version 2.0.0
 * @author 100xFenok Claude
 * @decision DEC-150 (2026-02-03)
 *
 * Sheet Structure:
 * | 구글ID | 프로필ID | 종목 | 평단가 | 수량 | 총매입금 | 세팅원금 | 날짜 |
 * | A열    | B열      | C열  | D열    | E열  | F열      | G열      | H열  |
 */

const SheetsSync = (function() {

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const CONFIG = {
    // Google Cloud Console - xfenok-analytics project
    CLIENT_ID: '1047143661358-3pd4f9o20tmp2u2dejskbdhrrs1tgmuo.apps.googleusercontent.com',
    API_KEY: 'AIzaSyCmaRwyiBnWWZf8mSp8g4Io8E0nqyWQnlI',

    // 🔴 하드코딩된 시트 ID (모든 사용자 공유)
    SPREADSHEET_ID: '1shNx-xmzsJ7ninBly4HUjOjrMFqlvj-u3aBg6PmTGBE',

    DISCOVERY_DOCS: [
      'https://sheets.googleapis.com/$discovery/rest?version=v4'
    ],
    // Sheets + UserInfo scope
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email',

    // Sheet 구조 (v2.0): 구글ID | 프로필ID | 종목 | 평단가 | 수량 | 총매입금 | 세팅원금 | 날짜
    // 시트 이름 없이 범위만 사용 → 첫 번째 시트에 자동 적용
    RANGE: 'A2:H10000'  // Skip header row, 8 columns
  };

  // =====================================================
  // STATE
  // =====================================================

  let currentProfileId = null;
  let currentUserEmail = null;  // Google 로그인 이메일
  let tokenClient = null;
  let gapiInited = false;
  let gisInited = false;
  let isSignedIn = false;

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
      if (typeof gapi !== 'undefined' && gapiInited) {
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
              discoveryDocs: CONFIG.DISCOVERY_DOCS,
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
   * Sign in to Google and get user email
   * @returns {Promise<Object>} Token response
   */
  function signIn() {
    return new Promise((resolve, reject) => {
      if (!gisInited) {
        reject(new Error('Google Identity Services not initialized'));
        return;
      }

      tokenClient.callback = async (response) => {
        if (response.error) {
          isSignedIn = false;
          currentUserEmail = null;
          reject(response);
        } else {
          isSignedIn = true;
          // Get user email after sign in
          try {
            await fetchUserEmail();
          } catch (e) {
            console.warn('Could not fetch user email:', e);
          }
          resolve(response);
        }
      };

      if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
      } else {
        tokenClient.requestAccessToken({ prompt: '' });
      }
    });
  }

  /**
   * Fetch current user's email from Google
   * Uses OAuth token directly (not API_KEY) to avoid 403
   */
  async function fetchUserEmail() {
    try {
      const token = gapi.client.getToken();
      if (!token || !token.access_token) {
        throw new Error('No access token available');
      }

      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${token.access_token}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      currentUserEmail = data.email;
      console.log('SheetsSync: Logged in as', currentUserEmail);
      return currentUserEmail;
    } catch (error) {
      console.error('Failed to get user email:', error);
      throw error;
    }
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
    currentUserEmail = null;
  }

  /**
   * Check if user is signed in
   * @returns {boolean}
   */
  function isAuthenticated() {
    return isSignedIn && gapi.client.getToken() !== null;
  }

  /**
   * Get current user's Google email
   * @returns {string|null}
   */
  function getUserEmail() {
    return currentUserEmail;
  }

  // =====================================================
  // PROFILE MANAGEMENT
  // =====================================================

  /**
   * Set current profile for Sheets operations
   * @param {string} profileId
   */
  function setCurrentProfile(profileId) {
    currentProfileId = profileId;
  }

  /**
   * Get spreadsheet ID (hardcoded)
   * @returns {string}
   */
  function getSpreadsheetId() {
    return CONFIG.SPREADSHEET_ID;
  }

  // =====================================================
  // READ OPERATIONS
  // =====================================================

  /**
   * Read ALL data from sheet (모든 사용자)
   * @returns {Promise<Array>} All rows
   */
  async function readAllRows() {
    const sheetId = getSpreadsheetId();
    if (!sheetId) {
      throw new Error('Spreadsheet ID not set');
    }

    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: CONFIG.RANGE,
    });

    return response.result.values || [];
  }

  /**
   * Read MY data from sheet (내 구글ID + 내 프로필ID만)
   * @returns {Promise<Array>} Filtered stocks for current user & profile
   */
  async function readMyData() {
    if (!currentUserEmail) {
      throw new Error('로그인이 필요합니다');
    }
    if (!currentProfileId) {
      throw new Error('프로필을 선택해주세요');
    }

    const allRows = await readAllRows();
    const myRows = allRows.filter(row =>
      row[0] === currentUserEmail && row[1] === currentProfileId
    );

    return parseRows(myRows);
  }

  /**
   * Parse sheet rows to stock array
   * 시트 컬럼: 구글ID | 프로필ID | 종목 | 평단가 | 수량 | 총매입금 | 세팅원금 | 날짜
   * @param {Array} rows - Raw sheet rows
   * @returns {Array} Stocks array
   */
  function parseRows(rows) {
    const stocks = [];

    rows.forEach(row => {
      const [googleId, profileId, symbol, avgPrice, holdings, totalInvested, principal, date] = row;

      if (!symbol) return;

      stocks.push({
        googleId: googleId || '',
        profileId: profileId || '',
        symbol: symbol.trim().toUpperCase(),
        avgPrice: parseFloat(avgPrice) || 0,
        holdings: parseInt(holdings) || 0,
        totalInvested: parseFloat(totalInvested) || 0,
        principal: parseFloat(principal) || 0,
        date: date || ''
      });
    });

    return stocks;
  }

  // =====================================================
  // WRITE OPERATIONS
  // =====================================================

  /**
   * Write all rows to sheet (전체 덮어쓰기)
   * @param {Array} rows - 2D array of row data
   */
  async function writeAllRows(rows) {
    const sheetId = getSpreadsheetId();
    if (!sheetId) {
      throw new Error('Spreadsheet ID not set');
    }

    // Clear existing data (except header)
    await gapi.client.sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: CONFIG.RANGE,
    });

    if (rows.length === 0) return;

    // Write all data
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'A2',  // 첫 번째 시트 자동 사용
      valueInputOption: 'USER_ENTERED',
      resource: { values: rows }
    });
  }

  // =====================================================
  // SYNC OPERATIONS (DEC-150: Dual-Key)
  // =====================================================

  /**
   * Push local data to cloud (현재 프로필만)
   * - 내 구글ID + 내 프로필ID 행만 삭제
   * - 새 데이터 추가
   * - 다른 사용자 데이터 보존
   */
  async function push() {
    if (!currentUserEmail) {
      throw new Error('로그인이 필요합니다');
    }

    const profile = ProfileManager.getActive();
    console.log('SheetsSync push - profile:', profile);
    console.log('SheetsSync push - stocks:', profile?.stocks);

    if (!profile || !profile.stocks) {
      throw new Error('프로필이 없습니다');
    }

    // 로컬 시간 기준 날짜 (한국 시간대 반영)
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    // 1. 전체 데이터 읽기
    const allRows = await readAllRows();

    // 2. 내 데이터 제외 (다른 사용자 데이터 보존)
    const otherRows = allRows.filter(row =>
      !(row[0] === currentUserEmail && row[1] === profile.id)
    );

    // 3. 내 새 데이터 생성
    const myNewRows = profile.stocks.map(stock => {
      const dailyData = ProfileManager.loadDailyData(profile.id, stock.symbol) || {};
      return [
        currentUserEmail,           // A: 구글ID
        profile.id,                 // B: 프로필ID
        stock.symbol,               // C: 종목
        dailyData.avgPrice || 0,    // D: 평단가
        dailyData.holdings || 0,    // E: 수량
        dailyData.totalInvested || 0, // F: 총매입금
        stock.principal || 0,       // G: 세팅원금
        today                       // H: 날짜
      ];
    });

    // 4. 합쳐서 저장
    const finalRows = [...otherRows, ...myNewRows];
    await writeAllRows(finalRows);

    console.log(`SheetsSync: Pushed ${myNewRows.length} rows for ${currentUserEmail}/${profile.id}`);
  }

  /**
   * Pull cloud data to local (내 구글ID + 내 프로필ID만)
   */
  async function pull() {
    if (!currentUserEmail) {
      throw new Error('로그인이 필요합니다');
    }

    const profile = ProfileManager.getActive();
    if (!profile) {
      throw new Error('프로필이 없습니다');
    }

    // 내 데이터만 필터링해서 가져오기
    const myStocks = await readMyData();

    // 각 종목의 일일 데이터 업데이트
    myStocks.forEach(stock => {
      // 1. Daily data 저장 (평단가, 수량, 총매입금)
      ProfileManager.saveDailyData(profile.id, stock.symbol, {
        avgPrice: stock.avgPrice,
        holdings: stock.holdings,
        totalInvested: stock.totalInvested,
        currentPrice: 0  // 현재가는 수동 입력
      });

      // 2. Stock settings 저장 (🔴 v4.13.0: 항상 업데이트 - 기존 종목도 principal 반영)
      const existingStock = profile.stocks?.find(s => s.symbol === stock.symbol);
      ProfileManager.addStock(profile.id, {
        symbol: stock.symbol,
        principal: stock.principal,  // 시트에서 가져온 값으로 업데이트
        sellPercent: existingStock?.sellPercent || (stock.symbol === 'TQQQ' ? 10 : 12)
      });
    });

    console.log(`SheetsSync: Pulled ${myStocks.length} rows for ${currentUserEmail}/${profile.id}`);
    return myStocks;
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
      userEmail: currentUserEmail,
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
    getUserEmail,

    // Profile
    setCurrentProfile,
    getSpreadsheetId,

    // Sync (DEC-150: Dual-Key)
    push,
    pull,
    readMyData,

    // Config (for debugging)
    CONFIG
  };

})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SheetsSync;
}
