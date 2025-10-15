/**
 * Company Detail View
 * Displays comprehensive company information with momentum metrics
 * @module CompanyDetailView
 * @version 1.0.0
 */

class CompanyDetailView {
    constructor(config = {}) {
        this.config = {
            container: config.container || null,
            theme: config.theme || 'light',
            sections: config.sections || [
                'overview',
                'momentum',
                'financials',
                'valuation',
                'technical',
                'news'
            ],
            updateInterval: config.updateInterval || 60000, // 1 minute
            ...config
        };

        this.container = null;
        this.company = null;
        this.updateTimer = null;
        this.eventHandlers = new Map();
    }

    /**
     * Render company detail view
     * @param {HTMLElement} container - Container element
     * @param {Object} company - Company data
     * @param {Object} options - Render options
     */
    render(container, company, options = {}) {
        this.container = container;
        this.company = company;

        // Clear existing content
        this.container.innerHTML = '';
        this.container.className = `company-detail-view ${this.config.theme}`;

        // Create layout
        this.createLayout();

        // Render sections
        this.config.sections.forEach(section => {
            this.renderSection(section);
        });

        // Set up auto-update
        if (options.autoUpdate && this.config.updateInterval) {
            this.startAutoUpdate();
        }

        return this;
    }

    /**
     * Create detail view layout
     * @private
     */
    createLayout() {
        // Create header
        const header = this.createHeader();
        this.container.appendChild(header);

        // Create navigation tabs
        const tabs = this.createTabs();
        this.container.appendChild(tabs);

        // Create content area
        const content = document.createElement('div');
        content.className = 'detail-content';
        content.id = 'detail-content';
        this.container.appendChild(content);

        // Create footer
        const footer = this.createFooter();
        this.container.appendChild(footer);
    }

    /**
     * Create header section
     * @private
     * @returns {HTMLElement} Header element
     */
    createHeader() {
        const header = document.createElement('div');
        header.className = 'detail-header';

        // Company info
        const info = document.createElement('div');
        info.className = 'company-info';
        info.innerHTML = `
            <div class="company-main">
                <h1>${this.company.name || 'N/A'}</h1>
                <span class="ticker">${this.company.ticker || 'N/A'}</span>
                <span class="exchange">${this.company.exchange || ''}</span>
            </div>
            <div class="company-meta">
                <span class="sector">${this.company.sector || 'N/A'}</span>
                <span class="industry">${this.company.industry || 'N/A'}</span>
                <span class="country">${this.company.country || 'N/A'}</span>
            </div>
        `;
        header.appendChild(info);

        // Price info
        const price = document.createElement('div');
        price.className = 'price-info';
        const priceChange = this.company.priceChange || 0;
        const changeClass = priceChange >= 0 ? 'positive' : 'negative';

        price.innerHTML = `
            <div class="current-price">
                <span class="price">$${(this.company.price || 0).toFixed(2)}</span>
                <span class="change ${changeClass}">
                    ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}
                    (${((priceChange / (this.company.price - priceChange)) * 100).toFixed(2)}%)
                </span>
            </div>
            <div class="price-range">
                <span>52W: $${(this.company.week52Low || 0).toFixed(2)} - $${(this.company.week52High || 0).toFixed(2)}</span>
            </div>
        `;
        header.appendChild(price);

        // Action buttons
        const actions = document.createElement('div');
        actions.className = 'header-actions';
        actions.innerHTML = `
            <button class="btn btn-primary" data-action="watchlist">
                <i class="icon-star"></i> Watchlist
            </button>
            <button class="btn btn-secondary" data-action="compare">
                <i class="icon-compare"></i> Compare
            </button>
            <button class="btn btn-secondary" data-action="export">
                <i class="icon-download"></i> Export
            </button>
        `;
        header.appendChild(actions);

        // Bind action handlers
        this.bindActionHandlers(actions);

        return header;
    }

