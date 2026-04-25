/**
 * Macro Monitor - DataFetcher
 * Widget에서 직접 API 호출 가능하게 하는 공통 모듈
 * Detail 방문 없이도 최신 데이터 반영
 *
 * @version 1.0.0
 * @see docs/planning/data-fetcher-plan.md
 * @see docs/DECISION_LOG.md → DEC-032
 */

import { DataManager } from './data-manager.js';
import {
  calculateLoanGrowth,
  calculateWeeklyNetLiquidityDelta,
  calculateYoY,
  computeBankingHealthSnapshot,
  computeLiquidityFlowSnapshot,
  computeLiquidityStressSnapshot,
  getDelinquencyStatus,
  getLoanDepositStatus,
  getLoanGrowthStatus,
  getTier1Status,
  getWorstStatus,
  getWeekKeyFromDate,
  getWeekKeyFromYMD,
  pickCompleteWeeks,
  toFiniteNumber,
  toLocalYMD
} from './signals-core.mjs';

class MacroDataFetcher {
  constructor() {
    this.fredFileCache = new Map();

    // TTL 설정 (DEC-032: 24시간/7일로 조정)
    this.ttl = 24 * 60 * 60 * 1000;        // 24시간 (fresh)
    this.staleTtl = 7 * 24 * 60 * 60 * 1000; // 7일 (stale)

    // 타임아웃
    this.timeout = 10000; // 10초

    // 외부 API URLs
    this.urls = {
      fdicApi: 'https://api.fdic.gov/banks/financials'
    };
  }

  // =========================================
  // 메인 API: Widget에서 호출
  // =========================================

  /**
   * Widget 데이터 가져오기 (캐시 우선 + API 폴백)
   * @param {string} widgetId - 위젯 ID (banking-health, liquidity-flow, liquidity-stress, sentiment-signal)
   * @param {boolean} forceRefresh - 강제 새로고침
   * @returns {Promise<object>} - { data, isStale, isFresh, ageMs }
   */
  async fetch(widgetId, forceRefresh = false) {
    // 1. 캐시 확인 (강제 새로고침 아닐 때)
    if (!forceRefresh) {
      const cached = DataManager.getWidgetDataWithStale(widgetId);
      if (cached.data && cached.isFresh) {
        console.log(`[DataFetcher] ${widgetId}: 캐시 사용 (fresh)`);
        return { ...cached, failed: false };
      }
      // Stale이면 API 시도 후 실패 시 캐시는 유지하되 failure를 surface 한다.
      if (cached.data && cached.isStale) {
        console.log(`[DataFetcher] ${widgetId}: stale 캐시 (${this.formatAge(cached.ageMs)}) → API 시도`);
        try {
          const data = await this.fetchByWidgetId(widgetId);
          if (data) {
            DataManager.saveWidgetData(widgetId, data);
            console.log(`[DataFetcher] ${widgetId}: API 갱신 성공`);
            return { data, isStale: false, isFresh: true, ageMs: 0, failed: false };
          }
        } catch (e) {
          console.log(`[DataFetcher] ${widgetId}: API 실패, stale 캐시는 유지하지만 failed=true로 반환`);
        }
        return { ...cached, failed: true };
      }
    }

    // 2. API 호출
    console.log(`[DataFetcher] ${widgetId}: API 호출 시작...`);
    try {
      const data = await this.fetchByWidgetId(widgetId);

      if (data) {
        // 3. 캐시 저장
        DataManager.saveWidgetData(widgetId, data);
        console.log(`[DataFetcher] ${widgetId}: API 호출 성공, 캐시 저장`);
        return { data, isStale: false, isFresh: true, ageMs: 0, failed: false };
      }
    } catch (e) {
      console.error(`[DataFetcher] ${widgetId}: API 호출 실패`, e);
    }

    // 4. API 실패 시 stale 캐시라도 반환하되 failure는 숨기지 않는다.
    const fallback = DataManager.getWidgetDataWithStale(widgetId);
    if (fallback.data) {
      console.log(`[DataFetcher] ${widgetId}: API 실패, stale 캐시 반환 + failed=true`);
      return { ...fallback, failed: true };
    }

    return { data: null, isStale: true, isFresh: false, ageMs: 0, failed: true };
  }

