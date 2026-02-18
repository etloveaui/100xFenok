/**
 * IndustryCostAnalytics
 *
 * Module 6: Sprint 4 Phase 1 - Industry Cost Structure Analysis
 *
 * Purpose: Analyze industry-specific cost structures and peer benchmarking
 * Data Source: A_Compare.json (104 valid companies, 68 fields)
 *
 * Key Features:
 * - Industry cost structure comparison (5Y AVG metrics)
 * - Revenue growth analysis (F-4 to F+3, 8 years)
 * - Peer benchmarking (ROE, OPM, margins)
 * - Valuation evolution tracking (PER 3Y/5Y/10Y → Current)
 *
 * Performance:
 * - O(1) ticker lookup via Map
 * - O(1) industry group access via Map
 * - O(n) filtering (n = 104, very fast)
 *
 * @author Claude Code (Sonnet 4.5)
 * @version 1.0.0
 * @created 2025-10-19
 */

class IndustryCostAnalytics {
    constructor() {
        this.data = null;
        this.validCompanies = [];
        this.companyMap = new Map();
        this.industryGroups = new Map();
        this.metadata = null;
        this.initialized = false;
        this.loadStartTime = null;
    }

    /**
     * Load and process A_Compare.json data
     * Filters to 104 valid companies and builds indexes
     *
     * @param {string} jsonPath - Path to A_Compare.json
     * @returns {Promise<boolean>} - Success status
     */
    async loadFromJSON(jsonPath = 'data/A_Compare.json') {
        try {
            this.loadStartTime = Date.now();

            const response = await fetch(jsonPath);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const jsonData = await response.json();
            const rawData = jsonData.data || jsonData;

            // Filter to valid companies (>10 non-null fields)
            this.validCompanies = rawData.filter(company => this.isValidCompany(company));

            this.data = this.validCompanies;
            this.metadata = {
                totalRecords: rawData.length,
                validRecords: this.validCompanies.length,
                filterRatio: (this.validCompanies.length / rawData.length * 100).toFixed(1) + '%',
                loadTime: Date.now() - this.loadStartTime
            };

            // Build indexes
            this.buildIndexes();

            this.initialized = true;
            console.log(`✅ IndustryCostAnalytics loaded: ${this.validCompanies.length} valid companies (${this.metadata.filterRatio} of total)`);

            return true;
        } catch (error) {
            console.error('❌ Failed to load IndustryCostAnalytics:', error);
            this.initialized = false;
            return false;
        }
    }

    /**
     * Check if company has sufficient data
     *
     * @param {Object} company - Company object
     * @returns {boolean} - True if valid (has Ticker and >10 non-null fields)
     */
    isValidCompany(company) {
        // Must have a valid Ticker for unique identification
        if (!company.Ticker || company.Ticker === 'None') {
            return false;
        }

        const nonNullCount = Object.values(company)
            .filter(v => v !== null && v !== undefined && v !== '')
            .length;
        return nonNullCount > 10;
    }

    /**
     * Build O(1) lookup indexes
     * - companyMap: ticker → company
     * - industryGroups: industry → companies[]
     */
    buildIndexes() {
        // Clear existing indexes
        this.companyMap.clear();
        this.industryGroups.clear();

        this.validCompanies.forEach(company => {
            // Ticker map (O(1) lookup)
            const ticker = company.Ticker;
            if (ticker) {
                this.companyMap.set(ticker, company);
            }

            // Industry groups
            const industry = company.WI26;
            if (industry) {
                if (!this.industryGroups.has(industry)) {
                    this.industryGroups.set(industry, []);
                }
                this.industryGroups.get(industry).push(company);
            }
        });

        console.log(`📊 Indexes built: ${this.companyMap.size} companies, ${this.industryGroups.size} industries`);
    }

    /**
     * Get company by ticker (O(1))
     *
     * @param {string} ticker - Stock ticker
     * @returns {Object|null} - Company object or null
     */
    getCompanyByTicker(ticker) {
        if (!ticker) return null;
        return this.companyMap.get(ticker) || null;
    }

    /**
     * Calculate industry average for a specific metric
     *
     * @param {string} industry - Industry name (WI26)
     * @param {string} metric - Field name
     * @returns {number|null} - Average value or null
     */
    getIndustryAverage(industry, metric) {
        const companies = this.industryGroups.get(industry);
        if (!companies || companies.length === 0) return null;

        const values = companies
            .map(c => this.parseNumber(c[metric]))
            .filter(v => v !== null);

        if (values.length === 0) return null;

        const sum = values.reduce((a, b) => a + b, 0);
        return sum / values.length;
    }

