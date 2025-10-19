/**
 * EPSMonitoringProvider.js
 * Sprint 4 Module 5: EPS 추정치 변화 감지 및 추세 분석
 *
 * 기능:
 * - T_Chk.json (1,250개 기업, 54 time-series) 로딩
 * - O(1) 티커 조회
 * - EPS 변화율 계산 (1주, 1개월, 3개월)
 * - 추세 분석 (상승/하락/안정)
 * - 급격한 변화 감지 (Alert)
 *
 * 데이터 소스: data/T_Chk.json
 * 레코드 수: 1,250 companies
 * 필드 수: 77 (23 metadata + 54 time-series)
 * Time Range: 2024-09-27 ~ 2025-10-03 (371 days)
 */

class EPSMonitoringProvider {
    constructor() {
        // Raw data
        this.data = null;
        this.metadata = null;

        // Indexes
        this.companyMap = new Map();     // ticker → company
        this.activeCompanies = [];       // companies with recent data
        this.dateFields = [];            // sorted date fields (descending)

        // State
        this.initialized = false;
        this.loadStartTime = null;
    }

    /**
     * T_Chk.json 로딩 및 초기화
     */
    async loadFromJSON(jsonPath = 'data/T_Chk.json') {
        console.log(`[EPSMonitoringProvider] Loading from ${jsonPath}...`);
        this.loadStartTime = Date.now();

        try {
            const response = await fetch(jsonPath);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const jsonData = await response.json();
            this.metadata = jsonData.metadata || {};
            this.data = this.processData(jsonData.data || jsonData);

            this.buildIndexes();
            this.initialized = true;

            const duration = Date.now() - this.loadStartTime;
            console.log(`✅ [EPSMonitoringProvider] Loaded ${this.data.length} companies (${this.activeCompanies.length} active) in ${duration}ms`);

            return true;
        } catch (error) {
            console.error('[EPSMonitoringProvider] Load failed:', error);
            return false;
        }
    }

    /**
     * 데이터 처리 및 정규화
     */
    processData(rawData) {
        return rawData.map(company => {
            const processed = {
                ...company,
                ticker: company.Ticker,
                corp: company.Corp,
                exchange: company.Exchange,
                industry: company.WI26,
                fy0: this.parseNumber(company['FY 0']),
                fy1: this.parseNumber(company['FY+1']),
                chk: this.parseNumber(company.CHK)
            };
            return processed;
        });
    }

    /**
     * 인덱스 구축
     */
    buildIndexes() {
        console.log('[EPSMonitoringProvider] Building indexes...');

        // Ticker index
        for (const company of this.data) {
            this.companyMap.set(company.ticker, company);
        }

        // Date fields (descending order)
        const sample = this.data[0];
        this.dateFields = Object.keys(sample)
            .filter(k => k.match(/^\d+(\.\d)?$/))
            .map(k => parseFloat(k))
            .sort((a, b) => b - a)  // descending
            .map(k => k.toString());

        // Active companies (≥50% recent data in last 10 snapshots)
        const recentDates = this.dateFields.slice(0, 10);
        this.activeCompanies = this.data.filter(company => {
            const populated = recentDates.filter(d => company[d] !== null && company[d] !== undefined).length;
            return populated >= 5;  // ≥50%
        });

        console.log(`✅ Date fields: ${this.dateFields.length}, Active companies: ${this.activeCompanies.length}/${this.data.length}`);
    }