  // =========================================
  // 위젯별 Fetch 로직
  // =========================================

  /**
   * 위젯 ID별 분기
   * @param {string} widgetId
   * @returns {Promise<object|null>}
   */
  async fetchByWidgetId(widgetId) {
    switch (widgetId) {
      case 'banking-health':
        return await this.fetchBankingHealth();
      case 'liquidity-flow':
        return await this.fetchLiquidityFlow();
      case 'liquidity-stress':
        return await this.fetchLiquidityStress();
      case 'sentiment':
      case 'sentiment-signal':
        return await this.fetchSentiment();
      default:
        console.warn(`[DataFetcher] Unknown widget: ${widgetId}`);
        return null;
    }
  }

  /**
   * Banking Health 데이터 fetch
   * FRED: DGS10, DRALACBN, TOTLL, DPSACBW027SBOG, BOGZ1FL010000016Q, BAMLH0A0HYM2
   * FDIC: Tier1 (JSON 캐시 또는 API)
   *
   * ★ Detail 페이지와 동일한 형식으로 반환 (DEC-032 수정)
   */
  async fetchBankingHealth() {
    const days = 365 * 2; // 2년 데이터

    try {
      // 병렬 호출
      const [
        delinquency,
        loans,
        deposits,
        fedTier1,
        yield10y,
        hySpread,
        fdicTier1
      ] = await Promise.all([
        this.fetchFRED('DRALACBN', days),      // 연체율
        this.fetchFRED('TOTLL', days),          // 총 대출
        this.fetchFRED('DPSACBW027SBOG', days), // 총 예금
        this.fetchFRED('BOGZ1FL010000016Q', days), // FED Tier1
        this.fetchFRED('DGS10', days),          // 10Y 금리
        this.fetchFRED('BAMLH0A0HYM2', days),   // HY 스프레드
        this.fetchFDICTier1()                   // FDIC Tier1
      ]);

      if (!fdicTier1?.length && !fedTier1?.length) {
        return null;
      }

      const statusLabels = { normal: '정상', caution: '주의', warning: '경계', danger: '위험' };
      const snapshot = computeBankingHealthSnapshot({ delinquency, loans, deposits, fedTier1, fdicTier1 });

      // ★ Detail과 동일한 형식으로 반환
      return {
        ...snapshot,
        delinquency: { ...snapshot.delinquency, label: statusLabels[snapshot.delinquency.status] },
        tier1: { ...snapshot.tier1, label: statusLabels[snapshot.tier1.status] },
        loanDeposit: { ...snapshot.loanDeposit, label: statusLabels[snapshot.loanDeposit.status] },
        loanGrowth: { ...snapshot.loanGrowth, label: statusLabels[snapshot.loanGrowth.status] },
        updated: new Date().toISOString()
      };
    } catch (e) {
      console.error('[DataFetcher] Banking Health fetch error:', e);
      return null;
    }
  }

  /**
   * 여신증가율 계산 (YoY)
   */
  calculateLoanGrowth(loans) {
    return calculateLoanGrowth(loans);
  }

  /**
   * 연체율 상태 판정
   */
  getDelinquencyStatus(val) {
    return getDelinquencyStatus(val);
  }

  /**
   * Tier1 자본비율 상태 판정
   */
  getTier1Status(val) {
    return getTier1Status(val);
  }

  /**
   * 예대율 상태 판정
   */
  getLoanDepositStatus(val) {
    return getLoanDepositStatus(val);
  }

  /**
   * 여신증가율 상태 판정
   */
  getLoanGrowthStatus(val) {
    return getLoanGrowthStatus(val);
  }