    /**
     * Compare company to industry averages
     *
     * @param {string} ticker - Stock ticker
     * @param {string[]} metrics - Array of metric field names
     * @returns {Object|null} - Comparison object or null
     */
    compareToIndustry(ticker, metrics = ['ROE (Fwd)', 'OPM (Fwd)', '5Y AVG']) {
        const company = this.getCompanyByTicker(ticker);
        if (!company) return null;

        const industry = company.WI26;
        if (!industry) return null;

        const comparison = {
            ticker,
            corp: company.Corp,
            industry,
            metrics: {}
        };

        metrics.forEach(metric => {
            const companyValue = this.parseNumber(company[metric]);
            const industryAvg = this.getIndustryAverage(industry, metric);

            if (companyValue !== null && industryAvg !== null) {
                comparison.metrics[metric] = {
                    company: companyValue,
                    industry: industryAvg,
                    difference: companyValue - industryAvg,
                    percentDiff: ((companyValue - industryAvg) / industryAvg) * 100
                };
            }
        });

        return comparison;
    }

    /**
     * Calculate revenue growth trend (F-4 to F+3)
     *
     * @param {string} ticker - Stock ticker
     * @returns {Object|null} - Revenue trend analysis or null
     */
    calculateRevenueTrend(ticker) {
        const company = this.getCompanyByTicker(ticker);
        if (!company) return null;

        const forecasts = {
            fMinus4: this.parseNumber(company['F-4']),
            fMinus3: this.parseNumber(company['F-3']),
            fMinus2: this.parseNumber(company['F-2']),
            fMinus1: this.parseNumber(company['F-1']),
            f0: this.parseNumber(company['F0']),
            fPlus1: this.parseNumber(company['F+1']),
            fPlus2: this.parseNumber(company['F+2']),
            fPlus3: this.parseNumber(company['F+3'])
        };

        // Check if we have minimum required data
        if (!forecasts.fMinus4 || !forecasts.f0 || !forecasts.fPlus3) {
            return null;
        }

        // Historical CAGR (F-4 to F0, 4 years)
        const historicalCAGR = Math.pow(forecasts.f0 / forecasts.fMinus4, 1/4) - 1;

        // Forward CAGR (F0 to F+3, 3 years)
        const forwardCAGR = Math.pow(forecasts.fPlus3 / forecasts.f0, 1/3) - 1;

        // Growth trend (acceleration/deceleration)
        const growthTrend = forwardCAGR - historicalCAGR;

        // Trajectory classification
        let trajectory;
        if (growthTrend < -0.1) trajectory = 'decelerating';
        else if (growthTrend > 0.1) trajectory = 'accelerating';
        else trajectory = 'stable';

        return {
            ticker,
            corp: company.Corp,
            forecasts,
            historicalCAGR,
            forwardCAGR,
            growthTrend,
            trajectory,
            revenue: {
                current: forecasts.f0,
                historical: forecasts.fMinus4,
                forward: forecasts.fPlus3,
                historicalGrowth: forecasts.f0 - forecasts.fMinus4,
                forwardGrowth: forecasts.fPlus3 - forecasts.f0
            }
        };
    }

    /**
     * Get peer comparison analysis
     *
     * @param {string} ticker - Stock ticker
     * @returns {Object|null} - Peer analysis or null
     */
    getPeerComparison(ticker) {
        const company = this.getCompanyByTicker(ticker);
        if (!company) return null;

        // Extract peer tickers (numeric field names = peer IDs)
        const peerFields = Object.keys(company).filter(k =>
            !isNaN(k) && k.indexOf('.') === -1  // Pure integers only
        );

        const peerTickers = peerFields
            .map(field => company[field])
            .filter(t => t && typeof t === 'string' && t !== ticker);

        // Get peer data
        const peers = peerTickers
            .map(t => this.getCompanyByTicker(t))
            .filter(Boolean);

        if (peers.length === 0) {
            return {
                ticker,
                corp: company.Corp,
                peerCount: 0,
                peers: []
            };
        }

        // Calculate peer averages
        const metrics = ['ROE (Fwd)', 'OPM (Fwd)', 'PER (Oct-25)', '5Y AVG'];
        const peerAverages = {};

        metrics.forEach(metric => {
            const values = peers
                .map(p => this.parseNumber(p[metric]))
                .filter(v => v !== null);

            if (values.length > 0) {
                peerAverages[metric] = values.reduce((a, b) => a + b, 0) / values.length;
            }
        });

        // Compare company to peer average
        const comparison = {};
        Object.keys(peerAverages).forEach(metric => {
            const companyValue = this.parseNumber(company[metric]);
            const peerAvg = peerAverages[metric];

            if (companyValue !== null) {
                comparison[metric] = {
                    company: companyValue,
                    peerAvg,
                    difference: companyValue - peerAvg,
                    percentDiff: ((companyValue - peerAvg) / peerAvg) * 100,
                    abovePeers: companyValue > peerAvg
                };
            }
        });

        return {
            ticker,
            corp: company.Corp,
            peerCount: peers.length,
            peerTickers,
            peerAverages,
            comparison,
            peers: peers.map(p => ({
                ticker: p.Ticker,
                corp: p.Corp,
                roe: this.parseNumber(p['ROE (Fwd)']),
                opm: this.parseNumber(p['OPM (Fwd)'])
            }))
        };
    }

