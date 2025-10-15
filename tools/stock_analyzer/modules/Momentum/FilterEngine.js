/**
 * FilterEngine - Advanced filtering system for companies
 * Provides comprehensive filtering capabilities with complex conditions
 *
 * @module Momentum/FilterEngine
 * @version 1.0.0
 */

class FilterEngine {
    constructor(config = {}) {
        this.config = {
            maxFilters: config.maxFilters || 50,
            cacheResults: config.cacheResults !== false,
            maxCacheSize: config.maxCacheSize || 100,
            enableSmartFilters: config.enableSmartFilters !== false,
            defaultOperator: config.defaultOperator || 'AND'
        };

        // Filter cache
        this.cache = new Map();

        // Predefined filter templates
        this.templates = this.initializeTemplates();

        // Smart filter patterns
        this.smartPatterns = this.initializeSmartPatterns();

        // Filter operators
        this.operators = {
            // Comparison operators
            eq: (a, b) => a === b,
            ne: (a, b) => a !== b,
            gt: (a, b) => a > b,
            gte: (a, b) => a >= b,
            lt: (a, b) => a < b,
            lte: (a, b) => a <= b,

            // Range operators
            between: (value, range) => value >= range[0] && value <= range[1],
            notBetween: (value, range) => value < range[0] || value > range[1],

            // String operators
            contains: (str, substr) => String(str).toLowerCase().includes(String(substr).toLowerCase()),
            notContains: (str, substr) => !String(str).toLowerCase().includes(String(substr).toLowerCase()),
            startsWith: (str, prefix) => String(str).toLowerCase().startsWith(String(prefix).toLowerCase()),
            endsWith: (str, suffix) => String(str).toLowerCase().endsWith(String(suffix).toLowerCase()),
            regex: (str, pattern) => new RegExp(pattern, 'i').test(String(str)),

            // Array operators
            in: (value, array) => array.includes(value),
            notIn: (value, array) => !array.includes(value),
            any: (array1, array2) => array1.some(v => array2.includes(v)),
            all: (array1, array2) => array2.every(v => array1.includes(v)),

            // Null operators
            isNull: (value) => value === null || value === undefined,
            isNotNull: (value) => value !== null && value !== undefined,

            // Boolean operators
            isTrue: (value) => value === true,
            isFalse: (value) => value === false
        };

        console.log('✅ FilterEngine initialized');
    }

    /**
     * Initialize filter templates
     * @private
     */
    initializeTemplates() {
        return {
            // Momentum filters
            highMomentum: {
                name: 'High Momentum',
                description: 'Companies with strong momentum scores',
                filters: [
                    { field: 'momentumScore', operator: 'gte', value: 70 },
                    { field: 'returnYTD', operator: 'gt', value: 0 }
                ]
            },

            topPerformers: {
                name: 'Top Performers',
                description: 'Best performing companies',
                filters: [
                    { field: 'returnYTD', operator: 'gte', value: 20 },
                    { field: 'return3M', operator: 'gt', value: 5 }
                ]
            },

            risingStars: {
                name: 'Rising Stars',
                description: 'Companies with accelerating momentum',
                filters: [
                    { field: 'return1M', operator: 'gt', value: 5 },
                    { field: 'return3M', operator: 'gt', value: 10 },
                    { field: 'volumeRatio', operator: 'gt', value: 1.5 }
                ]
            },

            // Value filters
            undervalued: {
                name: 'Undervalued',
                description: 'Companies with attractive valuations',
                filters: [
                    { field: 'perCurrent', operator: 'between', value: [5, 15] },
                    { field: 'pbrCurrent', operator: 'lt', value: 1.5 },
                    { field: 'pegCurrent', operator: 'lt', value: 1 }
                ]
            },

            growthAtReasonablePrice: {
                name: 'GARP',
                description: 'Growth at reasonable price',
                filters: [
                    { field: 'pegCurrent', operator: 'between', value: [0.5, 1.5] },
                    { field: 'salesGrowthYoY', operator: 'gt', value: 10 },
                    { field: 'roeFwd', operator: 'gt', value: 15 }
                ]
            },

            // Quality filters
            highQuality: {
                name: 'High Quality',
                description: 'Companies with strong fundamentals',
                filters: [
                    { field: 'roeFwd', operator: 'gte', value: 20 },
                    { field: 'debtEquityRatio', operator: 'lt', value: 0.5 },
                    { field: 'currentRatio', operator: 'gt', value: 1.5 }
                ]
            },

            profitable: {
                name: 'Profitable',
                description: 'Consistently profitable companies',
                filters: [
                    { field: 'npmFwd', operator: 'gt', value: 10 },
                    { field: 'opmFwd', operator: 'gt', value: 15 },
                    { field: 'roaFwd', operator: 'gt', value: 5 }
                ]
            },

            // Size filters
            largeCap: {
                name: 'Large Cap',
                description: 'Large capitalization companies',
                filters: [
                    { field: 'marketCapMillions', operator: 'gte', value: 10000 }
                ]
            },

            midCap: {
                name: 'Mid Cap',
                description: 'Mid capitalization companies',
                filters: [
                    { field: 'marketCapMillions', operator: 'between', value: [2000, 10000] }
                ]
            },

            smallCap: {
                name: 'Small Cap',
                description: 'Small capitalization companies',
                filters: [
                    { field: 'marketCapMillions', operator: 'between', value: [300, 2000] }
                ]
            },

            // Risk filters
            lowRisk: {
                name: 'Low Risk',
                description: 'Companies with low risk profiles',
                filters: [
                    { field: 'beta', operator: 'lt', value: 1 },
                    { field: 'debtEquityRatio', operator: 'lt', value: 0.3 },
                    { field: 'currentRatio', operator: 'gt', value: 2 }
                ]
            },

            defensive: {
                name: 'Defensive',
                description: 'Defensive stocks',
                filters: [
                    { field: 'beta', operator: 'lt', value: 0.8 },
                    { field: 'dividendYieldFwd', operator: 'gt', value: 2 }
                ]
            }
        };
    }