  /**
   * Liquidity Flow 데이터 fetch
   * FRED: M2SL, WALCL, RRPONTSYD
   * Treasury: TGA (일간) - DEC-048
   * DefiLlama: Stablecoin 시총
   *
   * ★ Detail 페이지와 동일한 형식으로 반환 (DEC-032 수정)
   * 단위: 모두 Billions로 변환
   */
  async fetchLiquidityFlow() {
    const days = 365 * 2;

    try {
      const [
        m2,
        fedBs,
        tga,
        rrp,
        stablecoin
      ] = await Promise.all([
        this.fetchFRED('M2SL', days),
        this.fetchFRED('WALCL', days),
        this.fetchTreasuryTGA(days),       // TGA: 일간 (DEC-048)
        this.fetchFRED('RRPONTSYD', days),
        this.fetchStablecoinData()
      ]);

      if (!m2?.length && !fedBs?.length && !tga?.length) {
        return null;
      }

      if (!Array.isArray(rrp) || rrp.length === 0) {
        console.warn('[DataFetcher] RRP series empty, fallback value 0 applied');
      }

      const snapshot = computeLiquidityFlowSnapshot({ m2, fedBs, tga, rrp, stablecoin });

      // ★ Detail과 동일한 형식으로 반환
      return {
        ...snapshot,
        // Signal Matrix 3개 지표
        m2YoY: snapshot.m2YoY,
        m2Total: snapshot.m2Total,  // Billions
        netLiquidity: snapshot.netLiquidity,  // Billions
        // netLiquidityDelta: 초기 로딩 시에도 의미있는 값 제공 (일간 변화량 근사치)
        // 단, 위젯은 weeklyNetFlow를 우선 사용하도록 설계됨
        netLiquidityDelta: snapshot.weeklyNetFlow,
        weeklyNetFlow: snapshot.weeklyNetFlow, // ★ 명시적 필드 추가
        stablecoinMcap: snapshot.stablecoinMcap,  // Billions
        scM2Ratio: snapshot.scM2Ratio,
        // Components (Chart용)
        walcl: snapshot.walcl,
        tga: snapshot.tga,
        rrp: snapshot.rrp,
        walclDelta: 0,  
        tgaDelta: 0,
        rrpDelta: 0,
        // 기존 호환용
        netFlow: snapshot.weeklyNetFlow,
        updated: new Date().toISOString()
      };
    } catch (e) {
      console.error('[DataFetcher] Liquidity Flow fetch error:', e);
      return null;
    }
  }

  // =========================================
  // 완결 주 (Complete Week) 계산 헬퍼
  // =========================================

  /**
   * 로컬 YYYY-MM-DD 포맷 (금지패턴 toISOString().split('T') 대체)
   * @param {Date} dt
   * @returns {string} "YYYY-MM-DD"
   */
  toLocalYMD(dt) {
    return toLocalYMD(dt);
  }

  /**
   * Date 객체 → weekKey (월요일 시작)
   * Detail 페이지와 동일한 로직
   */
  getWeekKeyFromDate(dt) {
    return getWeekKeyFromDate(dt);
  }

  /**
   * YYYY-MM-DD 문자열 → weekKey
   */
  getWeekKeyFromYMD(ymd) {
    return getWeekKeyFromYMD(ymd);
  }

  /**
   * 시계열 데이터 → 주간 버킷팅 → 완결 주 2개 선택
   * @param {Array} series - [{ date, val }, ...]
   * @returns {Object} - { lastComplete, prevComplete } 또는 null
   */
  pickCompleteWeeks(series) {
    const result = pickCompleteWeeks(series);
    if (result) {
      console.log(`[DataFetcher] pickCompleteWeeks: last=${result.lastComplete.weekKey} prev=${result.prevComplete.weekKey}`);
    }
    return result;
  }

  /**
   * Net Liquidity Weekly Delta 계산 (완결 주 기준)
   * WALCL: 주간, TGA: 일간 (DEC-048), RRP: 일간
   *
   * ★ 개선: weekKey 버킷팅 → 완결 주 2개 → Δ 계산
   */
  calculateWeeklyDelta(fedBs, tga, rrp) {
    return calculateWeeklyNetLiquidityDelta(fedBs, tga, rrp);
  }