    /**
     * Create navigation tabs
     * @private
     * @returns {HTMLElement} Tabs element
     */
    createTabs() {
        const tabs = document.createElement('div');
        tabs.className = 'detail-tabs';

        const tabList = document.createElement('ul');
        tabList.className = 'tab-list';

        const tabConfig = {
            overview: { label: 'Overview', icon: 'dashboard' },
            momentum: { label: 'Momentum', icon: 'trending' },
            financials: { label: 'Financials', icon: 'chart' },
            valuation: { label: 'Valuation', icon: 'dollar' },
            technical: { label: 'Technical', icon: 'analysis' },
            news: { label: 'News & Events', icon: 'news' }
        };

        this.config.sections.forEach((section, index) => {
            const tab = document.createElement('li');
            tab.className = `tab ${index === 0 ? 'active' : ''}`;
            tab.dataset.section = section;

            const config = tabConfig[section] || {};
            tab.innerHTML = `
                <i class="icon-${config.icon || 'info'}"></i>
                <span>${config.label || section}</span>
            `;

            tab.addEventListener('click', () => this.switchTab(section));
            tabList.appendChild(tab);
        });

        tabs.appendChild(tabList);
        return tabs;
    }

    /**
     * Render section content
     * @private
     * @param {string} section - Section name
     */
    renderSection(section) {
        const content = document.getElementById('detail-content');

        // Hide all sections
        const sections = content.querySelectorAll('.detail-section');
        sections.forEach(s => s.style.display = 'none');

        // Check if section exists
        let sectionDiv = content.querySelector(`[data-section="${section}"]`);
        if (!sectionDiv) {
            sectionDiv = document.createElement('div');
            sectionDiv.className = 'detail-section';
            sectionDiv.dataset.section = section;
            content.appendChild(sectionDiv);
        }

        // Show current section
        sectionDiv.style.display = 'block';

        // Render section content
        switch (section) {
            case 'overview':
                this.renderOverview(sectionDiv);
                break;
            case 'momentum':
                this.renderMomentum(sectionDiv);
                break;
            case 'financials':
                this.renderFinancials(sectionDiv);
                break;
            case 'valuation':
                this.renderValuation(sectionDiv);
                break;
            case 'technical':
                this.renderTechnical(sectionDiv);
                break;
            case 'news':
                this.renderNews(sectionDiv);
                break;
        }
    }

