/**
 * IB Helper Google Sheets Sync - v3.5.2 (#29 default values fix)
 *
 * Multi-user Google Sheets 동기화 모듈
 * Dual-Key Structure: GoogleID + ProfileID
 *
 * @version 3.5.3
 * @author 100xFenok Claude
 * @decision DEC-150 (2026-02-03), DEC-153 (2026-02-03)
 * @feature #211 (2026-02-03): 현재가 연동 - Prices 시트에서 자동 조회
 * @feature #211-P3 (2026-02-03): 프리마켓 가격 우선 (MarketState 기반)
 * @fix C-10 (2026-02-03): withRetry() - API rate limit 대응
 * @fix C-11 (2026-02-03): isAuthenticated() - gapi.client undefined 체크
 * @fix #29 (2026-02-03): 라오어 가이드 기준 기본값 (SOXL 12%/5%, 기타 10%/5%)
 *
 * Sheet1 "Portfolio" Structure (v3.6 - 12 columns):
 * | 구글ID | 프로필ID | 프로필이름 | 종목 | 평단가 | 수량 | 총매입금 | 세팅원금 | AFTER% | LOC% | 날짜 | 예수금 |
 * | A열    | B열      | C열        | D열  | E열    | F열  | G열      | H열      | I열    | J열  | K열  | L열  |
 *
 * Sheet3 "Orders" Structure (DEC-153):
 * | 날짜 | 구글ID | 프로필ID | 종목 | 주문타입 | 매수매도 | 가격 | 수량 | 총액 | 체결기준 | 체결 | 체결일 | 실제가격 |
 * | A열  | B열    | C열      | D열  | E열      | F열      | G열  | H열  | I열  | J열      | K열  | L열    | M열      |
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

    // Sheet 구조 (v3.6): 구글ID | 프로필ID | 프로필이름 | 종목 | 평단가 | 수량 | 총매입금 | 세팅원금 | AFTER% | LOC% | 날짜 | 예수금
    // 시트 이름 없이 범위만 사용 → 첫 번째 시트에 자동 적용
    // 예수금은 프로필의 첫 번째 종목 row에만 저장
    RANGE: 'A2:L10000'  // Skip header row, 12 columns
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

  // 🔴 v3.4.0: 중복 push 방지
  let isPushing = false;

  // =====================================================
  // RETRY HELPER (C-10: Rate Limit Handling)
  // =====================================================

  /**
   * 🔴 v3.5.0 (C-10): Rate limit 및 네트워크 오류 대응 retry 함수
   * @param {Function} fn - 실행할 async 함수
   * @param {number} maxRetries - 최대 재시도 횟수 (기본 3)
   * @param {number} baseDelay - 기본 딜레이 ms (기본 1000)
   * @returns {Promise<any>} 함수 실행 결과
   */
  async function withRetry(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Rate limit (429) 또는 서버 오류 (5xx)인 경우만 재시도
        const status = error?.status || error?.result?.error?.code;
        const isRetryable = status === 429 || (status >= 500 && status < 600);

        if (!isRetryable || attempt >= maxRetries) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s...
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`SheetsSync: Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
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
   * 🔴 v3.4.1: gapi/google 미정의 체크 추가 (C-04)
   */
  function signOut() {
    try {
      // gapi가 로드되지 않았으면 스킵
      if (typeof gapi !== 'undefined' && gapi.client) {
        const token = gapi.client.getToken();
        if (token && typeof google !== 'undefined' && google.accounts?.oauth2) {
          google.accounts.oauth2.revoke(token.access_token);
          gapi.client.setToken('');
        }
      }
    } catch (error) {
      console.warn('signOut error (ignored):', error);
    }
    isSignedIn = false;
    currentUserEmail = null;
  }

  /**
   * Check if user is signed in
   * 🔴 v3.5.1: gapi.client undefined 체크 추가 (C-11)
   * @returns {boolean}
   */
  function isAuthenticated() {
    try {
      return isSignedIn &&
             typeof gapi !== 'undefined' &&
             gapi.client &&
             gapi.client.getToken() !== null;
    } catch {
      return false;
    }
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
  /**
   * 🔴 v3.4.1: response 구조 검증 추가 (C-09)
   * 🔴 v3.5.0: withRetry 적용 (C-10)
   */
  async function readAllRows() {
    const sheetId = getSpreadsheetId();
    if (!sheetId) {
      throw new Error('Spreadsheet ID not set');
    }

    return withRetry(async () => {
      const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: CONFIG.RANGE,
      });

      // 🔴 v3.4.1: response 구조 검증
      if (!response || !response.result) {
        console.warn('readAllRows: Unexpected response structure', response);
        return [];
      }

      return response.result.values || [];
    });
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
   * 시트 컬럼 (v3.6): 구글ID | 프로필ID | 프로필이름 | 종목 | 평단가 | 수량 | 총매입금 | 세팅원금 | AFTER% | LOC% | 날짜 | 예수금
   * @param {Array} rows - Raw sheet rows
   * @returns {Array} Stocks array
   */
  function parseRows(rows) {
    const stocks = [];

    rows.forEach(row => {
      if (!row || row.length < 3) return;

      const hasProfileName = row.length >= 12;
      const googleId = row[0] || '';
      const profileId = row[1] || '';
      const profileName = hasProfileName ? row[2] : '';
      const baseIndex = hasProfileName ? 3 : 2;
      const symbol = row[baseIndex];

      if (!symbol) return;

      const avgPrice = row[baseIndex + 1];
      const holdings = row[baseIndex + 2];
      const totalInvested = row[baseIndex + 3];
      const principal = row[baseIndex + 4];
      const afterPercent = row[baseIndex + 5];
      const locPercent = row[baseIndex + 6];
      const date = row[baseIndex + 7];
      const balance = row[baseIndex + 8];

      const sym = String(symbol).trim().toUpperCase();
      stocks.push({
        googleId,
        profileId,
        symbol: sym,
        profileName: profileName || '',
        avgPrice: parseFloat(avgPrice) || 0,
        holdings: parseInt(holdings) || 0,
        totalInvested: parseFloat(totalInvested) || 0,
        principal: parseFloat(principal) || 0,
        sellPercent: parseFloat(afterPercent) || (sym === 'SOXL' ? 12 : 10),
        locSellPercent: parseFloat(locPercent) || 5,
        date: date || '',
        balance: parseFloat(balance) || 0
      });
    });

    return stocks;
  }

  // =====================================================
  // WRITE OPERATIONS
  // =====================================================

  /**
   * Write all rows to sheet (전체 덮어쓰기)
   * 🔴 v3.5.0: withRetry 적용 (C-10)
   * @param {Array} rows - 2D array of row data
   */
  async function writeAllRows(rows) {
    const sheetId = getSpreadsheetId();
    if (!sheetId) {
      throw new Error('Spreadsheet ID not set');
    }

    return withRetry(async () => {
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
   *
   * 🔴 v3.4.0: 중복 실행 방지 (isPushing flag)
   */
  async function push() {
    if (!currentUserEmail) {
      throw new Error('로그인이 필요합니다');
    }

    // 🔴 v3.4.0: 이미 push 중이면 스킵
    if (isPushing) {
      console.log('SheetsSync push: Already in progress, skipping');
      return;
    }

    const profile = ProfileManager.getActive();

    if (!profile || !profile.stocks) {
      throw new Error('프로필이 없습니다');
    }

    // 🔴 v3.4.0: push 시작
    isPushing = true;

    try {
      // 로컬 시간 기준 날짜 (한국 시간대 반영)
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

      // 1. 전체 데이터 읽기
      const allRows = await readAllRows();

      // 2. 내 데이터 제외 (다른 사용자 데이터 보존)
      const otherRows = allRows.filter(row =>
        !(row[0] === currentUserEmail && row[1] === profile.id)
      );

      // 3. 내 새 데이터 생성 (v3.6: 12 columns, 프로필 이름 + 예수금 포함)
      // 예수금은 BalanceManager에서 가져옴 (첫 번째 row에만 저장)
      const balance = (typeof BalanceManager !== 'undefined')
        ? BalanceManager.getBalance(profile.id)?.available || 0
        : 0;
      const profileName = profile.name || '프로필';

      const myNewRows = profile.stocks.map((stock, index) => {
        const dailyData = ProfileManager.loadDailyData(profile.id, stock.symbol) || {};
        const sym = stock.symbol.toUpperCase();
        return [
          currentUserEmail,           // A: 구글ID
          profile.id,                 // B: 프로필ID
          profileName,                // C: 프로필 이름
          stock.symbol,               // D: 종목
          dailyData.avgPrice || 0,    // E: 평단가
          dailyData.holdings || 0,    // F: 수량
          dailyData.totalInvested || 0, // G: 총매입금
          stock.principal || 0,       // H: 세팅원금
          // 🔴 v3.5.2: 라오어 가이드 기준 기본값 (#29)
          stock.sellPercent || (sym === 'SOXL' ? 12 : 10),      // I: AFTER% (지정가 매도)
          stock.locSellPercent || 5,     // J: LOC% (분할매도) - 모든 종목 5%
          today,                      // K: 날짜
          index === 0 ? (balance || 0) : 0  // L: 예수금 (첫 번째 row만, 🔴 v3.5.3: 빈값→0 통일 B5-08)
        ];
      });

      // 4. 합쳐서 저장
      const normalizedOtherRows = otherRows.map(row => {
        if (!row) return [];
        if (row.length >= 12) return row;
        const legacyRow = [...row];
        legacyRow.splice(2, 0, '');
        return legacyRow;
      });

      const finalRows = [...normalizedOtherRows, ...myNewRows];
      await writeAllRows(finalRows);

      console.log(`SheetsSync: Pushed ${myNewRows.length} rows for ${currentUserEmail}/${profile.id}`);
    } finally {
      // 🔴 v3.4.0: push 완료 (에러 발생해도 플래그 해제)
      isPushing = false;
    }
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

    // 🔴 v3.2: 예수금 저장 (첫 번째 row에서)
    if (myStocks.length > 0 && myStocks[0].balance > 0) {
      if (typeof BalanceManager !== 'undefined') {
        BalanceManager.updateBalance(profile.id, myStocks[0].balance);
      }
    }

    // 각 종목의 일일 데이터 업데이트 (v3.2: AFTER% + LOC% + 예수금 포함)
    myStocks.forEach(stock => {
      // 1. Daily data 저장 (평단가, 수량, 총매입금)
      ProfileManager.saveDailyData(profile.id, stock.symbol, {
        avgPrice: stock.avgPrice,
        holdings: stock.holdings,
        totalInvested: stock.totalInvested,
        currentPrice: 0  // 현재가는 수동 입력
      });

      // 2. Stock settings 저장 (v3.2: sellPercent + locSellPercent 시트에서 가져온 값 적용)
      ProfileManager.addStock(profile.id, {
        symbol: stock.symbol,
        principal: stock.principal,
        sellPercent: stock.sellPercent,        // H: AFTER% (시트에서 가져온 값)
        locSellPercent: stock.locSellPercent   // I: LOC% (시트에서 가져온 값)
      });
    });

    if (myStocks.length > 0 && myStocks[0].profileName) {
      ProfileManager.update(profile.id, { name: myStocks[0].profileName });
    }

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
  // PROFILE DISCOVERY (Bug 14 Fix)
  // =====================================================

  /**
   * Get all profiles from sheet for current Google user
   * Used for profile selection UI when pulling data
   * @returns {Promise<Array>} Array of { profileId, profileName, balance, stocks: [...] }
   */
  async function getMyProfilesFromSheet() {
    if (!currentUserEmail) {
      throw new Error('로그인이 필요합니다');
    }

    const allRows = await readAllRows();

    // Filter by my Google ID
    const myRows = allRows.filter(row => row[0] === currentUserEmail);

    // Group by profile ID (v3.2: 예수금 포함)
    const profileMap = {};
    myRows.forEach(row => {
      if (!row || row.length < 3) return;
      const hasProfileName = row.length >= 12;
      const profileId = row[1];
      const profileName = hasProfileName
        ? String(row[2] || '').trim()
        : (profileId.split('_')[0] || 'Profile');
      const baseIndex = hasProfileName ? 3 : 2;
      const sym = String(row[baseIndex] || '').trim().toUpperCase();

      if (!profileMap[profileId]) {
        profileMap[profileId] = {
          profileId,
          profileName: profileName || 'Profile',
          balance: 0,
          stocks: []
        };
      }

      const rowBalance = parseFloat(row[baseIndex + 8]) || 0;
      if (rowBalance > 0 && profileMap[profileId].balance === 0) {
        profileMap[profileId].balance = rowBalance;
      }

      profileMap[profileId].stocks.push({
        symbol: sym,
        avgPrice: parseFloat(row[baseIndex + 1]) || 0,
        holdings: parseInt(row[baseIndex + 2]) || 0,
        totalInvested: parseFloat(row[baseIndex + 3]) || 0,
        principal: parseFloat(row[baseIndex + 4]) || 0,
        sellPercent: parseFloat(row[baseIndex + 5]) || (sym === 'SOXL' ? 12 : 10),
        locSellPercent: parseFloat(row[baseIndex + 6]) || 5
      });
    });

    return Object.values(profileMap);
  }

  /**
   * Pull data from specific sheet profile ID (regardless of local profile ID)
   * This allows pulling from a sheet profile even if local profile ID is different
   * @param {string} sheetProfileId - Profile ID in the sheet to pull from
   * @returns {Promise<Array>} Pulled stocks
   */
  async function pullFromSheetProfile(sheetProfileId) {
    if (!currentUserEmail) {
      throw new Error('로그인이 필요합니다');
    }

    const profile = ProfileManager.getActive();
    if (!profile) {
      throw new Error('프로필이 없습니다');
    }

    const allRows = await readAllRows();

    // Filter by my Google ID AND the specified sheet profile ID
    const myRows = allRows.filter(row =>
      row[0] === currentUserEmail && row[1] === sheetProfileId
    );

    const myStocks = parseRows(myRows);

    // Update local profile with sheet data (v3.1: AFTER% + LOC% 포함)
    myStocks.forEach(stock => {
      // 1. Daily data 저장 (평단가, 수량, 총매입금)
      ProfileManager.saveDailyData(profile.id, stock.symbol, {
        avgPrice: stock.avgPrice,
        holdings: stock.holdings,
        totalInvested: stock.totalInvested,
        currentPrice: 0  // 현재가는 수동 입력
      });

      // 2. Stock settings 저장 (v3.1: sellPercent + locSellPercent 시트에서 가져온 값 적용)
      ProfileManager.addStock(profile.id, {
        symbol: stock.symbol,
        principal: stock.principal,
        sellPercent: stock.sellPercent,        // H: AFTER% (시트에서 가져온 값)
        locSellPercent: stock.locSellPercent   // I: LOC% (시트에서 가져온 값)
      });
    });

    if (myStocks.length > 0 && myStocks[0].profileName) {
      ProfileManager.update(profile.id, { name: myStocks[0].profileName });
    }

    console.log(`SheetsSync: Pulled ${myStocks.length} rows from sheet profile "${sheetProfileId}" to local profile "${profile.id}"`);
    return myStocks;
  }

  // =====================================================
  // PRICES MANAGEMENT (#211: 현재가 연동)
  // =====================================================

  /**
   * Get the "Prices" sheet name
   * @returns {string}
   */
  function getPricesSheetName() {
    return 'Prices';
  }

  /**
   * Fetch current prices from Prices sheet
   * Sheet structure (v1.2): | Ticker | Current | Close | High | Low | MarketState | UpdatedAt |
   *
   * 🔴 #211-P3: Current 열에는 이미 getBestPrice()로 계산된 값이 저장됨
   *   - PRE 상태 + preMarket 있음 → preMarket 가격
   *   - POST 상태 + afterHours 있음 → afterHours 가격
   *   - 그 외 → 정규장 가격
   *
   * @returns {Promise<Object>} Map of ticker → price data
   * Example: { TQQQ: { current: 55.1, close: 54, high: 55.7, low: 53.1, marketState: 'PRE' }, ... }
   */
  async function fetchCurrentPrices() {
    const sheetId = getSpreadsheetId();
    if (!sheetId) {
      console.warn('SheetsSync: Spreadsheet ID not set, cannot fetch prices');
      return {};
    }

    try {
      // 🔴 v3.5.0: withRetry 적용 (C-10)
      const response = await withRetry(() =>
        gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `${getPricesSheetName()}!A2:G100`,  // Skip header, include MarketState & UpdatedAt
        })
      );

      const rows = response.result.values || [];
      const prices = {};

      rows.forEach(row => {
        const ticker = (row[0] || '').toUpperCase().trim();
        if (!ticker) return;

        const current = parseFloat(row[1]) || 0;
        const close = parseFloat(row[2]) || 0;
        const high = parseFloat(row[3]) || 0;
        const low = parseFloat(row[4]) || 0;
        const marketState = (row[5] || 'UNKNOWN').toUpperCase();  // 🔴 #211-P3
        const updatedAt = row[6] || '';

        // Validate price is reasonable
        if (current > 0) {
          prices[ticker] = {
            current,       // 🔴 이미 getBestPrice()로 계산된 최적 가격
            close,
            high,
            low,
            marketState,   // 🔴 PRE/REGULAR/POST/CLOSED
            updatedAt,
            timestamp: new Date().toISOString()
          };
        }
      });

      console.log(`SheetsSync: Fetched prices for ${Object.keys(prices).length} tickers`);
      return prices;

    } catch (error) {
      console.error('SheetsSync: fetchCurrentPrices error:', error);
      return {};
    }
  }

  /**
   * Get current price for a specific ticker
   * @param {string} ticker - Stock symbol (e.g., 'TQQQ')
   * @returns {Promise<number>} Current price or 0 if not found
   */
  async function getCurrentPrice(ticker) {
    const prices = await fetchCurrentPrices();
    return prices[ticker.toUpperCase()]?.current || 0;
  }

  // =====================================================
  // ORDERS MANAGEMENT (DEC-153: Order Execution Tracking)
  // =====================================================

  /**
   * Get the "Orders" sheet name
   * @returns {string}
   */
  function getOrdersSheetName() {
    return 'Orders';
  }

  /**
   * Save orders to Sheet3 "Orders"
   * Called after calculateOrders() to record order history
   *
   * @param {Object} params - Order parameters
   * @param {string} params.ticker - Stock symbol (e.g., TQQQ, SOXL)
   * @param {Array} params.buyOrders - Array of buy order objects
   * @param {Array} params.sellOrders - Array of sell order objects
   * @returns {Promise<number>} Number of orders saved
   */
  async function saveOrders({ ticker, buyOrders, sellOrders }) {
    if (!currentUserEmail) {
      throw new Error('로그인이 필요합니다');
    }

    const profile = ProfileManager.getActive();
    if (!profile) {
      throw new Error('프로필이 없습니다');
    }

    const sheetId = getSpreadsheetId();
    if (!sheetId) {
      throw new Error('Spreadsheet ID not set');
    }

    // Get today's date (local time)
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    // Build order rows
    const orderRows = [];

    // Process buy orders
    buyOrders.forEach(order => {
      orderRows.push([
        today,                              // A: 날짜
        currentUserEmail,                   // B: 구글ID
        profile.id,                         // C: 프로필ID
        ticker,                             // D: 종목
        order.type,                         // E: 주문타입 (평단LOC매수, 큰수LOC매수, 하락대비)
        'BUY',                              // F: 매수매도
        parseFloat(order.price) || 0,       // G: 가격
        parseInt(order.quantity) || 0,      // H: 수량
        (parseFloat(order.price) || 0) * (parseInt(order.quantity) || 0),  // I: 총액
        'CLOSE',                            // J: 체결기준 (매수는 종가 기준)
        '',                                 // K: 체결 (빈값 = 미체결)
        '',                                 // L: 체결일
        ''                                  // M: 실제가격
      ]);
    });

    // Process sell orders
    sellOrders.forEach(order => {
      const isLoc = order.type.includes('LOC');
      orderRows.push([
        today,                              // A: 날짜
        currentUserEmail,                   // B: 구글ID
        profile.id,                         // C: 프로필ID
        ticker,                             // D: 종목
        order.type,                         // E: 주문타입 (LOC매도, 지정가매도)
        'SELL',                             // F: 매수매도
        parseFloat(order.price) || 0,       // G: 가격
        parseInt(order.quantity) || 0,      // H: 수량
        (parseFloat(order.price) || 0) * (parseInt(order.quantity) || 0),  // I: 총액
        isLoc ? 'CLOSE' : 'HIGH',           // J: 체결기준 (LOC=종가, 지정가=고가)
        '',                                 // K: 체결 (빈값 = 미체결)
        '',                                 // L: 체결일
        ''                                  // M: 실제가격
      ]);
    });

    if (orderRows.length === 0) {
      console.log('SheetsSync.saveOrders: No orders to save');
      return 0;
    }

    // Append to Orders sheet
    try {
      await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${getOrdersSheetName()}!A:M`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: orderRows }
      });

      console.log(`SheetsSync.saveOrders: Saved ${orderRows.length} orders for ${ticker}`);
      return orderRows.length;
    } catch (error) {
      // If sheet doesn't exist, create it first
      if (error.result?.error?.message?.includes('Unable to parse range')) {
        console.log('SheetsSync.saveOrders: Orders sheet may not exist, trying to create...');
        await createOrdersSheet();
        // Retry append
        await gapi.client.sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: `${getOrdersSheetName()}!A:M`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: orderRows }
        });
        console.log(`SheetsSync.saveOrders: Created sheet and saved ${orderRows.length} orders`);
        return orderRows.length;
      }
      throw error;
    }
  }

  /**
   * Create Orders sheet with headers if it doesn't exist
   */
  async function createOrdersSheet() {
    const sheetId = getSpreadsheetId();

    // Add new sheet
    try {
      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: getOrdersSheetName(),
                index: 2  // Third sheet (0-indexed)
              }
            }
          }]
        }
      });
    } catch (e) {
      // Sheet might already exist
      console.log('Sheet creation skipped (may already exist)');
    }

    // Add headers
    const headers = [
      ['날짜', '구글ID', '프로필ID', '종목', '주문타입', '매수매도', '가격', '수량', '총액', '체결기준', '체결', '체결일', '실제가격']
    ];

    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${getOrdersSheetName()}!A1:M1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: headers }
    });

    console.log('SheetsSync: Created Orders sheet with headers');
  }

  /**
   * Read pending orders (체결 컬럼이 빈 값인 주문)
   * @returns {Promise<Array>} Array of pending orders
   */
  async function readPendingOrders() {
    if (!currentUserEmail) {
      throw new Error('로그인이 필요합니다');
    }

    const sheetId = getSpreadsheetId();
    if (!sheetId) {
      throw new Error('Spreadsheet ID not set');
    }

    try {
      const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${getOrdersSheetName()}!A2:M10000`,
      });

      const rows = response.result.values || [];

      // Filter: my orders only, pending (체결 컬럼 빈값)
      const pending = rows.filter(row =>
        row[1] === currentUserEmail &&  // B: 구글ID
        (!row[10] || row[10] === '')    // K: 체결 (빈값 = 미체결)
      );

      return pending.map((row, index) => ({
        rowIndex: index + 2,  // Excel row number (1-indexed, skip header)
        date: row[0],
        googleId: row[1],
        profileId: row[2],
        ticker: row[3],
        orderType: row[4],
        side: row[5],
        price: parseFloat(row[6]) || 0,
        quantity: parseInt(row[7]) || 0,
        total: parseFloat(row[8]) || 0,
        executionBasis: row[9],  // CLOSE or HIGH
        execution: row[10],
        executionDate: row[11],
        actualPrice: row[12]
      }));
    } catch (error) {
      console.error('SheetsSync.readPendingOrders error:', error);
      return [];
    }
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

    // Profile Discovery (Bug 14 Fix)
    getMyProfilesFromSheet,
    pullFromSheetProfile,

    // Orders (DEC-153: Order Execution Tracking)
    saveOrders,
    readPendingOrders,

    // Prices (#211: 현재가 연동)
    fetchCurrentPrices,
    getCurrentPrice,

    // Config (for debugging)
    CONFIG
  };

})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SheetsSync;
}
