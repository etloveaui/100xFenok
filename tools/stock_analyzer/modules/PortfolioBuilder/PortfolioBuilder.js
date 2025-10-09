/**
 * PortfolioBuilder - 스마트 포트폴리오 빌더 메인 컨트롤러
 */
class PortfolioBuilder {
    constructor() {
        const PortfolioCore = window.PortfolioCore;
        const OptimizerCore = window.PortfolioOptimizerCore;
        const RiskAnalyzerCore = window.PortfolioRiskAnalyzerCore;

        if (!PortfolioCore || !OptimizerCore || !RiskAnalyzerCore) {
            throw new Error('PortfolioBuilder 의존성 로드 실패');
        }

        this.portfolio = new PortfolioCore();
        this.optimizer = new OptimizerCore();
        this.riskAnalyzer = new RiskAnalyzerCore();
        this.chart = null;

        this.allData = [];
        this.recommendations = [];
        this.currentFilter = null;
        this.lastOptimization = null;
    }

    initialize() {
        if (!window.PortfolioLayout) {
            console.warn('PortfolioLayout이 로드되지 않았습니다.');
            return;
        }

        this.collectData();
        const refs = window.PortfolioLayout.renderBase();
        if (!refs) return;

        this.refs = refs;
        this.bindEvents();
        this.renderRecommendations();
        this.refreshHoldings();
        console.log('✅ PortfolioBuilder 초기화 완료');
    }

    collectData() {
        const raw = Array.isArray(window.allData) ? window.allData : [];
        this.allData = raw.map(item => ({
            ticker: item.Ticker || item.ticker,
            name: item.corpName || item.name || '',
            industry: item.industry || item.Industry || '',
            exchange: item.Exchange || item.exchange || '',
            data: item
        })).filter(item => item.ticker);
    }

    bindEvents() {
        const { searchInput, filterChips, searchResults, holdingsTable, optimizeBtn, rebalanceBtn, clearBtn, backtestBtn } = this.refs;

        if (searchInput) {
            let timer;
            searchInput.addEventListener('input', (event) => {
                clearTimeout(timer);
                const value = event.target.value;
                timer = setTimeout(() => this.handleSearch(value), 180);
            });
        }

        filterChips?.forEach(chip => {
            chip.addEventListener('click', () => {
                if (this.currentFilter === chip.dataset.filter) {
                    this.currentFilter = null;
                    filterChips.forEach(c => c.classList.remove('bg-blue-100', 'text-blue-700'));
                    this.renderRecommendations();
                } else {
                    this.currentFilter = chip.dataset.filter;
                    filterChips.forEach(c => c.classList.remove('bg-blue-100', 'text-blue-700'));
                    chip.classList.add('bg-blue-100', 'text-blue-700');
                    this.renderRecommendations();
                }
            });
        });

        if (searchResults) {
            searchResults.addEventListener('click', (event) => {
                const target = event.target.closest('.add-holding-btn');
                if (!target) return;
                const ticker = target.dataset.ticker;
                this.addHolding(ticker);
            });
        }

        if (holdingsTable) {
            holdingsTable.addEventListener('input', (event) => {
                const slider = event.target.closest('.weight-slider');
                if (!slider) return;
                const ticker = slider.dataset.ticker;
                const weight = Number(slider.value) / 100;
                this.portfolio.updateWeight(ticker, weight);
                this.refreshHoldings();
            });

            holdingsTable.addEventListener('click', (event) => {
                const removeBtn = event.target.closest('.remove-holding-btn');
                if (!removeBtn) return;
                this.portfolio.removeHolding(removeBtn.dataset.ticker);
                this.refreshHoldings();
            });
        }

        optimizeBtn?.addEventListener('click', () => this.runOptimization());
        rebalanceBtn?.addEventListener('click', () => {
            this.portfolio.rebalanceEqual();
            this.refreshHoldings();
            this.pushNote('동일 비중 리밸런싱이 적용되었습니다.');
        });
        clearBtn?.addEventListener('click', () => {
            this.portfolio.clear();
            this.refreshHoldings();
            this.pushNote('포트폴리오를 초기화했습니다.');
        });
        backtestBtn?.addEventListener('click', () => this.runBacktest());
    }

