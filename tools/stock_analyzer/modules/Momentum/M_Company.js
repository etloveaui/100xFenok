/**
 * M_Company - Company Momentum Tracking Module
 * Tracks and analyzes momentum metrics for individual companies
 *
 * @module Momentum/M_Company
 * @version 1.0.0
 */

class M_Company {
    constructor(config = {}) {
        this.id = 'momentum-company';
        this.name = 'Company Momentum';
        this.version = '1.0.0';
        this.dependencies = ['data-provider', 'state-manager', 'event-bus'];

        this.config = {
            updateInterval: config.updateInterval || 60000, // 1 minute
            maxCompanies: config.maxCompanies || 1000,
            momentumPeriods: config.momentumPeriods || {
                short: [1, 5, 20], // 1d, 1w, 1m
                medium: [60, 120], // 3m, 6m
                long: [252, 504, 756] // 1y, 2y, 3y
            },
            defaultSort: config.defaultSort || 'momentumScore',
            defaultOrder: config.defaultOrder || 'desc',
            enableAutoUpdate: config.enableAutoUpdate !== false
        };

        // Module state
        this.companies = [];
        this.filteredCompanies = [];
        this.selectedCompanies = new Set();
        this.comparisonList = [];
        this.rankings = new Map();

        // Services
        this.dataProvider = null;
        this.stateManager = null;
        this.eventBus = null;
        this.performanceMonitor = null;

        // Components
        this.momentumCalculator = null;
        this.rankingEngine = null;
        this.filterEngine = null;
        this.visualizer = null;

        // UI elements
        this.container = null;
        this.tableElement = null;
        this.chartElement = null;
        this.detailPanel = null;

        // Update timer
        this.updateTimer = null;

        console.log('✅ M_Company module instantiated');
    }

    /**
     * Initialize module with dependencies
     * @param {Object} context - Module context
     */
    async initialize(context) {
        console.log('🚀 Initializing M_Company module...');

        // Set up services
        this.dataProvider = context.dataProvider;
        this.stateManager = context.stateManager;
        this.eventBus = context.eventBus;
        this.performanceMonitor = context.performanceMonitor;

        // Initialize components
        this.momentumCalculator = new MomentumCalculator(this.config.momentumPeriods);
        this.rankingEngine = new RankingEngine();
        this.filterEngine = new FilterEngine();
        this.visualizer = new MomentumVisualizer();

        // Set up event listeners
        this.setupEventListeners();

        // Load saved state
        await this.loadState();

        console.log('✅ M_Company module initialized');
    }

    /**
     * Activate module
     */
    async activate() {
        console.log('▶️ Activating M_Company module...');

        const tracker = this.performanceMonitor?.trackModule(this.id);
        const activationTracker = tracker?.trackLoad();

        try {
            // Create UI
            await this.createUI();

            // Load initial data
            await this.loadData();

            // Calculate initial momentum
            await this.calculateMomentum();

            // Render initial view
            this.render();

            // Start auto-update if enabled
            if (this.config.enableAutoUpdate) {
                this.startAutoUpdate();
            }

            // Mark as active
            this.stateManager?.setModuleState(this.id, 'active', true);

            activationTracker?.complete();
            console.log('✅ M_Company module activated');

        } catch (error) {
            console.error('❌ Failed to activate M_Company:', error);
            throw error;
        }
    }

    /**
     * Deactivate module
     */
    async deactivate() {
        console.log('⏹️ Deactivating M_Company module...');

        // Stop updates
        this.stopAutoUpdate();

        // Save state
        await this.saveState();

        // Clear UI
        this.clearUI();

        // Mark as inactive
        this.stateManager?.setModuleState(this.id, 'active', false);

        console.log('✅ M_Company module deactivated');
    }

