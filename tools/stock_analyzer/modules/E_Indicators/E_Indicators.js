/**
 * E_Indicators.js
 * Main Economic Indicators Module
 * Phase 3 - Economic Indicators Dashboard
 */

class E_Indicators {
    constructor(config = {}) {
        // Module configuration
        this.config = {
            updateInterval: config.updateInterval || 3600000, // 1 hour default
            countries: config.countries || ['US', 'EU', 'JP', 'CN', 'KR'],
            indicators: config.indicators || ['gdp', 'inflation', 'unemployment', 'interestRate'],
            chartTypes: config.chartTypes || ['line', 'area', 'bar'],
            cyclePhases: config.cyclePhases || ['expansion', 'peak', 'contraction', 'trough'],
            theme: config.theme || 'light',
            eventBus: config.eventBus || null,
            autoUpdate: config.autoUpdate !== undefined ? config.autoUpdate : true
        };

        // Initialize data processor
        this.processor = new EconomicDataProcessor();

        // Data storage
        this.data = {};
        this.currentCountry = this.config.countries[0];
        this.currentIndicator = this.config.indicators[0];

        // UI state
        this.isChartVisible = false;
        this.selectedChartType = this.config.chartTypes[0];

        // Event listeners
        this.listeners = new Map();

        // Auto-update timer
        this.updateTimer = null;

        // Initialize
        this.initialize();
    }

    /**
     * Initialize module
     */
    async initialize() {
        // Load initial data if available
        await this.loadInitialData();

        // Start auto-update if configured
        if (this.config.autoUpdate) {
            this.startAutoUpdate();
        }

        // Emit initialization event
        this.emit('initialized', {
            countries: this.config.countries,
            indicators: this.config.indicators
        });
    }

    /**
     * Load initial data
     */
    async loadInitialData() {
        try {
            // In production, this would fetch from API
            // For now, use mock data
            const mockData = this.generateMockData();
            await this.loadData(mockData);
        } catch (error) {
            console.error('Failed to load initial data:', error);
            this.emit('error', { message: 'Failed to load initial data', error });
        }
    }

    /**
     * Load economic data
     */
    async loadData(data) {
        if (!this.validateDataFormat(data)) {
            throw new Error('Invalid economic data format');
        }

        this.data = data;

        // Process data for each country
        this.processedData = {};
        this.config.countries.forEach(country => {
            this.processedData[country] = this.processor.aggregateByCountry(data, country);
        });

        // Calculate rankings
        this.rankings = this.processor.rankCountries(data, this.config.countries);

        // Emit data loaded event
        if (this.config.eventBus) {
            this.config.eventBus.publish({
                type: 'indicators:loaded',
                data: this.processedData
            });
        }

        this.emit('dataLoaded', {
            countries: this.config.countries,
            indicators: Object.keys(data)
        });

        return true;
    }

    /**
     * Validate data format
     */
    validateDataFormat(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }

        // Check for required indicators
        const hasRequiredIndicators = this.config.indicators.some(indicator =>
            data.hasOwnProperty(indicator) && Array.isArray(data[indicator])
        );