    handleSearch(keyword) {
        const trimmed = keyword.trim().toLowerCase();
        if (!trimmed) {
            this.renderRecommendations();
            return;
        }

        const results = this.allData.filter(item => {
            return item.ticker.toLowerCase().includes(trimmed)
                || item.name.toLowerCase().includes(trimmed)
                || (item.industry && item.industry.toLowerCase().includes(trimmed));
        }).slice(0, 30).map(item => this.toRecommendation(item));

        window.PortfolioLayout.renderSearchResults(results);
    }

    renderRecommendations() {
        const filter = this.currentFilter;
        let candidates = [...this.allData];

        const sortBy = (selector, desc = true) => {
            candidates = candidates
                .map(item => ({
                    ...item,
                    score: selector(item.data)
                }))
                .filter(item => Number.isFinite(item.score))
                .sort((a, b) => desc ? b.score - a.score : a.score - b.score);
        };

        switch (filter) {
            case 'momentum':
                sortBy(company => this.parseNumber(company['Return (Y)']) ?? this.parseNumber(company['3 M']) ?? -Infinity);
                break;
            case 'value':
                sortBy(company => this.parseNumber(company['PER (Oct-25)']) ?? Infinity, false);
                break;
            case 'dividend':
                sortBy(company => this.parseNumber(company['DY (FY+1)']) ?? -Infinity);
                break;
            case 'growth':
                sortBy(company => this.parseNumber(company['Sales (3)']) ?? -Infinity);
                break;
            default: {
                candidates = candidates.slice(0, 30);
                break;
            }
        }

        const results = candidates.slice(0, 20).map(item => this.toRecommendation(item));
        window.PortfolioLayout.renderSearchResults(results);
    }

    toRecommendation(item) {
        const company = item.data;
        const metrics = [];
        const append = (label, value, suffix = '%') => {
            const parsed = this.parseNumber(value);
            if (Number.isFinite(parsed)) {
                metrics.push(`${label} ${(parsed * 100).toFixed(1)}${suffix}`);
            }
        };

        append('1Y', company['Return (Y)']);
        append('ROE', company['ROE (Fwd)']);
        append('성장', company['Sales (3)']);
        append('배당', company['DY (FY+1)']);

        return {
            ticker: item.ticker,
            name: `${item.name} · ${item.industry || '업종정보없음'}`,
            metrics,
            data: company
        };
    }

    addHolding(ticker) {
        const candidate = this.allData.find(item => item.ticker === ticker);
        if (!candidate) {
            this.pushNote(`${ticker} 데이터를 찾을 수 없습니다.`);
            return;
        }
        this.portfolio.upsertHolding(candidate.data);
        this.refreshHoldings();
        this.pushNote(`${ticker}을(를) 포트폴리오에 추가했습니다.`);
    }

    refreshHoldings() {
        if (!this.refs) return;
        const holdings = this.portfolio.getHoldings();

        const rows = holdings.map(item => {
            const company = item.company;
            const expectedReturn = this.parseNumber(company['Return (Y)']);
            const riskProxy = this.optimizer.computeRiskProxy(company);

            return {
                ticker: item.ticker,
                companyName: company.corpName || company.name || '-',
                industry: company.industry || company.Industry || '-',
                weight: item.weight,
                expectedReturn: Number.isFinite(expectedReturn) ? expectedReturn : 0,
                riskProxy: Number.isFinite(riskProxy) ? riskProxy : null,
                metrics: {
                    roe: this.formatPercent(company['ROE (Fwd)']),
                    growth: this.formatPercent(company['Sales (3)']),
                    dividend: this.formatPercent(company['DY (FY+1)'])
                }
            };
        });

        window.PortfolioLayout.renderHoldingsTable(rows);
        window.PortfolioLayout.updateHoldingCount(rows.length);

        const summary = this.portfolio.summarize();
        const riskInfo = this.riskAnalyzer.analyze(
            rows.map(row => ({
                weight: row.weight,
                expectedReturn: row.expectedReturn,
                riskProxy: row.riskProxy
            }))
        );

        window.PortfolioLayout.renderSummary({
            ...summary,
            volatility: riskInfo.volatility,
            diversification: riskInfo.diversification
        });

        this.renderNotesCombine(riskInfo.notes);
        this.updateChart(rows);
    }

