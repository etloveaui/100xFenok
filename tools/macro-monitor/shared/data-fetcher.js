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

class MacroDataFetcher {
  constructor() {
    // API 설정
    this.proxy = 'https://fed-proxy.etloveaui.workers.dev/';
    this.apiKey = '6dda7dc3956a2c1d6ac939133de115f1';

    // TTL 설정 (DEC-032: 24시간/7일로 조정)
    this.ttl = 24 * 60 * 60 * 1000;        // 24시간 (fresh)
    this.staleTtl = 7 * 24 * 60 * 60 * 1000; // 7일 (stale)

    // 타임아웃
    this.timeout = 10000; // 10초

    // 외부 API URLs
    this.urls = {
      defiLlamaChart: 'https://stablecoins.llama.fi/stablecoincharts/all',
      defiLlamaList: 'https://stablecoins.llama.fi/stablecoins?includePrices=false',
      fdicApi: 'https://api.fdic.gov/banks/financials'
    };
  }

  // =========================================
  // 메인 API: Widget에서 호출
  // =========================================

  /**
   * Widget 데이터 가져오기 (캐시 우선 + API 폴백)
   * @param {string} widgetId - 위젯 ID (banking-health, liquidity-flow, liquidity-stress)
   * @param {boolean} forceRefresh - 강제 새로고침
   * @returns {Promise<object>} - { data, isStale, isFresh, ageMs }
   */
  async fetch(widgetId, forceRefresh = false) {
    // 1. 캐시 확인 (강제 새로고침 아닐 때)
    if (!forceRefresh) {
      const cached = DataManager.getWidgetDataWithStale(widgetId);
      if (cached.data && cached.isFresh) {
        console.log(`[DataFetcher] ${widgetId}: 캐시 사용 (fresh)`);
        return cached;
      }
      // Stale이지만 데이터 있으면 반환 (백그라운드 갱신은 추후)
      if (cached.data) {
        console.log(`[DataFetcher] ${widgetId}: stale 캐시 사용 (${this.formatAge(cached.ageMs)})`);
        return cached;
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
        return { data, isStale: false, isFresh: true, ageMs: 0 };
      }
    } catch (e) {
      console.error(`[DataFetcher] ${widgetId}: API 호출 실패`, e);
    }

    // 4. API 실패 시 stale 캐시라도 반환
    const fallback = DataManager.getWidgetDataWithStale(widgetId);
    if (fallback.data) {
      console.log(`[DataFetcher] ${widgetId}: API 실패, stale 캐시 사용`);
      return fallback;
    }

    return { data: null, isStale: true, isFresh: false, ageMs: 0 };
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
      default:
        console.warn(`[DataFetcher] Unknown widget: ${widgetId}`);
        return null;
    }
  }

  /**
   * Banking Health 데이터 fetch
   * FRED: DGS10, DRALACBN, TOTLL, DPSACBW027SBOG, BOGZ1FL010000016Q, BAMLH0A0HYM2
   * FDIC: Tier1 (JSON 캐시 또는 API)
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

      // 최신값 추출 및 상태 계산
      const latestDelinquency = this.getLatestValue(delinquency);
      const latestLoans = this.getLatestValue(loans);
      const latestDeposits = this.getLatestValue(deposits);
      const loanDepositRatio = latestDeposits > 0 ? (latestLoans / latestDeposits * 100) : null;

      // 상태 판정 (constants.js THRESHOLDS 기반)
      const delinquencyStatus = this.getBankingStatus('delinquency', latestDelinquency);
      const loanDepositStatus = this.getBankingStatus('loanDeposit', loanDepositRatio);

      // 종합 상태 (Weakest Link)
      const overallStatus = this.getWorstStatus([delinquencyStatus, loanDepositStatus]);

      return {
        timestamp: Date.now(),
        metrics: {
          delinquency: latestDelinquency,
          loanDepositRatio,
          tier1: this.getLatestValue(fdicTier1),
          fedTier1: this.getLatestValue(fedTier1),
          yield10y: this.getLatestValue(yield10y),
          hySpread: this.getLatestValue(hySpread)
        },
        statuses: {
          delinquency: delinquencyStatus,
          loanDeposit: loanDepositStatus
        },
        overall: overallStatus,
        series: {
          delinquency,
          loans,
          deposits,
          fedTier1,
          yield10y,
          hySpread,
          fdicTier1
        }
      };
    } catch (e) {
      console.error('[DataFetcher] Banking Health fetch error:', e);
      return null;
    }
  }

  /**
   * Liquidity Flow 데이터 fetch
   * FRED: M2SL, WALCL, WTREGEN, RRPONTSYD
   * DefiLlama: Stablecoin 시총
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
        this.fetchFRED('WTREGEN', days),
        this.fetchFRED('RRPONTSYD', days),
        this.fetchStablecoinData()
      ]);

      // Net Liquidity 계산: Fed BS - TGA - RRP
      const latestFedBs = this.getLatestValue(fedBs);
      const latestTga = this.getLatestValue(tga);
      const latestRrp = this.getLatestValue(rrp);
      const netLiquidity = latestFedBs - latestTga - latestRrp;

      // M2 YoY 계산
      const m2YoY = this.calculateYoY(m2);

      // 상태 판정
      const m2Status = m2YoY >= 6 ? 'positive' : m2YoY >= 2 ? 'neutral' : 'negative';
      const netLiqStatus = netLiquidity > 50 ? 'positive' : netLiquidity > -50 ? 'neutral' : 'negative';

      return {
        timestamp: Date.now(),
        metrics: {
          m2: this.getLatestValue(m2),
          m2YoY,
          fedBs: latestFedBs,
          tga: latestTga,
          rrp: latestRrp,
          netLiquidity,
          stablecoin: stablecoin?.current || null
        },
        statuses: {
          m2: m2Status,
          netLiquidity: netLiqStatus
        },
        overall: m2Status === 'positive' && netLiqStatus === 'positive' ? 'EXPANDING'
               : m2Status === 'negative' || netLiqStatus === 'negative' ? 'CONTRACTING'
               : 'NEUTRAL',
        series: { m2, fedBs, tga, rrp, stablecoin: stablecoin?.series || [] }
      };
    } catch (e) {
      console.error('[DataFetcher] Liquidity Flow fetch error:', e);
      return null;
    }
  }

  /**
   * Liquidity Stress 데이터 fetch
   * FRED: SOFR, IORB, WRESBAL, GDP
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

      // Spread 계산 (bp)
      const latestSofr = this.getLatestValue(sofr);
      const latestIorb = this.getLatestValue(iorb);
      const spread = latestSofr && latestIorb ? Math.round((latestSofr - latestIorb) * 100) : null;

      // Reserves/GDP 비율
      const latestReserves = this.getLatestValue(reserves);
      const latestGdp = this.getLatestValue(gdp);
      const reservesGdpRatio = latestReserves && latestGdp ? (latestReserves / latestGdp * 100) : null;

      // 상태 판정
      const spreadStatus = spread >= 30 ? 'danger' : spread >= 20 ? 'warning' : spread >= 10 ? 'caution' : 'normal';
      const ratioStatus = reservesGdpRatio < 8 ? 'danger' : reservesGdpRatio < 10 ? 'warning' : reservesGdpRatio < 12 ? 'caution' : 'normal';

      return {
        timestamp: Date.now(),
        metrics: {
          sofr: latestSofr,
          iorb: latestIorb,
          spread,
          reserves: latestReserves,
          gdp: latestGdp,
          reservesGdpRatio
        },
        statuses: {
          spread: spreadStatus,
          ratio: ratioStatus
        },
        overall: this.getWorstStatus([spreadStatus, ratioStatus]),
        series: { sofr, iorb, reserves, gdp }
      };
    } catch (e) {
      console.error('[DataFetcher] Liquidity Stress fetch error:', e);
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
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    const url = `${this.proxy}fred/series/observations?series_id=${seriesId}&api_key=${this.apiKey}&file_type=json&observation_start=${start}&observation_end=${end}&sort_order=asc`;

    try {
      const json = await this.fetchWithTimeout(url);
      if (!json?.observations) return [];

      return json.observations
        .filter(o => o.value !== '.')
        .map(o => ({ date: o.date, val: parseFloat(o.value) }));
    } catch (e) {
      console.error(`[DataFetcher] FRED ${seriesId} error:`, e);
      return [];
    }
  }

  // =========================================
  // FDIC API
  // =========================================

  /**
   * FDIC Tier1 데이터 fetch (JSON 캐시 우선)
   * @returns {Promise<Array>} - [{ date, val }, ...]
   */
  async fetchFDICTier1() {
    // 1. JSON 캐시 시도
    try {
      const jsonUrl = window.location.origin + '/100xFenok/data/fdic-tier1.json';
      const res = await this.fetchWithTimeout(jsonUrl);
      if (res?.data?.length > 0) {
        return res.data.map(d => ({ date: d.date, val: d.value }));
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
      // 시계열 API
      const json = await this.fetchWithTimeout(this.urls.defiLlamaChart);
      if (Array.isArray(json) && json.length > 0) {
        const series = json.map(d => ({
          date: new Date(d.date * 1000).toISOString().split('T')[0],
          val: d.totalCirculating?.peggedUSD || 0
        }));
        return {
          current: series[series.length - 1]?.val || 0,
          series
        };
      }
    } catch (e) {
      console.error('[DataFetcher] DefiLlama error:', e);
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
   * YoY 계산 (1년 전 대비)
   */
  calculateYoY(series) {
    if (!Array.isArray(series) || series.length < 2) return null;
    const latest = series[series.length - 1]?.val;
    // 약 1년 전 데이터 찾기 (주간 데이터 기준 ~52주)
    const yearAgoIdx = Math.max(0, series.length - 52);
    const yearAgo = series[yearAgoIdx]?.val;
    if (!latest || !yearAgo || yearAgo === 0) return null;
    return ((latest - yearAgo) / yearAgo) * 100;
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
    const order = ['normal', 'caution', 'warning', 'danger'];
    let worst = 0;
    for (const s of statuses) {
      const idx = order.indexOf(s);
      if (idx > worst) worst = idx;
    }
    return order[worst];
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