    /**
     * Get complete company summary
     *
     * @param {string} ticker - Stock ticker
     * @returns {Object|null} - Complete summary or null
     */
    getCompanySummary(ticker) {
        const company = this.getCompanyByTicker(ticker);
        if (!company) return null;

        return {
            ticker,
            corp: company.Corp,
            exchange: company.Exchange,
            industry: company.WI26,

            // Financial ratios
            roe: this.parseNumber(company['ROE (Fwd)']),
            opm: this.parseNumber(company['OPM (Fwd)']),
            ccc: this.parseNumber(company['CCC (FY 0)']),

            // Valuation
            per: this.parseNumber(company['PER (Oct-25)']),
            pbr: this.parseNumber(company['PBR (Oct-25)']),
            peg: this.parseNumber(company['PEG (Oct-25)']),

            // Historical multiples
            per3Y: this.parseNumber(company['PER (3)']),
            per5Y: this.parseNumber(company['PER (5)']),
            per10Y: this.parseNumber(company['PER (10)']),

            // Cost structure (5Y AVG)
            costStructure: {
                grossMargin: this.parseNumber(company['5Y AVG']),
                opMargin: this.parseNumber(company['5Y AVG.1']),
                ebitdaMargin: this.parseNumber(company['5Y AVG.7'])
            },

            // Revenue trend
            revenueTrend: this.calculateRevenueTrend(ticker),

            // Industry comparison
            industryComparison: this.compareToIndustry(ticker),

            // Peer comparison
            peerComparison: this.getPeerComparison(ticker)
        };
    }

    /**
     * Get industry statistics
     *
     * @param {string} industry - Industry name
     * @returns {Object|null} - Industry stats or null
     */
    getIndustryStatistics(industry) {
        const companies = this.industryGroups.get(industry);
        if (!companies || companies.length === 0) return null;

        const metrics = ['ROE (Fwd)', 'OPM (Fwd)', 'PER (Oct-25)', '5Y AVG'];
        const stats = {
            industry,
            companyCount: companies.length,
            averages: {},
            medians: {},
            ranges: {}
        };

        metrics.forEach(metric => {
            const values = companies
                .map(c => this.parseNumber(c[metric]))
                .filter(v => v !== null)
                .sort((a, b) => a - b);

            if (values.length > 0) {
                stats.averages[metric] = values.reduce((a, b) => a + b, 0) / values.length;
                stats.medians[metric] = values[Math.floor(values.length / 2)];
                stats.ranges[metric] = {
                    min: values[0],
                    max: values[values.length - 1]
                };
            }
        });

        return stats;
    }

    /**
     * Get industry cost structure breakdown
     *
     * @param {string} industry - Industry name
     * @returns {Object|null} - Cost structure or null
     */
    getIndustryCostStructure(industry) {
        const companies = this.industryGroups.get(industry);
        if (!companies || companies.length === 0) return null;

        const costMetrics = {
            'grossMargin': '5Y AVG',
            'opMargin': '5Y AVG.1',
            'ebitdaMargin': '5Y AVG.7'
        };

        const structure = {
            industry,
            companyCount: companies.length,
            averages: {}
        };

        Object.entries(costMetrics).forEach(([name, field]) => {
            const values = companies
                .map(c => this.parseNumber(c[field]))
                .filter(v => v !== null);

            if (values.length > 0) {
                structure.averages[name] = values.reduce((a, b) => a + b, 0) / values.length;
            }
        });

        return structure;
    }

    /**
     * Compare multiple industries
     *
     * @param {string[]} industries - Array of industry names
     * @returns {Object[]} - Array of industry comparisons
     */
    compareIndustries(industries) {
        return industries
            .map(industry => this.getIndustryStatistics(industry))
            .filter(Boolean);
    }

    /**
     * Filter companies by metric range
     *
     * @param {string} metric - Field name
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @returns {Object[]} - Filtered companies
     */
    filterByMetric(metric, min, max) {
        return this.validCompanies.filter(c => {
            const value = this.parseNumber(c[metric]);
            return value !== null && value >= min && value <= max;
        });
    }