  /**
   * Fallback: 인덱스 기반 계산 (이전 로직 유지)
   */
  calculateWeeklyDeltaFallback(fedBs, tga, rrp) {
    const hasRrp = Array.isArray(rrp) && rrp.length > 0;

    const latestWalcl = (fedBs[fedBs.length - 1]?.val || 0) / 1000;
    const latestTga = (tga[tga.length - 1]?.val || 0) / 1000;
    const latestRrp = hasRrp ? (rrp[rrp.length - 1]?.val || 0) : 0;

    const prevWalcl = (fedBs[fedBs.length - 2]?.val || 0) / 1000;
    let prevTga = latestTga;
    if (tga.length > 5) prevTga = (tga[tga.length - 6]?.val || 0) / 1000;
    let prevRrp = latestRrp;
    if (hasRrp && rrp.length > 5) prevRrp = rrp[rrp.length - 6]?.val || 0;

    const latestNet = latestWalcl - latestTga - latestRrp;
    const prevNet = prevWalcl - prevTga - prevRrp;

    return parseFloat((latestNet - prevNet).toFixed(1));
  }

  /**
   * Liquidity Stress 데이터 fetch
   * FRED: SOFR, IORB, WRESBAL, GDP
   *
   * ★ Detail 페이지와 동일한 형식으로 반환 (DEC-032 수정)
   */
  async fetchLiquidityStress() {
    const days = 365;

    try {
      const [
        sofr,
        iorb,
        reserves,
        gdp
      ] = await Promise.all([
        this.fetchFRED('SOFR', days),
        this.fetchFRED('IORB', days),
        this.fetchFRED('WRESBAL', days),
        this.fetchFRED('GDP', 1095) // 3년 (분기 데이터)
      ]);

      if (!sofr?.length && !iorb?.length && !reserves?.length) {
        return null;
      }

      const statusLabels = { normal: '정상', caution: '주의', warning: '경계', danger: '위험' };
      const snapshot = computeLiquidityStressSnapshot({ sofr, iorb, reserves, gdp });

      // ★ Detail과 동일한 형식으로 반환
      return {
        ...snapshot,
        overallStatus: snapshot.overallStatus,
        overallLabel: snapshot.overallLabel || 'Normal',
        tier1: {
          status: snapshot.tier1.status,
          label: statusLabels[snapshot.tier1.status],
          value: snapshot.tier1.value,  // bp 단위, 정수
          unit: 'bp'
        },
        tier2: {
          status: snapshot.tier2.status,
          label: statusLabels[snapshot.tier2.status],
          value: snapshot.tier2.value,  // % 단위
          unit: '%'
        },
        updated: new Date().toISOString()
      };
    } catch (e) {
      console.error('[DataFetcher] Liquidity Stress fetch error:', e);
      return null;
    }
  }

