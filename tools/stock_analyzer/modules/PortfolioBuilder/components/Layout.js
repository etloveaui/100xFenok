/**
 * PortfolioLayout - 포트폴리오 빌더 화면 레이아웃 생성 유틸리티
 */
const PortfolioLayout = (() => {
    const containerId = 'portfolio-content';

    function renderBase() {
        const container = document.getElementById(containerId);
        if (!container) {
            console.warn('[PortfolioLayout] portfolio-content 영역을 찾을 수 없습니다.');
            return null;
        }

        container.innerHTML = `
            <div class="space-y-6">
                <div class="dashboard-card">
                    <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 class="text-2xl font-bold text-gray-900">🎯 스마트 포트폴리오 빌더</h2>
                            <p class="text-sm text-gray-500">관심 종목을 선택하고, AI 최적화와 리스크 분석으로 완성도 높은 포트폴리오를 만들어보세요.</p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <button id="portfolio-optimize-btn" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                                <i class="fas fa-robot mr-2"></i>AI 최적화
                            </button>
                            <button id="portfolio-rebalance-btn" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
                                <i class="fas fa-balance-scale mr-2"></i>동일비중 리밸런싱
                            </button>
                            <button id="portfolio-clear-btn" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition">
                                <i class="fas fa-trash mr-2"></i>전체 초기화
                            </button>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)_360px] gap-6">
                    <section class="dashboard-card space-y-4">
                        <div>
                            <h3 class="text-lg font-semibold text-gray-900 mb-2">종목 탐색</h3>
                            <div class="relative">
                                <input id="portfolio-search-input" type="text" placeholder="티커, 회사명, 업종으로 검색..." class="w-full border border-gray-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                <i class="fas fa-search absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                            </div>
                        </div>
                        <div id="portfolio-filters" class="grid grid-cols-2 gap-2 text-xs">
                            <button data-filter="momentum" class="filter-chip px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-blue-50 hover:text-blue-700 transition">모멘텀 상위</button>
                            <button data-filter="value" class="filter-chip px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-blue-50 hover:text-blue-700 transition">밸류 매력</button>
                            <button data-filter="dividend" class="filter-chip px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-blue-50 hover:text-blue-700 transition">배당 우수</button>
                            <button data-filter="growth" class="filter-chip px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-blue-50 hover:text-blue-700 transition">성장 주도</button>
                        </div>
                        <div id="portfolio-search-results" class="space-y-3 max-h-96 overflow-y-auto pr-1 custom-scrollbar">
                            <div class="text-center text-gray-400 py-8">
                                검색어를 입력하거나 필터를 선택하면 추천 종목이 표시됩니다.
                            </div>
                        </div>
                    </section>

                    <section class="dashboard-card overflow-hidden">
                        <div class="flex items-center justify-between mb-4">
                            <div>
                                <h3 class="text-lg font-semibold text-gray-900">보유 종목</h3>
                                <p class="text-xs text-gray-500">슬라이더로 비중을 조정하고, AI 최적화를 실행해 보세요.</p>
                            </div>
                            <span id="portfolio-holding-count" class="text-sm text-gray-500">0개 종목</span>
                        </div>
                        <div class="overflow-x-auto -mx-4 px-4">
                            <table class="min-w-full text-sm" id="portfolio-holdings-table">
                                <thead class="bg-gray-50 text-gray-500 font-medium">
                                    <tr>
                                        <th class="px-3 py-2 text-left">종목</th>
                                        <th class="px-3 py-2 text-right">체크포인트</th>
                                        <th class="px-3 py-2 text-center">비중</th>
                                        <th class="px-3 py-2 text-center">예상수익률</th>
                                        <th class="px-3 py-2 text-center">리스크</th>
                                        <th class="px-3 py-2 text-center">조정</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td colspan="6" class="py-8 text-center text-gray-400">
                                            포트폴리오에 종목을 추가하면 여기에 표시됩니다.
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section class="space-y-4">
                        <div class="dashboard-card">
                            <h3 class="text-lg font-semibold text-gray-900 mb-3">포트폴리오 요약</h3>
                            <dl id="portfolio-summary" class="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <dt class="text-gray-500">예상 수익률</dt>
                                    <dd class="text-gray-900 font-semibold" data-field="expected-return">0%</dd>
                                </div>
                                <div>
                                    <dt class="text-gray-500">예상 변동성</dt>
                                    <dd class="text-gray-900 font-semibold" data-field="volatility">-</dd>
                                </div>
                                <div>
                                    <dt class="text-gray-500">ROE (Fwd)</dt>
                                    <dd class="text-gray-900" data-field="roe">-</dd>
                                </div>
                                <div>
                                    <dt class="text-gray-500">Sales Growth 3Y</dt>
                                    <dd class="text-gray-900" data-field="growth">-</dd>
                                </div>
                                <div>
                                    <dt class="text-gray-500">배당 수익률</dt>
                                    <dd class="text-gray-900" data-field="dividend">-</dd>
                                </div>
                                <div>
                                    <dt class="text-gray-500">분산 지수</dt>
                                    <dd class="text-gray-900" data-field="diversification">-</dd>
                                </div>
                            </dl>
                        </div>

                        <div class="dashboard-card">
                            <div class="flex items-center justify-between mb-3">
                                <h3 class="text-lg font-semibold text-gray-900">성과 시뮬레이션</h3>
                                <button id="portfolio-backtest-btn" class="text-sm px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50">
                                    <i class="fas fa-play mr-1"></i>백테스트 실행
                                </button>
                            </div>
                            <canvas id="portfolio-performance-chart" height="220"></canvas>
                        </div>

        <div class="dashboard-card">
            <h3 class="text-lg font-semibold text-gray-900 mb-2">AI 노트</h3>
            <ul id="portfolio-ai-notes" class="text-sm text-gray-600 space-y-2">
                <li class="text-gray-400">최적화/분석을 실행하면 인사이트가 표시됩니다.</li>
            </ul>
        </div>
                    </section>
                </div>
            </div>
        `;

        return {
            container,
            searchInput: document.getElementById('portfolio-search-input'),
            filterChips: Array.from(document.querySelectorAll('#portfolio-filters button')),
            searchResults: document.getElementById('portfolio-search-results'),
            holdingsTable: document.getElementById('portfolio-holdings-table'),
            summaryList: document.getElementById('portfolio-summary'),
            notesList: document.getElementById('portfolio-ai-notes'),
            optimizeBtn: document.getElementById('portfolio-optimize-btn'),
            rebalanceBtn: document.getElementById('portfolio-rebalance-btn'),
            clearBtn: document.getElementById('portfolio-clear-btn'),
            backtestBtn: document.getElementById('portfolio-backtest-btn'),
            holdingCount: document.getElementById('portfolio-holding-count'),
            performanceCanvas: document.getElementById('portfolio-performance-chart')
        };
    }

    function renderSearchResults(results = []) {
        const container = document.getElementById('portfolio-search-results');
        if (!container) return;
        if (!results.length) {
            container.innerHTML = `
                <div class="text-center text-gray-400 py-8">
                    조건에 맞는 추천 종목이 없습니다.
                </div>
            `;
            return;
        }

        container.innerHTML = results.map(item => `
            <button class="w-full text-left border border-gray-200 rounded-lg px-3 py-2 hover:border-blue-400 hover:bg-blue-50 transition add-holding-btn" data-ticker="${item.ticker}">
                <div class="flex items-center justify-between">
                    <div>
                        <h4 class="font-semibold text-gray-900">${item.ticker}</h4>
                        <p class="text-xs text-gray-500">${item.name}</p>
                    </div>
                    <div class="text-right text-xs text-gray-600 space-y-0.5">
                        ${item.metrics.map(metric => `<div>${metric}</div>`).join('')}
                    </div>
                </div>
            </button>
        `).join('');
    }

    function renderHoldingsTable(rows = []) {
        const table = document.getElementById('portfolio-holdings-table');
        if (!table) return;
        const tbody = table.querySelector('tbody');
        if (!rows.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="py-8 text-center text-gray-400">
                        포트폴리오에 종목을 추가하면 여기에 표시됩니다.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = rows.map(row => `
            <tr class="border-b border-gray-100 hover:bg-blue-50 transition">
                <td class="px-3 py-2 align-top">
                    <div class="font-semibold text-gray-900">${row.ticker}</div>
                    <div class="text-xs text-gray-500">${row.companyName}</div>
                    <div class="text-[11px] text-gray-400">${row.industry}</div>
                </td>
                <td class="px-3 py-2 text-xs text-gray-600 align-top">
                    <div>ROE: ${row.metrics.roe}</div>
                    <div>성장률: ${row.metrics.growth}</div>
                    <div>배당: ${row.metrics.dividend}</div>
                </td>
                <td class="px-3 py-2 text-center text-sm font-semibold text-gray-900 align-top">
                    ${(row.weight * 100).toFixed(1)}%
                </td>
                <td class="px-3 py-2 text-center text-xs text-gray-600 align-top">
                    ${(row.expectedReturn * 100).toFixed(1)}%
                </td>
                <td class="px-3 py-2 text-center text-xs text-gray-600 align-top">
                    ${row.riskProxy ? `${(row.riskProxy * 100).toFixed(1)}%` : 'N/A'}
                </td>
                <td class="px-3 py-2 text-center align-top">
                    <div class="flex flex-col items-center gap-2">
                        <input type="range" min="0" max="40" step="1" value="${Math.round(row.weight * 100)}" class="w-28 weight-slider" data-ticker="${row.ticker}">
                        <button class="text-xs text-red-500 hover:text-red-600 remove-holding-btn" data-ticker="${row.ticker}">제거</button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    function renderSummary(summary = {}) {
        const summaryEl = document.querySelector('#portfolio-summary');
        if (!summaryEl) return;
        const setField = (field, value) => {
            const target = summaryEl.querySelector(`[data-field="${field}"]`);
            if (!target) return;
            target.textContent = value;
        };

        setField('expected-return', summary.expectedReturn != null ? `${(summary.expectedReturn * 100).toFixed(1)}%` : '-');
        setField('volatility', summary.volatility != null ? `${(summary.volatility * 100).toFixed(1)}%` : '-');
        setField('roe', summary.roe != null ? `${(summary.roe * 100).toFixed(1)}%` : '-');
        setField('growth', summary.salesGrowth != null ? `${(summary.salesGrowth * 100).toFixed(1)}%` : '-');
        setField('dividend', summary.dividendYield != null ? `${(summary.dividendYield * 100).toFixed(1)}%` : '-');
        setField('diversification', Number.isFinite(summary.diversification) ? `${(summary.diversification * 100).toFixed(1)}%` : '-');
    }

    function renderNotes(notes = []) {
        const list = document.getElementById('portfolio-ai-notes');
        if (!list) return;
        if (!notes.length) {
            list.innerHTML = '<li class="text-gray-400">추가 인사이트가 없습니다.</li>';
            return;
        }
        list.innerHTML = notes.map(note => `<li>• ${note}</li>`).join('');
    }

    function updateHoldingCount(count) {
        const el = document.getElementById('portfolio-holding-count');
        if (el) {
            el.textContent = `${count}개 종목`;
        }
    }

    return {
        renderBase,
        renderSearchResults,
        renderHoldingsTable,
        renderSummary,
        renderNotes,
        updateHoldingCount
    };
})();

window.PortfolioLayout = PortfolioLayout;

console.log('✅ PortfolioLayout 로드 완료 - 포트폴리오 레이아웃 유틸');
