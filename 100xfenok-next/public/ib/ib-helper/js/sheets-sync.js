/**
 * IB Helper Google Sheets Sync - v4.0.2 (GAS Proxy Auth Migration)
 *
 * Multi-user Google Sheets 동기화 모듈
 * Dual-Key Structure: GoogleID + ProfileID
 *
 * @version 4.0.2
 * @feature #221: Apps Script WebApp으로 현재가 공개 API 구현 (로그인 불필요)
 * @fix Codex Review R1: CORS (Accept 헤더 제거), CONFIG 통합, ticker 검증, 1분 캐시
 * @fix Codex Review R2: 티커별 캐시 TTL 분리 (전역 타임스탬프 → 티커별 타임스탬프)
 * @fix Codex Review R3: JSONP 클라이언트 구현 (CORS 완전 우회 - script 삽입 방식)
 * @fix v3.7.4: fetchJSONP 변수 hoisting 버그 + 중복 resolve 방지
 * @feature #221-P3 (2026-02-04): commissionRate 동기화 (Portfolio M열)
 * @feature Session Persistence: 토큰 sessionStorage 저장 (탭 종료 시 자동 삭제)
 * @author 100xFenok Claude
 * @decision DEC-150 (2026-02-03), DEC-153 (2026-02-03)
 * @feature #211 (2026-02-03): 현재가 연동 - Prices 시트에서 자동 조회
 * @feature #211-P3 (2026-02-03): 프리마켓 가격 우선 (MarketState 기반)
 * @fix C-10 (2026-02-03): withRetry() - API rate limit 대응
 * @fix C-11 (2026-02-03): isAuthenticated() - gapi.client undefined 체크
 * @fix #29 (2026-02-03): 라오어 가이드 기준 기본값 (SOXL 12%/5%, 기타 10%/5%)
 * @feature #222-P4 (2026-02-04): CashReserve 시트 연동 (SGOV/BIL/BILS)
 * @fix v4.0.1 (2026-02-25): Proxy rowIndex alignment for push/pendingOrders + optional GIS preload bypass
 * @fix v4.0.2 (2026-02-25): Pull/Push duplicate freshness resolution + missing local dailyData overwrite guard
 *
 * Sheet1 "Portfolio" Structure (v3.8 - 15 columns):
 * | 구글ID | 프로필ID | 프로필이름 | 종목 | 평단가 | 수량 | 총매입금 | 세팅원금 | AFTER% | LOC% | 날짜 | 예수금 | 수수료(%) | 분할수 | revision |
 * | A열    | B열      | C열        | D열  | E열    | F열  | G열      | H열      | I열    | J열  | K열  | L열  | M열       | N열   | O열      |
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

    // 🔴 v3.7.0 (#221): Apps Script WebApp URL (현재가 공개 API)
    // 배포 후 URL 입력: https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec
    WEBAPP_URL: 'https://script.google.com/macros/s/AKfycbz2oCTIJyMFyAKUqoaZfcHMDz46rUEcSNFXnq2VDnXIKsdJcUl4oQQT6_FHRoeDyQAA/exec',

    // 🔴 v4.0.0 (#258/#226): GAS Proxy mode — all Sheets ops through doPost()
    // true = proxy path (no OAuth spreadsheets scope, 7-day session)
    // false = legacy gapi.client.sheets path (1-hour token, unverified app warning)
    USE_PROXY: true,

    DISCOVERY_DOCS: [
      'https://sheets.googleapis.com/$discovery/rest?version=v4'
    ],
    // Sheets + UserInfo scope
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email',

    // Sheet 구조 (v3.8): 구글ID | 프로필ID | 프로필이름 | 종목 | 평단가 | 수량 | 총매입금 | 세팅원금 | AFTER% | LOC% | 날짜 | 예수금 | 수수료(%) | 분할수 | revision
    // 시트 이름 없이 범위만 사용 → 첫 번째 시트에 자동 적용
    // 예수금은 프로필의 첫 번째 종목 row에만 저장
    RANGE: 'A2:O10000'  // Skip header row, 15 columns
  };

  const CASH_RESERVE_CONFIG = {
    SHEET_NAME: 'CashReserve',
    RANGE: 'A2:F10000'
  };

  // =====================================================
  // UTILITIES
  // =====================================================

  /**
   * 🔴 #236 (DEC-175): avgPrice 파생값 계산 (IIFE 내부용)
   * index.html의 computeAvgPrice()와 동일한 4자리 고정 로직
   */
  function _computeAvgPrice(totalInvested, holdings) {
    if (totalInvested > 0 && holdings > 0) {
      return parseFloat((totalInvested / holdings).toFixed(4));
    }
    return 0;
  }

  const PORTFOLIO_COLS = 15; // A~O

  function _sanitizeSymbol(symbol) {
    const raw = String(symbol || '').toUpperCase().trim();
    const clean = raw.replace(/[^A-Z0-9._-]/g, '');
    return clean.slice(0, 16);
  }

  function _normalizePortfolioRow(row) {
    if (!Array.isArray(row)) {
      return Array(PORTFOLIO_COLS).fill('');
    }

    const normalized = [...row];

    // Legacy rows without profile name column (<=12) need C column insertion.
    if (normalized.length <= 12) {
      normalized.splice(2, 0, '');
    }

    while (normalized.length < PORTFOLIO_COLS) normalized.push('');
    if (normalized.length > PORTFOLIO_COLS) normalized.length = PORTFOLIO_COLS;
    return normalized;
  }

  function _getRowSymbol(row) {
    const normalized = _normalizePortfolioRow(row);
    return _sanitizeSymbol(normalized[3]);
  }

  function _parseRevisionNumber(value) {
    const parsed = parseInt(String(value || '').trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function _isRowFresher(nextRow, prevRow) {
    const next = _normalizePortfolioRow(nextRow);
    const prev = _normalizePortfolioRow(prevRow);

    const nextRevision = _parseRevisionNumber(next[14]);
    const prevRevision = _parseRevisionNumber(prev[14]);
    if (nextRevision !== prevRevision) {
      return nextRevision > prevRevision;
    }

    const nextDate = String(next[10] || '').trim();
    const prevDate = String(prev[10] || '').trim();
    if (nextDate !== prevDate) {
      return nextDate > prevDate;
    }

    const nextInvested = parseFloat(next[6]);
    const prevInvested = parseFloat(prev[6]);
    if (Number.isFinite(nextInvested) && Number.isFinite(prevInvested) && nextInvested !== prevInvested) {
      return nextInvested > prevInvested;
    }

    const nextHoldings = parseFloat(next[5]);
    const prevHoldings = parseFloat(prev[5]);
    if (Number.isFinite(nextHoldings) && Number.isFinite(prevHoldings) && nextHoldings !== prevHoldings) {
      return nextHoldings > prevHoldings;
    }

    return false;
  }

  function _getProfileRevision(rows, googleId, profileId) {
    let latest = '';
    rows.forEach((row) => {
      const normalized = _normalizePortfolioRow(row);
      if (normalized[0] === googleId && normalized[1] === profileId) {
        const rev = String(normalized[14] || '');
        if (rev && rev > latest) latest = rev;
      }
    });
    return latest;
  }

  function _getRevisionStorageKey(profileId) {
    return `ib_helper_sheet_rev_${currentUserEmail || 'unknown'}_${profileId || 'none'}`;
  }

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

  // 🔴 v3.8.0: 세션 스토리지 키 (보안 강화)
  const TOKEN_STORAGE_KEY = 'ib_helper_google_token';
  const EMAIL_STORAGE_KEY = 'ib_helper_google_email';
  const LEGACY_TOKEN_STORAGE_KEY = 'ib_helper_google_token_legacy';
  const LEGACY_EMAIL_STORAGE_KEY = 'ib_helper_google_email_legacy';

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
    if (!CONFIG.CLIENT_ID) {
      console.warn('SheetsSync: CLIENT_ID not configured');
      return false;
    }

    try {
      // 🔴 v4.0.0: Proxy mode — skip gapi, only load GIS for identity
      if (CONFIG.USE_PROXY) {
        var restored = await GasProxy.init({
          preloadGis: false, // 수동 이메일 로그인 경로에서는 GIS 선로딩 생략
          onSignIn: function(email) {
            currentUserEmail = email;
            isSignedIn = true;
          },
          onSignOut: function() {
            currentUserEmail = null;
            isSignedIn = false;
          }
        });
        if (restored) {
          currentUserEmail = GasProxy.getUserEmail();
          isSignedIn = true;
        }
        return true;
      }

      // Legacy path: load gapi + GIS
      if (!CONFIG.API_KEY) {
        console.warn('SheetsSync: API_KEY not configured');
        return false;
      }
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
   * 🔴 v3.6.0: 저장된 세션 복원 시도
   * @returns {Promise<boolean>} 복원 성공 여부
   */
  async function tryRestoreSession() {
    try {
      // v3.8.0: sessionStorage only (non-persistent). Clear legacy localStorage values.
      const savedToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
      const savedEmail = sessionStorage.getItem(EMAIL_STORAGE_KEY);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(EMAIL_STORAGE_KEY);

      if (!savedToken || !savedEmail) {
        return false;
      }

      const tokenData = JSON.parse(savedToken);

      // 토큰 만료 체크 (만료 시간이 있고, 현재 시간보다 이전이면 만료)
      if (tokenData.expires_at && Date.now() > tokenData.expires_at) {
        console.log('SheetsSync: Saved token expired, clearing...');
        clearSavedSession();
        return false;
      }

      // 토큰 복원
      gapi.client.setToken(tokenData);
      currentUserEmail = savedEmail;
      isSignedIn = true;

      console.log('SheetsSync: Session restored for', savedEmail);
      return true;
    } catch (error) {
      console.warn('SheetsSync: Failed to restore session:', error);
      clearSavedSession();
      return false;
    }
  }

  /**
   * 🔴 v3.6.0: 세션 저장
   */
  function saveSession() {
    try {
      const token = gapi.client.getToken();
      if (token && currentUserEmail) {
        // 만료 시간 추가 (1시간 후)
        const tokenWithExpiry = {
          ...token,
          expires_at: Date.now() + (60 * 60 * 1000)  // 1시간
        };
        sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokenWithExpiry));
        sessionStorage.setItem(EMAIL_STORAGE_KEY, currentUserEmail);
        // v3.8.0: remove any persistent legacy session residue.
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(EMAIL_STORAGE_KEY);
        console.log('SheetsSync: Session saved for', currentUserEmail);
      }
    } catch (error) {
      console.warn('SheetsSync: Failed to save session:', error);
    }
  }

  /**
   * 🔴 v3.6.0: 저장된 세션 삭제
   */
  function clearSavedSession() {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(EMAIL_STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(EMAIL_STORAGE_KEY);
    localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    localStorage.removeItem(LEGACY_EMAIL_STORAGE_KEY);
  }

  /**
   * Sign in to Google and get user email
   * 🔴 v3.6.0: 저장된 세션 먼저 확인, 없으면 새 로그인
   * @param {Object} options - Proxy sign-in options (forceAccountSelect, manualEmail, buttonContainer, callbacks)
   * @returns {Promise<Object>} Token response
   */
  function signIn(options) {
    // 🔴 v4.0.0: Proxy mode — use GasProxy sign-in (returns Promise)
    if (CONFIG.USE_PROXY) {
      return GasProxy.signIn(options || {}).then(function(email) {
        currentUserEmail = email;
        isSignedIn = true;
        return { proxy: true, email: email };
      });
    }

    return new Promise(async (resolve, reject) => {
      if (!gisInited) {
        reject(new Error('Google Identity Services not initialized'));
        return;
      }

      // 🔴 v3.6.0: 저장된 세션 복원 시도
      if (await tryRestoreSession()) {
        resolve({ restored: true });
        return;
      }

      tokenClient.callback = async (response) => {
        if (response.error) {
          isSignedIn = false;
          currentUserEmail = null;
          clearSavedSession();
          reject(response);
        } else {
          isSignedIn = true;
          // Get user email after sign in
          try {
            await fetchUserEmail();
            // 🔴 v3.6.0: 세션 저장
            saveSession();
          } catch (e) {
            console.warn('Could not fetch user email:', e);
          }
          resolve(response);
        }
      };

      // 🔴 v3.6.0: prompt 변경 - 'select_account' 대신 '' 사용 (조용히 갱신 시도)
      const token = gapi.client.getToken();
      if (!token || !token.access_token) {
        // 토큰 없음 - 계정 선택 필요
        tokenClient.requestAccessToken({ prompt: 'consent' });
      } else {
        // 토큰 있음 - 조용히 갱신
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
   * 🔴 v3.6.0: 저장된 세션도 삭제
   */
  function signOut() {
    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      GasProxy.signOut();
      isSignedIn = false;
      currentUserEmail = null;
      return;
    }

    try {
      // gapi가 로드되지 않았으면 스킵
      if (typeof gapi !== 'undefined' && gapi.client) {
        const token = gapi.client.getToken();
        if (token && typeof google !== 'undefined' && google.accounts?.oauth2) {
          google.accounts.oauth2.revoke(token.access_token);
          gapi.client.setToken(null);
        }
      }
    } catch (error) {
      console.warn('signOut error (ignored):', error);
    }
    isSignedIn = false;
    currentUserEmail = null;
    // 🔴 v3.6.0: 저장된 세션 삭제
    clearSavedSession();
  }

  /**
   * Check if user is signed in
   * 🔴 v3.5.1: gapi.client undefined 체크 추가 (C-11)
   * @returns {boolean}
   */
  function isAuthenticated() {
    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      return GasProxy.isAuthenticated();
    }
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
    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      return GasProxy.getUserEmail() || currentUserEmail;
    }
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
    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      const result = await GasProxy.request('readPortfolio', null, {});
      if (!result.ok) throw new Error(result.error || 'readPortfolio failed');
      return result.data.values || [];
    }

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
   * 시트 컬럼 (v3.8): 구글ID | 프로필ID | 프로필이름 | 종목 | 평단가 | 수량 | 총매입금 | 세팅원금 | AFTER% | LOC% | 날짜 | 예수금 | 수수료(%) | 분할수 | revision
   * @param {Array} rows - Raw sheet rows
   * @returns {Array} Stocks array
   */
  function parseRows(rows) {
    const latestRowsBySymbol = new Map();

    rows.forEach(row => {
      if (!row || row.length < 3) return;

      const normalized = _normalizePortfolioRow(row);
      const sym = _sanitizeSymbol(normalized[3]);
      if (!sym) return;

      const existingRow = latestRowsBySymbol.get(sym);
      if (!existingRow || _isRowFresher(normalized, existingRow)) {
        latestRowsBySymbol.set(sym, normalized);
      }
    });

    const stocks = [];
    latestRowsBySymbol.forEach((normalized, sym) => {
      const holdings = parseInt(normalized[5], 10) || 0;
      const totalInvested = parseFloat(normalized[6]) || 0;
      const parsedBalance = parseFloat(normalized[11]);
      const parsedCommission = parseFloat(normalized[12]);

      stocks.push({
        googleId: normalized[0] || '',
        profileId: normalized[1] || '',
        symbol: sym,
        profileName: normalized[2] || '',
        avgPrice: _computeAvgPrice(totalInvested, holdings),
        holdings,
        totalInvested,
        principal: parseFloat(normalized[7]) || 0,
        divisions: parseInt(normalized[13], 10) || 40,
        sellPercent: parseFloat(normalized[8]) || (sym === 'SOXL' ? 12 : 10),
        locSellPercent: parseFloat(normalized[9]) || 5,
        date: normalized[10] || '',
        balance: Number.isFinite(parsedBalance) ? parsedBalance : null,
        commissionRate: Number.isFinite(parsedCommission) ? parsedCommission : null,
        revision: String(normalized[14] || '')
      });
    });

    return stocks;
  }

  // =====================================================
  // WRITE OPERATIONS
  // =====================================================

  /**
   * Write all rows to sheet (전체 재작성 - deprecated)
   * v3.8.0: clear() 제거. 유지보수 호환용으로만 유지.
   */
  async function writeAllRows(rows) {
    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      const result = await GasProxy.request('writePortfolio', null, { rows: rows || [] });
      if (!result.ok) throw new Error(result.error || 'writePortfolio failed');
      return;
    }

    const sheetId = getSpreadsheetId();
    if (!sheetId) {
      throw new Error('Spreadsheet ID not set');
    }

    return withRetry(async () => {
      if (!rows || rows.length === 0) return;
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'A2',  // 첫 번째 시트 자동 사용
        valueInputOption: 'USER_ENTERED',
        resource: { values: rows }
      });
    });
  }

  async function batchUpdatePortfolioRows(rowUpdates, profileId) {
    if (!rowUpdates || rowUpdates.length === 0) return;
    const targetProfileId = String(profileId || currentProfileId || '').trim();
    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      const result = await GasProxy.request('batchUpdatePortfolio', null, {
        rowUpdates,
        profileId: targetProfileId
      });
      if (!result.ok) throw new Error(result.error || 'batchUpdatePortfolio failed');
      return;
    }
    const sheetId = getSpreadsheetId();
    if (!sheetId) throw new Error('Spreadsheet ID not set');

    return withRetry(async () => {
      await gapi.client.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: rowUpdates.map((u) => ({
            range: `A${u.rowIndex}:O${u.rowIndex}`,
            values: [u.values]
          }))
        }
      });
    });
  }

  async function batchClearPortfolioRows(rowIndices, profileId) {
    if (!rowIndices || rowIndices.length === 0) return;
    const targetProfileId = String(profileId || currentProfileId || '').trim();
    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      const result = await GasProxy.request('batchClearPortfolio', null, {
        rowIndices,
        profileId: targetProfileId
      });
      if (!result.ok) throw new Error(result.error || 'batchClearPortfolio failed');
      return;
    }
    const sheetId = getSpreadsheetId();
    if (!sheetId) throw new Error('Spreadsheet ID not set');

    return withRetry(async () => {
      await gapi.client.sheets.spreadsheets.values.batchClear({
        spreadsheetId: sheetId,
        resource: {
          ranges: rowIndices.map((rowIndex) => `A${rowIndex}:O${rowIndex}`)
        }
      });
    });
  }

  async function appendPortfolioRows(rows, profileId) {
    if (!rows || rows.length === 0) return;
    const targetProfileId = String(profileId || currentProfileId || '').trim();
    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      const result = await GasProxy.request('appendPortfolio', null, {
        rows,
        profileId: targetProfileId
      });
      if (!result.ok) throw new Error(result.error || 'appendPortfolio failed');
      return;
    }
    const sheetId = getSpreadsheetId();
    if (!sheetId) throw new Error('Spreadsheet ID not set');

    return withRetry(async () => {
      await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'A2:O2',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
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
  async function push(overrideProfileId) {
    if (!currentUserEmail) {
      throw new Error('로그인이 필요합니다');
    }

    // 🔴 v3.4.0: 이미 push 중이면 스킵
    if (isPushing) {
      console.log('SheetsSync push: Already in progress, skipping');
      return;
    }

    // v4.0.3 (#272-C): debounce 안전성 — 호출 시점의 profileId 사용
    const profile = overrideProfileId
      ? ProfileManager.getAll().profiles[overrideProfileId]
      : ProfileManager.getActive();

    if (!profile || !profile.stocks) {
      throw new Error('프로필이 없습니다');
    }

    // 🔴 v3.4.0: push 시작
    isPushing = true;

    try {
      // 로컬 시간 기준 날짜 (한국 시간대 반영)
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const revision = `${Date.now()}`;

      // 예수금/수수료는 BalanceManager에서 가져옴 (첫 번째 row에만 저장)
      const balance = (typeof BalanceManager !== 'undefined')
        ? BalanceManager.getBalance(profile.id)?.available || 0
        : 0;
      const commissionRate = (typeof BalanceManager !== 'undefined')
        ? BalanceManager.getCommissionRate(profile.id)
        : null;
      const effectiveCommissionRate = (commissionRate !== null && commissionRate !== undefined)
        ? commissionRate
        : 0.07;
      const profileName = profile.name || '프로필';

      // 1) Snapshot read
      let allRows = [];
      let allRowIndices = [];
      if (CONFIG.USE_PROXY) {
        const snapshot = await GasProxy.request('readPortfolio', null, {});
        if (!snapshot.ok) throw new Error(snapshot.error || 'readPortfolio failed');
        allRows = snapshot?.data?.values || [];
        allRowIndices = snapshot?.data?.rowIndices || [];
      } else {
        allRows = await readAllRows();
      }

      const myRows = [];
      allRows.forEach((row, idx) => {
        const normalized = _normalizePortfolioRow(row);
        if (normalized[0] === currentUserEmail && normalized[1] === profile.id) {
          const absoluteRowIndexRaw = parseInt(allRowIndices[idx], 10);
          const absoluteRowIndex = Number.isFinite(absoluteRowIndexRaw) ? absoluteRowIndexRaw : (idx + 2);
          myRows.push({ rowIndex: absoluteRowIndex, row: normalized });
        }
      });

      const sheetRevision = _getProfileRevision(allRows, currentUserEmail, profile.id);
      const revisionKey = _getRevisionStorageKey(profile.id);
      const localRevision = localStorage.getItem(revisionKey);
      if (localRevision && sheetRevision && localRevision !== sheetRevision) {
        throw new Error('시트 데이터가 다른 세션에서 변경되었습니다. 먼저 시트에서 불러오기를 실행하세요.');
      }

      // 2) Just-before-write recheck to shrink TOCTOU window.
      const latestRows = await readAllRows();
      const latestRevision = _getProfileRevision(latestRows, currentUserEmail, profile.id);
      if (sheetRevision && latestRevision && sheetRevision !== latestRevision) {
        throw new Error('동시 저장 충돌이 감지되었습니다. 다시 불러온 후 저장하세요.');
      }

      const existingBySymbol = new Map();
      const duplicateRowIndices = [];
      myRows.forEach((entry) => {
        const sym = _getRowSymbol(entry.row);
        if (!sym) return;
        const existingEntry = existingBySymbol.get(sym);
        if (!existingEntry) {
          existingBySymbol.set(sym, entry);
          return;
        }
        if (_isRowFresher(entry.row, existingEntry.row)) {
          duplicateRowIndices.push(existingEntry.rowIndex);
          existingBySymbol.set(sym, entry);
          return;
        }
        duplicateRowIndices.push(entry.rowIndex);
      });

      const targetSymbols = new Set();
      const rowUpdates = [];
      const appendRows = [];

      let writtenCount = 0;
      profile.stocks.forEach((stock) => {
        const sym = _sanitizeSymbol(stock.symbol);
        if (!sym || targetSymbols.has(sym)) return;
        targetSymbols.add(sym);
        const isFirstWrittenRow = writtenCount === 0;
        writtenCount += 1;

        const existingEntry = existingBySymbol.get(sym);
        const existingRow = existingEntry ? _normalizePortfolioRow(existingEntry.row) : null;
        const dailyData = ProfileManager.loadDailyData(profile.id, sym);
        const hasLocalDailySnapshot = !!(dailyData && (
          Object.prototype.hasOwnProperty.call(dailyData, 'holdings') ||
          Object.prototype.hasOwnProperty.call(dailyData, 'totalInvested')
        ));

        const localHoldings = parseInt(dailyData?.holdings, 10);
        const localTotalInvested = parseFloat(dailyData?.totalInvested);
        const fallbackHoldings = existingRow ? (parseInt(existingRow[5], 10) || 0) : 0;
        const fallbackTotalInvested = existingRow ? (parseFloat(existingRow[6]) || 0) : 0;
        const holdings = Number.isFinite(localHoldings) ? localHoldings : fallbackHoldings;
        const totalInvested = Number.isFinite(localTotalInvested) ? localTotalInvested : fallbackTotalInvested;
        const rowDate = hasLocalDailySnapshot
          ? today
          : (existingRow ? (String(existingRow[10] || '').trim() || today) : today);

        const rowValues = [
          currentUserEmail,             // A: 구글ID
          profile.id,                   // B: 프로필ID
          profileName,                  // C: 프로필 이름
          sym,                          // D: 종목
          _computeAvgPrice(totalInvested, holdings), // E
          holdings,                     // F: 수량
          totalInvested,                // G: 총매입금
          stock.principal || 0,         // H: 세팅원금
          stock.sellPercent || (sym === 'SOXL' ? 12 : 10), // I: AFTER%
          stock.locSellPercent || 5,    // J: LOC%
          rowDate,                      // K: 날짜
          isFirstWrittenRow ? (balance || 0) : 0, // L: 예수금
          isFirstWrittenRow ? (effectiveCommissionRate || 0) : 0, // M: 수수료(%)
          stock.divisions || 40,        // N: 분할수
          revision                       // O: revision
        ];

        const existingRowIndex = existingEntry ? existingEntry.rowIndex : null;
        if (existingRowIndex) {
          rowUpdates.push({ rowIndex: existingRowIndex, values: rowValues });
        } else {
          appendRows.push(rowValues);
        }
      });

      if (targetSymbols.size === 0) {
        console.warn(
          `SheetsSync: Skip push for ${currentUserEmail}/${profile.id} (no valid symbols in local profile)`
        );
        return;
      }

      const staleRowIndices = [];
      myRows.forEach((entry) => {
        const sym = _getRowSymbol(entry.row);
        if (!sym) return;
        if (!targetSymbols.has(sym)) staleRowIndices.push(entry.rowIndex);
      });

      const rowsToClear = [...new Set([...staleRowIndices, ...duplicateRowIndices])];
      await batchClearPortfolioRows(rowsToClear, profile.id);
      await batchUpdatePortfolioRows(rowUpdates, profile.id);
      await appendPortfolioRows(appendRows, profile.id);

      localStorage.setItem(revisionKey, revision);
      console.log(
        `SheetsSync: Pushed ${targetSymbols.size} rows (updated=${rowUpdates.length}, appended=${appendRows.length}, cleared=${rowsToClear.length}) for ${currentUserEmail}/${profile.id}`
      );
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

    if (myStocks.length > 0 && typeof BalanceManager !== 'undefined') {
      const balanceSource = myStocks.find((stock) => Number.isFinite(stock.balance));
      if (balanceSource) {
        BalanceManager.updateBalance(profile.id, balanceSource.balance);
      }
      const commissionSource = myStocks.find((stock) => Number.isFinite(stock.commissionRate));
      if (commissionSource) {
        BalanceManager.updateCommissionRate(profile.id, commissionSource.commissionRate);
      }
    }

    // 각 종목의 일일 데이터 업데이트 (v3.2: AFTER% + LOC% + 예수금 포함)
    myStocks.forEach(stock => {
      // 1. Daily data 저장 (수량, 총매입금)
      // 🔴 #236 (DEC-175): avgPrice 저장 제거 - 파생값으로 전환
      ProfileManager.saveDailyData(profile.id, stock.symbol, {
        holdings: stock.holdings,
        totalInvested: stock.totalInvested,
        currentPrice: 0  // 현재가는 수동 입력
      });

      // 2. Stock settings 저장 (v3.2: sellPercent + locSellPercent 시트에서 가져온 값 적용)
      ProfileManager.addStock(profile.id, {
        symbol: stock.symbol,
        principal: stock.principal,
        divisions: stock.divisions || 40,
        sellPercent: stock.sellPercent,        // H: AFTER% (시트에서 가져온 값)
        locSellPercent: stock.locSellPercent   // I: LOC% (시트에서 가져온 값)
      });
    });

    if (myStocks.length > 0 && myStocks[0].profileName) {
      ProfileManager.update(profile.id, { name: myStocks[0].profileName });
    }

    // v3.8.0: sync revision checkpoint for optimistic conflict detection.
    const latestRevision = myStocks.reduce((latest, stock) => {
      const rev = String(stock.revision || '');
      return rev > latest ? rev : latest;
    }, '');
    if (latestRevision) {
      localStorage.setItem(_getRevisionStorageKey(profile.id), latestRevision);
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

  function setRevisionCheckpoint(profileId, revision) {
    if (!profileId || !revision) return;
    localStorage.setItem(_getRevisionStorageKey(profileId), String(revision));
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

    // Group by profile ID and keep latest row per symbol
    const profileMap = {};
    myRows.forEach(row => {
      if (!row || row.length < 3) return;
      const normalized = _normalizePortfolioRow(row);
      const profileId = normalized[1];
      const profileName = String(normalized[2] || '').trim() || (profileId.split('_')[0] || 'Profile');
      const sym = _sanitizeSymbol(normalized[3]);
      if (!sym) return;

      if (!profileMap[profileId]) {
        profileMap[profileId] = {
          profileId,
          profileName: profileName || 'Profile',
          rowsBySymbol: {}
        };
      }

      const existing = profileMap[profileId].rowsBySymbol[sym];
      if (!existing || _isRowFresher(normalized, existing)) {
        profileMap[profileId].rowsBySymbol[sym] = normalized;
      }
    });

    return Object.values(profileMap).map((profile) => {
      const rows = Object.values(profile.rowsBySymbol);

      let balance = 0;
      for (let i = 0; i < rows.length; i++) {
        const parsedBalance = parseFloat(rows[i][11]);
        if (Number.isFinite(parsedBalance)) {
          balance = parsedBalance;
          break;
        }
      }

      let commissionRate = 0;
      for (let i = 0; i < rows.length; i++) {
        const parsedCommission = parseFloat(rows[i][12]);
        if (Number.isFinite(parsedCommission)) {
          commissionRate = parsedCommission;
          break;
        }
      }

      const stocks = rows.reduce((acc, normalized) => {
        const sym = _sanitizeSymbol(normalized[3]);
        if (!sym) return acc;
        const holdings = parseInt(normalized[5], 10) || 0;
        const totalInvested = parseFloat(normalized[6]) || 0;
        acc.push({
          symbol: sym,
          avgPrice: _computeAvgPrice(totalInvested, holdings),
          holdings,
          totalInvested,
          principal: parseFloat(normalized[7]) || 0,
          divisions: parseInt(normalized[13], 10) || 40,
          sellPercent: parseFloat(normalized[8]) || (sym === 'SOXL' ? 12 : 10),
          locSellPercent: parseFloat(normalized[9]) || 5,
          revision: String(normalized[14] || '')
        });
        return acc;
      }, []);

      return {
        profileId: profile.profileId,
        profileName: profile.profileName,
        balance,
        commissionRate,
        stocks
      };
    });
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

    if (myStocks.length > 0 && typeof BalanceManager !== 'undefined') {
      const balanceSource = myStocks.find((stock) => Number.isFinite(stock.balance));
      if (balanceSource) {
        BalanceManager.updateBalance(profile.id, balanceSource.balance);
      }
      const commissionSource = myStocks.find((stock) => Number.isFinite(stock.commissionRate));
      if (commissionSource) {
        BalanceManager.updateCommissionRate(profile.id, commissionSource.commissionRate);
      }
    }

    // Update local profile with sheet data (v3.1: AFTER% + LOC% 포함)
    myStocks.forEach(stock => {
      // 1. Daily data 저장 (수량, 총매입금)
      // 🔴 #236 (DEC-175): avgPrice 저장 제거 - 파생값으로 전환
      ProfileManager.saveDailyData(profile.id, stock.symbol, {
        holdings: stock.holdings,
        totalInvested: stock.totalInvested,
        currentPrice: 0  // 현재가는 수동 입력
      });

      // 2. Stock settings 저장 (v3.1: sellPercent + locSellPercent 시트에서 가져온 값 적용)
      ProfileManager.addStock(profile.id, {
        symbol: stock.symbol,
        principal: stock.principal,
        divisions: stock.divisions || 40,
        sellPercent: stock.sellPercent,        // H: AFTER% (시트에서 가져온 값)
        locSellPercent: stock.locSellPercent   // I: LOC% (시트에서 가져온 값)
      });
    });

    if (myStocks.length > 0 && myStocks[0].profileName) {
      ProfileManager.update(profile.id, { name: myStocks[0].profileName });
    }

    const latestRevision = myStocks.reduce((latest, stock) => {
      const rev = String(stock.revision || '');
      return rev > latest ? rev : latest;
    }, '');
    if (latestRevision) {
      localStorage.setItem(_getRevisionStorageKey(profile.id), latestRevision);
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
    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      try {
        const result = await GasProxy.request('readPrices', null, {});
        if (!result.ok) throw new Error(result.error || 'readPrices failed');
        const rows = result.data.values || [];
        const prices = {};
        rows.forEach(row => {
          const ticker = (row[0] || '').toUpperCase().trim();
          if (!ticker) return;
          const current = parseFloat(row[1]) || 0;
          if (current > 0) {
            prices[ticker] = {
              current,
              close: parseFloat(row[2]) || 0,
              high: parseFloat(row[3]) || 0,
              low: parseFloat(row[4]) || 0,
              marketState: (row[5] || 'UNKNOWN').toUpperCase(),
              updatedAt: row[6] || '',
              timestamp: new Date().toISOString()
            };
          }
        });
        console.log(`SheetsSync: Fetched prices for ${Object.keys(prices).length} tickers (proxy)`);
        return prices;
      } catch (error) {
        console.error('SheetsSync: fetchCurrentPrices proxy error:', error);
        return {};
      }
    }

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

  // 🔴 v3.7.3: 가격 캐시 (1분 TTL) - Codex Review Round 2+3 반영
  // 티커별 타임스탬프 저장: { TQQQ: { price: 55, time: 1234567890 }, ... }
  let _priceCache = {};
  const PRICE_CACHE_TTL = 60 * 1000;  // 1분

  /**
   * 🔴 v3.7.3: JSONP fetch helper (CORS 우회용)
   * Apps Script ContentService는 setHeader()를 지원하지 않으므로 JSONP 방식 사용
   *
   * @param {string} url - WebApp URL with ?callback=fn parameter
   * @param {number} timeout - Timeout in ms (default 10000)
   * @returns {Promise<Object>} JSON data
   */
  function fetchJSONP(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const callbackName = 'jsonp_cb_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
      let script = null;  // 🔴 v3.7.4: 변수 선언 위치 수정 (hoisting 버그 방지)
      let resolved = false;  // 중복 resolve/reject 방지

      // Cleanup function
      function cleanup() {
        if (script && script.parentNode) {
          script.parentNode.removeChild(script);
        }
        delete window[callbackName];
      }

      // Timeout handler
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error('JSONP request timeout'));
        }
      }, timeout);

      // Global callback function
      window[callbackName] = function(data) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          cleanup();
          resolve(data);
        }
      };

      // Create script element
      script = document.createElement('script');
      script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + callbackName;
      script.onerror = function() {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          cleanup();
          reject(new Error('JSONP script load error'));
        }
      };

      document.body.appendChild(script);
    });
  }

  /**
   * Get current price for a specific ticker
   * 🔴 v3.7.0 (#221): Apps Script WebApp 호출 (Prices 시트 공개 API)
   * 🔴 v3.7.1: Codex Review R1 - 입력 검증, 캐시, Accept 헤더 제거
   * 🔴 v3.7.2: Codex Review R2 - 티커별 캐시 TTL 분리
   * 🔴 v3.7.3: Codex Review R3 - JSONP 클라이언트 구현 (CORS 완전 우회)
   *
   * Priority:
   * 1. In-memory cache (1분 TTL)
   * 2. WebApp API via JSONP (public, no auth, CORS-free)
   * 3. Cached fetchCurrentPrices result (if logged in)
   * 4. Return 0
   *
   * @param {string} ticker - Stock symbol (e.g., 'TQQQ')
   * @returns {Promise<number>} Current price or 0 if not found
   */
  async function getCurrentPrice(ticker) {
    // 🔴 Codex Review R1: ticker 인자 검증
    if (!ticker || typeof ticker !== 'string') {
      console.warn('SheetsSync.getCurrentPrice: Invalid ticker:', ticker);
      return 0;
    }

    const sym = ticker.toUpperCase().trim();
    if (!sym) return 0;

    // 🔴 Codex Review R2: 티커별 캐시 확인 (1분 TTL)
    const now = Date.now();
    const cached = _priceCache[sym];
    if (cached && (now - cached.time) < PRICE_CACHE_TTL) {
      console.log(`SheetsSync: ${sym} price from cache: $${cached.price}`);
      return cached.price;
    }

    // 🔴 v3.7.3: 1차 - JSONP로 WebApp 호출 (CORS 완전 우회)
    try {
      const data = await fetchJSONP(`${CONFIG.WEBAPP_URL}?ticker=${encodeURIComponent(sym)}`);
      const price = data.current || data.price || 0;
      const source = data.priceSource || 'REGULAR';
      if (price > 0) {
        // 🔴 Codex Review R2: 티커별 캐시 저장
        _priceCache[sym] = { price: price, source: source, time: now };
        console.log(`SheetsSync: ${sym} price from WebApp (JSONP): $${price}`);
        return price;
      }
    } catch (error) {
      console.warn('SheetsSync: WebApp JSONP error:', error.message);
    }

    // 🔴 2차: fetchCurrentPrices fallback (로그인 시)
    if (isAuthenticated()) {
      try {
        const prices = await fetchCurrentPrices();
        if (prices[sym] && prices[sym].current > 0) {
          const source = prices[sym].priceSource || 'REGULAR';
          // 티커별 캐시 저장
          _priceCache[sym] = { price: prices[sym].current, source: source, time: now };
          console.log(`SheetsSync: ${sym} price from Sheets fallback: $${prices[sym].current}`);
          return prices[sym].current;
        }
      } catch (error) {
        console.warn('SheetsSync: Sheets fallback error:', error.message);
      }
    }

    return 0;
  }

  /**
   * Get current price with source indicator
   * @param {string} ticker - Stock symbol
   * @returns {Promise<{price: number, source: string}|null>}
   */
  async function getCurrentPriceWithSource(ticker) {
    if (!ticker || typeof ticker !== 'string') {
      console.warn('SheetsSync.getCurrentPriceWithSource: Invalid ticker:', ticker);
      return null;
    }

    const sym = ticker.toUpperCase().trim();
    if (!sym) return null;

    const now = Date.now();
    const cached = _priceCache[sym];
    if (cached && (now - cached.time) < PRICE_CACHE_TTL) {
      console.log(`SheetsSync: ${sym} from cache: $${cached.price} (${cached.source || 'REGULAR'})`);
      return { price: cached.price, source: cached.source || 'REGULAR' };
    }

    try {
      const data = await fetchJSONP(`${CONFIG.WEBAPP_URL}?ticker=${encodeURIComponent(sym)}`);
      const price = data.current || data.price || 0;
      const source = data.priceSource || 'REGULAR';
      if (price > 0) {
        _priceCache[sym] = { price, source, time: now };
        return { price, source };
      }
    } catch (error) {
      console.warn('SheetsSync: WebApp JSONP error:', error.message);
    }

    if (isAuthenticated()) {
      try {
        const prices = await fetchCurrentPrices();
        if (prices[sym] && prices[sym].current > 0) {
          const source = prices[sym].priceSource || 'REGULAR';
          _priceCache[sym] = { price: prices[sym].current, source, time: now };
          return { price: prices[sym].current, source };
        }
      } catch (error) {
        console.warn('SheetsSync: Sheets fallback error:', error.message);
      }
    }

    return null;
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

  // =====================================================
  // CASH RESERVE MANAGEMENT (#222: P4 SGOV/BIL/BILS)
  // =====================================================

  function getCashReserveSheetName() {
    return CASH_RESERVE_CONFIG.SHEET_NAME;
  }

  async function createCashReserveSheet() {
    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      const result = await GasProxy.request('ensureSheet', null, {
        sheetName: getCashReserveSheetName(),
        headers: ['googleId', 'profileId', 'symbol', 'holdings', 'avgCost', 'updatedAt']
      });
      if (!result.ok) throw new Error(result.error || 'ensureSheet(CashReserve) failed');
      return;
    }

    const sheetId = getSpreadsheetId();

    try {
      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: getCashReserveSheetName(),
                index: 3
              }
            }
          }]
        }
      });
    } catch (e) {
      console.log('CashReserve sheet creation skipped (may already exist)');
    }

    const headers = [[
      'googleId', 'profileId', 'symbol', 'holdings', 'avgCost', 'updatedAt'
    ]];

    await withRetry(() =>
      gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${getCashReserveSheetName()}!A1:F1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: headers }
      })
    );
  }

  async function readCashReserveRows() {
    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      const result = await GasProxy.request('readCashReserve', null, {});
      if (!result.ok) throw new Error(result.error || 'readCashReserve failed');
      return result.data.values || [];
    }

    const sheetId = getSpreadsheetId();
    if (!sheetId) {
      throw new Error('Spreadsheet ID not set');
    }

    try {
      const response = await withRetry(() =>
        gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `${getCashReserveSheetName()}!${CASH_RESERVE_CONFIG.RANGE}`,
        })
      );
      return response?.result?.values || [];
    } catch (error) {
      if (error?.result?.error?.message?.includes('Unable to parse range')) {
        await createCashReserveSheet();
        return [];
      }
      throw error;
    }
  }

  function parseCashReserveRows(rows) {
    const reserves = [];
    rows.forEach(row => {
      if (!row || row.length < 3) return;
      const googleId = String(row[0] || '').trim();
      const profileId = String(row[1] || '').trim();
      const symbol = String(row[2] || '').trim().toUpperCase();
      if (!symbol) return;
      reserves.push({
        googleId,
        profileId,
        symbol,
        holdings: parseFloat(row[3]) || 0,
        avgCost: parseFloat(row[4]) || 0,
        updatedAt: row[5] || ''
      });
    });
    return reserves;
  }

  async function writeCashReserveRows(rows) {
    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      const result = await GasProxy.request('writeCashReserve', null, { rows: rows || [] });
      if (!result.ok) throw new Error(result.error || 'writeCashReserve failed');
      return;
    }

    const sheetId = getSpreadsheetId();
    if (!sheetId) {
      throw new Error('Spreadsheet ID not set');
    }

    await withRetry(() =>
      gapi.client.sheets.spreadsheets.values.clear({
        spreadsheetId: sheetId,
        range: `${getCashReserveSheetName()}!${CASH_RESERVE_CONFIG.RANGE}`,
      })
    );

    if (!rows || rows.length === 0) return;

    await withRetry(() =>
      gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${getCashReserveSheetName()}!A2`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: rows }
      })
    );
  }

  async function loadCashReserve(profileId) {
    if (!currentUserEmail) {
      throw new Error('로그인이 필요합니다');
    }
    if (!profileId) {
      throw new Error('프로필이 없습니다');
    }

    const allRows = await readCashReserveRows();
    const reserves = parseCashReserveRows(allRows);
    return reserves.filter(row => row.googleId === currentUserEmail && row.profileId === profileId);
  }

  async function saveCashReserve(entries) {
    if (!currentUserEmail) {
      throw new Error('로그인이 필요합니다');
    }

    const profile = ProfileManager.getActive();
    if (!profile) {
      throw new Error('프로필이 없습니다');
    }

    const allRows = await readCashReserveRows();
    const otherRows = allRows.filter(row =>
      !(row[0] === currentUserEmail && row[1] === profile.id)
    );

    const now = new Date().toISOString();
    const normalized = (entries || [])
      .map(entry => ({
        symbol: String(entry.symbol || '').trim().toUpperCase(),
        holdings: parseFloat(entry.holdings) || 0,
        avgCost: parseFloat(entry.avgCost) || 0
      }))
      .filter(entry => entry.symbol && (entry.holdings > 0 || entry.avgCost > 0));

    const newRows = normalized.map(entry => ([
      currentUserEmail,
      profile.id,
      entry.symbol,
      entry.holdings,
      entry.avgCost,
      now
    ]));

    await writeCashReserveRows(otherRows.concat(newRows));
    return newRows.length;
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
    if (!currentUserEmail && !(CONFIG.USE_PROXY && GasProxy.isAuthenticated())) {
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

    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      const result = await GasProxy.request('saveOrders', null, { rows: orderRows });
      if (!result.ok) throw new Error(result.error || 'saveOrders failed');
      console.log(`SheetsSync.saveOrders: Saved ${orderRows.length} orders for ${ticker} (proxy)`);
      return orderRows.length;
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
    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      const result = await GasProxy.request('ensureSheet', null, {
        sheetName: 'Orders',
        headers: ['날짜', '구글ID', '프로필ID', '종목', '주문타입', '매수매도', '가격', '수량', '총액', '체결기준', '체결', '체결일', '실제가격']
      });
      if (!result.ok) throw new Error(result.error || 'ensureSheet(Orders) failed');
      return;
    }

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
    if (!currentUserEmail && !(CONFIG.USE_PROXY && GasProxy.isAuthenticated())) {
      throw new Error('로그인이 필요합니다');
    }

    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      try {
        const result = await GasProxy.request('readOrders', null, {});
        if (!result.ok) throw new Error(result.error || 'readOrders failed');
        const rows = result.data.values || [];
        const rowIndices = result.data.rowIndices || [];
        return rows.reduce((pending, row, index) => {
          const isPending = !row[10] || row[10] === '';
          if (!isPending) return pending;
          const absoluteRowIndexRaw = parseInt(rowIndices[index], 10);
          const absoluteRowIndex = Number.isFinite(absoluteRowIndexRaw) ? absoluteRowIndexRaw : (index + 2);
          pending.push({
            rowIndex: absoluteRowIndex,
            date: row[0],
            googleId: row[1],
            profileId: row[2],
            ticker: row[3],
            orderType: row[4],
            side: row[5],
            price: parseFloat(row[6]) || 0,
            quantity: parseInt(row[7]) || 0,
            total: parseFloat(row[8]) || 0,
            executionBasis: row[9],
            execution: row[10],
            executionDate: row[11],
            actualPrice: row[12]
          });
          return pending;
        }, []);
      } catch (error) {
        console.error('SheetsSync.readPendingOrders proxy error:', error);
        return [];
      }
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

      // Keep original sheet index when filtering so rowIndex always points to real sheet row.
      return rows.reduce((pending, row, index) => {
        const isMyOrder = row[1] === currentUserEmail;       // B: 구글ID
        const isPending = !row[10] || row[10] === '';        // K: 체결 (빈값 = 미체결)
        if (!isMyOrder || !isPending) return pending;

        pending.push({
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
        });
        return pending;
      }, []);
    } catch (error) {
      console.error('SheetsSync.readPendingOrders error:', error);
      return [];
    }
  }

  /**
   * Get yesterday's total BUY quantity for a ticker (per profile)
   * @param {string} profileId - Profile ID
   * @param {string} ticker - Stock symbol
   * @returns {Promise<number>} Total BUY quantity for yesterday
   */
  async function getYesterdayBuyQuantity(profileId, ticker) {
    if (!currentUserEmail && !(CONFIG.USE_PROXY && GasProxy.isAuthenticated())) {
      throw new Error('로그인이 필요합니다');
    }
    if (!profileId || !ticker) {
      return 0;
    }

    const now = new Date();
    now.setDate(now.getDate() - 1);
    const yesterday = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const sym = String(ticker || '').toUpperCase().trim();
    if (!sym) return 0;

    // 🔴 v4.0.0: Proxy mode
    if (CONFIG.USE_PROXY) {
      try {
        const result = await GasProxy.request('readOrders', null, {});
        if (!result.ok) throw new Error(result.error || 'readOrders failed');
        const rows = result.data.values || [];
        let total = 0;
        rows.forEach(row => {
          if (
            row[0] === yesterday &&
            row[2] === profileId &&
            row[3] === sym &&
            row[5] === 'BUY'
          ) {
            total += parseInt(row[7]) || 0;
          }
        });
        return total;
      } catch (error) {
        console.error('SheetsSync.getYesterdayBuyQuantity proxy error:', error);
        return 0;
      }
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
      let total = 0;

      rows.forEach(row => {
        if (
          row[0] === yesterday &&     // A: 날짜
          row[1] === currentUserEmail && // B: 구글ID
          row[2] === profileId &&        // C: 프로필ID
          row[3] === sym &&              // D: 종목
          row[5] === 'BUY'               // F: 매수매도
        ) {
          total += parseInt(row[7]) || 0; // H: 수량
        }
      });

      return total;
    } catch (error) {
      if (error.result?.error?.message?.includes('Unable to parse range')) {
        return 0;
      }
      console.error('SheetsSync.getYesterdayBuyQuantity error:', error);
      return 0;
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

    // Google OAuth Authentication
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
    setRevisionCheckpoint,

    // Orders (DEC-153: Order Execution Tracking)
    saveOrders,
    readPendingOrders,
    getYesterdayBuyQuantity,

    // CashReserve (#222-P4)
    loadCashReserve,
    saveCashReserve,

    // Prices (#211: 현재가 연동)
    fetchCurrentPrices,
    getCurrentPrice,
    getCurrentPriceWithSource,

    // Config (for debugging)
    CONFIG
  };

})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SheetsSync;
}