  /**
   * Sentiment 데이터 fetch (Phase 4-C)
   * JSON 파일 로드: vix, move, cftc-sp500, cnn-fear-greed, crypto-fear-greed, aaii
   * @returns {Promise<object|null>}
   */
  async fetchSentiment() {
    try {
      const basePath = this.getBasePath();
      const baseUrl = window.location.origin + basePath + '/data/sentiment/';

      // 병렬 로드 (필수 5개 + 선택 3개)
      const [vix, move, cftc, cnn, crypto, aaii, cnnComponents, putcall] = await Promise.all([
        this.fetchJsonFile(baseUrl + 'vix.json'),
        this.fetchJsonFile(baseUrl + 'move.json'),
        this.fetchJsonFile(baseUrl + 'cftc-sp500.json'),
        this.fetchJsonFile(baseUrl + 'cnn-fear-greed.json'),
        this.fetchJsonFile(baseUrl + 'crypto-fear-greed.json'),
        this.fetchJsonFile(baseUrl + 'aaii.json'),
        this.fetchJsonFile(baseUrl + 'cnn-components.json'),
        this.fetchJsonFile(baseUrl + 'cnn-put-call.json')
      ]);

      if (!vix && !move && !cftc) {
        return null;
      }

      // 최신값 추출
      const getLatest = (arr, field = 'value') => {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const latest = arr[arr.length - 1];
        return latest[field] ?? latest.val ?? latest.close ?? null;
      };

      // VIX: { date, value } 형태
      const latestVix = getLatest(vix, 'value');
      // MOVE: { date, value } 형태
      const latestMove = getLatest(move, 'value');
      // CFTC: { date, net } 형태
      const latestCftc = getLatest(cftc, 'net');
      // CNN F&G: { date, score } 형태 (주의: value가 아닌 score!)
      const latestCnn = getLatest(cnn, 'score');
      // Crypto F&G: { date, value } 형태
      const latestCrypto = getLatest(crypto, 'value');
      // Put/Call: { date, value } 형태
      const latestPutCall = getLatest(putcall, 'value');
      // AAII: { date, bullish, bearish, neutral } 형태 - 사용 예정
      const latestAaii = aaii?.[aaii.length - 1] || null;
      const aaiiBearish = latestAaii?.bearish ?? null;
      const aaiiSpread = (() => {
        if (!latestAaii || typeof latestAaii !== 'object') return null;
        if (Number.isFinite(latestAaii.spread)) return latestAaii.spread;
        if (Number.isFinite(latestAaii.bullish) && Number.isFinite(latestAaii.bearish)) {
          return latestAaii.bullish - latestAaii.bearish;
        }
        return null;
      })();

      console.log(`[DataFetcher] Sentiment 로드: VIX=${latestVix}, MOVE=${latestMove}, CFTC=${latestCftc}, CNN=${latestCnn}, Crypto=${latestCrypto}, PutCall=${latestPutCall}`);

      return {
        // Widget contract (parent -> child)
        vix: latestVix,
        move: latestMove,
        cnn_fg: latestCnn,
        aaii_bearish: aaiiBearish,
        aaii_spread: aaiiSpread,
        cftc_net: latestCftc,
        crypto_fg: latestCrypto,
        putcall_ratio: latestPutCall,
        // Compatibility aliases (temporary)
        cftc: latestCftc,
        cnn: latestCnn,
        crypto: latestCrypto,
        aaii: latestAaii,
        // 추가 지표
        cnnComponents: cnnComponents,
        // 히스토리 데이터 (차트용)
        history: {
          vix: vix || [],
          move: move || [],
          cftc: cftc || [],
          cnn: cnn || [],
          crypto: crypto || [],
          putcall: putcall || []
        },
        // 메타데이터
        updated: new Date().toISOString()
      };
    } catch (e) {
      console.error('[DataFetcher] Sentiment fetch error:', e);
      return null;
    }
  }

  /**
   * JSON 파일 로드 헬퍼
   * @param {string} url - JSON 파일 URL
   * @returns {Promise<array|object|null>}
   */
  async fetchJsonFile(url) {
    try {
      const res = await this.fetchWithTimeout(url);
      return res;
    } catch (e) {
      console.warn(`[DataFetcher] JSON load failed: ${url}`, e.message);
      return null;
    }
  }

  // =========================================
  // FRED API
  // =========================================

  /**
   * FRED 시리즈 데이터 fetch
   * @param {string} seriesId - FRED series ID
   * @param {number} days - 조회 일수
   * @returns {Promise<Array>} - [{ date, val }, ...]
   */
  async fetchFRED(seriesId, days = 365) {
    const fileMap = {
      DGS10: 'fred-banking-daily',
      BAMLH0A0HYM2: 'fred-banking-daily',
      TOTLL: 'fred-banking-weekly',
      DPSACBW027SBOG: 'fred-banking-weekly',
      DRALACBN: 'fred-banking-quarterly',
      DRCCLACBS: 'fred-banking-quarterly',
      DRCLACBS: 'fred-banking-quarterly',
      DRBLACBS: 'fred-banking-quarterly',
      DRCRELEXFACBS: 'fred-banking-quarterly',
      BOGZ1FL010000016Q: 'fred-banking-quarterly',
      CORALACBN: 'fred-banking-quarterly',
      CORCCACBS: 'fred-banking-quarterly',
      CORCACBS: 'fred-banking-quarterly',
      CORBLACBS: 'fred-banking-quarterly',
      CORCREXFACBS: 'fred-banking-quarterly',
      M2SL: 'fred-macro',
      WALCL: 'fred-macro',
      RRPONTSYD: 'fred-macro',
      SOFR: 'fred-macro',
      IORB: 'fred-macro',
      WRESBAL: 'fred-macro',
      GDP: 'fred-macro'
    };

    const file = fileMap[seriesId];
    if (!file) {
      console.error(`[DataFetcher] FRED series unmapped: ${seriesId}`);
      return [];
    }

    try {
      let payloadPromise = this.fredFileCache.get(file);
      if (!payloadPromise) {
        const basePath = this.getBasePath();
        const jsonUrl = window.location.origin + basePath + `/data/macro/${file}.json`;
        payloadPromise = this.fetchWithTimeout(jsonUrl);
        this.fredFileCache.set(file, payloadPromise);
      }

      const payload = await payloadPromise;
      const rows = Array.isArray(payload?.series?.[seriesId])
        ? payload.series[seriesId]
            .map((row) => ({ date: row?.date, val: Number(row?.value) }))
            .filter((row) => row.date && Number.isFinite(row.val))
        : [];

      if (!days) return rows;

      const startDate = new Date();
      startDate.setHours(12, 0, 0, 0);
      startDate.setDate(startDate.getDate() - days);
      const start = this.toLocalYMD(startDate);
      return rows.filter((row) => row.date >= start);
    } catch (e) {
      this.fredFileCache.delete(file);
      console.error(`[DataFetcher] FRED ${seriesId} JSON error:`, e);
      return [];
    }
  }