    runOptimization() {
        const holdings = this.portfolio.getHoldings();
        if (!holdings.length) {
            this.pushNote('최적화할 종목이 없습니다.');
            return { holdings: [], notes: ['최적화할 종목이 없습니다'] };  // 빈 결과 반환
        }

        const targetHoldings = holdings.map(item => ({
            ticker: item.ticker,
            company: item.company,
            weight: item.weight
        }));

        const result = this.optimizer.optimize({
            holdings: targetHoldings,
            constraints: {
                maxWeight: 0.35,
                targetReturn: 0.12
            }
        });

        if (result && result.holdings) {
            result.holdings.forEach(item => {
                this.portfolio.updateWeight(item.ticker, item.weight);
            });
        }

        this.lastOptimization = result;
        this.refreshHoldings();

        const notes = [
            ...(result?.notes || []),
            result?.sharpe ? `최적화된 샤프 지수는 ${result.sharpe.toFixed(2)}입니다.` : '충분한 데이터가 없어 샤프 지수를 계산하지 못했습니다.'
        ];
        this.renderNotesCombine(notes);

        // 테스트를 위한 결과 반환
        return result || { holdings: targetHoldings, notes: notes };
    }

    runBacktest() {
        if (!this.refs) return;
        const holdings = this.portfolio.getHoldings();
        if (!holdings.length) {
            this.pushNote('백테스트할 포트폴리오가 없습니다.');
            return;
        }

        const calcWindow = (key) => {
            let total = 0;
            holdings.forEach(item => {
                const value = this.parseNumber(item.company[key]);
                if (Number.isFinite(value)) {
                    total += value * item.weight;
                }
            });
            return total || 0;
        };

        const windows = [
            { label: '1M', value: calcWindow('1 M') },
            { label: '3M', value: calcWindow('3 M') },
            { label: '6M', value: calcWindow('6 M') },
            { label: '1Y', value: calcWindow('Return (Y)') }
        ];

        this.renderPerformanceChart(windows);
        this.pushNote('백테스트 결과를 갱신했습니다.');
    }

    updateChart(rows) {
        if (!this.refs || !this.refs.performanceCanvas || !window.Chart) return;
        if (!rows.length) {
            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }
            return;
        }

        const labels = rows.map(row => row.ticker);
        const data = rows.map(row => (row.weight * 100).toFixed(1));

        if (!this.chart) {
            const ctx = this.refs.performanceCanvas.getContext('2d');
            this.chart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{
                        label: 'Weight',
                        data,
                        backgroundColor: [
                            '#3b82f6',
                            '#10b981',
                            '#f97316',
                            '#8b5cf6',
                            '#ec4899',
                            '#22d3ee'
                        ]
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            position: 'bottom'
                        }
                    }
                }
            });
        } else {
            this.chart.data.labels = labels;
            this.chart.data.datasets[0].data = data;
            this.chart.update();
        }
    }

    renderPerformanceChart(points = []) {
        if (!this.refs || !this.refs.performanceCanvas || !window.Chart) return;
        const ctx = this.refs.performanceCanvas.getContext('2d');

        if (this.performanceChart) {
            this.performanceChart.destroy();
        }

        this.performanceChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: points.map(point => point.label),
                datasets: [{
                    label: '포트폴리오 수익률',
                    data: points.map(point => (point.value * 100).toFixed(2)),
                    backgroundColor: '#3b82f6'
                }]
            },
            options: {
                scales: {
                    y: {
                        ticks: {
                            callback: value => `${value}%`
                        }
                    }
                }
            }
        });
    }

    renderNotesCombine(extra = []) {
        const notes = [];
        if (this.lastOptimization?.notes?.length) {
            notes.push(...this.lastOptimization.notes);
        }
        if (Array.isArray(extra)) {
            notes.push(...extra);
        }
        window.PortfolioLayout.renderNotes(notes);
    }

    pushNote(message) {
        if (window.loadingManager && typeof window.loadingManager.showFeedback === 'function') {
            window.loadingManager.showFeedback(message, 'info', 2000);
        } else {
            console.log(`[PortfolioBuilder] ${message}`);
        }
    }

    parseNumber(value) {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            const cleaned = value.replace(/[^0-9.+-]/g, '');
            if (cleaned === '') return NaN;
            return Number(cleaned);
        }
        return NaN;
    }

    formatPercent(value) {
        const parsed = this.parseNumber(value);
        if (!Number.isFinite(parsed)) return 'N/A';
        return `${(parsed * 100).toFixed(1)}%`;
    }
}

window.portfolioBuilder = new PortfolioBuilder();

console.log('✅ PortfolioBuilder 로드 완료 - 스마트 포트폴리오 빌더');
