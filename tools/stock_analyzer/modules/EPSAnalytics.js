/**
 * EPSAnalytics.js
 * Sprint 4: EPS (주당순이익) 분석 모듈
 *
 * 기능:
 * - T_EPS_C (1,250개) EPS 데이터 활용
 * - 기업별 EPS 비교 (현재, 성장률, Forward EPS)
 * - 업종별 평균 EPS 분석
 * - 인터랙티브 차트 시각화
 */

class EPSAnalytics {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.epsData = null;
        this.initialized = false;
    }

    /**
     * 초기화: EPS 데이터 로딩
     */
    async initialize() {
        console.log('[EPSAnalytics] 초기화 시작...');

        try {
            const integratedData = await this.loadIntegratedData();

            if (!integratedData?.data?.technical?.T_EPS_C) {
                console.warn('[EPSAnalytics] T_EPS_C 데이터 없음');
                return false;
            }

            this.epsData = integratedData.data.technical.T_EPS_C;

            // 데이터와 기존 company 데이터 매칭
            this.enrichEPSData();

            this.initialized = true;
            console.log(`[EPSAnalytics] 초기화 완료: ${this.epsData.length}개 기업`);
            return true;

        } catch (error) {
            console.error('[EPSAnalytics] 초기화 실패:', error);
            return false;
        }
    }

    /**
     * Integrated JSON 로딩
     */
    async loadIntegratedData() {
        const response = await fetch('./data/global_scouter_integrated.json');
        if (!response.ok) {
            throw new Error(`Failed to load integrated data: ${response.status}`);
        }
        return await response.json();
    }

    /**
     * EPS 데이터에 기존 company 데이터 연결
     */
    enrichEPSData() {
        if (!this.dataManager?.companies) {
            console.warn('[EPSAnalytics] DataManager companies 없음');
            return;
        }

        // Ticker로 매칭
        const companyMap = new Map(
            this.dataManager.companies.map(c => [c.Ticker, c])
        );

        this.epsData = this.epsData.map(eps => {
            const company = companyMap.get(eps.Ticker);
            return {
                ...eps,
                corpName: company?.corpName || eps.Corp,
                price: company?.Price || eps['주가변화'],
                marketCap: company?.['(USD mn)'] || eps['(USD mn)']
            };
        });
    }

    /**
     * 기업별 EPS 조회
     * @param {string} ticker - 종목 코드
     * @returns {Object} EPS 데이터
     */
    getCompanyEPS(ticker) {
        if (!this.initialized || !this.epsData) {
            return null;
        }

        const eps = this.epsData.find(e => e.Ticker === ticker);
        if (!eps) {
            return null;
        }

        return {
            ticker: eps.Ticker,
            corp: eps.Corp,
            exchange: eps.Exchange,
            sector: eps.WI26,

            // 현재 EPS 지표
            eps_current: this.parseEPS(eps['EPS']),
            eps_fwd: this.parseEPS(eps['EPS (Fwd)']),
            eps_nxt: this.parseEPS(eps['EPS (Nxt)']),

            // EPS 성장률
            eps_growth_1y: this.parseEPS(eps['EPS성장(1Y)']),
            eps_growth_3y: this.parseEPS(eps['EPS성장(3Y)']),
            eps_growth_5y: this.parseEPS(eps['EPS성장(5Y)']),

            // 추가 수익성 지표
            roe: this.parseEPS(eps['ROE']),
            roe_fwd: this.parseEPS(eps['ROE (Fwd)']),
            profit_margin: this.parseEPS(eps['수익률']),

            marketCap: eps['(USD mn)']
        };
    }

    /**
     * EPS 파싱 (다양한 형식 처리)
     */
    parseEPS(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const num = parseFloat(value);
        if (isNaN(num)) {
            return null;
        }
        // EPS 성장률의 경우 0-1 범위면 백분율로 변환
        if (Math.abs(num) <= 1 && Math.abs(num) > 0) {
            return num * 100;
        }
        return num;
    }

    /**
     * 업종별 평균 EPS 계산
     * @returns {Array} 업종별 평균 EPS
     */
    getSectorEPSAverages() {
        if (!this.initialized || !this.epsData) {
            return [];
        }

        const sectorMap = new Map();

        this.epsData.forEach(eps => {
            const sector = eps.WI26 || 'Unknown';

            if (!sectorMap.has(sector)) {
                sectorMap.set(sector, {
                    sector,
                    count: 0,
                    eps_current: [],
                    eps_fwd: [],
                    eps_growth_3y: [],
                    roe: [],
                    profit_margin: []
                });
            }

            const data = sectorMap.get(sector);
            data.count++;

            const epsCurrent = this.parseEPS(eps['EPS']);
            const epsFwd = this.parseEPS(eps['EPS (Fwd)']);
            const epsGrowth3y = this.parseEPS(eps['EPS성장(3Y)']);
            const roe = this.parseEPS(eps['ROE']);
            const profitMargin = this.parseEPS(eps['수익률']);

            if (epsCurrent !== null) data.eps_current.push(epsCurrent);
            if (epsFwd !== null) data.eps_fwd.push(epsFwd);
            if (epsGrowth3y !== null) data.eps_growth_3y.push(epsGrowth3y);
            if (roe !== null) data.roe.push(roe);
            if (profitMargin !== null) data.profit_margin.push(profitMargin);
        });

        // 평균 계산
        const results = [];
        sectorMap.forEach((data, sector) => {
            results.push({
                sector,
                count: data.count,
                eps_current_avg: this.average(data.eps_current),
                eps_fwd_avg: this.average(data.eps_fwd),
                eps_growth_3y_avg: this.average(data.eps_growth_3y),
                roe_avg: this.average(data.roe),
                profit_margin_avg: this.average(data.profit_margin)
            });
        });

        // 기업 수 많은 순으로 정렬
        return results.sort((a, b) => b.count - a.count);
    }

    /**
     * 평균 계산
     */
    average(arr) {
        if (!arr || arr.length === 0) return null;
        const sum = arr.reduce((acc, val) => acc + val, 0);
        return sum / arr.length;
    }

    /**
     * 고EPS 기업 필터링
     * @param {number} threshold - EPS 임계값
     * @param {string} metric - 지표 (current, fwd, growth)
     * @returns {Array} 고EPS 기업 리스트
     */
    getHighEPSCompanies(threshold = 5, metric = 'current') {
        if (!this.initialized || !this.epsData) {
            return [];
        }

        let metricKey;
        switch (metric) {
            case 'current':
                metricKey = 'EPS';
                break;
            case 'fwd':
                metricKey = 'EPS (Fwd)';
                break;
            case 'growth':
                metricKey = 'EPS성장(3Y)';
                break;
            default:
                metricKey = 'EPS';
        }

        return this.epsData
            .filter(eps => {
                const value = this.parseEPS(eps[metricKey]);
                return value !== null && value >= threshold;
            })
            .map(eps => ({
                ticker: eps.Ticker,
                corp: eps.Corp,
                sector: eps.WI26,
                epsValue: this.parseEPS(eps[metricKey]),
                marketCap: eps['(USD mn)']
            }))
            .sort((a, b) => b.epsValue - a.epsValue);
    }

    /**
     * EPS 차트 데이터 생성 (Chart.js 형식)
     * @param {string} ticker - 종목 코드
     * @returns {Object} Chart.js 데이터 객체
     */
    getEPSChartData(ticker) {
        const eps = this.getCompanyEPS(ticker);
        if (!eps) {
            return null;
        }

        return {
            labels: ['EPS Current', 'EPS Fwd', 'EPS Nxt', 'ROE', 'ROE Fwd', 'Profit Margin'],
            datasets: [{
                label: `${eps.corp} EPS & Profitability`,
                data: [
                    eps.eps_current,
                    eps.eps_fwd,
                    eps.eps_nxt,
                    eps.roe,
                    eps.roe_fwd,
                    eps.profit_margin
                ],
                backgroundColor: [
                    'rgba(54, 162, 235, 0.6)',
                    'rgba(54, 162, 235, 0.8)',
                    'rgba(75, 192, 192, 0.6)',
                    'rgba(255, 206, 86, 0.6)',
                    'rgba(255, 206, 86, 0.8)',
                    'rgba(153, 102, 255, 0.6)'
                ],
                borderColor: [
                    'rgba(54, 162, 235, 1)',
                    'rgba(54, 162, 235, 1)',
                    'rgba(75, 192, 192, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(153, 102, 255, 1)'
                ],
                borderWidth: 2
            }]
        };
    }

    /**
     * 업종별 평균 EPS 차트 데이터
     * @param {number} topN - 상위 N개 업종
     * @returns {Object} Chart.js 데이터 객체
     */
    getSectorEPSChartData(topN = 10) {
        const sectors = this.getSectorEPSAverages().slice(0, topN);

        return {
            labels: sectors.map(s => s.sector),
            datasets: [
                {
                    label: 'EPS Current Avg',
                    data: sectors.map(s => s.eps_current_avg),
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 2
                },
                {
                    label: 'EPS Fwd Avg',
                    data: sectors.map(s => s.eps_fwd_avg),
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 2
                },
                {
                    label: 'ROE Avg (%)',
                    data: sectors.map(s => s.roe_avg),
                    backgroundColor: 'rgba(255, 206, 86, 0.6)',
                    borderColor: 'rgba(255, 206, 86, 1)',
                    borderWidth: 2
                }
            ]
        };
    }

    /**
     * EPS Summary 생성 (DeepCompare 패널용)
     * @param {string} ticker - 종목 코드
     * @returns {string} HTML 형식 EPS 요약
     */
    getEPSSummaryHTML(ticker) {
        const eps = this.getCompanyEPS(ticker);
        if (!eps) {
            return '<p class="text-muted">EPS data not available</p>';
        }

        const formatEPS = (value) => {
            if (value === null) return 'N/A';
            return value.toFixed(2);
        };

        const formatPercent = (value) => {
            if (value === null) return 'N/A';
            return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
        };

        return `
            <div class="eps-summary">
                <h6 class="mb-2">💰 EPS Analysis - ${eps.corp}</h6>
                <div class="row">
                    <div class="col-md-4">
                        <strong>Current EPS</strong>
                        <p>EPS: ${formatEPS(eps.eps_current)}</p>
                        <p>EPS (Fwd): ${formatEPS(eps.eps_fwd)}</p>
                        <p>EPS (Nxt): ${formatEPS(eps.eps_nxt)}</p>
                    </div>
                    <div class="col-md-4">
                        <strong>EPS Growth Rates</strong>
                        <p>1-Year: ${formatPercent(eps.eps_growth_1y)}</p>
                        <p>3-Year: ${formatPercent(eps.eps_growth_3y)}</p>
                        <p>5-Year: ${formatPercent(eps.eps_growth_5y)}</p>
                    </div>
                    <div class="col-md-4">
                        <strong>Profitability</strong>
                        <p>ROE: ${formatPercent(eps.roe)}</p>
                        <p>ROE (Fwd): ${formatPercent(eps.roe_fwd)}</p>
                        <p>Profit Margin: ${formatPercent(eps.profit_margin)}</p>
                    </div>
                </div>
                <div class="mt-2">
                    <small class="text-muted">Sector: ${eps.sector} | Market Cap: $${eps.marketCap ? eps.marketCap.toLocaleString() : 'N/A'}M</small>
                </div>
            </div>
        `;
    }

    /**
     * EPS 비교 (여러 기업)
     * @param {Array<string>} tickers - 종목 코드 배열
     * @param {string} metric - 비교 지표 (current, fwd, growth)
     * @returns {Array} 비교 결과
     */
    compareEPS(tickers, metric = 'current') {
        if (!this.initialized || !this.epsData) {
            return [];
        }

        let metricKey;
        switch (metric) {
            case 'current':
                metricKey = 'EPS';
                break;
            case 'fwd':
                metricKey = 'EPS (Fwd)';
                break;
            case 'growth':
                metricKey = 'EPS성장(3Y)';
                break;
            default:
                metricKey = 'EPS';
        }

        return tickers
            .map(ticker => {
                const eps = this.epsData.find(e => e.Ticker === ticker);
                if (!eps) return null;

                return {
                    ticker: eps.Ticker,
                    corp: eps.Corp,
                    epsValue: this.parseEPS(eps[metricKey]),
                    sector: eps.WI26,
                    marketCap: eps['(USD mn)']
                };
            })
            .filter(e => e !== null && e.epsValue !== null)
            .sort((a, b) => b.epsValue - a.epsValue);
    }

    /**
     * EPS 성장 추이 데이터
     * @param {string} ticker - 종목 코드
     * @returns {Object} Chart.js 시계열 데이터
     */
    getEPSGrowthTrendData(ticker) {
        const eps = this.getCompanyEPS(ticker);
        if (!eps) {
            return null;
        }

        return {
            labels: ['1-Year Growth', '3-Year Growth', '5-Year Growth'],
            datasets: [{
                label: `${eps.corp} EPS Growth Trend`,
                data: [
                    eps.eps_growth_1y,
                    eps.eps_growth_3y,
                    eps.eps_growth_5y
                ],
                backgroundColor: 'rgba(75, 192, 192, 0.6)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 2,
                fill: false,
                tension: 0.4
            }]
        };
    }

    /**
     * ROE vs EPS 성장률 산점도 데이터
     * @param {number} topN - 상위 N개 기업
     * @returns {Object} Chart.js scatter 데이터
     */
    getROEvsEPSGrowthData(topN = 50) {
        if (!this.initialized || !this.epsData) {
            return null;
        }

        const validData = this.epsData
            .map(eps => ({
                ticker: eps.Ticker,
                corp: eps.Corp,
                roe: this.parseEPS(eps['ROE']),
                epsGrowth: this.parseEPS(eps['EPS성장(3Y)'])
            }))
            .filter(d => d.roe !== null && d.epsGrowth !== null)
            .slice(0, topN);

        return {
            datasets: [{
                label: 'ROE vs EPS Growth (3Y)',
                data: validData.map(d => ({
                    x: d.roe,
                    y: d.epsGrowth,
                    label: d.corp
                })),
                backgroundColor: 'rgba(153, 102, 255, 0.6)',
                borderColor: 'rgba(153, 102, 255, 1)',
                borderWidth: 1
            }]
        };
    }

    /**
     * 섹터별 EPS 성장률 히트맵 데이터
     * @returns {Array} 히트맵용 데이터
     */
    getSectorEPSHeatmapData() {
        const sectors = this.getSectorEPSAverages();

        return sectors.map(sector => ({
            sector: sector.sector,
            eps_growth: sector.eps_growth_3y_avg || 0,
            roe: sector.roe_avg || 0,
            count: sector.count
        }));
    }
}

// Export for use in stock_analyzer_enhanced.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EPSAnalytics;
}
