/**
 * ComparisonLayout - DeepCompare UI 레이아웃 생성 유틸리티
 *
 * 이 모듈은 DOM 조작을 캡슐화하여 DeepCompare 본체가 계산 로직에 집중할 수 있도록 합니다.
 * 모든 함수는 id로 접근 가능한 기존 HTML 요소를 재사용하며,
 * 필요한 경우에만 새 요소를 추가합니다.
 */
const DeepCompareLayout = (() => {
    const ROOT_ID = 'comparison-results';
    const SELECTION_ID = 'compare-selection-area';
    const BUBBLE_WRAPPER_ID = 'deep-compare-bubble-wrapper';
    const RADAR_WRAPPER_ID = 'deep-compare-radar-wrapper';
    const TABLE_WRAPPER_ID = 'deep-compare-table-wrapper';
    const INSIGHT_WRAPPER_ID = 'deep-compare-insights';

    function ensureBaseStructure() {
        const root = document.getElementById(ROOT_ID);
        if (!root) {
            console.warn('[DeepCompareLayout] comparison-results 영역을 찾을 수 없습니다.');
            return null;
        }

        if (!document.getElementById(BUBBLE_WRAPPER_ID)) {
            root.innerHTML = `
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div class="dashboard-card">
                        <div class="flex items-center justify-between mb-4">
                            <h3 class="text-lg font-semibold text-gray-900">4차원 비교 버블 차트</h3>
                            <span class="text-xs text-gray-500">ROE / Sales Growth / Market Cap / PER</span>
                        </div>
                        <canvas id="${BUBBLE_WRAPPER_ID}" height="400"></canvas>
                    </div>
                    <div class="dashboard-card">
                        <div class="flex items-center justify-between mb-4">
                            <h3 class="text-lg font-semibold text-gray-900">핵심 지표 레이더</h3>
                            <span class="text-xs text-gray-500">Profitability · Growth · Momentum · Valuation · Dividend</span>
                        </div>
                        <canvas id="${RADAR_WRAPPER_ID}" height="400"></canvas>
                    </div>
                </div>
                <div class="dashboard-card mt-6">
                    <h3 class="text-lg font-semibold text-gray-900 mb-4">비교 지표 테이블</h3>
                    <div class="overflow-x-auto">
                        <table class="min-w-full divide-y divide-gray-200 text-sm" id="${TABLE_WRAPPER_ID}">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-3 py-2 text-left font-medium text-gray-500">대상</th>
                                    <th class="px-3 py-2 text-center font-medium text-gray-500">ROE</th>
                                    <th class="px-3 py-2 text-center font-medium text-gray-500">Sales Growth</th>
                                    <th class="px-3 py-2 text-center font-medium text-gray-500">Momentum</th>
                                    <th class="px-3 py-2 text-center font-medium text-gray-500">PER</th>
                                    <th class="px-3 py-2 text-center font-medium text-gray-500">Dividend</th>
                                    <th class="px-3 py-2 text-center font-medium text-gray-500">Score</th>
                                    <th class="px-3 py-2 text-center font-medium text-gray-500">Risk</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-200"></tbody>
                        </table>
                    </div>
                </div>
                <div class="dashboard-card mt-6">
                    <h3 class="text-lg font-semibold text-gray-900 mb-3">📌 인사이트</h3>
                    <ul id="${INSIGHT_WRAPPER_ID}" class="space-y-2 text-sm text-gray-700">
                        <li class="text-gray-400">대상을 선택하면 인사이트가 표시됩니다.</li>
                    </ul>
                </div>
            `;
        }

        return {
            root,
            bubbleCanvas: document.getElementById(BUBBLE_WRAPPER_ID),
            radarCanvas: document.getElementById(RADAR_WRAPPER_ID),
            table: document.getElementById(TABLE_WRAPPER_ID),
            insightList: document.getElementById(INSIGHT_WRAPPER_ID)
        };
    }

    function renderSelectedCompanies(items = []) {
        const container = document.getElementById(SELECTION_ID);
        if (!container) {
            console.warn('[DeepCompareLayout] selection 영역을 찾을 수 없습니다.');
            return;
        }

        if (!items.length) {
            container.innerHTML = `
                <div class="col-span-full text-center py-8 text-gray-400">
                    비교 대상을 추가하려면 기업 카드나 상세 모달에서 "비교" 버튼을 사용하세요.
                </div>
            `;
            return;
        }

        container.innerHTML = items.map(item => `
            <div class="dashboard-card draggable-company flex flex-col gap-2 cursor-grab" draggable="true" data-id="${item.id}">
                <div class="flex items-center justify-between">
                    <div>
                        <h4 class="text-base font-semibold text-gray-900">${item.name}</h4>
                        <p class="text-xs text-gray-500">${item.subtitle || ''}</p>
                    </div>
                    <button class="remove-compare-btn text-sm text-red-600 hover:text-red-700" data-id="${item.id}">
                        제거
                    </button>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <span>ROE: ${item.metrics?.profitability ?? 'N/A'}</span>
                    <span>Growth: ${item.metrics?.growth ?? 'N/A'}</span>
                    <span>Momentum: ${item.metrics?.momentum ?? 'N/A'}</span>
                    <span>PER: ${item.metrics?.valuation ?? 'N/A'}</span>
                </div>
            </div>
        `).join('');
    }

    function renderComparisonTable(rows = []) {
        const layout = ensureBaseStructure();
        if (!layout?.table) return;
        const tbody = layout.table.querySelector('tbody');
        if (!tbody) return;

        if (!rows.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="px-3 py-6 text-center text-gray-400">
                        비교 대상을 선택하면 테이블이 채워집니다.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = rows.map(row => `
            <tr class="hover:bg-blue-50 transition-colors" data-id="${row.id}">
                <td class="px-3 py-2 font-medium text-gray-900">${row.name}</td>
                <td class="px-3 py-2 text-center">${row.profitability}</td>
                <td class="px-3 py-2 text-center">${row.growth}</td>
                <td class="px-3 py-2 text-center">${row.momentum}</td>
                <td class="px-3 py-2 text-center">${row.valuation}</td>
                <td class="px-3 py-2 text-center">${row.dividend}</td>
                <td class="px-3 py-2 text-center font-semibold">${row.score}</td>
                <td class="px-3 py-2 text-center">${row.risk}</td>
            </tr>
        `).join('');
    }

    function renderInsights(items = []) {
        const layout = ensureBaseStructure();
        if (!layout?.insightList) return;

        if (!items.length) {
            layout.insightList.innerHTML = `
                <li class="text-gray-400">대상을 선택하면 인사이트가 표시됩니다.</li>
            `;
            return;
        }

        layout.insightList.innerHTML = items.map(line => `
            <li class="flex items-start gap-2">
                <span class="text-blue-600 mt-0.5">•</span>
                <span>${line}</span>
            </li>
        `).join('');
    }

    return {
        ensureBaseStructure,
        renderSelectedCompanies,
        renderComparisonTable,
        renderInsights
    };
})();

window.DeepCompareLayout = DeepCompareLayout;

console.log('✅ DeepCompare ComparisonLayout 로드 완료');
