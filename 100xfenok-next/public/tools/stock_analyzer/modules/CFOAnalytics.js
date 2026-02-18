/**
 * CFOAnalytics.js
 * Sprint 5 Task 5.1: Cash Flow Waterfall Analysis Module
 *
 * Features:
 * - T_CFO (1,264 companies) Cash Flow data analysis
 * - Company-specific CFO trend analysis (FY-4 to FY+3)
 * - Cash Conversion Cycle (CCC) analysis
 * - Operating Profit Margin (OPM) and ROE metrics
 * - Sector-level CFO aggregation and comparison
 * - Interactive Chart.js waterfall visualization
 * - Cash Flow health scoring system
 */

class CFOAnalytics {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.cfoData = null;
        this.initialized = false;
    }

    /**
     * Initialize: Load CFO data from integrated JSON
     */
    async initialize() {
        console.log('[CFOAnalytics] Initializing...');

        try {
            const integratedData = await this.loadIntegratedData();

            if (!integratedData?.data?.technical?.T_CFO) {
                console.warn('[CFOAnalytics] T_CFO data not found');
                return false;
            }

            this.cfoData = integratedData.data.technical.T_CFO;

            // Enrich with existing company data
            this.enrichCFOData();

            this.initialized = true;
            console.log(`[CFOAnalytics] Initialization complete: ${this.cfoData.length} companies`);
            return true;

        } catch (error) {
            console.error('[CFOAnalytics] Initialization failed:', error);
            return false;
        }
    }

    /**
     * Load integrated JSON data
     */
    async loadIntegratedData() {
        const response = await fetch('./data/global_scouter_integrated.json');
        if (!response.ok) {
            throw new Error(`Failed to load integrated data: ${response.status}`);
        }
        return await response.json();
    }

    /**
     * Enrich CFO data with existing company data
     */
    enrichCFOData() {
        if (!this.dataManager?.companies) {
            console.warn('[CFOAnalytics] DataManager companies not available');
            return;
        }

        // Match by Ticker
        const companyMap = new Map(
            this.dataManager.companies.map(c => [c.Ticker, c])
        );

        this.cfoData = this.cfoData.map(cfo => {
            const company = companyMap.get(cfo.Ticker);
            return {
                ...cfo,
                corpName: company?.corpName || cfo.Corp,
                price: company?.Price || cfo['현재가'],
                marketCap: company?.['(USD mn)'] || cfo['(USD mn)']
            };
        });
    }

    /**
     * Get full CFO data for a specific company
     * @param {string} ticker - Stock ticker symbol
     * @returns {Object} Complete CFO data including all fiscal years
     */
    getCompanyCFO(ticker) {
        if (!this.initialized || !this.cfoData) {
            return null;
        }

        const cfo = this.cfoData.find(c => c.Ticker === ticker);
        if (!cfo) {
            return null;
        }

        return {
            ticker: cfo.Ticker,
            corp: cfo.Corp,
            exchange: cfo.Exchange,
            sector: cfo.WI26,

            // Cash Flow time series (FY-4 to FY+3)
            fy_minus_4: this.parseCashFlow(cfo['FY-4']),
            fy_minus_3: this.parseCashFlow(cfo['FY-3']),
            fy_minus_2: this.parseCashFlow(cfo['FY-2']),
            fy_minus_1: this.parseCashFlow(cfo['FY-1']),
            fy_0: this.parseCashFlow(cfo['FY 0']),
            fy_plus_1: this.parseCashFlow(cfo['FY+1']),
            fy_plus_2: this.parseCashFlow(cfo['FY+2']),
            fy_plus_3: this.parseCashFlow(cfo['FY+3']),

            // Key metrics
            ccc: this.parseCashFlow(cfo['CCC (FY 0)']),
            opm_fwd: this.parseCashFlow(cfo['OPM (Fwd)']),
            roe_fwd: this.parseCashFlow(cfo['ROE (Fwd)']),

            // Valuation
            marketCap: cfo['(USD mn)'],
            price: cfo['현재가']
        };
    }

    /**
     * Parse cash flow value (handles various formats)
     * @param {*} value - Raw cash flow value
     * @returns {number|null} Parsed cash flow number
     */
    parseCashFlow(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const num = parseFloat(value);
        if (isNaN(num)) {
            return null;
        }
        return num;
    }

    /**
     * Get cash flow trend with growth rates
     * @param {string} ticker - Stock ticker symbol
     * @returns {Object} Time series data with growth rates
     */
    getCashFlowTrend(ticker) {
        const cfo = this.getCompanyCFO(ticker);
        if (!cfo) {
            return null;
        }

        const timeSeries = [
            { period: 'FY-4', value: cfo.fy_minus_4 },
            { period: 'FY-3', value: cfo.fy_minus_3 },
            { period: 'FY-2', value: cfo.fy_minus_2 },
            { period: 'FY-1', value: cfo.fy_minus_1 },
            { period: 'FY 0', value: cfo.fy_0 },
            { period: 'FY+1', value: cfo.fy_plus_1 },
            { period: 'FY+2', value: cfo.fy_plus_2 },
            { period: 'FY+3', value: cfo.fy_plus_3 }
        ];

        // Calculate growth rates
        const withGrowth = timeSeries.map((item, index) => {
            if (index === 0 || item.value === null) {
                return { ...item, growthRate: null };
            }
            const prevValue = timeSeries[index - 1].value;
            if (prevValue === null || prevValue === 0) {
                return { ...item, growthRate: null };
            }
            const growthRate = ((item.value - prevValue) / Math.abs(prevValue)) * 100;
            return { ...item, growthRate };
        });

        return {
            ticker: cfo.ticker,
            corp: cfo.corp,
            timeSeries: withGrowth,
            avgGrowthRate: this.calculateAvgGrowth(withGrowth)
        };
    }

    /**
     * Calculate average growth rate from time series
     */
    calculateAvgGrowth(timeSeries) {
        const growthRates = timeSeries
            .map(t => t.growthRate)
            .filter(g => g !== null && isFinite(g));

        if (growthRates.length === 0) return null;

        return this.average(growthRates);
    }

    /**
     * Get Free Cash Flow estimates
     * @param {string} ticker - Stock ticker symbol
     * @returns {Object} FCF analysis
     */
    getFreeCashFlow(ticker) {
        const cfo = this.getCompanyCFO(ticker);
        if (!cfo) {
            return null;
        }

        // FCF approximation: use operating cash flow as proxy
        // In real scenario: FCF = Operating Cash Flow - CapEx
        return {
            ticker: cfo.ticker,
            corp: cfo.corp,
            fcf_current: cfo.fy_0,
            fcf_forecast_1y: cfo.fy_plus_1,
            fcf_forecast_2y: cfo.fy_plus_2,
            fcf_forecast_3y: cfo.fy_plus_3,
            fcf_trend: cfo.fy_plus_1 > cfo.fy_0 ? 'improving' : 'declining',
            fcf_positive: cfo.fy_0 !== null && cfo.fy_0 > 0
        };
    }

    /**
     * Get Cash Conversion Cycle analysis
     * @param {string} ticker - Stock ticker symbol
     * @returns {Object} CCC interpretation
     */
    getCashConversionCycle(ticker) {
        const cfo = this.getCompanyCFO(ticker);
        if (!cfo) {
            return null;
        }

        const ccc = cfo.ccc;
        if (ccc === null) {
            return {
                ticker: cfo.ticker,
                corp: cfo.corp,
                ccc: null,
                interpretation: 'Data not available'
            };
        }

        let interpretation;
        let rating;

        if (ccc < 0) {
            interpretation = 'Excellent: Negative CCC indicates company gets paid before paying suppliers';
            rating = 5;
        } else if (ccc < 30) {
            interpretation = 'Very Good: Efficient cash conversion cycle';
            rating = 4;
        } else if (ccc < 60) {
            interpretation = 'Good: Acceptable cash conversion cycle';
            rating = 3;
        } else if (ccc < 90) {
            interpretation = 'Fair: Room for improvement in cash conversion';
            rating = 2;
        } else {
            interpretation = 'Poor: Slow cash conversion, potential liquidity concerns';
            rating = 1;
        }

        return {
            ticker: cfo.ticker,
            corp: cfo.corp,
            ccc: ccc,
            interpretation: interpretation,
            rating: rating
        };
    }

    /**
     * Get sector CFO averages
     * @returns {Array} Sector-level aggregated CFO metrics
     */
    getSectorCFOAverages() {
        if (!this.initialized || !this.cfoData) {
            return [];
        }

        const sectorMap = new Map();

        this.cfoData.forEach(cfo => {
            const sector = cfo.WI26 || 'Unknown';

            if (!sectorMap.has(sector)) {
                sectorMap.set(sector, {
                    sector,
                    count: 0,
                    cfo_fy0: [],
                    cfo_fy_plus_1: [],
                    ccc: [],
                    opm_fwd: [],
                    roe_fwd: []
                });
            }

            const data = sectorMap.get(sector);
            data.count++;

            const cfoFy0 = this.parseCashFlow(cfo['FY 0']);
            const cfoFyPlus1 = this.parseCashFlow(cfo['FY+1']);
            const ccc = this.parseCashFlow(cfo['CCC (FY 0)']);
            const opmFwd = this.parseCashFlow(cfo['OPM (Fwd)']);
            const roeFwd = this.parseCashFlow(cfo['ROE (Fwd)']);

            if (cfoFy0 !== null) data.cfo_fy0.push(cfoFy0);
            if (cfoFyPlus1 !== null) data.cfo_fy_plus_1.push(cfoFyPlus1);
            if (ccc !== null) data.ccc.push(ccc);
            if (opmFwd !== null) data.opm_fwd.push(opmFwd);
            if (roeFwd !== null) data.roe_fwd.push(roeFwd);
        });

        // Calculate averages
        const results = [];
        sectorMap.forEach((data, sector) => {
            results.push({
                sector,
                count: data.count,
                cfo_fy0_avg: this.average(data.cfo_fy0),
                cfo_fy_plus_1_avg: this.average(data.cfo_fy_plus_1),
                ccc_avg: this.average(data.ccc),
                opm_fwd_avg: this.average(data.opm_fwd),
                roe_fwd_avg: this.average(data.roe_fwd)
            });
        });

        // Sort by company count
        return results.sort((a, b) => b.count - a.count);
    }

    /**
     * Average calculation utility
     */
    average(arr) {
        if (!arr || arr.length === 0) return null;
        const sum = arr.reduce((acc, val) => acc + val, 0);
        return sum / arr.length;
    }

    /**
     * Median calculation utility
     */
    median(arr) {
        if (!arr || arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    /**
     * Percentile calculation utility
     */
    percentile(arr, p) {
        if (!arr || arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const index = (p / 100) * (sorted.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        const weight = index % 1;

        if (lower === upper) {
            return sorted[lower];
        }
        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    }

    /**
     * Get high cash flow companies
     * @param {number} threshold - CFO threshold (USD million)
     * @param {string} metric - Metric to filter by (FY 0, FY+1, etc.)
     * @returns {Array} List of high CFO companies
     */
    getHighCashFlowCompanies(threshold = 1000, metric = 'FY 0') {
        if (!this.initialized || !this.cfoData) {
            return [];
        }

        return this.cfoData
            .filter(cfo => {
                const value = this.parseCashFlow(cfo[metric]);
                return value !== null && value >= threshold;
            })
            .map(cfo => ({
                ticker: cfo.Ticker,
                corp: cfo.Corp,
                sector: cfo.WI26,
                cfoValue: this.parseCashFlow(cfo[metric]),
                marketCap: cfo['(USD mn)'],
                ccc: this.parseCashFlow(cfo['CCC (FY 0)'])
            }))
            .sort((a, b) => b.cfoValue - a.cfoValue);
    }

    /**
     * Calculate CFO health score (0-100)
     * @param {string} ticker - Stock ticker symbol
     * @returns {Object} Health score breakdown
     */
    getCFOHealthScore(ticker) {
        const cfo = this.getCompanyCFO(ticker);
        if (!cfo) {
            return null;
        }

        let score = 0;
        const breakdown = {};

        // Component 1: Positive Free Cash Flow (30 points)
        if (cfo.fy_0 !== null && cfo.fy_0 > 0) {
            score += 30;
            breakdown.fcf_positive = { score: 30, status: 'positive' };
        } else {
            breakdown.fcf_positive = { score: 0, status: 'negative' };
        }

        // Component 2: CCC Score (25 points)
        if (cfo.ccc !== null) {
            if (cfo.ccc < 0) {
                score += 25;
                breakdown.ccc = { score: 25, rating: 'excellent' };
            } else if (cfo.ccc < 30) {
                score += 20;
                breakdown.ccc = { score: 20, rating: 'very_good' };
            } else if (cfo.ccc < 60) {
                score += 15;
                breakdown.ccc = { score: 15, rating: 'good' };
            } else if (cfo.ccc < 90) {
                score += 10;
                breakdown.ccc = { score: 10, rating: 'fair' };
            } else {
                score += 5;
                breakdown.ccc = { score: 5, rating: 'poor' };
            }
        } else {
            breakdown.ccc = { score: 0, rating: 'unknown' };
        }

        // Component 3: OPM Score (25 points)
        if (cfo.opm_fwd !== null) {
            const opmPercent = cfo.opm_fwd * 100;
            if (opmPercent >= 30) {
                score += 25;
                breakdown.opm = { score: 25, rating: 'excellent' };
            } else if (opmPercent >= 20) {
                score += 20;
                breakdown.opm = { score: 20, rating: 'very_good' };
            } else if (opmPercent >= 10) {
                score += 15;
                breakdown.opm = { score: 15, rating: 'good' };
            } else if (opmPercent >= 5) {
                score += 10;
                breakdown.opm = { score: 10, rating: 'fair' };
            } else {
                score += 5;
                breakdown.opm = { score: 5, rating: 'poor' };
            }
        } else {
            breakdown.opm = { score: 0, rating: 'unknown' };
        }

        // Component 4: CFO Growth (20 points)
        const trend = this.getCashFlowTrend(ticker);
        if (trend && trend.avgGrowthRate !== null) {
            if (trend.avgGrowthRate >= 20) {
                score += 20;
                breakdown.growth = { score: 20, rating: 'excellent' };
            } else if (trend.avgGrowthRate >= 10) {
                score += 15;
                breakdown.growth = { score: 15, rating: 'very_good' };
            } else if (trend.avgGrowthRate >= 5) {
                score += 10;
                breakdown.growth = { score: 10, rating: 'good' };
            } else if (trend.avgGrowthRate >= 0) {
                score += 5;
                breakdown.growth = { score: 5, rating: 'fair' };
            } else {
                score += 0;
                breakdown.growth = { score: 0, rating: 'declining' };
            }
        } else {
            breakdown.growth = { score: 0, rating: 'unknown' };
        }

        return {
            ticker: cfo.ticker,
            corp: cfo.corp,
            totalScore: score,
            breakdown: breakdown,
            grade: this.getGrade(score),
            recommendation: this.getRecommendation(score)
        };
    }

    /**
     * Get letter grade from score
     */
    getGrade(score) {
        if (score >= 90) return 'A+';
        if (score >= 80) return 'A';
        if (score >= 70) return 'B+';
        if (score >= 60) return 'B';
        if (score >= 50) return 'C';
        return 'D';
    }

    /**
     * Get recommendation from score
     */
    getRecommendation(score) {
        if (score >= 80) return 'Strong cash flow position, excellent financial health';
        if (score >= 60) return 'Good cash flow management, monitor growth trends';
        if (score >= 40) return 'Adequate cash flow, room for improvement';
        return 'Weak cash flow position, requires attention';
    }

    /**
     * Get CFO waterfall chart data for Chart.js
     * @param {string} ticker - Stock ticker symbol
     * @returns {Object} Chart.js waterfall data
     */
    getCFOWaterfallData(ticker) {
        const trend = this.getCashFlowTrend(ticker);
        if (!trend) {
            return null;
        }

        const labels = trend.timeSeries.map(t => t.period);
        const values = trend.timeSeries.map(t => t.value);

        // Waterfall colors: green for positive changes, red for negative
        const colors = trend.timeSeries.map((item, index) => {
            if (index === 0) return 'rgba(54, 162, 235, 0.6)';
            if (item.growthRate === null) return 'rgba(201, 203, 207, 0.6)';
            return item.growthRate >= 0
                ? 'rgba(75, 192, 192, 0.6)'
                : 'rgba(255, 99, 132, 0.6)';
        });

        return {
            labels: labels,
            datasets: [{
                label: `${trend.corp} Cash Flow (USD Million)`,
                data: values,
                backgroundColor: colors,
                borderColor: colors.map(c => c.replace('0.6', '1')),
                borderWidth: 2
            }]
        };
    }

    /**
     * Get sector CFO heatmap data for Chart.js
     * @returns {Array} Heatmap data structure
     */
    getSectorCFOHeatmapData() {
        const sectors = this.getSectorCFOAverages();

        return sectors.map(sector => ({
            sector: sector.sector,
            cfo: sector.cfo_fy0_avg || 0,
            ccc: sector.ccc_avg || 0,
            opm: sector.opm_fwd_avg ? sector.opm_fwd_avg * 100 : 0,
            count: sector.count
        }));
    }

    /**
     * Get CFO vs ROE scatter plot data
     * @param {number} topN - Top N companies to include
     * @returns {Object} Chart.js scatter data
     */
    getCFOvsROEScatterData(topN = 100) {
        if (!this.initialized || !this.cfoData) {
            return null;
        }

        const validData = this.cfoData
            .map(cfo => ({
                ticker: cfo.Ticker,
                corp: cfo.Corp,
                cfo_fy0: this.parseCashFlow(cfo['FY 0']),
                roe: this.parseCashFlow(cfo['ROE (Fwd)']),
                marketCap: this.parseCashFlow(cfo['(USD mn)'])
            }))
            .filter(d => d.cfo_fy0 !== null && d.roe !== null && d.marketCap !== null)
            .sort((a, b) => b.marketCap - a.marketCap)
            .slice(0, topN);

        return {
            datasets: [{
                label: 'CFO vs ROE (Fwd)',
                data: validData.map(d => ({
                    x: d.cfo_fy0,
                    y: d.roe * 100,
                    r: Math.sqrt(d.marketCap) / 50,
                    label: d.corp
                })),
                backgroundColor: 'rgba(153, 102, 255, 0.6)',
                borderColor: 'rgba(153, 102, 255, 1)',
                borderWidth: 1
            }]
        };
    }

    /**
     * Generate CFO summary HTML (DOMPurify-safe)
     * @param {string} ticker - Stock ticker symbol
     * @returns {string} HTML summary
     */
    getCFOSummaryHTML(ticker) {
        const cfo = this.getCompanyCFO(ticker);
        if (!cfo) {
            return '<p class="text-muted">CFO data not available</p>';
        }

        const healthScore = this.getCFOHealthScore(ticker);
        const cccAnalysis = this.getCashConversionCycle(ticker);

        const formatCFO = (value) => {
            if (value === null) return 'N/A';
            return `$${(value / 1000).toFixed(1)}B`;
        };

        const formatPercent = (value) => {
            if (value === null) return 'N/A';
            return `${(value * 100).toFixed(2)}%`;
        };

        const formatDays = (value) => {
            if (value === null) return 'N/A';
            return `${value.toFixed(1)} days`;
        };

        const html = `
            <div class="cfo-summary">
                <h6 class="mb-2">💰 Cash Flow Analysis - ${cfo.corp}</h6>
                <div class="row">
                    <div class="col-md-4">
                        <strong>Current Cash Flow</strong>
                        <p>FY 0: ${formatCFO(cfo.fy_0)}</p>
                        <p>FY+1 (Est): ${formatCFO(cfo.fy_plus_1)}</p>
                        <p>FY+2 (Est): ${formatCFO(cfo.fy_plus_2)}</p>
                    </div>
                    <div class="col-md-4">
                        <strong>Key Metrics</strong>
                        <p>CCC: ${formatDays(cfo.ccc)}</p>
                        <p>OPM (Fwd): ${formatPercent(cfo.opm_fwd)}</p>
                        <p>ROE (Fwd): ${formatPercent(cfo.roe_fwd)}</p>
                    </div>
                    <div class="col-md-4">
                        <strong>Health Score</strong>
                        <p>Score: ${healthScore.totalScore}/100 (${healthScore.grade})</p>
                        <p>CCC Rating: ${cccAnalysis.rating}/5 stars</p>
                        <p>${healthScore.recommendation}</p>
                    </div>
                </div>
                <div class="mt-2">
                    <small class="text-muted">Sector: ${cfo.sector} | Market Cap: $${cfo.marketCap ? (cfo.marketCap / 1000).toFixed(1) : 'N/A'}B</small>
                </div>
            </div>
        `;

        // DOMPurify sanitization if available
        if (typeof DOMPurify !== 'undefined') {
            return DOMPurify.sanitize(html);
        }
        return html;
    }

    /**
     * Compare CFO across multiple companies
     * @param {Array<string>} tickers - Array of ticker symbols
     * @returns {Array} Comparative CFO analysis
     */
    compareCFO(tickers) {
        if (!this.initialized || !this.cfoData) {
            return [];
        }

        return tickers
            .map(ticker => {
                const cfo = this.getCompanyCFO(ticker);
                if (!cfo) return null;

                const healthScore = this.getCFOHealthScore(ticker);

                return {
                    ticker: cfo.ticker,
                    corp: cfo.corp,
                    cfo_fy0: cfo.fy_0,
                    cfo_fy_plus_1: cfo.fy_plus_1,
                    ccc: cfo.ccc,
                    opm_fwd: cfo.opm_fwd,
                    roe_fwd: cfo.roe_fwd,
                    healthScore: healthScore.totalScore,
                    grade: healthScore.grade
                };
            })
            .filter(c => c !== null)
            .sort((a, b) => b.healthScore - a.healthScore);
    }
}

// Export for use in stock_analyzer_enhanced.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CFOAnalytics;
}
