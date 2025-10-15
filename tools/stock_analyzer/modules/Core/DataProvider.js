/**
 * DataProvider - Central data management layer
 * Handles data loading, caching, and querying
 *
 * @module Core/DataProvider
 * @version 1.0.0
 */

class DataProvider {
    constructor(config = {}) {
        this.cache = new Map();
        this.loading = new Map();
        this.eventBus = null;

        this.config = {
            cacheTTL: config.cacheTTL || 300000, // 5 minutes default
            baseUrl: config.baseUrl || './data/',
            retryAttempts: config.retryAttempts || 3,
            retryDelay: config.retryDelay || 1000
        };

        // Data quality metrics
        this.qualityMetrics = new Map();

        console.log('✅ DataProvider initialized');
    }

    /**
     * Initialize with event bus
     * @param {EventBus} eventBus - Event bus instance
     */
    initialize(eventBus) {
        this.eventBus = eventBus;
        this.setupEventListeners();
    }

    /**
     * Load data from JSON file
     * @param {string} dataType - Type of data to load
     * @param {Object} options - Loading options
     * @returns {Promise<Object>} Loaded data
     */
    async loadData(dataType, options = {}) {
        const cacheKey = this.getCacheKey(dataType, options);

        // Check cache first
        if (this.cache.has(cacheKey) && !options.forceRefresh) {
            const cached = this.cache.get(cacheKey);

            if (Date.now() - cached.timestamp < this.config.cacheTTL) {
                console.log(`📦 Using cached data for ${dataType}`);
                return cached.data;
            }
        }

        // Check if already loading
        if (this.loading.has(cacheKey)) {
            console.log(`⏳ Waiting for ongoing load of ${dataType}`);
            return this.loading.get(cacheKey);
        }

        // Start loading
        const loadPromise = this.loadDataInternal(dataType, options);
        this.loading.set(cacheKey, loadPromise);

        try {
            const data = await loadPromise;

            // Cache the data
            this.cache.set(cacheKey, {
                data,
                timestamp: Date.now()
            });

            // Calculate quality metrics
            this.calculateQualityMetrics(dataType, data);

            // Emit success event
            if (this.eventBus) {
                this.eventBus.emit('data:loaded', {
                    dataType,
                    recordCount: Array.isArray(data) ? data.length : Object.keys(data).length,
                    quality: this.qualityMetrics.get(dataType)
                });
            }

            return data;

        } catch (error) {
            // Emit error event
            if (this.eventBus) {
                this.eventBus.emit('data:error', {
                    dataType,
                    error: error.message
                });
            }
            throw error;

        } finally {
            this.loading.delete(cacheKey);
        }
    }