        return hasRequiredIndicators;
    }

    /**
     * Parse time series data
     */
    parseTimeSeries(indicator, country) {
        return this.processor.parseTimeSeries(this.data, indicator, country);
    }

    /**
     * Classify economic cycle
     */
    classifyCycle(indicators) {
        return this.processor.classifyCycle(indicators);
    }

    /**
     * Calculate cycle momentum
     */
    calculateCycleMomentum(country) {
        return this.processor.calculateCycleMomentum(this.data, country);
    }

    /**
     * Aggregate indicators by country
     */
    aggregateByCountry(country) {
        return this.processor.aggregateByCountry(this.data, country);
    }

    /**
     * Calculate composite economic index
     */
    calculateCompositeIndex(country) {
        const aggregated = this.aggregateByCountry(country);
        return this.processor.calculateCompositeIndex(aggregated);
    }

    /**
     * Rank countries by economic strength
     */
    rankCountries() {
        return this.processor.rankCountries(this.data, this.config.countries);
    }

    /**
     * Detect economic anomalies
     */
    detectAnomalies(country) {
        return this.processor.detectAnomalies(this.data, country);
    }

    /**
     * Get indicator value
     */
    getIndicator(type, country) {
        const validTypes = this.config.indicators;
        if (!validTypes.includes(type)) {
            throw new Error(`Invalid indicator type: ${type}`);
        }

        const series = this.parseTimeSeries(type, country);
        return series.length > 0 ? series[series.length - 1] : null;
    }

    /**
     * Prepare chart data for visualization
     */
    prepareChartData(chartType, indicator, country) {
        const series = this.parseTimeSeries(indicator, country);

        if (series.length === 0) {
            return { labels: [], datasets: [] };
        }

        const labels = series.map(item => item.date);
        const data = series.map(item => item.value);

        const colors = {
            gdp: 'rgb(54, 162, 235)',
            inflation: 'rgb(255, 99, 132)',
            unemployment: 'rgb(255, 159, 64)',
            interestRate: 'rgb(75, 192, 192)'
        };

        return {
            labels,
            datasets: [{
                label: `${indicator.toUpperCase()} - ${country}`,
                data,
                borderColor: colors[indicator] || 'rgb(201, 203, 207)',
                backgroundColor: colors[indicator] ? colors[indicator].replace('rgb', 'rgba').replace(')', ', 0.1)') : 'rgba(201, 203, 207, 0.1)',
                fill: chartType === 'area',
                tension: 0.1
            }]
        };
    }

    /**
     * Prepare multi-series chart data
     */
    prepareMultiSeriesChart(countries, indicator) {
        const colors = [
            'rgb(54, 162, 235)',
            'rgb(255, 99, 132)',
            'rgb(255, 206, 86)',
            'rgb(75, 192, 192)',
            'rgb(153, 102, 255)'
        ];

        const datasets = countries.map((country, index) => {
            const series = this.parseTimeSeries(indicator, country);
            const data = series.map(item => item.value);

            return {
                label: country,
                data,
                borderColor: colors[index % colors.length],
                backgroundColor: colors[index % colors.length].replace('rgb', 'rgba').replace(')', ', 0.1)'),
                fill: false,
                tension: 0.1
            };
        });

        // Get labels from first country's data
        const firstSeries = this.parseTimeSeries(indicator, countries[0]);
        const labels = firstSeries.map(item => item.date);

        return { labels, datasets };
    }

    /**
     * Prepare heatmap data
     */
    prepareHeatmap() {
        const countries = this.config.countries;
        const indicators = this.config.indicators;
        const values = [];

        countries.forEach((country, countryIndex) => {
            const row = [];
            indicators.forEach((indicator, indicatorIndex) => {
                const aggregated = this.aggregateByCountry(country);
                const value = aggregated[indicator] ? aggregated[indicator].latest : 0;

                // Normalize values for heatmap
                let normalized = 0;
                if (indicator === 'gdp') {
                    normalized = this.processor.normalizeValue(value, -2, 5, 0, 100);
                } else if (indicator === 'inflation') {
                    normalized = this.processor.scoreInflation(value);
                } else if (indicator === 'unemployment') {
                    normalized = this.processor.normalizeValue(value, 10, 3, 0, 100);
                } else if (indicator === 'interestRate') {
                    normalized = this.processor.scoreInterestRate(value);
                }

                row.push({
                    x: indicatorIndex,
                    y: countryIndex,
                    value: normalized,
                    raw: value,
                    country,
                    indicator
                });
            });
            values.push(...row);
        });

        return {
            countries,
            indicators,
            values
        };
    }

    /**
     * Export data in specified format
     */
    exportData(format = 'csv') {
        if (format === 'csv') {
            return this.exportAsCSV();
        } else if (format === 'json') {
            return JSON.stringify(this.data, null, 2);
        } else {
            throw new Error(`Unsupported export format: ${format}`);
        }
    }

    /**
     * Export data as CSV
     */
    exportAsCSV() {
        const rows = ['Country,Indicator,Date,Value'];

        this.config.countries.forEach(country => {
            this.config.indicators.forEach(indicator => {
                const series = this.parseTimeSeries(indicator, country);
                series.forEach(item => {
                    rows.push(`${country},${indicator},${item.date},${item.value}`);
                });
            });
        });

        return rows.join('\n');
    }

    /**
     * Start auto-update
     */
    startAutoUpdate() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }

        this.updateTimer = setInterval(async () => {
            await this.loadRemoteData();

            if (this.config.eventBus) {
                this.config.eventBus.publish({
                    type: 'indicators:update',
                    timestamp: new Date().toISOString()
                });
            }
        }, this.config.updateInterval);
    }

    /**
     * Stop auto-update
     */
    stopAutoUpdate() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
    }

    /**
     * Load remote data (placeholder for API integration)
     */
    async loadRemoteData() {
        try {
            // In production, fetch from API
            // For now, simulate with mock data update
            const mockData = this.generateMockData();
            await this.loadData(mockData);
        } catch (error) {
            throw new Error('Failed to load economic data: ' + error.message);
        }
    }

    /**
     * Subscribe to events
     */
    subscribe(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);

        // Return unsubscribe function
        return () => {
            const callbacks = this.listeners.get(event);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        };
    }

    /**
     * Emit event
     */
    emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event listener for ${event}:`, error);
                }
            });
        }
    }

    /**
     * Render module UI
     */
    render(container) {
        if (!container) {
            throw new Error('Container element is required');
        }

        // Clear existing content
        container.innerHTML = '';

        // Create main dashboard structure
        const dashboard = document.createElement('div');
        dashboard.className = 'e-indicators-dashboard';
        dashboard.innerHTML = this.generateDashboardHTML();

        container.appendChild(dashboard);

        // Attach event listeners
        this.attachEventListeners(dashboard);

        // Initial render of data
        this.updateDashboard();

        return dashboard;
    }

    /**
     * Generate dashboard HTML
     */
    generateDashboardHTML() {
        return `
            <div class="e-indicators-header">
                <h2 class="text-xl font-bold mb-4">
                    <i class="fas fa-chart-line text-blue-600 mr-2"></i>
                    Economic Indicators Dashboard
                </h2>
                <div class="country-selector mb-4">
                    <label class="text-sm font-medium mr-2">Country:</label>
                    <select class="px-3 py-1 border rounded">
                        ${this.config.countries.map(country =>
                            `<option value="${country}" ${country === this.currentCountry ? 'selected' : ''}>
                                ${this.getCountryName(country)}
                            </option>`
                        ).join('')}
                    </select>
                </div>
            </div>

            <div class="cycle-indicator mb-6">
                <div class="bg-gradient-to-r from-blue-50 to-blue-100 p-4 rounded-lg">
                    <div class="flex justify-between items-center">
                        <div>
                            <div class="text-sm text-gray-600">Economic Cycle Phase</div>
                            <div class="cycle-phase text-2xl font-bold text-blue-800">--</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-600">Cycle Momentum</div>
                            <div class="cycle-momentum text-xl font-semibold">--</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-600">Composite Index</div>
                            <div class="composite-index text-xl font-semibold">--</div>
                        </div>
                    </div>
                    <div class="cycle-summary text-sm text-gray-700 mt-2">--</div>
                </div>
            </div>

            <div class="indicator-cards grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                ${this.config.indicators.map(indicator => `
                    <div class="indicator-card bg-white p-4 rounded-lg shadow" data-indicator="${indicator}">
                        <div class="text-xs text-gray-500 uppercase">${this.getIndicatorName(indicator)}</div>
                        <div class="value text-2xl font-bold mt-1">--</div>
                        <div class="change text-sm mt-1">--</div>
                        <div class="sparkline mt-2" style="height: 30px;"></div>
                    </div>
                `).join('')}
            </div>

            <div class="chart-section">
                <div class="chart-controls flex justify-between items-center mb-4">
                    <div class="flex gap-2">
                        <button class="chart-toggle px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600">
                            <i class="fas fa-chart-area mr-1"></i>Charts
                        </button>
                        <button class="heatmap-toggle px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600">
                            <i class="fas fa-th mr-1"></i>Heatmap
                        </button>
                    </div>
                    <div class="chart-type-selector hidden">
                        <select class="px-3 py-1 border rounded">
                            ${this.config.chartTypes.map(type =>
                                `<option value="${type}">${type.charAt(0).toUpperCase() + type.slice(1)}</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
                <div class="chart-container bg-white p-4 rounded-lg shadow hidden">
                    <canvas id="economic-chart"></canvas>
                </div>
                <div class="heatmap-container bg-white p-4 rounded-lg shadow hidden">
                    <div id="economic-heatmap"></div>
                </div>
            </div>

            <div class="anomalies-section mt-6 hidden">
                <h3 class="text-lg font-semibold mb-3">
                    <i class="fas fa-exclamation-triangle text-yellow-500 mr-2"></i>
                    Economic Anomalies
                </h3>
                <div class="anomalies-list"></div>
            </div>
        `;
    }

    /**
     * Get country name
     */
    getCountryName(code) {
        const names = {
            'US': 'United States',
            'EU': 'European Union',
            'JP': 'Japan',
            'CN': 'China',
            'KR': 'South Korea'
        };
        return names[code] || code;
    }

    /**
     * Get indicator name
     */
    getIndicatorName(indicator) {
        const names = {
            'gdp': 'GDP Growth',
            'inflation': 'Inflation',
            'unemployment': 'Unemployment',
            'interestRate': 'Interest Rate'
        };
        return names[indicator] || indicator;
    }

    /**
     * Attach event listeners
     */
    attachEventListeners(dashboard) {
        // Country selector
        const countrySelector = dashboard.querySelector('.country-selector select');
        if (countrySelector) {
            countrySelector.addEventListener('change', (e) => {
                this.currentCountry = e.target.value;
                this.updateDashboard();
                this.emit('countryChanged', { country: this.currentCountry });
            });
        }

        // Chart toggle
        const chartToggle = dashboard.querySelector('.chart-toggle');
        if (chartToggle) {
            chartToggle.addEventListener('click', () => {
                this.toggleChart();
            });
        }

        // Heatmap toggle
        const heatmapToggle = dashboard.querySelector('.heatmap-toggle');
        if (heatmapToggle) {
            heatmapToggle.addEventListener('click', () => {
                this.toggleHeatmap();
            });
        }

        // Chart type selector
        const chartTypeSelector = dashboard.querySelector('.chart-type-selector select');
        if (chartTypeSelector) {
            chartTypeSelector.addEventListener('change', (e) => {
                this.selectedChartType = e.target.value;
                if (this.isChartVisible) {
                    this.updateChart();
                }
            });
        }

        // Indicator cards click
        const indicatorCards = dashboard.querySelectorAll('.indicator-card');
        indicatorCards.forEach(card => {
            card.addEventListener('click', () => {
                const indicator = card.dataset.indicator;
                this.currentIndicator = indicator;
                if (this.isChartVisible) {
                    this.updateChart();
                }
            });
        });
    }

    /**
     * Update dashboard with current data
     */
    updateDashboard() {
        const dashboard = document.querySelector('.e-indicators-dashboard');
        if (!dashboard) return;

        // Update cycle indicator
        const aggregated = this.aggregateByCountry(this.currentCountry);
        const cycleData = {
            gdpGrowth: aggregated.gdp ? aggregated.gdp.latest : 2.0,
            unemployment: aggregated.unemployment ? aggregated.unemployment.latest : 5.0,
            inflation: aggregated.inflation ? aggregated.inflation.latest : 2.0
        };

        const cycle = this.classifyCycle(cycleData);
        const momentum = this.calculateCycleMomentum(this.currentCountry);
        const index = this.calculateCompositeIndex(this.currentCountry);

        // Update cycle phase
        const phaseElement = dashboard.querySelector('.cycle-phase');
        if (phaseElement) {
            phaseElement.textContent = cycle.phase.charAt(0).toUpperCase() + cycle.phase.slice(1);
            phaseElement.className = `cycle-phase text-2xl font-bold ${this.getPhaseColor(cycle.phase)}`;
        }

        // Update momentum
        const momentumElement = dashboard.querySelector('.cycle-momentum');
        if (momentumElement) {
            const arrow = momentum.score > 0 ? '↑' : momentum.score < 0 ? '↓' : '→';
            momentumElement.innerHTML = `${arrow} ${momentum.score} (${momentum.trend})`;
            momentumElement.className = `cycle-momentum text-xl font-semibold ${this.getTrendColor(momentum.trend)}`;
        }

        // Update composite index
        const indexElement = dashboard.querySelector('.composite-index');
        if (indexElement) {
            indexElement.textContent = `${index.value}/100`;
            indexElement.className = `composite-index text-xl font-semibold ${this.getIndexColor(index.value)}`;
        }

        // Update summary
        const summaryElement = dashboard.querySelector('.cycle-summary');
        if (summaryElement) {
            summaryElement.textContent = cycle.summary;
        }

        // Update indicator cards
        this.config.indicators.forEach(indicator => {
            const card = dashboard.querySelector(`.indicator-card[data-indicator="${indicator}"]`);
            if (card) {
                const data = aggregated[indicator];
                if (data && data.latest !== null) {
                    card.querySelector('.value').textContent = this.formatValue(data.latest, indicator);

                    const changeElement = card.querySelector('.change');
                    const changeText = data.change >= 0 ? '+' : '';
                    changeElement.innerHTML = `${changeText}${data.change.toFixed(2)} (${changeText}${data.changePercent.toFixed(1)}%)`;
                    changeElement.className = `change text-sm mt-1 ${data.change >= 0 ? 'text-green-600' : 'text-red-600'}`;

                    // Draw sparkline
                    this.drawSparkline(card.querySelector('.sparkline'), data.series || []);
                } else {
                    card.querySelector('.value').textContent = '--';
                    card.querySelector('.change').textContent = '--';
                }
            }
        });

        // Update anomalies
        this.updateAnomalies();
    }

    /**
     * Format value based on indicator type
     */
    formatValue(value, indicator) {
        if (value === null || value === undefined) return '--';

        if (indicator === 'gdp' || indicator === 'inflation' || indicator === 'unemployment' || indicator === 'interestRate') {
            return value.toFixed(2) + '%';
        }
        return value.toFixed(2);
    }

    /**
     * Get phase color class
     */
    getPhaseColor(phase) {
        const colors = {
            'expansion': 'text-green-600',
            'peak': 'text-yellow-600',
            'contraction': 'text-orange-600',
            'trough': 'text-red-600',
            'unknown': 'text-gray-600'
        };
        return colors[phase] || 'text-gray-600';
    }

    /**
     * Get trend color class
     */
    getTrendColor(trend) {
        const colors = {
            'bullish': 'text-green-600',
            'bearish': 'text-red-600',
            'neutral': 'text-gray-600'
        };
        return colors[trend] || 'text-gray-600';
    }

    /**
     * Get index color class
     */
    getIndexColor(value) {
        if (value >= 70) return 'text-green-600';
        if (value >= 40) return 'text-yellow-600';
        return 'text-red-600';
    }

    /**
     * Draw sparkline chart
     */
    drawSparkline(container, series) {
        if (!container || !series || series.length < 2) return;

        // Simple SVG sparkline
        const width = 100;
        const height = 30;
        const values = series.slice(-10).map(item => item.value); // Last 10 points

        if (values.length === 0) return;

        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;

        const points = values.map((value, i) => {
            const x = (i / (values.length - 1)) * width;
            const y = height - ((value - min) / range) * height;
            return `${x},${y}`;
        }).join(' ');

        container.innerHTML = `
            <svg width="${width}" height="${height}" class="sparkline-svg">
                <polyline
                    points="${points}"
                    fill="none"
                    stroke="#3b82f6"
                    stroke-width="2"
                />
            </svg>
        `;
    }

    /**
     * Toggle chart visibility
     */
    toggleChart() {
        const container = document.querySelector('.chart-container');
        const typeSelector = document.querySelector('.chart-type-selector');

        if (container) {
            this.isChartVisible = !this.isChartVisible;
            container.classList.toggle('hidden');
            typeSelector.classList.toggle('hidden');

            if (this.isChartVisible) {
                this.updateChart();
            }
        }
    }

    /**
     * Toggle heatmap visibility
     */
    toggleHeatmap() {
        const container = document.querySelector('.heatmap-container');

        if (container) {
            const isVisible = !container.classList.contains('hidden');
            container.classList.toggle('hidden');

            if (!isVisible) {
                this.renderHeatmap();
            }
        }
    }

    /**
     * Update chart
     */
    updateChart() {
        const canvas = document.getElementById('economic-chart');
        if (!canvas) return;

        // Prepare chart data
        const chartData = this.prepareChartData(
            this.selectedChartType,
            this.currentIndicator,
            this.currentCountry
        );

        // Create or update chart
        const ctx = canvas.getContext('2d');

        if (this.chart) {
            this.chart.destroy();
        }

        this.chart = new Chart(ctx, {
            type: this.selectedChartType === 'area' ? 'line' : this.selectedChartType,
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false
                    }
                }
            }
        });
    }

    /**
     * Render heatmap
     */
    renderHeatmap() {
        const container = document.getElementById('economic-heatmap');
        if (!container) return;

        const heatmapData = this.prepareHeatmap();

        // Simple HTML table heatmap (would use D3.js in production)
        let html = '<table class="heatmap-table w-full">';
        html += '<thead><tr><th></th>';

        heatmapData.indicators.forEach(indicator => {
            html += `<th class="text-xs">${this.getIndicatorName(indicator)}</th>`;
        });
        html += '</tr></thead><tbody>';

        heatmapData.countries.forEach((country, countryIndex) => {
            html += `<tr><td class="font-semibold">${this.getCountryName(country)}</td>`;

            heatmapData.indicators.forEach((indicator, indicatorIndex) => {
                const cell = heatmapData.values.find(
                    v => v.x === indicatorIndex && v.y === countryIndex
                );

                if (cell) {
                    const color = this.getHeatmapColor(cell.value);
                    html += `<td style="background-color: ${color}" class="text-center p-2" title="${cell.raw?.toFixed(2) || '--'}">
                        ${cell.raw?.toFixed(1) || '--'}
                    </td>`;
                } else {
                    html += '<td class="text-center p-2">--</td>';
                }
            });

            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    /**
     * Get heatmap color
     */
    getHeatmapColor(value) {
        if (value >= 80) return 'rgba(34, 197, 94, 0.8)'; // Green
        if (value >= 60) return 'rgba(132, 204, 22, 0.6)'; // Light green
        if (value >= 40) return 'rgba(250, 204, 21, 0.6)'; // Yellow
        if (value >= 20) return 'rgba(251, 146, 60, 0.6)'; // Orange
        return 'rgba(239, 68, 68, 0.8)'; // Red
    }

    /**
     * Update anomalies section
     */
    updateAnomalies() {
        const anomalies = this.detectAnomalies(this.currentCountry);
        const section = document.querySelector('.anomalies-section');
        const list = document.querySelector('.anomalies-list');

        if (!section || !list) return;

        if (anomalies.length > 0) {
            section.classList.remove('hidden');

            list.innerHTML = anomalies.map(anomaly => `
                <div class="anomaly-item bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-2">
                    <div class="flex items-start">
                        <i class="fas fa-exclamation-circle text-yellow-600 mt-1 mr-2"></i>
                        <div>
                            <div class="font-semibold">${anomaly.indicator}</div>
                            <div class="text-sm text-gray-700">${anomaly.message}</div>
                            <div class="text-xs text-gray-500 mt-1">
                                Current value: ${anomaly.value?.toFixed(2) || '--'}% | Severity: ${anomaly.severity}
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
        } else {
            section.classList.add('hidden');
        }
    }

    /**
     * Generate mock data for testing
     */
    generateMockData() {
        const data = {};
        const quarters = ['2023-Q3', '2023-Q4', '2024-Q1', '2024-Q2', '2024-Q3'];
        const months = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06'];

        // GDP data (quarterly)
        data.gdp = [];
        this.config.countries.forEach(country => {
            quarters.forEach((quarter, i) => {
                data.gdp.push({
                    date: quarter,
                    value: 1.5 + Math.random() * 3 + (i * 0.2),
                    country: country
                });
            });
        });

        // Inflation data (monthly)
        data.inflation = [];
        this.config.countries.forEach(country => {
            months.forEach((month, i) => {
                data.inflation.push({
                    date: month,
                    value: 2 + Math.random() * 2,
                    country: country
                });
            });
        });

        // Unemployment data (monthly)
        data.unemployment = [];
        this.config.countries.forEach(country => {
            months.forEach((month, i) => {
                data.unemployment.push({
                    date: month,
                    value: 3 + Math.random() * 4,
                    country: country
                });
            });
        });

        // Interest rate data (monthly)
        data.interestRate = [];
        this.config.countries.forEach(country => {
            months.forEach((month, i) => {
                data.interestRate.push({
                    date: month,
                    value: 2 + Math.random() * 4,
                    country: country
                });
            });
        });

        return data;
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stopAutoUpdate();

        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }

        this.listeners.clear();
        this.data = {};
        this.processedData = {};
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = E_Indicators;
} else {
    window.E_Indicators = E_Indicators;
}