  // =========================================
  // Treasury FiscalData API (DEC-048)
  // =========================================

  /**
   * TGA 일간 데이터 fetch (Treasury API 우선, FRED 폴백)
   * 2005-2021: Federal Reserve Account / 2021-10-01~현재: Treasury General Account (TGA)
   * 필드: open_today_bal (close_today_bal은 null)
   * @param {number} days - 조회 일수
   * @returns {Promise<Array>} - [{ date, val }, ...] (Millions 단위)
   *
   * account_type 변경 이력 (DEC-048, DEC-049 수정):
   *   2005 ~ 2021-09-30: Federal Reserve Account
   *   2021-10-01 ~ 2022-04-15: Treasury General Account (TGA)
   *   2022-04-18 ~ 현재: Treasury General Account (TGA) Opening Balance
   */
  async fetchTreasuryTGA(days = 365) {
    // ★ same-origin JSON only: cron-generated cache under data/macro/tga.json
    try {
      const basePath = this.getBasePath();
      const jsonUrl = window.location.origin + basePath + '/data/macro/tga.json';
      const res = await this.fetchWithTimeout(jsonUrl);
      const rows = Array.isArray(res?.series) ? res.series : [];

      if (rows.length === 0) {
        console.warn('[DataFetcher] TGA JSON empty');
        return [];
      }

      const startDate = new Date();
      startDate.setHours(12, 0, 0, 0);
      startDate.setDate(startDate.getDate() - days);
      const start = this.toLocalYMD(startDate);
      const result = rows
        .filter((row) => row?.date && row.date >= start && Number.isFinite(Number(row.val)))
        .map((row) => ({ date: row.date, val: Number(row.val) }));

      console.log(`[DataFetcher] Treasury TGA JSON 로드: ${result.length}개 (일간, ${result[0]?.date} ~ ${result[result.length-1]?.date})`);
      return result;
    } catch (e) {
      console.error('[DataFetcher] TGA JSON load failed:', e);
      return [];
    }
  }

  // =========================================
  // FDIC API
  // =========================================

  /**
   * FDIC Tier1 데이터 fetch (JSON 캐시 우선)
   * 경로: /data/macro/fdic-tier1.json
   * @returns {Promise<Array>} - [{ date, val }, ...]
   */
  async fetchFDICTier1() {
    // 1. JSON 캐시 시도
    try {
      const basePath = this.getBasePath();
      const jsonUrl = window.location.origin + basePath + '/data/macro/fdic-tier1.json';
      try {
        const res = await this.fetchWithTimeout(jsonUrl);
        if (res?.data?.length > 0) {
          return res.data.map(d => ({ date: d.date, val: d.value }));
        }
      } catch (e) {
        // Fall through to the API if the macro cache is unavailable.
      }
    } catch (e) {
      console.log('[DataFetcher] FDIC JSON 없음, API 폴백...');
    }

    // 2. API 폴백 (최근 20분기)
    try {
      const quarters = this.generateQuarters(20);
      const results = [];

      for (const q of quarters) {
        try {
          const url = `${this.urls.fdicApi}?limit=10000&fields=RBC1AAJ,RISDATE&filters=RISDATE:${q}`;
          const json = await this.fetchWithTimeout(url);
          const ratios = json?.data?.map(r => r.data?.RBC1AAJ).filter(v => v != null && !isNaN(v)) || [];
          if (ratios.length > 0) {
            const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
            results.push({ date: q, val: avg });
          }
        } catch (e) { /* 개별 분기 실패 무시 */ }
      }

      return results.sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) {
      console.error('[DataFetcher] FDIC API error:', e);
      return [];
    }
  }