    /**
     * Internal data loading with retry logic
     * @private
     */
    async loadDataInternal(dataType, options, attempt = 1) {
        const fileName = this.getFileName(dataType, options);
        const url = `${this.config.baseUrl}${fileName}`;

        console.log(`📥 Loading ${dataType} from ${url} (attempt ${attempt})`);

        try {
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            // Validate data structure
            this.validateData(dataType, data);

            return data;

        } catch (error) {
            console.error(`❌ Failed to load ${dataType}:`, error);

            // Retry logic
            if (attempt < this.config.retryAttempts) {
                console.log(`🔄 Retrying in ${this.config.retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
                return this.loadDataInternal(dataType, options, attempt + 1);
            }

            throw error;
        }
    }

    /**
     * Query data with filters
     * @param {string} dataType - Data type to query
     * @param {Object} query - Query parameters
     * @returns {Promise<Array>} Filtered results
     */
    async query(dataType, query = {}) {
        const data = await this.loadData(dataType);

        if (!Array.isArray(data)) {
            throw new Error(`Data type ${dataType} is not queryable`);
        }

        let results = [...data];

        // Apply filters
        if (query.filters) {
            results = this.applyFilters(results, query.filters);
        }

        // Apply sorting
        if (query.sort) {
            results = this.applySort(results, query.sort);
        }

        // Apply pagination
        if (query.limit || query.offset) {
            results = this.applyPagination(results, {
                limit: query.limit || 50,
                offset: query.offset || 0
            });
        }

        return {
            data: results,
            total: data.length,
            filtered: results.length,
            query
        };
    }

    /**
     * Apply filters to data
     * @private
     */
    applyFilters(data, filters) {
        return data.filter(item => {
            for (const [field, condition] of Object.entries(filters)) {
                if (!this.evaluateCondition(item[field], condition)) {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * Evaluate filter condition
     * @private
     */
    evaluateCondition(value, condition) {
        if (condition === null || condition === undefined) {
            return true;
        }

        // Simple equality
        if (typeof condition !== 'object') {
            return value === condition;
        }

        // Complex conditions
        if (condition.$eq !== undefined) {
            return value === condition.$eq;
        }
        if (condition.$ne !== undefined) {
            return value !== condition.$ne;
        }
        if (condition.$gt !== undefined) {
            return value > condition.$gt;
        }
        if (condition.$gte !== undefined) {
            return value >= condition.$gte;
        }
        if (condition.$lt !== undefined) {
            return value < condition.$lt;
        }
        if (condition.$lte !== undefined) {
            return value <= condition.$lte;
        }
        if (condition.$in !== undefined) {
            return Array.isArray(condition.$in) && condition.$in.includes(value);
        }
        if (condition.$nin !== undefined) {
            return Array.isArray(condition.$nin) && !condition.$nin.includes(value);
        }
        if (condition.$contains !== undefined) {
            return String(value).toLowerCase().includes(String(condition.$contains).toLowerCase());
        }
        if (condition.$regex !== undefined) {
            return new RegExp(condition.$regex, condition.$flags || 'i').test(value);
        }

        return true;
    }

    /**
     * Apply sorting to data
     * @private
     */
    applySort(data, sort) {
        const sortFields = Array.isArray(sort) ? sort : [sort];

        return data.sort((a, b) => {
            for (const sortField of sortFields) {
                const { field, order = 'asc' } =
                    typeof sortField === 'string'
                        ? { field: sortField, order: 'asc' }
                        : sortField;

                const aVal = a[field];
                const bVal = b[field];

                // Handle null/undefined
                if (aVal == null && bVal == null) continue;
                if (aVal == null) return order === 'asc' ? 1 : -1;
                if (bVal == null) return order === 'asc' ? -1 : 1;

                // Compare values
                let comparison = 0;
                if (aVal < bVal) comparison = -1;
                if (aVal > bVal) comparison = 1;

                if (comparison !== 0) {
                    return order === 'asc' ? comparison : -comparison;
                }
            }
            return 0;
        });
    }

    /**
     * Apply pagination to data
     * @private
     */
    applyPagination(data, { limit, offset }) {
        return data.slice(offset, offset + limit);
    }

    /**
     * Calculate data quality metrics
     * @private
     */
    calculateQualityMetrics(dataType, data) {
        if (!Array.isArray(data) || data.length === 0) {
            return;
        }

        const sample = data[0];
        const fields = Object.keys(sample);

        const metrics = {
            recordCount: data.length,
            fieldCount: fields.length,
            completeness: 0,
            nullRate: {},
            dataTypes: {}
        };

        // Calculate completeness and null rates
        let totalValues = 0;
        let nonNullValues = 0;

        fields.forEach(field => {
            let nullCount = 0;
            const types = new Set();

            data.forEach(record => {
                totalValues++;
                const value = record[field];

                if (value == null || value === '') {
                    nullCount++;
                } else {
                    nonNullValues++;
                    types.add(typeof value);
                }
            });

            metrics.nullRate[field] = (nullCount / data.length * 100).toFixed(2) + '%';
            metrics.dataTypes[field] = Array.from(types);
        });

        metrics.completeness = (nonNullValues / totalValues * 100).toFixed(2) + '%';

        this.qualityMetrics.set(dataType, metrics);

        console.log(`📊 Data quality for ${dataType}:`, metrics);
    }

    /**
     * Validate data structure
     * @private
     */
    validateData(dataType, data) {
        // Basic validation
        if (!data) {
            throw new Error(`No data returned for ${dataType}`);
        }

        // Type-specific validation
        switch (dataType) {
            case 'companies':
                if (!Array.isArray(data)) {
                    throw new Error('Companies data must be an array');
                }
                if (data.length > 0 && !data[0].Ticker) {
                    throw new Error('Company records must have Ticker field');
                }
                break;

            case 'economic-indicators':
                if (!data.indicators || !Array.isArray(data.indicators)) {
                    throw new Error('Economic indicators must have indicators array');
                }
                break;

            case 'etf-data':
                if (!Array.isArray(data)) {
                    throw new Error('ETF data must be an array');
                }
                break;
        }
    }

    /**
     * Get cache key for data request
     * @private
     */
    getCacheKey(dataType, options = {}) {
        return `${dataType}_${JSON.stringify(options)}`;
    }

    /**
     * Get file name for data type
     * @private
     */
    getFileName(dataType, options = {}) {
        const fileMap = {
            'companies': 'enhanced_summary_data_clean.json',
            'economic-indicators': 'economic_indicators.json',
            'etf-data': 'etf_data.json',
            'momentum-rankings': 'momentum_rankings.json',
            'sector-data': 'sector_summary.json'
        };

        return fileMap[dataType] || `${dataType}.json`;
    }

    /**
     * Clear cache
     * @param {string} dataType - Optional specific data type to clear
     */
    clearCache(dataType = null) {
        if (dataType) {
            const keysToDelete = [];
            for (const key of this.cache.keys()) {
                if (key.startsWith(dataType)) {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(key => this.cache.delete(key));
            console.log(`🧹 Cleared cache for ${dataType}`);
        } else {
            this.cache.clear();
            console.log('🧹 Cleared all cache');
        }

        if (this.eventBus) {
            this.eventBus.emit('data:cache:invalidated', { dataType });
        }
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        if (!this.eventBus) return;

        // Listen for cache invalidation requests
        this.eventBus.on('data:invalidate', (data) => {
            this.clearCache(data.dataType);
        });

        // Listen for data refresh requests
        this.eventBus.on('data:refresh', async (data) => {
            try {
                await this.loadData(data.dataType, { forceRefresh: true });
            } catch (error) {
                console.error('Data refresh failed:', error);
            }
        });
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getCacheStats() {
        const stats = {
            size: this.cache.size,
            entries: []
        };

        for (const [key, value] of this.cache.entries()) {
            stats.entries.push({
                key,
                age: Date.now() - value.timestamp,
                expired: Date.now() - value.timestamp > this.config.cacheTTL
            });
        }

        return stats;
    }

    /**
     * Destroy the data provider
     */
    destroy() {
        this.cache.clear();
        this.loading.clear();
        this.qualityMetrics.clear();
        console.log('✅ DataProvider destroyed');
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.DataProvider = DataProvider;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataProvider;
}