    /**
     * Load company data
     * @param {Array} data - Optional company data array (if not using DataProvider)
     */
    async loadData(data = null) {
        const loadTracker = this.performanceMonitor?.trackModule(this.id).trackDataFetch('companies');

        try {
            console.log('📥 Loading company data...');

            // Load from provided data or DataProvider
            let rawData;
            if (data) {
                rawData = data;
            } else if (this.dataProvider) {
                rawData = await this.dataProvider.loadData('companies');
            } else {
                throw new Error('No data source available');
            }

            // Process and validate data
            if (Array.isArray(rawData)) {
                this.companies = rawData.slice(0, this.config.maxCompanies);
            } else if (rawData && rawData.data) {
                this.companies = rawData.data.slice(0, this.config.maxCompanies);
            } else {
                throw new Error('Invalid company data format');
            }

            // Apply initial filters
            this.filteredCompanies = [...this.companies];

            // Emit data loaded event
            this.eventBus?.emit('momentum:data:loaded', {
                module: this.id,
                count: this.companies.length
            });

            loadTracker?.();
            console.log(`✅ Loaded ${this.companies.length} companies`);

        } catch (error) {
            console.error('❌ Failed to load company data:', error);
            this.eventBus?.emit('momentum:data:error', {
                module: this.id,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Calculate momentum for all companies
     */
    async calculateMomentum() {
        const calcTracker = this.performanceMonitor?.trackModule(this.id).track('momentum-calculation');

        try {
            console.log('📊 Calculating momentum metrics...');

            // Calculate momentum for each company
            for (const company of this.companies) {
                const momentum = this.momentumCalculator.calculate(company);
                company.momentum = momentum;

                // Calculate composite score
                company.momentumScore = this.calculateCompositeScore(momentum);
            }

            // Update rankings
            await this.updateRankings();

            calcTracker?.();
            console.log('✅ Momentum calculation complete');

        } catch (error) {
            console.error('❌ Failed to calculate momentum:', error);
            throw error;
        }
    }

    /**
     * Calculate composite momentum score
     * @private
     */
    calculateCompositeScore(momentum) {
        if (!momentum) return 0;

        // Weighted average of different momentum metrics
        const weights = {
            price: 0.3,
            earnings: 0.25,
            volume: 0.15,
            fundamental: 0.2,
            technical: 0.1
        };

        let score = 0;
        let totalWeight = 0;

        for (const [metric, weight] of Object.entries(weights)) {
            if (momentum[metric] !== undefined && !isNaN(momentum[metric])) {
                score += momentum[metric] * weight;
                totalWeight += weight;
            }
        }

        return totalWeight > 0 ? score / totalWeight : 0;
    }

    /**
     * Update company rankings
     */
    async updateRankings() {
        console.log('🏆 Updating rankings...');

        // Clear existing rankings
        this.rankings.clear();

        // Rank by different metrics
        const metrics = [
            'momentumScore',
            'returnYTD',
            'return1M',
            'return3M',
            'marketCapMillions',
            'volumeMomentum'
        ];

        for (const metric of metrics) {
            const ranked = this.rankingEngine.rank(this.filteredCompanies, metric);
            this.rankings.set(metric, ranked);
        }

        // Emit rankings updated event
        this.eventBus?.emit('momentum:rankings:updated', {
            module: this.id,
            metrics: Array.from(this.rankings.keys())
        });
    }

    /**
     * Apply filters to companies
     * @param {Object} filters - Filter criteria
     */
    applyFilters(filters) {
        console.log('🔍 Applying filters:', filters);

        const filterTracker = this.performanceMonitor?.trackModule(this.id).track('filtering');

        // Apply filters using FilterEngine
        this.filteredCompanies = this.filterEngine.filter(this.companies, filters);

        // Recalculate rankings for filtered data
        this.updateRankings();

        // Update state
        this.stateManager?.setModuleState(this.id, 'filters', filters);

        // Emit filter event
        this.eventBus?.emit('momentum:filtered', {
            module: this.id,
            filters,
            count: this.filteredCompanies.length
        });

        filterTracker?.();

        // Re-render
        this.render();
    }

    /**
     * Sort companies
     * @param {string} field - Field to sort by
     * @param {string} order - Sort order (asc/desc)
     */
    sortCompanies(field, order = 'desc') {
        console.log(`🔄 Sorting by ${field} (${order})`);

        this.filteredCompanies.sort((a, b) => {
            const aVal = this.getNestedValue(a, field);
            const bVal = this.getNestedValue(b, field);

            if (aVal === null || aVal === undefined) return 1;
            if (bVal === null || bVal === undefined) return -1;

            const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return order === 'asc' ? comparison : -comparison;
        });

        // Update state
        this.stateManager?.setModuleState(this.id, 'sort', { field, order });

        // Re-render
        this.render();
    }

    /**
     * Select company for detail view
     * @param {string} ticker - Company ticker
     */
    selectCompany(ticker) {
        const company = this.companies.find(c => c.Ticker === ticker);

        if (!company) {
            console.error(`Company not found: ${ticker}`);
            return;
        }

        console.log(`📌 Selected company: ${ticker}`);

        // Update selection
        this.selectedCompanies.add(ticker);

        // Show detail view
        this.showCompanyDetail(company);

        // Emit selection event
        this.eventBus?.emit('momentum:company:selected', {
            module: this.id,
            ticker,
            company
        });
    }

    /**
     * Add companies to comparison
     * @param {Array<string>} tickers - Company tickers
     */
    addToComparison(tickers) {
        console.log('📊 Adding to comparison:', tickers);

        for (const ticker of tickers) {
            const company = this.companies.find(c => c.Ticker === ticker);
            if (company && !this.comparisonList.find(c => c.Ticker === ticker)) {
                this.comparisonList.push(company);
            }
        }

        // Limit comparison list
        if (this.comparisonList.length > 10) {
            this.comparisonList = this.comparisonList.slice(0, 10);
        }

        // Update comparison view
        this.updateComparisonView();

        // Emit comparison event
        this.eventBus?.emit('momentum:comparison:updated', {
            module: this.id,
            companies: this.comparisonList.map(c => c.Ticker)
        });
    }

    /**
     * Export data
     * @param {string} format - Export format (csv, json, excel)
     * @param {Object} options - Export options
     */
    async exportData(format = 'csv', options = {}) {
        console.log(`📤 Exporting data as ${format}...`);

        try {
            const dataToExport = options.filtered ? this.filteredCompanies : this.companies;

            let exportContent;
            let filename;
            let mimeType;

            switch (format) {
                case 'csv':
                    exportContent = this.exportAsCSV(dataToExport);
                    filename = `momentum_companies_${Date.now()}.csv`;
                    mimeType = 'text/csv';
                    break;

                case 'json':
                    exportContent = JSON.stringify(dataToExport, null, 2);
                    filename = `momentum_companies_${Date.now()}.json`;
                    mimeType = 'application/json';
                    break;

                case 'excel':
                    exportContent = await this.exportAsExcel(dataToExport);
                    filename = `momentum_companies_${Date.now()}.xlsx`;
                    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                    break;

                default:
                    throw new Error(`Unsupported export format: ${format}`);
            }

            // Download file
            this.downloadFile(exportContent, filename, mimeType);

            // Emit export event
            this.eventBus?.emit('momentum:exported', {
                module: this.id,
                format,
                count: dataToExport.length
            });

            console.log('✅ Export complete');

        } catch (error) {
            console.error('❌ Export failed:', error);
            throw error;
        }
    }

    /**
     * Create module UI
     * @private
     */
    async createUI() {
        // Find or create container
        this.container = document.getElementById('momentum-company-container');

        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'momentum-company-container';
            this.container.className = 'momentum-module-container';
            document.body.appendChild(this.container);
        }

        // Create UI structure
        this.container.innerHTML = `
            <div class="momentum-company">
                <div class="module-header">
                    <h2>📈 Company Momentum Tracker</h2>
                    <div class="module-controls">
                        <button id="mc-filter-btn" class="btn-secondary">🔍 Filters</button>
                        <button id="mc-compare-btn" class="btn-secondary">📊 Compare</button>
                        <button id="mc-export-btn" class="btn-secondary">📤 Export</button>
                        <button id="mc-refresh-btn" class="btn-primary">🔄 Refresh</button>
                    </div>
                </div>

                <div class="module-stats">
                    <div class="stat-item">
                        <span class="stat-label">Total Companies</span>
                        <span class="stat-value" id="mc-total-count">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Filtered</span>
                        <span class="stat-value" id="mc-filtered-count">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Top Gainer</span>
                        <span class="stat-value" id="mc-top-gainer">-</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Top Loser</span>
                        <span class="stat-value" id="mc-top-loser">-</span>
                    </div>
                </div>

                <div class="module-tabs">
                    <button class="tab-btn active" data-tab="table">📋 Table View</button>
                    <button class="tab-btn" data-tab="heatmap">🗺️ Heat Map</button>
                    <button class="tab-btn" data-tab="charts">📊 Charts</button>
                    <button class="tab-btn" data-tab="rankings">🏆 Rankings</button>
                </div>

                <div class="module-content">
                    <div id="mc-table-view" class="tab-content active">
                        <div class="table-container"></div>
                    </div>
                    <div id="mc-heatmap-view" class="tab-content">
                        <div class="heatmap-container"></div>
                    </div>
                    <div id="mc-charts-view" class="tab-content">
                        <div class="charts-container"></div>
                    </div>
                    <div id="mc-rankings-view" class="tab-content">
                        <div class="rankings-container"></div>
                    </div>
                </div>

                <div id="mc-detail-panel" class="detail-panel" style="display: none;">
                    <!-- Company detail view -->
                </div>

                <div id="mc-comparison-panel" class="comparison-panel" style="display: none;">
                    <!-- Comparison view -->
                </div>

                <div id="mc-filter-panel" class="filter-panel" style="display: none;">
                    <!-- Filter controls -->
                </div>
            </div>
        `;

        // Set up event handlers
        this.setupUIEventHandlers();
    }

    /**
     * Setup UI event handlers
     * @private
     */
    setupUIEventHandlers() {
        // Tab switching
        this.container.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Control buttons
        document.getElementById('mc-filter-btn')?.addEventListener('click', () => {
            this.toggleFilterPanel();
        });

        document.getElementById('mc-compare-btn')?.addEventListener('click', () => {
            this.toggleComparisonPanel();
        });

        document.getElementById('mc-export-btn')?.addEventListener('click', () => {
            this.showExportDialog();
        });

        document.getElementById('mc-refresh-btn')?.addEventListener('click', () => {
            this.refresh();
        });
    }

    /**
     * Render module content
     */
    render() {
        console.log('🎨 Rendering M_Company module...');

        const renderTracker = this.performanceMonitor?.trackModule(this.id).trackRender();

        try {
            // Update statistics
            this.updateStatistics();

            // Get active tab
            const activeTab = this.container.querySelector('.tab-btn.active')?.dataset.tab || 'table';

            // Render based on active tab
            switch (activeTab) {
                case 'table':
                    this.renderTableView();
                    break;
                case 'heatmap':
                    this.renderHeatmapView();
                    break;
                case 'charts':
                    this.renderChartsView();
                    break;
                case 'rankings':
                    this.renderRankingsView();
                    break;
            }

            renderTracker?.();

        } catch (error) {
            console.error('❌ Render error:', error);
        }
    }

    /**
     * Render table view
     * @private
     */
    renderTableView() {
        const container = this.container.querySelector('.table-container');

        if (!container) return;

        // Create table HTML
        let html = `
            <table class="momentum-table">
                <thead>
                    <tr>
                        <th class="sortable" data-field="Ticker">Ticker</th>
                        <th class="sortable" data-field="corpName">Company</th>
                        <th class="sortable" data-field="currentPrice">Price</th>
                        <th class="sortable" data-field="momentumScore">Score</th>
                        <th class="sortable" data-field="returnYTD">YTD %</th>
                        <th class="sortable" data-field="return1M">1M %</th>
                        <th class="sortable" data-field="return3M">3M %</th>
                        <th class="sortable" data-field="marketCapMillions">Market Cap</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // Add rows
        const displayCompanies = this.filteredCompanies.slice(0, 100); // Limit display

        for (const company of displayCompanies) {
            const ytdClass = company.returnYTD >= 0 ? 'positive' : 'negative';
            const m1Class = company.return1M >= 0 ? 'positive' : 'negative';
            const m3Class = company.return3M >= 0 ? 'positive' : 'negative';

            html += `
                <tr data-ticker="${company.Ticker}">
                    <td class="ticker">${company.Ticker || '-'}</td>
                    <td class="company-name">${company.corpName || '-'}</td>
                    <td class="price">$${this.formatNumber(company.currentPrice)}</td>
                    <td class="momentum-score">${this.formatNumber(company.momentumScore, 2)}</td>
                    <td class="return ${ytdClass}">${this.formatPercent(company.returnYTD)}</td>
                    <td class="return ${m1Class}">${this.formatPercent(company.return1M)}</td>
                    <td class="return ${m3Class}">${this.formatPercent(company.return3M)}</td>
                    <td class="market-cap">$${this.formatLargeNumber(company.marketCapMillions)}M</td>
                    <td class="actions">
                        <button class="btn-small" onclick="window.M_Company.selectCompany('${company.Ticker}')">📋</button>
                        <button class="btn-small" onclick="window.M_Company.addToComparison(['${company.Ticker}'])">📊</button>
                    </td>
                </tr>
            `;
        }

        html += '</tbody></table>';

        container.innerHTML = html;

        // Add sort handlers
        container.querySelectorAll('.sortable').forEach(header => {
            header.addEventListener('click', () => {
                this.sortCompanies(header.dataset.field);
            });
        });
    }

    /**
     * Update statistics display
     * @private
     */
    updateStatistics() {
        // Update counts (with null checks)
        const totalCountEl = document.getElementById('mc-total-count');
        const filteredCountEl = document.getElementById('mc-filtered-count');

        if (totalCountEl) totalCountEl.textContent = this.companies.length;
        if (filteredCountEl) filteredCountEl.textContent = this.filteredCompanies.length;

        // Find top gainer/loser
        if (this.filteredCompanies.length > 0) {
            const sorted = [...this.filteredCompanies].sort((a, b) =>
                (b.returnYTD || -999) - (a.returnYTD || -999)
            );

            const topGainer = sorted[0];
            const topLoser = sorted[sorted.length - 1];

            const topGainerEl = document.getElementById('mc-top-gainer');
            const topLoserEl = document.getElementById('mc-top-loser');

            if (topGainerEl) topGainerEl.textContent =
                topGainer ? `${topGainer.Ticker} (${this.formatPercent(topGainer.returnYTD)})` : '-';

            if (topLoserEl) topLoserEl.textContent =
                topLoser ? `${topLoser.Ticker} (${this.formatPercent(topLoser.returnYTD)})` : '-';
        }
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        if (!this.eventBus) return;

        // Listen for data updates
        this.eventBus.on('data:updated', async (data) => {
            if (data.dataType === 'companies') {
                await this.loadData();
                await this.calculateMomentum();
                this.render();
            }
        });

        // Listen for user selections
        this.eventBus.on('user:security:selected', (data) => {
            this.selectCompany(data.ticker);
        });

        // Listen for filter requests
        this.eventBus.on('user:filter:applied', (data) => {
            if (data.module === this.id) {
                this.applyFilters(data.filters);
            }
        });
    }

    /**
     * Start auto-update
     * @private
     */
    startAutoUpdate() {
        if (this.updateTimer) return;

        this.updateTimer = setInterval(async () => {
            await this.refresh();
        }, this.config.updateInterval);

        console.log('⏱️ Auto-update started');
    }

    /**
     * Stop auto-update
     * @private
     */
    stopAutoUpdate() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
            console.log('⏹️ Auto-update stopped');
        }
    }

    /**
     * Refresh data and view
     */
    async refresh() {
        console.log('🔄 Refreshing M_Company...');

        try {
            await this.loadData();
            await this.calculateMomentum();
            this.render();

            this.eventBus?.emit('momentum:refreshed', {
                module: this.id,
                timestamp: Date.now()
            });

        } catch (error) {
            console.error('❌ Refresh failed:', error);
        }
    }

    /**
     * Load saved state
     * @private
     */
    async loadState() {
        if (!this.stateManager) return;

        const state = this.stateManager.getAllModuleState(this.id);

        if (state.filters) {
            this.applyFilters(state.filters);
        }

        if (state.sort) {
            this.sortCompanies(state.sort.field, state.sort.order);
        }

        if (state.selectedCompanies) {
            this.selectedCompanies = new Set(state.selectedCompanies);
        }

        if (state.comparisonList) {
            this.comparisonList = state.comparisonList;
        }
    }

    /**
     * Save current state
     * @private
     */
    async saveState() {
        if (!this.stateManager) return;

        this.stateManager.setModuleState(this.id, 'selectedCompanies',
            Array.from(this.selectedCompanies));

        this.stateManager.setModuleState(this.id, 'comparisonList',
            this.comparisonList.map(c => c.Ticker));
    }

    /**
     * Clear UI
     * @private
     */
    clearUI() {
        if (this.container) {
            this.container.innerHTML = '';
        }
    }

    /**
     * Utility: Format number
     * @private
     */
    formatNumber(value, decimals = 2) {
        if (value === null || value === undefined || isNaN(value)) return '-';
        return Number(value).toFixed(decimals);
    }

    /**
     * Utility: Format percentage
     * @private
     */
    formatPercent(value) {
        if (value === null || value === undefined || isNaN(value)) return '-';
        const formatted = (value * 100).toFixed(2);
        return value >= 0 ? `+${formatted}%` : `${formatted}%`;
    }

    /**
     * Utility: Format large numbers
     * @private
     */
    formatLargeNumber(value) {
        if (value === null || value === undefined || isNaN(value)) return '-';

        if (value >= 1000000) {
            return (value / 1000000).toFixed(1) + 'T';
        } else if (value >= 1000) {
            return (value / 1000).toFixed(1) + 'B';
        }
        return value.toFixed(0);
    }

    /**
     * Utility: Get nested object value
     * @private
     */
    getNestedValue(obj, path) {
        const keys = path.split('.');
        let value = obj;

        for (const key of keys) {
            value = value?.[key];
            if (value === undefined) break;
        }

        return value;
    }

    /**
     * Export as CSV
     * @private
     */
    exportAsCSV(data) {
        // Implementation will be added
        return '';
    }

    /**
     * Export as Excel
     * @private
     */
    async exportAsExcel(data) {
        // Implementation will be added
        return '';
    }

    /**
     * Download file
     * @private
     */
    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Destroy module
     */
    destroy() {
        this.stopAutoUpdate();
        this.clearUI();
        this.companies = [];
        this.filteredCompanies = [];
        this.rankings.clear();
        console.log('✅ M_Company module destroyed');
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.M_Company = M_Company;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = M_Company;
}