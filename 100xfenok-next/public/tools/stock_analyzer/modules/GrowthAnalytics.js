/**
 * GrowthAnalytics.js
 * Sprint 4: Growth & EPS 시각화 모듈
 *
 * 기능:
 * - T_Growth_C (1,250개) 현재 성장률 데이터 활용
 * - 기업별 성장률 비교 (Sales, OP, EPS)
 * - 업종별 평균 성장률 분석
 * - 인터랙티브 차트 시각화
 */

class GrowthAnalytics {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.growthData = null;
        this.initialized = false;
    }

    /**
     * 초기화: Growth 데이터 로딩
     */
    async initialize() {
        console.log('[GrowthAnalytics] 초기화 시작...');

        try {
            const integratedData = await this.loadIntegratedData();

            if (!integratedData?.data?.technical?.T_Growth_C) {
                console.warn('[GrowthAnalytics] T_Growth_C 데이터 없음');
                return false;
            }

            this.growthData = integratedData.data.technical.T_Growth_C;

            // 데이터와 기존 company 데이터 매칭
            this.enrichGrowthData();

            this.initialized = true;
            console.log(`[GrowthAnalytics] 초기화 완료: ${this.growthData.length}개 기업`);
            return true;

        } catch (error) {
            console.error('[GrowthAnalytics] 초기화 실패:', error);
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
     * Growth 데이터에 기존 company 데이터 연결
     */
    enrichGrowthData() {
        if (!this.dataManager?.companies) {
            console.warn('[GrowthAnalytics] DataManager companies 없음');
            return;
        }

        // Ticker로 매칭
        const companyMap = new Map(
            this.dataManager.companies.map(c => [c.Ticker, c])
        );

        this.growthData = this.growthData.map(growth => {
            const company = companyMap.get(growth.Ticker);
            return {
                ...growth,
                corpName: company?.corpName || growth.Corp,
                price: company?.Price || growth['주가변화'],
                marketCap: company?.['(USD mn)'] || growth['(USD mn)']
            };
        });
    }

    /**
     * 기업별 성장률 조회
     * @param {string} ticker - 종목 코드
     * @returns {Object} 성장률 데이터
     */
    getCompanyGrowth(ticker) {
        if (!this.initialized || !this.growthData) {
            return null;
        }

        const growth = this.growthData.find(g => g.Ticker === ticker);
        if (!growth) {
            return null;
        }

        return {
            ticker: growth.Ticker,
            corp: growth.Corp,
            exchange: growth.Exchange,
            sector: growth.WI26,
            sales_7y: this.parseGrowth(growth['Sales (7)']),
            sales_3y: this.parseGrowth(growth['Sales (3)']),
            op_7y: this.parseGrowth(growth['OP (7)']),
            op_3y: this.parseGrowth(growth['OP (3)']),
            eps_7y: this.parseGrowth(growth['EPS (7)']),
            eps_3y: this.parseGrowth(growth['EPS (3)']),
            roe_fwd: this.parseGrowth(growth['ROE (Fwd)']),
            opm_fwd: this.parseGrowth(growth['OPM (Fwd)'])
        };
    }

    /**
     * 성장률 파싱 (소수 → 백분율)
     */
    parseGrowth(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const num = parseFloat(value);
        if (isNaN(num)) {
            return null;
        }
        // 0-1 범위면 백분율로 변환
        if (Math.abs(num) <= 1) {
            return num * 100;
        }
        return num;
    }

    /**
     * 업종별 평균 성장률 계산
     * @returns {Array} 업종별 평균 성장률
     */
    getSectorGrowthAverages() {
        if (!this.initialized || !this.growthData) {
            return [];
        }

        const sectorMap = new Map();

        this.growthData.forEach(growth => {
            const sector = growth.WI26 || 'Unknown';

            if (!sectorMap.has(sector)) {
                sectorMap.set(sector, {
                    sector,
                    count: 0,
                    sales_7y: [],
                    sales_3y: [],
                    op_7y: [],
                    op_3y: [],
                    eps_7y: [],
                    eps_3y: []
                });
            }

            const data = sectorMap.get(sector);
            data.count++;

            const sales7 = this.parseGrowth(growth['Sales (7)']);
            const sales3 = this.parseGrowth(growth['Sales (3)']);
            const op7 = this.parseGrowth(growth['OP (7)']);
            const op3 = this.parseGrowth(growth['OP (3)']);
            const eps7 = this.parseGrowth(growth['EPS (7)']);
            const eps3 = this.parseGrowth(growth['EPS (3)']);

            if (sales7 !== null) data.sales_7y.push(sales7);
            if (sales3 !== null) data.sales_3y.push(sales3);
            if (op7 !== null) data.op_7y.push(op7);
            if (op3 !== null) data.op_3y.push(op3);
            if (eps7 !== null) data.eps_7y.push(eps7);
            if (eps3 !== null) data.eps_3y.push(eps3);
        });

        // 평균 계산
        const results = [];
        sectorMap.forEach((data, sector) => {
            results.push({
                sector,
                count: data.count,
                sales_7y_avg: this.average(data.sales_7y),
                sales_3y_avg: this.average(data.sales_3y),
                op_7y_avg: this.average(data.op_7y),
                op_3y_avg: this.average(data.op_3y),
                eps_7y_avg: this.average(data.eps_7y),
                eps_3y_avg: this.average(data.eps_3y)
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
     * 고성장 기업 필터링
     * @param {number} threshold - 성장률 임계값 (%)
     * @param {string} metric - 지표 (sales, op, eps)
     * @param {string} period - 기간 (7y, 3y)
     * @returns {Array} 고성장 기업 리스트
     */
    getHighGrowthCompanies(threshold = 20, metric = 'sales', period = '7y') {
        if (!this.initialized || !this.growthData) {
            return [];
        }

        const metricKey = `${metric.toUpperCase()} (${period === '7y' ? '7' : '3'})`;

        return this.growthData
            .filter(growth => {
                const value = this.parseGrowth(growth[metricKey]);
                return value !== null && value >= threshold;
            })
            .map(growth => ({
                ticker: growth.Ticker,
                corp: growth.Corp,
                sector: growth.WI26,
                growthRate: this.parseGrowth(growth[metricKey]),
                marketCap: growth['(USD mn)']
            }))
            .sort((a, b) => b.growthRate - a.growthRate);
    }

    /**
     * 성장률 차트 데이터 생성 (Chart.js 형식)
     * @param {string} ticker - 종목 코드
     * @returns {Object} Chart.js 데이터 객체
     */
    getGrowthChartData(ticker) {
        const growth = this.getCompanyGrowth(ticker);
        if (!growth) {
            return null;
        }

        return {
            labels: ['Sales (7y)', 'Sales (3y)', 'OP (7y)', 'OP (3y)', 'EPS (7y)', 'EPS (3y)'],
            datasets: [{
                label: `${growth.corp} Growth Rates`,
                data: [
                    growth.sales_7y,
                    growth.sales_3y,
                    growth.op_7y,
                    growth.op_3y,
                    growth.eps_7y,
                    growth.eps_3y
                ],
                backgroundColor: [
                    'rgba(54, 162, 235, 0.6)',
                    'rgba(54, 162, 235, 0.8)',
                    'rgba(75, 192, 192, 0.6)',
                    'rgba(75, 192, 192, 0.8)',
                    'rgba(255, 206, 86, 0.6)',
                    'rgba(255, 206, 86, 0.8)'
                ],
                borderColor: [
                    'rgba(54, 162, 235, 1)',
                    'rgba(54, 162, 235, 1)',
                    'rgba(75, 192, 192, 1)',
                    'rgba(75, 192, 192, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(255, 206, 86, 1)'
                ],
                borderWidth: 2
            }]
        };
    }

    /**
     * 업종별 평균 성장률 차트 데이터
     * @param {number} topN - 상위 N개 업종
     * @returns {Object} Chart.js 데이터 객체
     */
    getSectorGrowthChartData(topN = 10) {
        const sectors = this.getSectorGrowthAverages().slice(0, topN);

        return {
            labels: sectors.map(s => s.sector),
            datasets: [
                {
                    label: 'Sales 7y Avg (%)',
                    data: sectors.map(s => s.sales_7y_avg),
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 2
                },
                {
                    label: 'OP 7y Avg (%)',
                    data: sectors.map(s => s.op_7y_avg),
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 2
                },
                {
                    label: 'EPS 7y Avg (%)',
                    data: sectors.map(s => s.eps_7y_avg),
                    backgroundColor: 'rgba(255, 206, 86, 0.6)',
                    borderColor: 'rgba(255, 206, 86, 1)',
                    borderWidth: 2
                }
            ]
        };
    }

    /**
     * Growth Summary 생성 (DeepCompare 패널용)
     * @param {string} ticker - 종목 코드
     * @returns {string} HTML 형식 성장률 요약
     */
    getGrowthSummaryHTML(ticker) {
        const growth = this.getCompanyGrowth(ticker);
        if (!growth) {
            return '<p class="text-muted">Growth data not available</p>';
        }

        const formatGrowth = (value) => {
            if (value === null) return 'N/A';
            return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
        };

        return `
            <div class="growth-summary">
                <h6 class="mb-2">📈 Growth Rates - ${growth.corp}</h6>
                <div class="row">
                    <div class="col-md-4">
                        <strong>Sales Growth</strong>
                        <p>7-year: ${formatGrowth(growth.sales_7y)}</p>
                        <p>3-year: ${formatGrowth(growth.sales_3y)}</p>
                    </div>
                    <div class="col-md-4">
                        <strong>Operating Profit</strong>
                        <p>7-year: ${formatGrowth(growth.op_7y)}</p>
                        <p>3-year: ${formatGrowth(growth.op_3y)}</p>
                    </div>
                    <div class="col-md-4">
                        <strong>EPS Growth</strong>
                        <p>7-year: ${formatGrowth(growth.eps_7y)}</p>
                        <p>3-year: ${formatGrowth(growth.eps_3y)}</p>
                    </div>
                </div>
                <div class="mt-2">
                    <small><strong>ROE (Fwd):</strong> ${formatGrowth(growth.roe_fwd)} |
                    <strong>OPM (Fwd):</strong> ${formatGrowth(growth.opm_fwd)}</small>
                </div>
            </div>
        `;
    }
}

// Export for use in stock_analyzer_enhanced.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GrowthAnalytics;
}
