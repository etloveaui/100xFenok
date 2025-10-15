/**
 * Company Comparison Module
 * Enables side-by-side comparison of multiple companies
 * @module CompanyComparison
 * @version 1.0.0
 */

class CompanyComparison {
    constructor(config = {}) {
        this.config = {
            maxCompanies: config.maxCompanies || 5,
            theme: config.theme || 'light',
            chartTypes: config.chartTypes || ['line', 'bar', 'radar'],
            metrics: config.metrics || [
                'momentum',
                'valuation',
                'financials',
                'technical',
                'performance'
            ],
            ...config
        };

        this.companies = new Map();
        this.container = null;
        this.chartInstances = new Map();
        this.activeMetric = 'momentum';
        this.eventHandlers = new Map();
    }

    /**
     * Initialize comparison view
     * @param {HTMLElement} container - Container element
     * @param {Array} companies - Initial companies to compare
     */
    initialize(container, companies = []) {
        this.container = container;
        this.container.className = `company-comparison ${this.config.theme}`;

        // Add initial companies
        companies.forEach(company => {
            if (this.companies.size < this.config.maxCompanies) {
                this.addCompany(company);
            }
        });

        // Render comparison view
        this.render();

        return this;
    }

    /**
     * Add company to comparison
     * @param {Object} company - Company data
     * @returns {boolean} Success status
     */
    addCompany(company) {
        if (this.companies.size >= this.config.maxCompanies) {
            console.warn(`Maximum ${this.config.maxCompanies} companies allowed for comparison`);
            return false;
        }

        if (this.companies.has(company.ticker)) {
            console.warn(`Company ${company.ticker} already in comparison`);
            return false;
        }

        this.companies.set(company.ticker, {
            ...company,
            color: this.getCompanyColor(this.companies.size)
        });

        // Re-render if already initialized
        if (this.container) {
            this.render();
        }

        // Trigger event
        this.triggerEvent('companyAdded', company);

        return true;
    }

    /**
     * Remove company from comparison
     * @param {string} ticker - Company ticker
     * @returns {boolean} Success status
     */
    removeCompany(ticker) {
        if (!this.companies.has(ticker)) {
            return false;
        }

        const company = this.companies.get(ticker);
        this.companies.delete(ticker);

        // Re-render if initialized
        if (this.container) {
            this.render();
        }

        // Trigger event
        this.triggerEvent('companyRemoved', company);

        return true;
    }

    /**
     * Render comparison view
     * @private
     */
    render() {
        if (!this.container) return;

        // Clear container
        this.container.innerHTML = '';

        // Check if there are companies to compare
        if (this.companies.size === 0) {
            this.renderEmptyState();
            return;
        }

        // Create layout
        const header = this.createHeader();
        const controls = this.createControls();
        const content = this.createContent();
        const footer = this.createFooter();

        this.container.appendChild(header);
        this.container.appendChild(controls);
        this.container.appendChild(content);
        this.container.appendChild(footer);

        // Render active metric
        this.renderMetric(this.activeMetric);
    }

