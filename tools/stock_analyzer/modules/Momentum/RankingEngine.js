/**
 * RankingEngine - Company ranking and scoring system
 * Ranks companies based on various metrics and algorithms
 *
 * @module Momentum/RankingEngine
 * @version 1.0.0
 */

class RankingEngine {
    constructor(config = {}) {
        this.config = {
            percentileMethod: config.percentileMethod || 'inclusive', // inclusive, exclusive
            rankingMethods: config.rankingMethods || ['standard', 'percentile', 'zscore', 'decile'],
            tieBreaker: config.tieBreaker || 'marketCap', // Field to use for tie-breaking
            cacheResults: config.cacheResults !== false,
            maxCacheSize: config.maxCacheSize || 100
        };

        // Ranking cache
        this.cache = new Map();

        // Ranking algorithms
        this.algorithms = {
            standard: this.standardRank.bind(this),
            percentile: this.percentileRank.bind(this),
            zscore: this.zScoreRank.bind(this),
            decile: this.decileRank.bind(this),
            composite: this.compositeRank.bind(this),
            weighted: this.weightedRank.bind(this),
            relative: this.relativeRank.bind(this),
            categorical: this.categoricalRank.bind(this)
        };

        // Scoring methods
        this.scoringMethods = {
            linear: this.linearScore.bind(this),
            exponential: this.exponentialScore.bind(this),
            logarithmic: this.logarithmicScore.bind(this),
            sigmoid: this.sigmoidScore.bind(this)
        };

        console.log('✅ RankingEngine initialized');
    }

