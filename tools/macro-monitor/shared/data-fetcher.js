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
      // Stale이면 API 시도 후 실패 시 캐시 반환 (#16 수정)
      if (cached.data && cached.isStale) {
        console.log(`[DataFetcher] ${widgetId}: stale 캐시 (${this.formatAge(cached.ageMs)}) → API 시도`);
        try {
          const data = await this.fetchByWidgetId(widgetId);
          if (data) {
            DataManager.saveWidgetData(widgetId, data);
            console.log(`[DataFetcher] ${widgetId}: API 갱신 성공`);
            return { data, isStale: false, isFresh: true, ageMs: 0 };
          }
        } catch (e) {
          console.log(`[DataFetcher] ${widgetId}: API 실패, stale 캐시 사용`);
        }
        return cached; // API 실패 시 stale 캐시 반환
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

      // 최신값 추출
      const latestDelinquency = this.getLatestValue(delinquency) || 0;
      const latestLoans = this.getLatestValue(loans);
      const latestDeposits = this.getLatestValue(deposits);
      const latestTier1 = this.getLatestValue(fdicTier1) || this.getLatestValue(fedTier1) || 0;

      // 예대율 계산
      const loanDepositRatio = latestDeposits > 0 ? parseFloat((latestLoans / latestDeposits * 100).toFixed(2)) : 0;

      // 여신증가율 계산 (YoY)
      const loanGrowth = this.calculateLoanGrowth(loans);

      // 상태 판정 (constants.js THRESHOLDS 기반)
      const delStatus = this.getDelinquencyStatus(latestDelinquency);
      const t1Status = this.getTier1Status(latestTier1);
      const ldStatus = this.getLoanDepositStatus(loanDepositRatio);
      const lgStatus = this.getLoanGrowthStatus(loanGrowth);

      // 종합 상태 (Weakest Link)
      const overallStatus = this.getWorstStatus([delStatus, t1Status, ldStatus, lgStatus]);

      // 라벨 맵 (Detail과 동일)
      const statusLabels = { normal: '정상', caution: '주의', warning: '경계', danger: '위험' };
      const overallLabels = { normal: 'Healthy', caution: 'Watch', warning: 'Caution', danger: 'Stress' };

      // ★ Detail과 동일한 형식으로 반환
      return {
        overallStatus,
        overallLabel: overallLabels[overallStatus],
        delinquency: { value: parseFloat(latestDelinquency.toFixed(2)), status: delStatus, label: statusLabels[delStatus] },
        tier1: { value: parseFloat(latestTier1.toFixed(2)), status: t1Status, label: statusLabels[t1Status] },
        loanDeposit: { value: loanDepositRatio, status: ldStatus, label: statusLabels[ldStatus] },
        loanGrowth: { value: parseFloat(loanGrowth.toFixed(2)), status: lgStatus, label: statusLabels[lgStatus] },
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
    if (!loans?.length || loans.length < 2) return 0;

    const latestVal = loans[loans.length - 1]?.val;
    // 약 1년 전 데이터 (주간 데이터 ~52주)
    const yearAgoIdx = Math.max(0, loans.length - 52);
    const yearAgoVal = loans[yearAgoIdx]?.val;

    if (!latestVal || !yearAgoVal || yearAgoVal === 0) return 0;
    return ((latestVal - yearAgoVal) / yearAgoVal) * 100;
  }

  /**
   * 연체율 상태 판정
   */
  getDelinquencyStatus(val) {
    if (val == null) return 'normal';
    if (val < 2) return 'normal';
    if (val < 3) return 'caution';
    if (val < 4) return 'warning';
    return 'danger';
  }

  /**
   * Tier1 자본비율 상태 판정
   */
  getTier1Status(val) {
    if (val == null) return 'normal';
    if (val >= 12) return 'normal';
    if (val >= 10) return 'caution';
    if (val >= 8) return 'warning';
    return 'danger';
  }

  /**
   * 예대율 상태 판정
   */
  getLoanDepositStatus(val) {
    if (val == null) return 'normal';
    if (val >= 60 && val <= 85) return 'normal';
    if (val > 85) return 'warning';  // 과열
    if (val >= 55) return 'caution';
    return 'warning';  // 위축
  }

  /**
   * 여신증가율 상태 판정
   */
  getLoanGrowthStatus(val) {
    if (val == null) return 'normal';
    if (val >= 5) return 'normal';
    if (val >= 0) return 'caution';
    return 'warning';
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

      // 최신값 (단위 변환: WALCL, TGA는 Millions → Billions)
      // M2SL, RRP는 이미 Billions
      const latestM2 = this.getLatestValue(m2);  // Billions
      const walclB = this.getLatestValue(fedBs) / 1000;  // Millions → Billions
      const tgaB = this.getLatestValue(tga) / 1000;      // Millions → Billions
      const rrpB = this.getLatestValue(rrp);             // 이미 Billions ★ 수정됨

      // Net Liquidity 계산 (정식 공식): Fed BS - TGA - RRP (Billions)
      const netLiquidity = walclB - tgaB - rrpB;

      // M2 YoY 계산
      const m2YoY = this.calculateYoY(m2) || 0;

      // Stablecoin / M2 비율 (%)
      const stablecoinMcap = (stablecoin?.current || 0) / 1e9;  // Billions
      const scM2Ratio = latestM2 > 0 ? (stablecoinMcap / (latestM2 * 1000)) * 100 : 0;  // M2는 Trillions 단위

      // Delta 값들 (최근 2주 데이터로 계산)
      // ★ weeklyNetFlow: 최근 1주일간 변화량 (Hero Value용)
      const weeklyNetFlow = this.calculateWeeklyDelta(fedBs, tga, rrp);

      // ★ Detail과 동일한 형식으로 반환
      return {
        // Signal Matrix 3개 지표
        m2YoY: parseFloat(m2YoY.toFixed(2)),
        m2Total: latestM2,  // Billions
        netLiquidity: parseFloat(netLiquidity.toFixed(1)),  // Billions
        // netLiquidityDelta: 초기 로딩 시에도 의미있는 값 제공 (일간 변화량 근사치)
        // 단, 위젯은 weeklyNetFlow를 우선 사용하도록 설계됨
        netLiquidityDelta: weeklyNetFlow, 
        weeklyNetFlow: weeklyNetFlow, // ★ 명시적 필드 추가
        stablecoinMcap,  // Billions
        scM2Ratio: parseFloat(scM2Ratio.toFixed(2)),
        // Components (Chart용)
        walcl: parseFloat(walclB.toFixed(1)),
        tga: parseFloat(tgaB.toFixed(1)),
        rrp: parseFloat(rrpB.toFixed(1)),
        walclDelta: 0,  
        tgaDelta: 0,
        rrpDelta: 0,
        // 기존 호환용
        netFlow: weeklyNetFlow,
        updated: new Date().toISOString()
      };
    } catch (e) {
      console.error('[DataFetcher] Liquidity Flow fetch error:', e);
      return null;
    }
  }

    /**

     * Net Liquidity Weekly Delta 계산

     * WALCL: 주간, TGA: 일간 (DEC-048), RRP: 일간

     * RRP 단위 수정 반영 (/1000 제거)

     */

    calculateWeeklyDelta(fedBs, tga, rrp) {

      // 데이터 부족 시 0 반환

      if (!fedBs?.length || fedBs.length < 2 || !tga?.length || tga.length < 2) return 0;

  

      const hasRrp = Array.isArray(rrp) && rrp.length > 0;

  

      // 최신 값 (Last)

      const latestWalcl = (fedBs[fedBs.length - 1]?.val || 0) / 1000; // Billions

      const latestTga = (tga[tga.length - 1]?.val || 0) / 1000;       // Billions

      // RRPONTSYD는 원천 데이터가 이미 Billions 단위이므로 /1000 하지 않는다 (P0 Unit Fix)

      const latestRrp = hasRrp ? (rrp[rrp.length - 1]?.val || 0) : 0; 

  

      // 1주일 전 값 (Prev)

      const prevWalcl = (fedBs[fedBs.length - 2]?.val || 0) / 1000;

      

      // TGA: 5일 전(영업일 기준 1주일) 데이터를 찾거나, 없으면 index-5 사용

      let prevTga = latestTga;

      if (tga.length > 5) prevTga = (tga[tga.length - 6]?.val || 0) / 1000;

  

      // RRP: 안전하게 접근

      let prevRrp = latestRrp;

      if (hasRrp && rrp.length > 5) prevRrp = rrp[rrp.length - 6]?.val || 0;

  

      // Sanity Check: RRP 단위 검증 (P0)

      // 최근 8년 내 RRP가 $5T를 넘은 적은 없으므로, 5000 초과 시 단위 오류 가능성 큼

      if (latestRrp > 5000) {

          console.warn(`[DataFetcher] Abnormal RRP value detected: ${latestRrp}. Unit scaling might be incorrect (expected Billions).`);

      }

  

      // Net Liquidity = WALCL - TGA - RRP

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

      // Spread 계산 (bp)
      const latestSofr = this.getLatestValue(sofr);
      const latestIorb = this.getLatestValue(iorb);
      const spread = latestSofr && latestIorb ? Math.round((latestSofr - latestIorb) * 100) : 0;

      // Reserves/GDP 비율
      // 단위: WRESBAL = Millions, GDP = Billions → Reserves를 Billions로 변환 (/1000)
      const latestReserves = this.getLatestValue(reserves);
      const latestGdp = this.getLatestValue(gdp);
      const reservesGdpRatio = (latestReserves && latestGdp)
        ? parseFloat(((latestReserves / 1000) / latestGdp * 100).toFixed(1))
        : 0;

      // 상태 판정 (Detail과 동일)
      const tier1Status = spread >= 30 ? 'danger' : spread >= 20 ? 'warning' : spread >= 10 ? 'caution' : 'normal';
      const tier2Status = reservesGdpRatio < 8 ? 'danger' : reservesGdpRatio < 10 ? 'warning' : reservesGdpRatio < 12 ? 'caution' : 'normal';
      const overallStatus = this.getWorstStatus([tier1Status, tier2Status]);

      // 라벨 맵 (Detail과 동일)
      const statusLabels = { normal: '정상', caution: '주의', warning: '경계', danger: '위험' };
      const overallLabels = { normal: 'Normal', caution: 'Caution', warning: 'High Stress', danger: 'Critical' };

      // ★ Detail과 동일한 형식으로 반환
      return {
        overallStatus,
        overallLabel: overallLabels[overallStatus] || 'Normal',
        tier1: {
          status: tier1Status,
          label: statusLabels[tier1Status],
          value: spread,  // bp 단위, 정수
          unit: 'bp'
        },
        tier2: {
          status: tier2Status,
          label: statusLabels[tier2Status],
          value: reservesGdpRatio,  // % 단위
          unit: '%'
        },
        updated: new Date().toISOString()
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
    const start = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    const baseUrl = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';

    try {
      // 3개 account_type 모두 fetch (시기별 다른 이름 사용)
      const urls = [
        // 1. Federal Reserve Account (2005 ~ 2021-09-30)
        `${baseUrl}?filter=account_type:eq:Federal Reserve Account,record_date:gte:${start}&sort=record_date&page[size]=10000&fields=record_date,open_today_bal`,
        // 2. Treasury General Account (TGA) (2021-10-01 ~ 2022-04-15)
        `${baseUrl}?filter=account_type:eq:Treasury General Account (TGA),record_date:gte:${start}&sort=record_date&page[size]=10000&fields=record_date,open_today_bal`,
        // 3. Treasury General Account (TGA) Opening Balance (2022-04-18 ~ 현재) ★ 추가!
        `${baseUrl}?filter=account_type:eq:Treasury General Account (TGA) Opening Balance,record_date:gte:${start}&sort=record_date&page[size]=10000&fields=record_date,open_today_bal`
      ];

      const responses = await Promise.all(urls.map(url => this.fetchWithTimeout(url)));

      // 데이터 병합
      const allData = [];
      responses.forEach((json, idx) => {
        if (json?.data) {
          const typeName = ['FRA', 'TGA', 'TGA-Opening'][idx];
          json.data.forEach(d => {
            if (d.open_today_bal && d.open_today_bal !== 'null') {
              allData.push({ date: d.record_date, val: parseFloat(d.open_today_bal) });
            }
          });
          console.log(`[DataFetcher] ${typeName}: ${json.data.length}개`);
        }
      });

      if (allData.length === 0) {
        console.warn('[DataFetcher] Treasury API 데이터 없음, FRED 폴백');
        return this.fetchFRED('WTREGEN', days);
      }

      // 날짜 정렬 (오름차순)
      allData.sort((a, b) => a.date.localeCompare(b.date));

      // 중복 제거 (같은 날짜면 나중 데이터 = Opening Balance 우선)
      const uniqueMap = new Map();
      allData.forEach(d => uniqueMap.set(d.date, d.val));

      const result = Array.from(uniqueMap.entries()).map(([date, val]) => ({ date, val }));
      console.log(`[DataFetcher] Treasury TGA 로드: ${result.length}개 (일간, ${result[0]?.date} ~ ${result[result.length-1]?.date})`);

      return result;

    } catch (e) {
      console.error('[DataFetcher] Treasury API 실패, FRED 폴백:', e);
      return this.fetchFRED('WTREGEN', days);
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
      const basePath = this.getBasePath();
      const jsonUrl = window.location.origin + basePath + '/data/fdic-tier1.json';
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
   * 동적 base path (Cloudflare Pages, localhost, GitHub Pages 호환)
   */
  getBasePath() {
    const isLocal = /^(127\.0\.0\.1|localhost|192\.168\.\d+\.\d+)$/.test(location.hostname) || location.protocol === 'file:';
    const isCloudflare = location.hostname.endsWith('pages.dev');
    return (isLocal || isCloudflare) ? '' : '/100xFenok';
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