    /**
     * Render overview section
     * @private
     * @param {HTMLElement} container - Section container
     */
    renderOverview(container) {
        container.innerHTML = `
            <h2>Company Overview</h2>
            <div class="overview-grid">
                <div class="overview-card">
                    <h3>Business Summary</h3>
                    <p>${this.company.description || 'No description available.'}</p>
                </div>

                <div class="overview-card">
                    <h3>Key Metrics</h3>
                    <div class="metrics-grid">
                        <div class="metric">
                            <label>Market Cap</label>
                            <value>$${this.formatNumber(this.company.marketCap || 0)}</value>
                        </div>
                        <div class="metric">
                            <label>Revenue</label>
                            <value>$${this.formatNumber(this.company.revenue || 0)}</value>
                        </div>
                        <div class="metric">
                            <label>Net Income</label>
                            <value>$${this.formatNumber(this.company.netIncome || 0)}</value>
                        </div>
                        <div class="metric">
                            <label>Employees</label>
                            <value>${this.formatNumber(this.company.employees || 0)}</value>
                        </div>
                    </div>
                </div>

                <div class="overview-card">
                    <h3>Trading Information</h3>
                    <div class="trading-grid">
                        <div class="trading-item">
                            <label>Volume</label>
                            <value>${this.formatNumber(this.company.volume || 0)}</value>
                        </div>
                        <div class="trading-item">
                            <label>Avg Volume</label>
                            <value>${this.formatNumber(this.company.avgVolume || 0)}</value>
                        </div>
                        <div class="trading-item">
                            <label>Shares Outstanding</label>
                            <value>${this.formatNumber(this.company.sharesOutstanding || 0)}</value>
                        </div>
                        <div class="trading-item">
                            <label>Float</label>
                            <value>${this.formatNumber(this.company.float || 0)}</value>
                        </div>
                    </div>
                </div>

                <div class="overview-card">
                    <h3>Company Details</h3>
                    <div class="details-list">
                        <div class="detail-item">
                            <label>CEO</label>
                            <value>${this.company.ceo || 'N/A'}</value>
                        </div>
                        <div class="detail-item">
                            <label>Founded</label>
                            <value>${this.company.founded || 'N/A'}</value>
                        </div>
                        <div class="detail-item">
                            <label>Headquarters</label>
                            <value>${this.company.headquarters || 'N/A'}</value>
                        </div>
                        <div class="detail-item">
                            <label>Website</label>
                            <value><a href="${this.company.website || '#'}" target="_blank">${this.company.website || 'N/A'}</a></value>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render momentum section
     * @private
     * @param {HTMLElement} container - Section container
     */
    renderMomentum(container) {
        const momentum = this.company.momentum || {};

        container.innerHTML = `
            <h2>Momentum Analysis</h2>
            <div class="momentum-grid">
                <div class="momentum-card">
                    <h3>Momentum Scores</h3>
                    <div class="scores-chart" id="momentum-scores"></div>
                </div>

                <div class="momentum-card">
                    <h3>Performance Metrics</h3>
                    <div class="performance-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>Period</th>
                                    <th>Return</th>
                                    <th>Rank</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>1 Month</td>
                                    <td class="${this.getChangeClass(momentum.return1M)}">${this.formatPercent(momentum.return1M)}</td>
                                    <td>${momentum.rank1M || 'N/A'}</td>
                                </tr>
                                <tr>
                                    <td>3 Months</td>
                                    <td class="${this.getChangeClass(momentum.return3M)}">${this.formatPercent(momentum.return3M)}</td>
                                    <td>${momentum.rank3M || 'N/A'}</td>
                                </tr>
                                <tr>
                                    <td>6 Months</td>
                                    <td class="${this.getChangeClass(momentum.return6M)}">${this.formatPercent(momentum.return6M)}</td>
                                    <td>${momentum.rank6M || 'N/A'}</td>
                                </tr>
                                <tr>
                                    <td>1 Year</td>
                                    <td class="${this.getChangeClass(momentum.return1Y)}">${this.formatPercent(momentum.return1Y)}</td>
                                    <td>${momentum.rank1Y || 'N/A'}</td>
                                </tr>
                                <tr>
                                    <td>YTD</td>
                                    <td class="${this.getChangeClass(momentum.returnYTD)}">${this.formatPercent(momentum.returnYTD)}</td>
                                    <td>${momentum.rankYTD || 'N/A'}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="momentum-card">
                    <h3>Momentum Factors</h3>
                    <div class="factors-grid">
                        <div class="factor">
                            <label>Price Momentum</label>
                            <div class="factor-bar">
                                <div class="bar-fill" style="width: ${momentum.priceMomentum || 0}%"></div>
                            </div>
                            <span>${momentum.priceMomentum || 0}/100</span>
                        </div>
                        <div class="factor">
                            <label>Volume Momentum</label>
                            <div class="factor-bar">
                                <div class="bar-fill" style="width: ${momentum.volumeMomentum || 0}%"></div>
                            </div>
                            <span>${momentum.volumeMomentum || 0}/100</span>
                        </div>
                        <div class="factor">
                            <label>Earnings Momentum</label>
                            <div class="factor-bar">
                                <div class="bar-fill" style="width: ${momentum.earningsMomentum || 0}%"></div>
                            </div>
                            <span>${momentum.earningsMomentum || 0}/100</span>
                        </div>
                        <div class="factor">
                            <label>Technical Momentum</label>
                            <div class="factor-bar">
                                <div class="bar-fill" style="width: ${momentum.technicalMomentum || 0}%"></div>
                            </div>
                            <span>${momentum.technicalMomentum || 0}/100</span>
                        </div>
                    </div>
                </div>

                <div class="momentum-card">
                    <h3>Trend Analysis</h3>
                    <div class="trend-chart" id="momentum-trend"></div>
                </div>
            </div>
        `;

        // Render charts
        this.renderMomentumCharts();
    }

    /**
     * Render financials section
     * @private
     * @param {HTMLElement} container - Section container
     */
    renderFinancials(container) {
        const financials = this.company.financials || {};

        container.innerHTML = `
            <h2>Financial Statements</h2>
            <div class="financials-grid">
                <div class="financial-card">
                    <h3>Income Statement</h3>
                    <table class="financial-table">
                        <tbody>
                            <tr>
                                <td>Revenue</td>
                                <td>$${this.formatNumber(financials.revenue || 0)}</td>
                            </tr>
                            <tr>
                                <td>Gross Profit</td>
                                <td>$${this.formatNumber(financials.grossProfit || 0)}</td>
                            </tr>
                            <tr>
                                <td>Operating Income</td>
                                <td>$${this.formatNumber(financials.operatingIncome || 0)}</td>
                            </tr>
                            <tr>
                                <td>Net Income</td>
                                <td>$${this.formatNumber(financials.netIncome || 0)}</td>
                            </tr>
                            <tr>
                                <td>EPS</td>
                                <td>$${(financials.eps || 0).toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="financial-card">
                    <h3>Balance Sheet</h3>
                    <table class="financial-table">
                        <tbody>
                            <tr>
                                <td>Total Assets</td>
                                <td>$${this.formatNumber(financials.totalAssets || 0)}</td>
                            </tr>
                            <tr>
                                <td>Current Assets</td>
                                <td>$${this.formatNumber(financials.currentAssets || 0)}</td>
                            </tr>
                            <tr>
                                <td>Total Liabilities</td>
                                <td>$${this.formatNumber(financials.totalLiabilities || 0)}</td>
                            </tr>
                            <tr>
                                <td>Current Liabilities</td>
                                <td>$${this.formatNumber(financials.currentLiabilities || 0)}</td>
                            </tr>
                            <tr>
                                <td>Shareholders Equity</td>
                                <td>$${this.formatNumber(financials.shareholdersEquity || 0)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="financial-card">
                    <h3>Cash Flow</h3>
                    <table class="financial-table">
                        <tbody>
                            <tr>
                                <td>Operating Cash Flow</td>
                                <td>$${this.formatNumber(financials.operatingCashFlow || 0)}</td>
                            </tr>
                            <tr>
                                <td>Investing Cash Flow</td>
                                <td>$${this.formatNumber(financials.investingCashFlow || 0)}</td>
                            </tr>
                            <tr>
                                <td>Financing Cash Flow</td>
                                <td>$${this.formatNumber(financials.financingCashFlow || 0)}</td>
                            </tr>
                            <tr>
                                <td>Free Cash Flow</td>
                                <td>$${this.formatNumber(financials.freeCashFlow || 0)}</td>
                            </tr>
                            <tr>
                                <td>Cash & Equivalents</td>
                                <td>$${this.formatNumber(financials.cash || 0)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="financial-card">
                    <h3>Financial Ratios</h3>
                    <table class="financial-table">
                        <tbody>
                            <tr>
                                <td>Gross Margin</td>
                                <td>${this.formatPercent(financials.grossMargin)}</td>
                            </tr>
                            <tr>
                                <td>Operating Margin</td>
                                <td>${this.formatPercent(financials.operatingMargin)}</td>
                            </tr>
                            <tr>
                                <td>Net Margin</td>
                                <td>${this.formatPercent(financials.netMargin)}</td>
                            </tr>
                            <tr>
                                <td>ROE</td>
                                <td>${this.formatPercent(financials.roe)}</td>
                            </tr>
                            <tr>
                                <td>ROA</td>
                                <td>${this.formatPercent(financials.roa)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    /**
     * Render valuation section
     * @private
     * @param {HTMLElement} container - Section container
     */
    renderValuation(container) {
        const valuation = this.company.valuation || {};

        container.innerHTML = `
            <h2>Valuation Metrics</h2>
            <div class="valuation-grid">
                <div class="valuation-card">
                    <h3>Price Multiples</h3>
                    <div class="multiples-grid">
                        <div class="multiple">
                            <label>P/E Ratio</label>
                            <value>${(valuation.pe || 0).toFixed(2)}</value>
                            <span class="comparison">${this.getValuationIndicator(valuation.pe, 'pe')}</span>
                        </div>
                        <div class="multiple">
                            <label>P/B Ratio</label>
                            <value>${(valuation.pb || 0).toFixed(2)}</value>
                            <span class="comparison">${this.getValuationIndicator(valuation.pb, 'pb')}</span>
                        </div>
                        <div class="multiple">
                            <label>P/S Ratio</label>
                            <value>${(valuation.ps || 0).toFixed(2)}</value>
                            <span class="comparison">${this.getValuationIndicator(valuation.ps, 'ps')}</span>
                        </div>
                        <div class="multiple">
                            <label>PEG Ratio</label>
                            <value>${(valuation.peg || 0).toFixed(2)}</value>
                            <span class="comparison">${this.getValuationIndicator(valuation.peg, 'peg')}</span>
                        </div>
                    </div>
                </div>

                <div class="valuation-card">
                    <h3>Enterprise Value</h3>
                    <table class="valuation-table">
                        <tbody>
                            <tr>
                                <td>Enterprise Value</td>
                                <td>$${this.formatNumber(valuation.enterpriseValue || 0)}</td>
                            </tr>
                            <tr>
                                <td>EV/Revenue</td>
                                <td>${(valuation.evRevenue || 0).toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td>EV/EBITDA</td>
                                <td>${(valuation.evEbitda || 0).toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td>EV/FCF</td>
                                <td>${(valuation.evFcf || 0).toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="valuation-card">
                    <h3>Dividend & Yield</h3>
                    <table class="valuation-table">
                        <tbody>
                            <tr>
                                <td>Dividend Yield</td>
                                <td>${this.formatPercent(valuation.dividendYield)}</td>
                            </tr>
                            <tr>
                                <td>Dividend/Share</td>
                                <td>$${(valuation.dividendPerShare || 0).toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td>Payout Ratio</td>
                                <td>${this.formatPercent(valuation.payoutRatio)}</td>
                            </tr>
                            <tr>
                                <td>FCF Yield</td>
                                <td>${this.formatPercent(valuation.fcfYield)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="valuation-card">
                    <h3>Analyst Ratings</h3>
                    <div class="ratings-summary">
                        <div class="rating-overall">
                            <span class="rating-value">${valuation.analystRating || 'N/A'}</span>
                            <span class="rating-label">${this.getAnalystRatingLabel(valuation.analystRating)}</span>
                        </div>
                        <div class="rating-breakdown">
                            <div class="rating-bar">
                                <label>Strong Buy</label>
                                <div class="bar" style="width: ${valuation.strongBuy || 0}%"></div>
                                <span>${valuation.strongBuy || 0}%</span>
                            </div>
                            <div class="rating-bar">
                                <label>Buy</label>
                                <div class="bar" style="width: ${valuation.buy || 0}%"></div>
                                <span>${valuation.buy || 0}%</span>
                            </div>
                            <div class="rating-bar">
                                <label>Hold</label>
                                <div class="bar" style="width: ${valuation.hold || 0}%"></div>
                                <span>${valuation.hold || 0}%</span>
                            </div>
                            <div class="rating-bar">
                                <label>Sell</label>
                                <div class="bar" style="width: ${valuation.sell || 0}%"></div>
                                <span>${valuation.sell || 0}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render technical section
     * @private
     * @param {HTMLElement} container - Section container
     */
    renderTechnical(container) {
        const technical = this.company.technical || {};

        container.innerHTML = `
            <h2>Technical Analysis</h2>
            <div class="technical-grid">
                <div class="technical-card">
                    <h3>Moving Averages</h3>
                    <table class="technical-table">
                        <tbody>
                            <tr>
                                <td>SMA 20</td>
                                <td>$${(technical.sma20 || 0).toFixed(2)}</td>
                                <td class="${this.getTechnicalSignal(this.company.price, technical.sma20)}">${this.getTechnicalSignalLabel(this.company.price, technical.sma20)}</td>
                            </tr>
                            <tr>
                                <td>SMA 50</td>
                                <td>$${(technical.sma50 || 0).toFixed(2)}</td>
                                <td class="${this.getTechnicalSignal(this.company.price, technical.sma50)}">${this.getTechnicalSignalLabel(this.company.price, technical.sma50)}</td>
                            </tr>
                            <tr>
                                <td>SMA 200</td>
                                <td>$${(technical.sma200 || 0).toFixed(2)}</td>
                                <td class="${this.getTechnicalSignal(this.company.price, technical.sma200)}">${this.getTechnicalSignalLabel(this.company.price, technical.sma200)}</td>
                            </tr>
                            <tr>
                                <td>EMA 20</td>
                                <td>$${(technical.ema20 || 0).toFixed(2)}</td>
                                <td class="${this.getTechnicalSignal(this.company.price, technical.ema20)}">${this.getTechnicalSignalLabel(this.company.price, technical.ema20)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="technical-card">
                    <h3>Technical Indicators</h3>
                    <div class="indicators-grid">
                        <div class="indicator">
                            <label>RSI (14)</label>
                            <value>${(technical.rsi || 0).toFixed(1)}</value>
                            <span class="${this.getRSIClass(technical.rsi)}">${this.getRSILabel(technical.rsi)}</span>
                        </div>
                        <div class="indicator">
                            <label>MACD</label>
                            <value>${(technical.macd || 0).toFixed(2)}</value>
                            <span class="${technical.macdSignal > 0 ? 'bullish' : 'bearish'}">${technical.macdSignal > 0 ? 'Bullish' : 'Bearish'}</span>
                        </div>
                        <div class="indicator">
                            <label>Stochastic</label>
                            <value>${(technical.stochastic || 0).toFixed(1)}</value>
                            <span class="${this.getStochasticClass(technical.stochastic)}">${this.getStochasticLabel(technical.stochastic)}</span>
                        </div>
                        <div class="indicator">
                            <label>ATR (14)</label>
                            <value>${(technical.atr || 0).toFixed(2)}</value>
                            <span>Volatility</span>
                        </div>
                    </div>
                </div>

                <div class="technical-card">
                    <h3>Support & Resistance</h3>
                    <div class="levels-grid">
                        <div class="resistance-levels">
                            <h4>Resistance</h4>
                            <div class="level">R3: $${(technical.r3 || 0).toFixed(2)}</div>
                            <div class="level">R2: $${(technical.r2 || 0).toFixed(2)}</div>
                            <div class="level">R1: $${(technical.r1 || 0).toFixed(2)}</div>
                        </div>
                        <div class="current-price">
                            <label>Current</label>
                            <value>$${(this.company.price || 0).toFixed(2)}</value>
                        </div>
                        <div class="support-levels">
                            <h4>Support</h4>
                            <div class="level">S1: $${(technical.s1 || 0).toFixed(2)}</div>
                            <div class="level">S2: $${(technical.s2 || 0).toFixed(2)}</div>
                            <div class="level">S3: $${(technical.s3 || 0).toFixed(2)}</div>
                        </div>
                    </div>
                </div>

                <div class="technical-card">
                    <h3>Price Chart</h3>
                    <div class="price-chart" id="technical-chart"></div>
                </div>
            </div>
        `;

        // Render price chart
        this.renderPriceChart();
    }

    /**
     * Render news section
     * @private
     * @param {HTMLElement} container - Section container
     */
    renderNews(container) {
        const news = this.company.news || [];
        const events = this.company.events || [];

        container.innerHTML = `
            <h2>News & Events</h2>
            <div class="news-grid">
                <div class="news-section">
                    <h3>Latest News</h3>
                    <div class="news-list">
                        ${news.length > 0 ? news.map(article => `
                            <div class="news-item">
                                <div class="news-date">${this.formatDate(article.date)}</div>
                                <div class="news-content">
                                    <h4><a href="${article.url}" target="_blank">${article.title}</a></h4>
                                    <p>${article.summary || ''}</p>
                                    <span class="news-source">${article.source || ''}</span>
                                </div>
                            </div>
                        `).join('') : '<p>No recent news available</p>'}
                    </div>
                </div>

                <div class="events-section">
                    <h3>Upcoming Events</h3>
                    <div class="events-list">
                        ${events.length > 0 ? events.map(event => `
                            <div class="event-item">
                                <div class="event-date">${this.formatDate(event.date)}</div>
                                <div class="event-content">
                                    <h4>${event.title}</h4>
                                    <p>${event.description || ''}</p>
                                    <span class="event-type">${event.type || ''}</span>
                                </div>
                            </div>
                        `).join('') : '<p>No upcoming events</p>'}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Create footer section
     * @private
     * @returns {HTMLElement} Footer element
     */
    createFooter() {
        const footer = document.createElement('div');
        footer.className = 'detail-footer';

        footer.innerHTML = `
            <div class="footer-info">
                <span>Last Updated: ${this.formatDate(new Date())}</span>
                <span>Data Source: ${this.company.dataSource || 'Market Data API'}</span>
            </div>
            <div class="footer-actions">
                <button class="btn btn-link" data-action="refresh">
                    <i class="icon-refresh"></i> Refresh
                </button>
                <button class="btn btn-link" data-action="print">
                    <i class="icon-print"></i> Print
                </button>
                <button class="btn btn-link" data-action="share">
                    <i class="icon-share"></i> Share
                </button>
            </div>
        `;

        // Bind footer actions
        this.bindFooterActions(footer);

        return footer;
    }

    /**
     * Switch between tabs
     * @private
     * @param {string} section - Section to switch to
     */
    switchTab(section) {
        // Update tab active state
        const tabs = this.container.querySelectorAll('.tab');
        tabs.forEach(tab => {
            if (tab.dataset.section === section) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // Render section
        this.renderSection(section);
    }

    /**
     * Bind action handlers
     * @private
     * @param {HTMLElement} container - Container element
     */
    bindActionHandlers(container) {
        container.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;

            const action = button.dataset.action;
            this.handleAction(action);
        });
    }

    /**
     * Bind footer action handlers
     * @private
     * @param {HTMLElement} footer - Footer element
     */
    bindFooterActions(footer) {
        footer.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;

            const action = button.dataset.action;
            this.handleFooterAction(action);
        });
    }

    /**
     * Handle action
     * @private
     * @param {string} action - Action name
     */
    handleAction(action) {
        switch (action) {
            case 'watchlist':
                this.addToWatchlist();
                break;
            case 'compare':
                this.openComparison();
                break;
            case 'export':
                this.exportData();
                break;
        }
    }

    /**
     * Handle footer action
     * @private
     * @param {string} action - Action name
     */
    handleFooterAction(action) {
        switch (action) {
            case 'refresh':
                this.refresh();
                break;
            case 'print':
                this.print();
                break;
            case 'share':
                this.share();
                break;
        }
    }

    /**
     * Add to watchlist
     * @private
     */
    addToWatchlist() {
        // Trigger watchlist event
        if (this.eventHandlers.has('watchlist')) {
            this.eventHandlers.get('watchlist')(this.company);
        }
    }

    /**
     * Open comparison
     * @private
     */
    openComparison() {
        // Trigger comparison event
        if (this.eventHandlers.has('compare')) {
            this.eventHandlers.get('compare')(this.company);
        }
    }

    /**
     * Export data
     * @private
     */
    exportData() {
        // Trigger export event
        if (this.eventHandlers.has('export')) {
            this.eventHandlers.get('export')(this.company);
        }
    }

    /**
     * Refresh data
     * @private
     */
    refresh() {
        // Trigger refresh event
        if (this.eventHandlers.has('refresh')) {
            this.eventHandlers.get('refresh')(this.company);
        }

        // Re-render
        this.render(this.container, this.company);
    }

    /**
     * Print view
     * @private
     */
    print() {
        window.print();
    }

    /**
     * Share view
     * @private
     */
    share() {
        // Trigger share event
        if (this.eventHandlers.has('share')) {
            this.eventHandlers.get('share')(this.company);
        }
    }

    /**
     * Render momentum charts
     * @private
     */
    renderMomentumCharts() {
        // Implementation would depend on charting library
        // This is a placeholder for chart rendering
        console.log('Rendering momentum charts...');
    }

    /**
     * Render price chart
     * @private
     */
    renderPriceChart() {
        // Implementation would depend on charting library
        // This is a placeholder for chart rendering
        console.log('Rendering price chart...');
    }

    /**
     * Start auto-update
     * @private
     */
    startAutoUpdate() {
        this.updateTimer = setInterval(() => {
            this.refresh();
        }, this.config.updateInterval);
    }

    /**
     * Stop auto-update
     * @private
     */
    stopAutoUpdate() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
    }

    /**
     * Format number with commas
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
        return (value * 100).toFixed(2) + '%';
    }

    /**
     * Format date
     * @private
     * @param {Date|string} date - Date to format
     * @returns {string} Formatted date
     */
    formatDate(date) {
        if (!date) return 'N/A';
        const d = new Date(date);
        return d.toLocaleDateString();
    }

    /**
     * Get change class
     * @private
     * @param {number} value - Value to check
     * @returns {string} CSS class
     */
    getChangeClass(value) {
        if (!value && value !== 0) return '';
        return value >= 0 ? 'positive' : 'negative';
    }

    /**
     * Get valuation indicator
     * @private
     * @param {number} value - Valuation metric value
     * @param {string} metric - Metric type
     * @returns {string} Indicator text
     */
    getValuationIndicator(value, metric) {
        // This would compare to industry averages
        // Placeholder implementation
        return 'vs Industry Avg';
    }

    /**
     * Get analyst rating label
     * @private
     * @param {number} rating - Rating value
     * @returns {string} Rating label
     */
    getAnalystRatingLabel(rating) {
        if (rating >= 4.5) return 'Strong Buy';
        if (rating >= 3.5) return 'Buy';
        if (rating >= 2.5) return 'Hold';
        if (rating >= 1.5) return 'Sell';
        return 'Strong Sell';
    }

    /**
     * Get technical signal
     * @private
     * @param {number} price - Current price
     * @param {number} ma - Moving average
     * @returns {string} Signal class
     */
    getTechnicalSignal(price, ma) {
        if (!price || !ma) return '';
        return price > ma ? 'bullish' : 'bearish';
    }

    /**
     * Get technical signal label
     * @private
     * @param {number} price - Current price
     * @param {number} ma - Moving average
     * @returns {string} Signal label
     */
    getTechnicalSignalLabel(price, ma) {
        if (!price || !ma) return 'N/A';
        return price > ma ? 'Above' : 'Below';
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
     * Get RSI label
     * @private
     * @param {number} rsi - RSI value
     * @returns {string} RSI label
     */
    getRSILabel(rsi) {
        if (!rsi) return 'N/A';
        if (rsi >= 70) return 'Overbought';
        if (rsi <= 30) return 'Oversold';
        return 'Neutral';
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
     * Get Stochastic label
     * @private
     * @param {number} value - Stochastic value
     * @returns {string} Stochastic label
     */
    getStochasticLabel(value) {
        if (!value) return 'N/A';
        if (value >= 80) return 'Overbought';
        if (value <= 20) return 'Oversold';
        return 'Neutral';
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
     * Unregister event handler
     * @param {string} event - Event name
     */
    off(event) {
        this.eventHandlers.delete(event);
        return this;
    }

    /**
     * Destroy view
     */
    destroy() {
        this.stopAutoUpdate();
        this.eventHandlers.clear();

        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CompanyDetailView;
}