    /**
     * Initialize smart filter patterns
     * @private
     */
    initializeSmartPatterns() {
        return {
            // Pattern: "strong momentum"
            'strong momentum': {
                filters: [
                    { field: 'momentumScore', operator: 'gte', value: 70 }
                ]
            },

            // Pattern: "cheap stocks"
            'cheap': {
                filters: [
                    { field: 'perCurrent', operator: 'lt', value: 15 }
                ]
            },

            // Pattern: "high growth"
            'high growth': {
                filters: [
                    { field: 'salesGrowthYoY', operator: 'gt', value: 20 }
                ]
            },

            // Pattern: "dividend"
            'dividend': {
                filters: [
                    { field: 'dividendYieldFwd', operator: 'gt', value: 0 }
                ]
            },

            // Pattern: "tech stocks"
            'tech': {
                filters: [
                    { field: 'gicsSector', operator: 'eq', value: 'Information Technology' }
                ]
            }
        };
    }

    /**
     * Apply filters to companies
     * @param {Array} companies - Array of companies
     * @param {Object|Array} filters - Filter conditions
     * @param {Object} options - Filter options
     * @returns {Array} Filtered companies
     */
    filter(companies, filters, options = {}) {
        if (!companies || companies.length === 0) {
            return [];
        }

        if (!filters || (Array.isArray(filters) && filters.length === 0)) {
            return companies;
        }

        // Check cache
        const cacheKey = this.getCacheKey(companies, filters, options);
        if (this.config.cacheResults && this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        // Parse filters
        const parsedFilters = this.parseFilters(filters, options);

        // Apply filters
        const filtered = this.applyFilters(companies, parsedFilters, options);

        // Cache result
        if (this.config.cacheResults) {
            this.cacheResult(cacheKey, filtered);
        }

        return filtered;
    }

    /**
     * Parse filter input
     * @private
     */
    parseFilters(filters, options = {}) {
        // Handle template filters
        if (typeof filters === 'string' && this.templates[filters]) {
            return this.templates[filters].filters;
        }

        // Handle smart patterns
        if (typeof filters === 'string' && this.config.enableSmartFilters) {
            const pattern = this.findSmartPattern(filters);
            if (pattern) {
                return pattern.filters;
            }
        }

        // Handle array of filters
        if (Array.isArray(filters)) {
            return filters;
        }

        // Handle object filters (convert to array)
        if (typeof filters === 'object') {
            return this.convertObjectToFilters(filters);
        }

        return [];
    }

    /**
     * Convert object notation to filter array
     * @private
     */
    convertObjectToFilters(obj) {
        const filters = [];

        for (const [field, condition] of Object.entries(obj)) {
            if (condition === null || condition === undefined) {
                continue;
            }

            // Simple value
            if (typeof condition !== 'object') {
                filters.push({
                    field,
                    operator: 'eq',
                    value: condition
                });
                continue;
            }

            // Object with operators
            for (const [operator, value] of Object.entries(condition)) {
                const cleanOperator = operator.startsWith('$') ? operator.slice(1) : operator;
                filters.push({
                    field,
                    operator: cleanOperator,
                    value
                });
            }
        }

        return filters;
    }

    /**
     * Apply parsed filters to companies
     * @private
     */
    applyFilters(companies, filters, options = {}) {
        const operator = options.operator || this.config.defaultOperator;

        return companies.filter(company => {
            if (operator === 'OR') {
                // OR logic - at least one filter must pass
                return filters.some(filter => this.evaluateFilter(company, filter));
            } else {
                // AND logic (default) - all filters must pass
                return filters.every(filter => this.evaluateFilter(company, filter));
            }
        });
    }

    /**
     * Evaluate single filter condition
     * @private
     */
    evaluateFilter(company, filter) {
        const value = this.getFieldValue(company, filter.field);
        const operator = this.operators[filter.operator];

        if (!operator) {
            console.warn(`Unknown operator: ${filter.operator}`);
            return true;
        }

        // Handle null values
        if (filter.operator === 'isNull' || filter.operator === 'isNotNull') {
            return operator(value);
        }

        // Skip null values for other operators (unless explicitly checking)
        if (value === null || value === undefined) {
            return false;
        }

        // Apply operator
        try {
            return operator(value, filter.value);
        } catch (error) {
            console.error(`Filter evaluation error:`, error);
            return false;
        }
    }

    /**
     * Create complex filter with multiple conditions
     * @param {Array} conditions - Array of condition groups
     * @param {string} groupOperator - Operator between groups (AND/OR)
     * @returns {Function} Filter function
     */
    createComplexFilter(conditions, groupOperator = 'AND') {
        return (companies) => {
            return companies.filter(company => {
                if (groupOperator === 'OR') {
                    // At least one group must pass
                    return conditions.some(group =>
                        this.applyFilters([company], group.filters, { operator: group.operator }).length > 0
                    );
                } else {
                    // All groups must pass
                    return conditions.every(group =>
                        this.applyFilters([company], group.filters, { operator: group.operator }).length > 0
                    );
                }
            });
        };
    }

    /**
     * Apply template filter
     * @param {Array} companies - Companies to filter
     * @param {string} templateName - Template name
     * @returns {Array} Filtered companies
     */
    applyTemplate(companies, templateName) {
        const template = this.templates[templateName];

        if (!template) {
            console.error(`Unknown template: ${templateName}`);
            return companies;
        }

        return this.filter(companies, template.filters);
    }

    /**
     * Get available templates
     * @returns {Array} Template information
     */
    getTemplates() {
        return Object.entries(this.templates).map(([key, template]) => ({
            key,
            name: template.name,
            description: template.description,
            filterCount: template.filters.length
        }));
    }

    /**
     * Create custom filter template
     * @param {string} name - Template name
     * @param {Object} template - Template configuration
     */
    addTemplate(name, template) {
        this.templates[name] = {
            name: template.name || name,
            description: template.description || '',
            filters: template.filters || []
        };
    }

    /**
     * Filter by sector
     * @param {Array} companies - Companies to filter
     * @param {Array<string>} sectors - Sectors to include
     * @returns {Array} Filtered companies
     */
    filterBySector(companies, sectors) {
        if (!sectors || sectors.length === 0) {
            return companies;
        }

        return this.filter(companies, {
            gicsSector: { $in: sectors }
        });
    }

    /**
     * Filter by country
     * @param {Array} companies - Companies to filter
     * @param {Array<string>} countries - Countries to include
     * @returns {Array} Filtered companies
     */
    filterByCountry(companies, countries) {
        if (!countries || countries.length === 0) {
            return companies;
        }

        return this.filter(companies, {
            country: { $in: countries }
        });
    }

    /**
     * Filter by market cap range
     * @param {Array} companies - Companies to filter
     * @param {number} min - Minimum market cap
     * @param {number} max - Maximum market cap
     * @returns {Array} Filtered companies
     */
    filterByMarketCap(companies, min, max) {
        const filters = [];

        if (min !== undefined && min !== null) {
            filters.push({ field: 'marketCapMillions', operator: 'gte', value: min });
        }

        if (max !== undefined && max !== null) {
            filters.push({ field: 'marketCapMillions', operator: 'lte', value: max });
        }

        return this.filter(companies, filters);
    }

    /**
     * Filter by performance
     * @param {Array} companies - Companies to filter
     * @param {string} period - Time period (YTD, 1M, 3M, 6M, 1Y)
     * @param {number} minReturn - Minimum return
     * @returns {Array} Filtered companies
     */
    filterByPerformance(companies, period, minReturn) {
        const fieldMap = {
            'YTD': 'returnYTD',
            '1M': 'return1M',
            '3M': 'return3M',
            '6M': 'return6M',
            '1Y': 'return1Y'
        };

        const field = fieldMap[period];

        if (!field) {
            console.error(`Unknown period: ${period}`);
            return companies;
        }

        return this.filter(companies, {
            [field]: { $gte: minReturn }
        });
    }

    /**
     * Filter by valuation metrics
     * @param {Array} companies - Companies to filter
     * @param {Object} metrics - Valuation metrics
     * @returns {Array} Filtered companies
     */
    filterByValuation(companies, metrics) {
        const filters = [];

        if (metrics.maxPE) {
            filters.push({ field: 'perCurrent', operator: 'lte', value: metrics.maxPE });
        }

        if (metrics.minPE) {
            filters.push({ field: 'perCurrent', operator: 'gte', value: metrics.minPE });
        }

        if (metrics.maxPB) {
            filters.push({ field: 'pbrCurrent', operator: 'lte', value: metrics.maxPB });
        }

        if (metrics.maxPEG) {
            filters.push({ field: 'pegCurrent', operator: 'lte', value: metrics.maxPEG });
        }

        return this.filter(companies, filters);
    }

    /**
     * Filter by quality metrics
     * @param {Array} companies - Companies to filter
     * @param {Object} metrics - Quality metrics
     * @returns {Array} Filtered companies
     */
    filterByQuality(companies, metrics) {
        const filters = [];

        if (metrics.minROE) {
            filters.push({ field: 'roeFwd', operator: 'gte', value: metrics.minROE });
        }

        if (metrics.minROA) {
            filters.push({ field: 'roaFwd', operator: 'gte', value: metrics.minROA });
        }

        if (metrics.maxDebtEquity) {
            filters.push({ field: 'debtEquityRatio', operator: 'lte', value: metrics.maxDebtEquity });
        }

        if (metrics.minCurrentRatio) {
            filters.push({ field: 'currentRatio', operator: 'gte', value: metrics.minCurrentRatio });
        }

        return this.filter(companies, filters);
    }

    /**
     * Search companies by text
     * @param {Array} companies - Companies to search
     * @param {string} searchText - Search text
     * @param {Array<string>} fields - Fields to search in
     * @returns {Array} Matching companies
     */
    search(companies, searchText, fields = ['Ticker', 'corpName']) {
        if (!searchText || searchText.trim() === '') {
            return companies;
        }

        const searchLower = searchText.toLowerCase();

        return companies.filter(company => {
            return fields.some(field => {
                const value = this.getFieldValue(company, field);
                if (value === null || value === undefined) return false;
                return String(value).toLowerCase().includes(searchLower);
            });
        });
    }

    /**
     * Get unique values for a field
     * @param {Array} companies - Companies to analyze
     * @param {string} field - Field name
     * @returns {Array} Unique values
     */
    getUniqueValues(companies, field) {
        const values = new Set();

        companies.forEach(company => {
            const value = this.getFieldValue(company, field);
            if (value !== null && value !== undefined) {
                values.add(value);
            }
        });

        return Array.from(values).sort();
    }

    /**
     * Get filter statistics
     * @param {Array} original - Original companies
     * @param {Array} filtered - Filtered companies
     * @returns {Object} Statistics
     */
    getFilterStats(original, filtered) {
        return {
            originalCount: original.length,
            filteredCount: filtered.length,
            removedCount: original.length - filtered.length,
            retentionRate: (filtered.length / original.length * 100).toFixed(2) + '%',
            removalRate: ((original.length - filtered.length) / original.length * 100).toFixed(2) + '%'
        };
    }

    /**
     * Find smart pattern
     * @private
     */
    findSmartPattern(text) {
        const textLower = text.toLowerCase();

        for (const [pattern, config] of Object.entries(this.smartPatterns)) {
            if (textLower.includes(pattern)) {
                return config;
            }
        }

        return null;
    }

    /**
     * Get field value from company object
     * @private
     */
    getFieldValue(company, field) {
        // Handle nested properties
        const keys = field.split('.');
        let value = company;

        for (const key of keys) {
            value = value?.[key];
            if (value === undefined) break;
        }

        return value;
    }

    /**
     * Get cache key
     * @private
     */
    getCacheKey(companies, filters, options) {
        const companiesHash = companies.length; // Simple hash based on count
        const filtersStr = JSON.stringify(filters);
        const optionsStr = JSON.stringify(options);
        return `${companiesHash}_${filtersStr}_${optionsStr}`;
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
        console.log('✅ Filter cache cleared');
    }

    /**
     * Destroy engine
     */
    destroy() {
        this.clearCache();
        console.log('✅ FilterEngine destroyed');
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.FilterEngine = FilterEngine;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FilterEngine;
}