    /**
     * Rank companies by specified metric
     * @param {Array} companies - Array of company objects
     * @param {string|Array} metric - Metric field(s) to rank by
     * @param {Object} options - Ranking options
     * @returns {Array} Ranked companies with rank information
     */
    rank(companies, metric, options = {}) {
        if (!companies || companies.length === 0) {
            return [];
        }

        // Check cache
        const cacheKey = this.getCacheKey(companies, metric, options);
        if (this.config.cacheResults && this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        // Determine ranking method
        const method = options.method || 'standard';
        const algorithm = this.algorithms[method];

        if (!algorithm) {
            console.error(`Unknown ranking method: ${method}`);
            return companies;
        }

        // Perform ranking
        const ranked = algorithm(companies, metric, options);

        // Cache results
        if (this.config.cacheResults) {
            this.cacheResult(cacheKey, ranked);
        }

        return ranked;
    }

    /**
     * Standard ranking (1, 2, 3...)
     * @private
     */
    standardRank(companies, metric, options = {}) {
        const order = options.order || 'desc';
        const handleNulls = options.handleNulls || 'last';

        // Create copy with original index
        const indexed = companies.map((company, index) => ({
            ...company,
            _originalIndex: index,
            _value: this.getMetricValue(company, metric)
        }));

        // Separate null values
        const withValues = indexed.filter(c => c._value !== null && c._value !== undefined);
        const withoutValues = indexed.filter(c => c._value === null || c._value === undefined);

        // Sort companies with values
        withValues.sort((a, b) => {
            const comparison = this.compareValues(a._value, b._value);

            // Handle ties with tie-breaker
            if (comparison === 0 && this.config.tieBreaker) {
                const tieA = this.getMetricValue(a, this.config.tieBreaker);
                const tieB = this.getMetricValue(b, this.config.tieBreaker);
                return this.compareValues(tieA, tieB) * (order === 'desc' ? -1 : 1);
            }

            return comparison * (order === 'desc' ? -1 : 1);
        });

        // Assign ranks
        let currentRank = 1;
        for (let i = 0; i < withValues.length; i++) {
            if (i > 0 && withValues[i]._value !== withValues[i - 1]._value) {
                currentRank = i + 1;
            }
            withValues[i]._rank = currentRank;
            withValues[i]._rankMetric = metric;
            withValues[i]._rankPercentile = ((withValues.length - currentRank + 1) / withValues.length) * 100;
        }

        // Handle null values
        const nullRank = handleNulls === 'first' ? 0 : withValues.length + 1;
        withoutValues.forEach(company => {
            company._rank = nullRank;
            company._rankMetric = metric;
            company._rankPercentile = 0;
        });

        // Combine and sort by rank
        const allRanked = [...withValues, ...withoutValues];

        if (handleNulls === 'first') {
            allRanked.sort((a, b) => a._rank - b._rank);
        }

        // Clean up temporary fields
        allRanked.forEach(company => {
            delete company._originalIndex;
            delete company._value;
        });

        return allRanked;
    }

    /**
     * Percentile ranking (0-100)
     * @private
     */
    percentileRank(companies, metric, options = {}) {
        const order = options.order || 'desc';
        const method = options.percentileMethod || this.config.percentileMethod;

        // Get standard ranks first
        const ranked = this.standardRank(companies, metric, options);

        // Calculate percentiles
        const validCompanies = ranked.filter(c => c._rank && c._rank > 0);
        const totalValid = validCompanies.length;

        validCompanies.forEach(company => {
            let percentile;

            if (method === 'exclusive') {
                // Exclusive method: (rank - 1) / (n - 1) * 100
                percentile = totalValid > 1
                    ? ((company._rank - 1) / (totalValid - 1)) * 100
                    : 50;
            } else {
                // Inclusive method: rank / n * 100
                percentile = (company._rank / totalValid) * 100;
            }

            // Invert for descending order (higher value = higher percentile)
            if (order === 'desc') {
                percentile = 100 - percentile;
            }

            company._percentile = Math.round(percentile * 100) / 100;
        });

        return ranked;
    }

    /**
     * Z-score ranking (standard deviations from mean)
     * @private
     */
    zScoreRank(companies, metric, options = {}) {
        // Get metric values
        const values = companies
            .map(c => this.getMetricValue(c, metric))
            .filter(v => v !== null && v !== undefined && !isNaN(v));

        if (values.length === 0) {
            return companies;
        }

        // Calculate mean and standard deviation
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
        const stdDev = Math.sqrt(variance);

        // Calculate z-scores
        const result = companies.map(company => {
            const value = this.getMetricValue(company, metric);
            const zScore = value !== null && value !== undefined && stdDev > 0
                ? (value - mean) / stdDev
                : 0;

            return {
                ...company,
                _zScore: zScore,
                _zScoreMetric: metric,
                _zScoreCategory: this.categorizeZScore(zScore)
            };
        });

        // Sort by z-score
        result.sort((a, b) => b._zScore - a._zScore);

        // Assign ranks based on z-scores
        let currentRank = 1;
        for (let i = 0; i < result.length; i++) {
            if (i > 0 && Math.abs(result[i]._zScore - result[i - 1]._zScore) > 0.01) {
                currentRank = i + 1;
            }
            result[i]._rank = currentRank;
        }

        return result;
    }

    /**
     * Decile ranking (1-10)
     * @private
     */
    decileRank(companies, metric, options = {}) {
        // Get percentile ranks first
        const ranked = this.percentileRank(companies, metric, options);

        // Assign deciles
        ranked.forEach(company => {
            if (company._percentile !== undefined) {
                company._decile = Math.min(10, Math.max(1, Math.ceil(company._percentile / 10)));
            } else {
                company._decile = null;
            }
        });

        return ranked;
    }

    /**
     * Composite ranking (multiple metrics)
     * @private
     */
    compositeRank(companies, metrics, options = {}) {
        if (!Array.isArray(metrics)) {
            return this.standardRank(companies, metrics, options);
        }

        const weights = options.weights || metrics.map(() => 1 / metrics.length);

        // Get ranks for each metric
        const ranksByMetric = metrics.map(metric =>
            this.percentileRank([...companies], metric, options)
        );

        // Calculate composite scores
        const compositeScores = companies.map((company, index) => {
            let totalScore = 0;
            let totalWeight = 0;

            metrics.forEach((metric, metricIndex) => {
                const rankedCompany = ranksByMetric[metricIndex].find(
                    c => c.Ticker === company.Ticker
                );

                if (rankedCompany && rankedCompany._percentile !== undefined) {
                    totalScore += rankedCompany._percentile * weights[metricIndex];
                    totalWeight += weights[metricIndex];
                }
            });

            return {
                ...company,
                _compositeScore: totalWeight > 0 ? totalScore / totalWeight : 0,
                _compositeMetrics: metrics
            };
        });

        // Sort by composite score
        compositeScores.sort((a, b) => b._compositeScore - a._compositeScore);

        // Assign composite ranks
        let currentRank = 1;
        for (let i = 0; i < compositeScores.length; i++) {
            if (i > 0 && compositeScores[i]._compositeScore !== compositeScores[i - 1]._compositeScore) {
                currentRank = i + 1;
            }
            compositeScores[i]._compositeRank = currentRank;
        }

        return compositeScores;
    }

    /**
     * Weighted ranking
     * @private
     */
    weightedRank(companies, criteria, options = {}) {
        const weights = criteria.reduce((acc, c) => {
            acc[c.metric] = c.weight;
            return acc;
        }, {});

        const metrics = criteria.map(c => c.metric);

        return this.compositeRank(companies, metrics, { ...options, weights: Object.values(weights) });
    }

    /**
     * Relative ranking (vs benchmark)
     * @private
     */
    relativeRank(companies, metric, options = {}) {
        const benchmark = options.benchmark || 0;
        const benchmarkType = options.benchmarkType || 'value'; // value, mean, median, percentile

        // Calculate benchmark value
        let benchmarkValue = benchmark;

        if (benchmarkType === 'mean') {
            const values = companies
                .map(c => this.getMetricValue(c, metric))
                .filter(v => v !== null && v !== undefined);
            benchmarkValue = values.reduce((a, b) => a + b, 0) / values.length;
        } else if (benchmarkType === 'median') {
            const values = companies
                .map(c => this.getMetricValue(c, metric))
                .filter(v => v !== null && v !== undefined)
                .sort((a, b) => a - b);
            benchmarkValue = values[Math.floor(values.length / 2)];
        } else if (benchmarkType === 'percentile') {
            const percentileRank = options.benchmarkPercentile || 50;
            const values = companies
                .map(c => this.getMetricValue(c, metric))
                .filter(v => v !== null && v !== undefined)
                .sort((a, b) => a - b);
            const index = Math.floor((percentileRank / 100) * values.length);
            benchmarkValue = values[index];
        }

        // Calculate relative values
        const result = companies.map(company => {
            const value = this.getMetricValue(company, metric);
            const relativeValue = value !== null && value !== undefined
                ? value - benchmarkValue
                : null;

            return {
                ...company,
                _relativeValue: relativeValue,
                _relativeToBenchmark: benchmarkValue,
                _outperformance: relativeValue !== null ? relativeValue > 0 : false
            };
        });

        // Sort by relative value
        result.sort((a, b) => {
            if (a._relativeValue === null) return 1;
            if (b._relativeValue === null) return -1;
            return b._relativeValue - a._relativeValue;
        });

        // Assign ranks
        let currentRank = 1;
        for (let i = 0; i < result.length; i++) {
            if (i > 0 && result[i]._relativeValue !== result[i - 1]._relativeValue) {
                currentRank = i + 1;
            }
            result[i]._relativeRank = currentRank;
        }

        return result;
    }

    /**
     * Categorical ranking (by groups)
     * @private
     */
    categoricalRank(companies, metric, options = {}) {
        const categoryField = options.categoryField || 'sector';
        const categories = {};

        // Group by category
        companies.forEach(company => {
            const category = company[categoryField] || 'Unknown';
            if (!categories[category]) {
                categories[category] = [];
            }
            categories[category].push(company);
        });

        // Rank within each category
        const rankedByCategory = {};
        for (const [category, categoryCompanies] of Object.entries(categories)) {
            rankedByCategory[category] = this.standardRank(categoryCompanies, metric, options);
        }

        // Combine results
        const result = [];
        for (const [category, rankedCompanies] of Object.entries(rankedByCategory)) {
            rankedCompanies.forEach(company => {
                result.push({
                    ...company,
                    _category: category,
                    _categoryRank: company._rank,
                    _categoryPercentile: company._rankPercentile
                });
            });
        }

        // Calculate overall rank
        result.sort((a, b) => {
            const aValue = this.getMetricValue(a, metric);
            const bValue = this.getMetricValue(b, metric);
            return this.compareValues(bValue, aValue);
        });

        let currentRank = 1;
        for (let i = 0; i < result.length; i++) {
            if (i > 0) {
                const currValue = this.getMetricValue(result[i], metric);
                const prevValue = this.getMetricValue(result[i - 1], metric);
                if (currValue !== prevValue) {
                    currentRank = i + 1;
                }
            }
            result[i]._overallRank = currentRank;
        }

        return result;
    }

    /**
     * Calculate ranking score
     * @param {Array} companies - Ranked companies
     * @param {string} method - Scoring method
     * @returns {Array} Companies with scores
     */
    score(companies, method = 'linear') {
        const scorer = this.scoringMethods[method];

        if (!scorer) {
            console.error(`Unknown scoring method: ${method}`);
            return companies;
        }

        return companies.map(company => ({
            ...company,
            _score: scorer(company._rank, companies.length)
        }));
    }

    /**
     * Linear scoring
     * @private
     */
    linearScore(rank, total) {
        if (!rank || rank <= 0) return 0;
        return Math.max(0, (total - rank + 1) / total) * 100;
    }

    /**
     * Exponential scoring
     * @private
     */
    exponentialScore(rank, total) {
        if (!rank || rank <= 0) return 0;
        const normalized = (total - rank + 1) / total;
        return Math.pow(normalized, 2) * 100;
    }

    /**
     * Logarithmic scoring
     * @private
     */
    logarithmicScore(rank, total) {
        if (!rank || rank <= 0) return 0;
        const normalized = (total - rank + 1) / total;
        return Math.log10(normalized * 9 + 1) * 100;
    }

    /**
     * Sigmoid scoring
     * @private
     */
    sigmoidScore(rank, total) {
        if (!rank || rank <= 0) return 0;
        const normalized = (rank - 1) / (total - 1);
        const x = (normalized - 0.5) * 12; // Scale to approximately -6 to 6
        return (1 / (1 + Math.exp(x))) * 100;
    }

    /**
     * Get top N companies
     * @param {Array} ranked - Ranked companies
     * @param {number} n - Number of top companies
     * @returns {Array} Top N companies
     */
    getTop(ranked, n = 10) {
        return ranked
            .filter(c => c._rank && c._rank > 0)
            .slice(0, n);
    }

    /**
     * Get bottom N companies
     * @param {Array} ranked - Ranked companies
     * @param {number} n - Number of bottom companies
     * @returns {Array} Bottom N companies
     */
    getBottom(ranked, n = 10) {
        return ranked
            .filter(c => c._rank && c._rank > 0)
            .slice(-n);
    }

    /**
     * Get companies in percentile range
     * @param {Array} ranked - Ranked companies
     * @param {number} min - Minimum percentile
     * @param {number} max - Maximum percentile
     * @returns {Array} Companies in range
     */
    getPercentileRange(ranked, min, max) {
        return ranked.filter(c =>
            c._percentile !== undefined &&
            c._percentile >= min &&
            c._percentile <= max
        );
    }

    /**
     * Get ranking statistics
     * @param {Array} ranked - Ranked companies
     * @param {string} metric - Metric name
     * @returns {Object} Statistics
     */
    getStatistics(ranked, metric) {
        const values = ranked
            .map(c => this.getMetricValue(c, metric))
            .filter(v => v !== null && v !== undefined && !isNaN(v));

        if (values.length === 0) {
            return {
                count: 0,
                min: null,
                max: null,
                mean: null,
                median: null,
                stdDev: null,
                percentiles: {}
            };
        }

        // Sort values
        values.sort((a, b) => a - b);

        // Calculate statistics
        const count = values.length;
        const min = values[0];
        const max = values[count - 1];
        const mean = values.reduce((a, b) => a + b, 0) / count;

        // Median
        const median = count % 2 === 0
            ? (values[count / 2 - 1] + values[count / 2]) / 2
            : values[Math.floor(count / 2)];

        // Standard deviation
        const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / count;
        const stdDev = Math.sqrt(variance);

        // Percentiles
        const percentiles = {};
        [10, 25, 50, 75, 90].forEach(p => {
            const index = Math.floor((p / 100) * count);
            percentiles[`p${p}`] = values[Math.min(index, count - 1)];
        });

        return {
            count,
            min,
            max,
            mean,
            median,
            stdDev,
            percentiles,
            range: max - min,
            cv: mean !== 0 ? stdDev / mean : null // Coefficient of variation
        };
    }

    /**
     * Get metric value from company object
     * @private
     */
    getMetricValue(company, metric) {
        if (typeof metric === 'function') {
            return metric(company);
        }

        // Handle nested properties
        const keys = metric.split('.');
        let value = company;

        for (const key of keys) {
            value = value?.[key];
            if (value === undefined) break;
        }

        // Convert to number if possible
        if (typeof value === 'string' && !isNaN(value)) {
            value = parseFloat(value);
        }

        return value;
    }

    /**
     * Compare two values
     * @private
     */
    compareValues(a, b) {
        // Handle nulls/undefined
        if (a === null || a === undefined) return 1;
        if (b === null || b === undefined) return -1;

        // Numeric comparison
        if (typeof a === 'number' && typeof b === 'number') {
            return a - b;
        }

        // String comparison
        if (typeof a === 'string' && typeof b === 'string') {
            return a.localeCompare(b);
        }

        // Default comparison
        return a < b ? -1 : a > b ? 1 : 0;
    }

    /**
     * Categorize z-score
     * @private
     */
    categorizeZScore(zScore) {
        if (zScore > 2) return 'Very High';
        if (zScore > 1) return 'High';
        if (zScore > -1) return 'Normal';
        if (zScore > -2) return 'Low';
        return 'Very Low';
    }

    /**
     * Get cache key
     * @private
     */
    getCacheKey(companies, metric, options) {
        const companiesHash = companies.map(c => c.Ticker).join(',');
        const metricStr = Array.isArray(metric) ? metric.join(',') : metric;
        const optionsStr = JSON.stringify(options);
        return `${companiesHash}_${metricStr}_${optionsStr}`;
    }

    /**
     * Cache result
     * @private
     */
    cacheResult(key, result) {
        // Limit cache size
        if (this.cache.size >= this.config.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, result);
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        console.log('✅ Ranking cache cleared');
    }

    /**
     * Destroy engine
     */
    destroy() {
        this.clearCache();
        console.log('✅ RankingEngine destroyed');
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.RankingEngine = RankingEngine;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RankingEngine;
}