    /**
     * Helper: String → Number with null safety
     */
    parseNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const num = typeof value === 'number' ? value : parseFloat(value);
        return isNaN(num) || !isFinite(num) ? null : num;
    }

    // ===== Core Analytics =====

    /**
     * 티커로 기업 조회 (O(1))
     */
    getCompanyByTicker(ticker) {
        if (!ticker || !this.initialized) return null;
        return this.companyMap.get(ticker) || null;
    }

    /**
     * EPS 히스토리 조회
     */
    getEPSHistory(ticker, limit = 20) {
        const company = this.getCompanyByTicker(ticker);
        if (!company) return null;

        const history = [];
        const dates = this.dateFields.slice(0, limit);

        for (const dateSerial of dates) {
            const value = company[dateSerial];
            if (value !== null && value !== undefined) {
                history.push({
                    dateSerial: parseFloat(dateSerial),
                    date: this.excelSerialToDate(parseFloat(dateSerial)),
                    epsValue: this.parseNumber(value)
                });
            }
        }

        return {
            ticker: company.ticker,
            corp: company.corp,
            currentFY: company.fy0,
            nextFY: company.fy1,
            history: history
        };
    }

    /**
     * Excel serial → Date
     */
    excelSerialToDate(serial) {
        const baseDate = new Date(1899, 11, 30);
        const days = Math.floor(serial);
        const result = new Date(baseDate);
        result.setDate(result.getDate() + days);
        return result.toISOString().split('T')[0];
    }

    /**
     * 변화율 계산
     */
    calculateChangeRate(ticker, period = '1w') {
        const company = this.getCompanyByTicker(ticker);
        if (!company || this.dateFields.length < 2) return null;

        let offset;
        if (period === '1w') offset = 1;          // 1 week ago
        else if (period === '1m') offset = 4;     // ~1 month ago
        else if (period === '3m') offset = 12;    // ~3 months ago
        else return null;

        const latest = company[this.dateFields[0]];
        const previous = company[this.dateFields[offset]];

        if (latest === null || previous === null) return null;

        const latestVal = this.parseNumber(latest);
        const previousVal = this.parseNumber(previous);

        if (latestVal === null || previousVal === null || previousVal === 0) return null;

        return (latestVal - previousVal) / previousVal;
    }

    /**
     * 추세 감지 (linear regression)
     */
    detectTrend(ticker, window = 4) {
        const company = this.getCompanyByTicker(ticker);
        if (!company) return null;

        const dates = this.dateFields.slice(0, window);
        const values = dates.map(d => this.parseNumber(company[d])).filter(v => v !== null);

        if (values.length < 3) return { trend: 'insufficient_data', confidence: 0 };

        // Linear regression slope
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        for (let i = 0; i < values.length; i++) {
            sumX += i;
            sumY += values[i];
            sumXY += i * values[i];
            sumX2 += i * i;
        }

        const n = values.length;
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const avgValue = sumY / n;
        const normalizedSlope = slope / avgValue;

        let trend;
        if (normalizedSlope > 0.02) trend = 'uptrend';
        else if (normalizedSlope < -0.02) trend = 'downtrend';
        else trend = 'stable';

        // Confidence (R²)
        const yMean = avgValue;
        let ssTotal = 0, ssResidual = 0;
        for (let i = 0; i < values.length; i++) {
            const predicted = (sumY / n) + slope * (i - sumX / n);
            ssTotal += (values[i] - yMean) ** 2;
            ssResidual += (values[i] - predicted) ** 2;
        }
        const rSquared = ssTotal === 0 ? 0 : 1 - (ssResidual / ssTotal);

        return {
            trend: trend,
            slope: normalizedSlope,
            confidence: Math.max(0, rSquared)
        };
    }

    // ===== Alert System =====

    /**
     * 급격한 변화 감지
     */
    identifyRapidChanges(threshold = 0.05) {
        if (!this.initialized) return [];

        const rapidChanges = [];

        for (const company of this.activeCompanies) {
            const change1w = this.calculateChangeRate(company.ticker, '1w');
            if (change1w === null) continue;

            if (Math.abs(change1w) >= threshold) {
                rapidChanges.push({
                    ticker: company.ticker,
                    corp: company.corp,
                    industry: company.industry,
                    changeRate: change1w,
                    direction: change1w > 0 ? 'upgrade' : 'downgrade',
                    severity: Math.abs(change1w) > 0.10 ? 'high' : 'medium',
                    fy0: company.fy0,
                    message: `EPS forecast ${change1w > 0 ? 'upgraded' : 'downgraded'} by ${(Math.abs(change1w) * 100).toFixed(2)}% in 1 week`
                });
            }
        }

        return rapidChanges.sort((a, b) => Math.abs(b.changeRate) - Math.abs(a.changeRate));
    }

    /**
     * 상향 조정 기업
     */
    getUpgradedCompanies(period = '1w', minChange = 0.02) {
        const upgraded = [];

        for (const company of this.activeCompanies) {
            const change = this.calculateChangeRate(company.ticker, period);
            if (change !== null && change >= minChange) {
                upgraded.push({
                    ticker: company.ticker,
                    corp: company.corp,
                    industry: company.industry,
                    changeRate: change,
                    fy0: company.fy0
                });
            }
        }

        return upgraded.sort((a, b) => b.changeRate - a.changeRate);
    }

    /**
     * 하향 조정 기업
     */
    getDowngradedCompanies(period = '1w', minChange = 0.02) {
        const downgraded = [];

        for (const company of this.activeCompanies) {
            const change = this.calculateChangeRate(company.ticker, period);
            if (change !== null && change <= -minChange) {
                downgraded.push({
                    ticker: company.ticker,
                    corp: company.corp,
                    industry: company.industry,
                    changeRate: change,
                    fy0: company.fy0
                });
            }
        }

        return downgraded.sort((a, b) => a.changeRate - b.changeRate);
    }

    // ===== Statistical Analysis =====

    /**
     * 시장 센티먼트 (전체)
     */
    getMarketSentiment() {
        if (!this.initialized) return null;

        let upgrades = 0, downgrades = 0, stable = 0;

        for (const company of this.activeCompanies) {
            const change = this.calculateChangeRate(company.ticker, '1w');
            if (change === null) continue;

            if (change > 0.01) upgrades++;
            else if (change < -0.01) downgrades++;
            else stable++;
        }

        const total = upgrades + downgrades + stable;

        return {
            total: total,
            upgrades: upgrades,
            downgrades: downgrades,
            stable: stable,
            upgradeRate: total > 0 ? upgrades / total : 0,
            downgradeRate: total > 0 ? downgrades / total : 0,
            sentiment: upgrades > downgrades ? 'positive' : upgrades < downgrades ? 'negative' : 'neutral'
        };
    }

    /**
     * 업종별 센티먼트
     */
    getIndustrySentiment(industry) {
        if (!this.initialized || !industry) return null;

        const industryCompanies = this.activeCompanies.filter(c => c.industry === industry);
        if (industryCompanies.length === 0) return null;

        let upgrades = 0, downgrades = 0, stable = 0;

        for (const company of industryCompanies) {
            const change = this.calculateChangeRate(company.ticker, '1w');
            if (change === null) continue;

            if (change > 0.01) upgrades++;
            else if (change < -0.01) downgrades++;
            else stable++;
        }

        const total = upgrades + downgrades + stable;

        return {
            industry: industry,
            companies: industryCompanies.length,
            total: total,
            upgrades: upgrades,
            downgrades: downgrades,
            stable: stable,
            upgradeRate: total > 0 ? upgrades / total : 0,
            sentiment: upgrades > downgrades ? 'positive' : upgrades < downgrades ? 'negative' : 'neutral'
        };
    }

    /**
     * 상위 변화 기업 (Top Movers)
     */
    getTopMovers(limit = 20) {
        if (!this.initialized) return { topUpgrades: [], topDowngrades: [] };

        const changes = [];

        for (const company of this.activeCompanies) {
            const change = this.calculateChangeRate(company.ticker, '1w');
            if (change !== null) {
                changes.push({
                    ticker: company.ticker,
                    corp: company.corp,
                    industry: company.industry,
                    changeRate: change,
                    fy0: company.fy0
                });
            }
        }

        const topUpgrades = changes
            .filter(c => c.changeRate > 0)
            .sort((a, b) => b.changeRate - a.changeRate)
            .slice(0, limit);

        const topDowngrades = changes
            .filter(c => c.changeRate < 0)
            .sort((a, b) => a.changeRate - b.changeRate)
            .slice(0, limit);

        return {
            topUpgrades: topUpgrades,
            topDowngrades: topDowngrades
        };
    }

    /**
     * 요약 정보
     */
    getCompanySummary(ticker) {
        const company = this.getCompanyByTicker(ticker);
        if (!company) return null;

        const change1w = this.calculateChangeRate(ticker, '1w');
        const change1m = this.calculateChangeRate(ticker, '1m');
        const change3m = this.calculateChangeRate(ticker, '3m');
        const trend = this.detectTrend(ticker, 4);

        return {
            ticker: company.ticker,
            corp: company.corp,
            exchange: company.exchange,
            industry: company.industry,
            currentFY: company.fy0,
            nextFY: company.fy1,
            chk: company.chk,
            changes: {
                oneWeek: change1w,
                oneMonth: change1m,
                threeMonths: change3m
            },
            trend: trend
        };
    }
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EPSMonitoringProvider;
}