    /**
     * Get top performers by metric
     *
     * @param {string} metric - Field name
     * @param {number} limit - Number of results
     * @returns {Object[]} - Top performers
     */
    getTopPerformers(metric, limit = 10) {
        return this.validCompanies
            .map(c => ({
                ticker: c.Ticker,
                corp: c.Corp,
                industry: c.WI26,
                value: this.parseNumber(c[metric])
            }))
            .filter(c => c.value !== null)
            .sort((a, b) => b.value - a.value)
            .slice(0, limit);
    }

    /**
     * Get bottom performers by metric
     *
     * @param {string} metric - Field name
     * @param {number} limit - Number of results
     * @returns {Object[]} - Bottom performers
     */
    getBottomPerformers(metric, limit = 10) {
        return this.validCompanies
            .map(c => ({
                ticker: c.Ticker,
                corp: c.Corp,
                industry: c.WI26,
                value: this.parseNumber(c[metric])
            }))
            .filter(c => c.value !== null)
            .sort((a, b) => a.value - b.value)
            .slice(0, limit);
    }

    /**
     * Get market-wide statistics
     *
     * @returns {Object} - Market stats
     */
    getMarketStatistics() {
        const metrics = ['ROE (Fwd)', 'OPM (Fwd)', 'PER (Oct-25)', '5Y AVG'];
        const stats = {
            totalCompanies: this.validCompanies.length,
            industries: this.industryGroups.size,
            averages: {},
            medians: {}
        };

        metrics.forEach(metric => {
            const values = this.validCompanies
                .map(c => this.parseNumber(c[metric]))
                .filter(v => v !== null)
                .sort((a, b) => a - b);

            if (values.length > 0) {
                stats.averages[metric] = values.reduce((a, b) => a + b, 0) / values.length;
                stats.medians[metric] = values[Math.floor(values.length / 2)];
            }
        });

        return stats;
    }

    /**
     * Get valuation distribution
     *
     * @returns {Object} - Valuation distribution
     */
    getValuationDistribution() {
        const perValues = this.validCompanies
            .map(c => this.parseNumber(c['PER (Oct-25)']))
            .filter(v => v !== null);

        const buckets = {
            under10: perValues.filter(v => v < 10).length,
            range10to20: perValues.filter(v => v >= 10 && v < 20).length,
            range20to30: perValues.filter(v => v >= 20 && v < 30).length,
            range30to50: perValues.filter(v => v >= 30 && v < 50).length,
            over50: perValues.filter(v => v >= 50).length
        };

        return {
            total: perValues.length,
            buckets,
            percentages: {
                under10: (buckets.under10 / perValues.length * 100).toFixed(1) + '%',
                range10to20: (buckets.range10to20 / perValues.length * 100).toFixed(1) + '%',
                range20to30: (buckets.range20to30 / perValues.length * 100).toFixed(1) + '%',
                range30to50: (buckets.range30to50 / perValues.length * 100).toFixed(1) + '%',
                over50: (buckets.over50 / perValues.length * 100).toFixed(1) + '%'
            }
        };
    }

    /**
     * Identify outliers by metric
     *
     * @param {string} metric - Field name
     * @param {number} threshold - Standard deviations from mean
     * @returns {Object[]} - Outlier companies
     */
    identifyOutliers(metric, threshold = 2.0) {
        const values = this.validCompanies.map(c => ({
            ticker: c.Ticker,
            corp: c.Corp,
            value: this.parseNumber(c[metric])
        })).filter(c => c.value !== null);

        if (values.length < 3) return [];

        // Calculate mean and stddev
        const mean = values.reduce((sum, c) => sum + c.value, 0) / values.length;
        const variance = values.reduce((sum, c) => sum + Math.pow(c.value - mean, 2), 0) / values.length;
        const stddev = Math.sqrt(variance);

        // Find outliers (>threshold std devs from mean)
        return values
            .filter(c => Math.abs(c.value - mean) > threshold * stddev)
            .map(c => ({
                ...c,
                mean,
                stddev,
                zScore: (c.value - mean) / stddev,
                direction: c.value > mean ? 'high' : 'low'
            }))
            .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
    }

    /**
     * Parse number safely (handles null, strings, NaN, Infinity)
     *
     * @param {any} value - Value to parse
     * @returns {number|null} - Parsed number or null
     */
    parseNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const num = typeof value === 'number' ? value : parseFloat(value);
        return (isNaN(num) || !isFinite(num)) ? null : num;
    }
}