    /**
     * Render empty state
     * @private
     */
    renderEmptyState() {
        this.container.innerHTML = `
            <div class="comparison-empty">
                <i class="icon-compare-large"></i>
                <h3>No Companies Selected</h3>
                <p>Add companies to start comparing</p>
                <button class="btn btn-primary" data-action="add-company">
                    <i class="icon-plus"></i> Add Company
                </button>
            </div>
        `;

        // Bind add company action
        const addBtn = this.container.querySelector('[data-action="add-company"]');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.triggerEvent('requestAddCompany'));
        }
    }

    /**
     * Create comparison header
     * @private
     * @returns {HTMLElement} Header element
     */
    createHeader() {
        const header = document.createElement('div');
        header.className = 'comparison-header';

        // Title
        const title = document.createElement('h2');
        title.textContent = 'Company Comparison';
        header.appendChild(title);

        // Company list
        const companyList = document.createElement('div');
        companyList.className = 'company-list';

        Array.from(this.companies.values()).forEach(company => {
            const companyItem = document.createElement('div');
            companyItem.className = 'company-item';
            companyItem.innerHTML = `
                <span class="company-color" style="background-color: ${company.color}"></span>
                <span class="company-name">${company.name}</span>
                <span class="company-ticker">(${company.ticker})</span>
                <button class="btn-remove" data-ticker="${company.ticker}">
                    <i class="icon-close"></i>
                </button>
            `;
            companyList.appendChild(companyItem);
        });

        // Add company button
        if (this.companies.size < this.config.maxCompanies) {
            const addBtn = document.createElement('button');
            addBtn.className = 'btn btn-add-company';
            addBtn.innerHTML = '<i class="icon-plus"></i> Add Company';
            addBtn.addEventListener('click', () => this.triggerEvent('requestAddCompany'));
            companyList.appendChild(addBtn);
        }

        header.appendChild(companyList);

        // Bind remove handlers
        header.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.btn-remove');
            if (removeBtn) {
                this.removeCompany(removeBtn.dataset.ticker);
            }
        });

        return header;
    }

    /**
     * Create comparison controls
     * @private
     * @returns {HTMLElement} Controls element
     */
    createControls() {
        const controls = document.createElement('div');
        controls.className = 'comparison-controls';

        // Metric selector
        const metricSelector = document.createElement('div');
        metricSelector.className = 'metric-selector';

        this.config.metrics.forEach(metric => {
            const btn = document.createElement('button');
            btn.className = `metric-btn ${metric === this.activeMetric ? 'active' : ''}`;
            btn.dataset.metric = metric;
            btn.textContent = this.getMetricLabel(metric);
            btn.addEventListener('click', () => this.selectMetric(metric));
            metricSelector.appendChild(btn);
        });

        controls.appendChild(metricSelector);

        // View options
        const viewOptions = document.createElement('div');
        viewOptions.className = 'view-options';
        viewOptions.innerHTML = `
            <button class="btn btn-icon" data-action="toggle-chart" title="Toggle Chart">
                <i class="icon-chart"></i>
            </button>
            <button class="btn btn-icon" data-action="toggle-table" title="Toggle Table">
                <i class="icon-table"></i>
            </button>
            <button class="btn btn-icon" data-action="export" title="Export">
                <i class="icon-download"></i>
            </button>
        `;

        controls.appendChild(viewOptions);

        // Bind view option handlers
        viewOptions.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (btn) {
                this.handleViewAction(btn.dataset.action);
            }
        });

        return controls;
    }

    /**
     * Create comparison content area
     * @private
     * @returns {HTMLElement} Content element
     */
    createContent() {
        const content = document.createElement('div');
        content.className = 'comparison-content';
        content.id = 'comparison-content';

        // Chart container
        const chartContainer = document.createElement('div');
        chartContainer.className = 'chart-container';
        chartContainer.id = 'comparison-chart';
        content.appendChild(chartContainer);

        // Table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-container';
        tableContainer.id = 'comparison-table';
        content.appendChild(tableContainer);

        return content;
    }

    /**
     * Create comparison footer
     * @private
     * @returns {HTMLElement} Footer element
     */
    createFooter() {
        const footer = document.createElement('div');
        footer.className = 'comparison-footer';

        footer.innerHTML = `
            <div class="footer-info">
                <span>Comparing ${this.companies.size} companies</span>
                <span>Last updated: ${new Date().toLocaleTimeString()}</span>
            </div>
            <div class="footer-actions">
                <button class="btn btn-link" data-action="refresh">
                    <i class="icon-refresh"></i> Refresh
                </button>
                <button class="btn btn-link" data-action="reset">
                    <i class="icon-reset"></i> Reset
                </button>
            </div>
        `;

        // Bind footer actions
        footer.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (btn) {
                this.handleFooterAction(btn.dataset.action);
            }
        });

        return footer;
    }

    /**
     * Select and render metric
     * @private
     * @param {string} metric - Metric to display
     */
    selectMetric(metric) {
        this.activeMetric = metric;

        // Update button states
        const buttons = this.container.querySelectorAll('.metric-btn');
        buttons.forEach(btn => {
            if (btn.dataset.metric === metric) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Render metric
        this.renderMetric(metric);
    }

    /**
     * Render metric comparison
     * @private
     * @param {string} metric - Metric type
     */
    renderMetric(metric) {
        switch (metric) {
            case 'momentum':
                this.renderMomentumComparison();
                break;
            case 'valuation':
                this.renderValuationComparison();
                break;
            case 'financials':
                this.renderFinancialsComparison();
                break;
            case 'technical':
                this.renderTechnicalComparison();
                break;
            case 'performance':
                this.renderPerformanceComparison();
                break;
            default:
                console.warn(`Unknown metric: ${metric}`);
        }
    }

    /**
     * Render momentum comparison
     * @private
     */
    renderMomentumComparison() {
        const chartContainer = document.getElementById('comparison-chart');
        const tableContainer = document.getElementById('comparison-table');

        // Prepare data
        const companies = Array.from(this.companies.values());
        const categories = ['Price', 'Volume', 'Earnings', 'Technical', 'Overall'];

        const chartData = {
            labels: categories,
            datasets: companies.map(company => ({
                label: company.ticker,
                data: [
                    company.momentum?.priceMomentum || 0,
                    company.momentum?.volumeMomentum || 0,
                    company.momentum?.earningsMomentum || 0,
                    company.momentum?.technicalMomentum || 0,
                    company.momentum?.overallScore || 0
                ],
                backgroundColor: company.color + '40',
                borderColor: company.color,
                borderWidth: 2
            }))
        };

        // Render chart
        this.renderRadarChart(chartContainer, chartData);

        // Render table
        const tableHTML = `
            <table class="comparison-table">
                <thead>
                    <tr>
                        <th>Metric</th>
                        ${companies.map(c => `<th>${c.ticker}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Overall Score</td>
                        ${companies.map(c => `<td class="value">${c.momentum?.overallScore || 0}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Rank</td>
                        ${companies.map(c => `<td>${c.momentum?.rank || 'N/A'}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>1M Return</td>
                        ${companies.map(c => `<td class="${this.getReturnClass(c.momentum?.return1M)}">${this.formatPercent(c.momentum?.return1M)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>3M Return</td>
                        ${companies.map(c => `<td class="${this.getReturnClass(c.momentum?.return3M)}">${this.formatPercent(c.momentum?.return3M)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>6M Return</td>
                        ${companies.map(c => `<td class="${this.getReturnClass(c.momentum?.return6M)}">${this.formatPercent(c.momentum?.return6M)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>1Y Return</td>
                        ${companies.map(c => `<td class="${this.getReturnClass(c.momentum?.return1Y)}">${this.formatPercent(c.momentum?.return1Y)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Volatility</td>
                        ${companies.map(c => `<td>${this.formatPercent(c.momentum?.volatility)}</td>`).join('')}
                    </tr>
                </tbody>
            </table>
        `;

        tableContainer.innerHTML = tableHTML;
    }

    /**
     * Render valuation comparison
     * @private
     */
    renderValuationComparison() {
        const chartContainer = document.getElementById('comparison-chart');
        const tableContainer = document.getElementById('comparison-table');

        // Prepare data
        const companies = Array.from(this.companies.values());
        const metrics = ['P/E', 'P/B', 'P/S', 'EV/EBITDA', 'PEG'];

        const chartData = {
            labels: companies.map(c => c.ticker),
            datasets: metrics.map((metric, index) => ({
                label: metric,
                data: companies.map(c => this.getValuationMetric(c, metric)),
                backgroundColor: this.getMetricColor(index),
                borderWidth: 1
            }))
        };

        // Render chart
        this.renderBarChart(chartContainer, chartData);

        // Render table
        const tableHTML = `
            <table class="comparison-table">
                <thead>
                    <tr>
                        <th>Metric</th>
                        ${companies.map(c => `<th>${c.ticker}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Market Cap</td>
                        ${companies.map(c => `<td>$${this.formatNumber(c.marketCap || 0)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>P/E Ratio</td>
                        ${companies.map(c => `<td>${(c.valuation?.pe || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>P/B Ratio</td>
                        ${companies.map(c => `<td>${(c.valuation?.pb || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>P/S Ratio</td>
                        ${companies.map(c => `<td>${(c.valuation?.ps || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>PEG Ratio</td>
                        ${companies.map(c => `<td>${(c.valuation?.peg || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>EV/EBITDA</td>
                        ${companies.map(c => `<td>${(c.valuation?.evEbitda || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Dividend Yield</td>
                        ${companies.map(c => `<td>${this.formatPercent(c.valuation?.dividendYield)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>FCF Yield</td>
                        ${companies.map(c => `<td>${this.formatPercent(c.valuation?.fcfYield)}</td>`).join('')}
                    </tr>
                </tbody>
            </table>
        `;

        tableContainer.innerHTML = tableHTML;
    }

    /**
     * Render financials comparison
     * @private
     */
    renderFinancialsComparison() {
        const chartContainer = document.getElementById('comparison-chart');
        const tableContainer = document.getElementById('comparison-table');

        // Prepare data
        const companies = Array.from(this.companies.values());

        // Revenue and profit comparison
        const chartData = {
            labels: companies.map(c => c.ticker),
            datasets: [
                {
                    label: 'Revenue',
                    data: companies.map(c => c.financials?.revenue || 0),
                    backgroundColor: '#4CAF50',
                    yAxisID: 'y1'
                },
                {
                    label: 'Net Income',
                    data: companies.map(c => c.financials?.netIncome || 0),
                    backgroundColor: '#2196F3',
                    yAxisID: 'y2'
                }
            ]
        };

        // Render chart
        this.renderDoubleBarChart(chartContainer, chartData);

        // Render table
        const tableHTML = `
            <table class="comparison-table">
                <thead>
                    <tr>
                        <th>Metric</th>
                        ${companies.map(c => `<th>${c.ticker}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    <tr class="section-header">
                        <td colspan="${companies.length + 1}">Income Statement</td>
                    </tr>
                    <tr>
                        <td>Revenue</td>
                        ${companies.map(c => `<td>$${this.formatNumber(c.financials?.revenue || 0)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Gross Profit</td>
                        ${companies.map(c => `<td>$${this.formatNumber(c.financials?.grossProfit || 0)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Operating Income</td>
                        ${companies.map(c => `<td>$${this.formatNumber(c.financials?.operatingIncome || 0)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Net Income</td>
                        ${companies.map(c => `<td>$${this.formatNumber(c.financials?.netIncome || 0)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>EPS</td>
                        ${companies.map(c => `<td>$${(c.financials?.eps || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr class="section-header">
                        <td colspan="${companies.length + 1}">Margins</td>
                    </tr>
                    <tr>
                        <td>Gross Margin</td>
                        ${companies.map(c => `<td>${this.formatPercent(c.financials?.grossMargin)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Operating Margin</td>
                        ${companies.map(c => `<td>${this.formatPercent(c.financials?.operatingMargin)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Net Margin</td>
                        ${companies.map(c => `<td>${this.formatPercent(c.financials?.netMargin)}</td>`).join('')}
                    </tr>
                    <tr class="section-header">
                        <td colspan="${companies.length + 1}">Returns</td>
                    </tr>
                    <tr>
                        <td>ROE</td>
                        ${companies.map(c => `<td>${this.formatPercent(c.financials?.roe)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>ROA</td>
                        ${companies.map(c => `<td>${this.formatPercent(c.financials?.roa)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>ROIC</td>
                        ${companies.map(c => `<td>${this.formatPercent(c.financials?.roic)}</td>`).join('')}
                    </tr>
                </tbody>
            </table>
        `;

        tableContainer.innerHTML = tableHTML;
    }

    /**
     * Render technical comparison
     * @private
     */
    renderTechnicalComparison() {
        const chartContainer = document.getElementById('comparison-chart');
        const tableContainer = document.getElementById('comparison-table');

        // Prepare data
        const companies = Array.from(this.companies.values());

        // Technical indicators comparison
        const indicators = ['RSI', 'MACD', 'Stochastic', 'ATR', 'Bollinger'];

        const chartData = {
            labels: indicators,
            datasets: companies.map(company => ({
                label: company.ticker,
                data: [
                    this.normalizeIndicator(company.technical?.rsi, 0, 100),
                    this.normalizeIndicator(company.technical?.macd, -100, 100),
                    this.normalizeIndicator(company.technical?.stochastic, 0, 100),
                    this.normalizeIndicator(company.technical?.atr, 0, 50),
                    this.normalizeIndicator(company.technical?.bollingerBand, -2, 2)
                ],
                backgroundColor: company.color + '40',
                borderColor: company.color,
                borderWidth: 2
            }))
        };

        // Render chart
        this.renderRadarChart(chartContainer, chartData);

        // Render table
        const tableHTML = `
            <table class="comparison-table">
                <thead>
                    <tr>
                        <th>Indicator</th>
                        ${companies.map(c => `<th>${c.ticker}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Current Price</td>
                        ${companies.map(c => `<td>$${(c.price || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>52W Range</td>
                        ${companies.map(c => `<td>$${(c.week52Low || 0).toFixed(2)} - $${(c.week52High || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>SMA 20</td>
                        ${companies.map(c => `<td>$${(c.technical?.sma20 || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>SMA 50</td>
                        ${companies.map(c => `<td>$${(c.technical?.sma50 || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>SMA 200</td>
                        ${companies.map(c => `<td>$${(c.technical?.sma200 || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>RSI (14)</td>
                        ${companies.map(c => `<td class="${this.getRSIClass(c.technical?.rsi)}">${(c.technical?.rsi || 0).toFixed(1)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>MACD</td>
                        ${companies.map(c => `<td class="${c.technical?.macdSignal > 0 ? 'bullish' : 'bearish'}">${(c.technical?.macd || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Stochastic</td>
                        ${companies.map(c => `<td class="${this.getStochasticClass(c.technical?.stochastic)}">${(c.technical?.stochastic || 0).toFixed(1)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Volume</td>
                        ${companies.map(c => `<td>${this.formatNumber(c.volume || 0)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Avg Volume</td>
                        ${companies.map(c => `<td>${this.formatNumber(c.avgVolume || 0)}</td>`).join('')}
                    </tr>
                </tbody>
            </table>
        `;

        tableContainer.innerHTML = tableHTML;
    }

    /**
     * Render performance comparison
     * @private
     */
    renderPerformanceComparison() {
        const chartContainer = document.getElementById('comparison-chart');
        const tableContainer = document.getElementById('comparison-table');

        // Prepare data
        const companies = Array.from(this.companies.values());
        const periods = ['1D', '1W', '1M', '3M', '6M', '1Y', 'YTD'];

        const chartData = {
            labels: periods,
            datasets: companies.map(company => ({
                label: company.ticker,
                data: [
                    company.performance?.return1D || 0,
                    company.performance?.return1W || 0,
                    company.performance?.return1M || 0,
                    company.performance?.return3M || 0,
                    company.performance?.return6M || 0,
                    company.performance?.return1Y || 0,
                    company.performance?.returnYTD || 0
                ],
                borderColor: company.color,
                backgroundColor: company.color + '20',
                fill: false,
                tension: 0.1
            }))
        };

        // Render chart
        this.renderLineChart(chartContainer, chartData);

        // Render table
        const tableHTML = `
            <table class="comparison-table">
                <thead>
                    <tr>
                        <th>Period</th>
                        ${companies.map(c => `<th>${c.ticker}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>1 Day</td>
                        ${companies.map(c => `<td class="${this.getReturnClass(c.performance?.return1D)}">${this.formatPercent(c.performance?.return1D)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>1 Week</td>
                        ${companies.map(c => `<td class="${this.getReturnClass(c.performance?.return1W)}">${this.formatPercent(c.performance?.return1W)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>1 Month</td>
                        ${companies.map(c => `<td class="${this.getReturnClass(c.performance?.return1M)}">${this.formatPercent(c.performance?.return1M)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>3 Months</td>
                        ${companies.map(c => `<td class="${this.getReturnClass(c.performance?.return3M)}">${this.formatPercent(c.performance?.return3M)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>6 Months</td>
                        ${companies.map(c => `<td class="${this.getReturnClass(c.performance?.return6M)}">${this.formatPercent(c.performance?.return6M)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>1 Year</td>
                        ${companies.map(c => `<td class="${this.getReturnClass(c.performance?.return1Y)}">${this.formatPercent(c.performance?.return1Y)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>YTD</td>
                        ${companies.map(c => `<td class="${this.getReturnClass(c.performance?.returnYTD)}">${this.formatPercent(c.performance?.returnYTD)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>3 Year</td>
                        ${companies.map(c => `<td class="${this.getReturnClass(c.performance?.return3Y)}">${this.formatPercent(c.performance?.return3Y)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>5 Year</td>
                        ${companies.map(c => `<td class="${this.getReturnClass(c.performance?.return5Y)}">${this.formatPercent(c.performance?.return5Y)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Max Drawdown</td>
                        ${companies.map(c => `<td class="negative">${this.formatPercent(c.performance?.maxDrawdown)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Sharpe Ratio</td>
                        ${companies.map(c => `<td>${(c.performance?.sharpeRatio || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>Beta</td>
                        ${companies.map(c => `<td>${(c.performance?.beta || 0).toFixed(2)}</td>`).join('')}
                    </tr>
                </tbody>
            </table>
        `;

        tableContainer.innerHTML = tableHTML;
    }

    /**
     * Render radar chart
     * @private
     * @param {HTMLElement} container - Chart container
     * @param {Object} data - Chart data
     */
    renderRadarChart(container, data) {
        // Placeholder for actual chart rendering
        // In a real implementation, this would use a charting library like Chart.js
        container.innerHTML = `
            <div class="chart-placeholder radar-chart">
                <h3>Radar Chart</h3>
                <p>Comparing ${data.datasets.length} companies across ${data.labels.length} metrics</p>
            </div>
        `;
    }

    /**
     * Render bar chart
     * @private
     * @param {HTMLElement} container - Chart container
     * @param {Object} data - Chart data
     */
    renderBarChart(container, data) {
        // Placeholder for actual chart rendering
        container.innerHTML = `
            <div class="chart-placeholder bar-chart">
                <h3>Bar Chart</h3>
                <p>Comparing ${data.labels.length} companies</p>
            </div>
        `;
    }

    /**
     * Render double bar chart
     * @private
     * @param {HTMLElement} container - Chart container
     * @param {Object} data - Chart data
     */
    renderDoubleBarChart(container, data) {
        // Placeholder for actual chart rendering
        container.innerHTML = `
            <div class="chart-placeholder double-bar-chart">
                <h3>Financial Comparison</h3>
                <p>Revenue vs Net Income comparison</p>
            </div>
        `;
    }

    /**
     * Render line chart
     * @private
     * @param {HTMLElement} container - Chart container
     * @param {Object} data - Chart data
     */
    renderLineChart(container, data) {
        // Placeholder for actual chart rendering
        container.innerHTML = `
            <div class="chart-placeholder line-chart">
                <h3>Performance Over Time</h3>
                <p>Tracking ${data.datasets.length} companies across ${data.labels.length} periods</p>
            </div>
        `;
    }

    /**
     * Handle view action
     * @private
     * @param {string} action - Action type
     */
    handleViewAction(action) {
        switch (action) {
            case 'toggle-chart':
                this.toggleChart();
                break;
            case 'toggle-table':
                this.toggleTable();
                break;
            case 'export':
                this.exportComparison();
                break;
        }
    }

    /**
     * Handle footer action
     * @private
     * @param {string} action - Action type
     */
    handleFooterAction(action) {
        switch (action) {
            case 'refresh':
                this.refresh();
                break;
            case 'reset':
                this.reset();
                break;
        }
    }

    /**
     * Toggle chart visibility
     * @private
     */
    toggleChart() {
        const chart = document.getElementById('comparison-chart');
        if (chart) {
            chart.style.display = chart.style.display === 'none' ? 'block' : 'none';
        }
    }

    /**
     * Toggle table visibility
     * @private
     */
    toggleTable() {
        const table = document.getElementById('comparison-table');
        if (table) {
            table.style.display = table.style.display === 'none' ? 'block' : 'none';
        }
    }

    /**
     * Export comparison data
     * @private
     */
    exportComparison() {
        const data = {
            companies: Array.from(this.companies.values()),
            metric: this.activeMetric,
            timestamp: new Date().toISOString()
        };

        this.triggerEvent('export', data);
    }

    /**
     * Refresh comparison data
     * @private
     */
    refresh() {
        this.triggerEvent('refresh', Array.from(this.companies.keys()));
        this.render();
    }

    /**
     * Reset comparison
     * @private
     */
    reset() {
        this.companies.clear();
        this.render();
        this.triggerEvent('reset');
    }

    /**
     * Get company color
     * @private
     * @param {number} index - Company index
     * @returns {string} Color hex code
     */
    getCompanyColor(index) {
        const colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336'];
        return colors[index % colors.length];
    }

    /**
     * Get metric label
     * @private
     * @param {string} metric - Metric key
     * @returns {string} Display label
     */
    getMetricLabel(metric) {
        const labels = {
            momentum: 'Momentum',
            valuation: 'Valuation',
            financials: 'Financials',
            technical: 'Technical',
            performance: 'Performance'
        };
        return labels[metric] || metric;
    }

    /**
     * Get valuation metric value
     * @private
     * @param {Object} company - Company data
     * @param {string} metric - Metric name
     * @returns {number} Metric value
     */
    getValuationMetric(company, metric) {
        const map = {
            'P/E': company.valuation?.pe,
            'P/B': company.valuation?.pb,
            'P/S': company.valuation?.ps,
            'EV/EBITDA': company.valuation?.evEbitda,
            'PEG': company.valuation?.peg
        };
        return map[metric] || 0;
    }

    /**
     * Get metric color
     * @private
     * @param {number} index - Metric index
     * @returns {string} Color hex code
     */
    getMetricColor(index) {
        const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF'];
        return colors[index % colors.length];
    }

    /**
     * Normalize indicator value
     * @private
     * @param {number} value - Indicator value
     * @param {number} min - Minimum range
     * @param {number} max - Maximum range
     * @returns {number} Normalized value (0-100)
     */
    normalizeIndicator(value, min, max) {
        if (!value && value !== 0) return 0;
        return ((value - min) / (max - min)) * 100;
    }

    /**
     * Format number
     * @private
     * @param {number} num - Number to format
     * @returns {string} Formatted number
     */
    formatNumber(num) {
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
        return num.toLocaleString();
    }

    /**
     * Format percentage
     * @private
     * @param {number} value - Value to format
     * @returns {string} Formatted percentage
     */
    formatPercent(value) {
        if (!value && value !== 0) return 'N/A';
        return (value > 0 ? '+' : '') + (value * 100).toFixed(2) + '%';
    }

    /**
     * Get return class
     * @private
     * @param {number} value - Return value
     * @returns {string} CSS class
     */
    getReturnClass(value) {
        if (!value && value !== 0) return '';
        return value >= 0 ? 'positive' : 'negative';
    }

    /**
     * Get RSI class
     * @private
     * @param {number} rsi - RSI value
     * @returns {string} CSS class
     */
    getRSIClass(rsi) {
        if (!rsi) return '';
        if (rsi >= 70) return 'overbought';
        if (rsi <= 30) return 'oversold';
        return 'neutral';
    }

    /**
     * Get Stochastic class
     * @private
     * @param {number} value - Stochastic value
     * @returns {string} CSS class
     */
    getStochasticClass(value) {
        if (!value) return '';
        if (value >= 80) return 'overbought';
        if (value <= 20) return 'oversold';
        return 'neutral';
    }

    /**
     * Register event handler
     * @param {string} event - Event name
     * @param {Function} handler - Event handler
     */
    on(event, handler) {
        this.eventHandlers.set(event, handler);
        return this;
    }

    /**
     * Trigger event
     * @private
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    triggerEvent(event, data) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event)(data);
        }
    }

    /**
     * Destroy comparison view
     */
    destroy() {
        this.companies.clear();
        this.chartInstances.clear();
        this.eventHandlers.clear();

        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CompanyComparison;
}