  // =========================================
  // DefiLlama API
  // =========================================

  /**
   * Stablecoin 데이터 fetch
   * @returns {Promise<object|null>} - { current, series }
   */
  async fetchStablecoinData() {
    try {
      const basePath = this.getBasePath();
      const jsonUrl = window.location.origin + basePath + '/data/macro/stablecoins.json';
      const json = await this.fetchWithTimeout(jsonUrl);
      const series = Array.isArray(json?.series) ? json.series : [];
      if (series.length > 0) {
        return {
          current: Number(json?.current ?? series[series.length - 1]?.val ?? 0),
          series: series
            .filter((row) => row?.date && Number.isFinite(Number(row.val)))
            .map((row) => ({ date: row.date, val: Number(row.val) }))
        };
      }
    } catch (e) {
      console.error('[DataFetcher] stablecoins JSON error:', e);
    }
    return null;
  }

  // =========================================
  // 유틸리티
  // =========================================

  /**
   * 타임아웃 포함 fetch
   */
  async fetchWithTimeout(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  /**
   * 시리즈에서 최신값 추출
   */
  getLatestValue(series) {
    if (!Array.isArray(series) || series.length === 0) return null;
    return series[series.length - 1]?.val ?? null;
  }

  /**
   * 숫자 정규화 (NaN/null/undefined 방어)
   * @param {*} value
   * @param {number} fallback
   * @returns {number}
   */
  toFiniteNumber(value, fallback = 0) {
    return toFiniteNumber(value, fallback);
  }

  /**
   * YoY 계산 (1년 전 대비)
   */
  calculateYoY(series) {
    return calculateYoY(series);
  }

  /**
   * Banking 상태 판정
   */
  getBankingStatus(type, value) {
    if (value == null) return 'unknown';

    if (type === 'delinquency') {
      if (value >= 4) return 'danger';
      if (value >= 3) return 'warning';
      if (value >= 2) return 'caution';
      return 'normal';
    }

    if (type === 'loanDeposit') {
      if (value > 85) return 'warning';  // 과열
      if (value < 55) return 'warning';  // 위축
      if (value < 60) return 'caution';
      return 'normal';
    }

    return 'normal';
  }

  /**
   * 최악 상태 선택 (Weakest Link)
   */
  getWorstStatus(statuses) {
    return getWorstStatus(statuses);
  }

  /**
   * 분기 목록 생성 (FDIC용)
   */
  generateQuarters(count) {
    const quarters = [];
    const now = new Date();
    let year = now.getFullYear();
    let quarter = Math.ceil((now.getMonth() + 1) / 3);

    for (let i = 0; i < count; i++) {
      quarters.push(`${year}-${quarter.toString().padStart(2, '0')}-01`);
      quarter--;
      if (quarter < 1) {
        quarter = 4;
        year--;
      }
    }
    return quarters;
  }

  /**
   * 동적 base path (Cloudflare Pages, localhost, GitHub Pages 호환)
   */
  getBasePath() {
    return location.pathname.startsWith('/100xFenok/') ? '/100xFenok' : '';
  }

  /**
   * 나이 포맷 (읽기 쉽게)
   */
  formatAge(ageMs) {
    const minutes = Math.floor(ageMs / 60000);
    if (minutes < 1) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    return `${days}일 전`;
  }
}

// 싱글톤 인스턴스
const DataFetcher = new MacroDataFetcher();

// ES Module export
export { MacroDataFetcher, DataFetcher };

// CommonJS 호환
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MacroDataFetcher, DataFetcher };
}
