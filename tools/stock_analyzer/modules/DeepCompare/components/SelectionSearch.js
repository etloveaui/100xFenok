/**
 * SelectionSearch - 비교 대상 검색 및 추천 리스트 관리
 *
 * 이 모듈은 검색 입력과 추천 리스트를 업데이트하는 역할을 담당합니다.
 * Debounce 로직과 간단한 하이라이팅을 포함하여 UX를 개선합니다.
 */
const DeepCompareSelectionSearch = (() => {
    let onSelectCallback = null;
    let debounceTimer = null;
    let cache = [];

    function initialize({ inputId = 'compare-search', containerId = 'available-items', onSelect }) {
        const input = document.getElementById(inputId);
        const container = document.getElementById(containerId);

        if (!input || !container) {
            console.warn('[DeepCompareSelectionSearch] 검색 UI를 찾지 못했습니다.');
            return;
        }

        onSelectCallback = onSelect;

        input.addEventListener('input', event => {
            const keyword = event.target.value.trim();
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                renderList(filterCandidates(keyword), container, keyword);
            }, 160);
        });

        container.addEventListener('click', event => {
            const card = event.target.closest('[data-id]');
            if (!card) return;
            const id = card.dataset.id;
            if (!id) return;
            const matched = cache.find(item => item.id === id);
            if (matched && onSelectCallback) {
                onSelectCallback(matched);
            }
        });

        // 초기 추천 리스트
        renderList(filterCandidates(''), container, '');
    }

    function updateCache(newCache = []) {
        cache = newCache;
    }

    function filterCandidates(keyword) {
        if (!cache.length) return [];
        if (!keyword) {
            return cache.slice(0, 12);
        }

        const lower = keyword.toLowerCase();
        return cache
            .filter(item => item.name?.toLowerCase().includes(lower) || item.subtitle?.toLowerCase().includes(lower))
            .slice(0, 20);
    }

    function renderList(list, container, keyword) {
        if (!list.length) {
            container.innerHTML = `
                <div class="col-span-full text-center py-6 text-gray-400">
                    일치하는 항목이 없습니다.
                </div>
            `;
            return;
        }

        container.innerHTML = list.map(item => `
            <button
                type="button"
                class="dashboard-card text-left focus:outline-none focus:ring-2 focus:ring-blue-500 transition flex flex-col gap-1"
                data-id="${item.id}"
            >
                <span class="text-base font-semibold text-gray-900">${highlight(item.name || '', keyword)}</span>
                ${item.subtitle ? `<span class="text-xs text-gray-500">${highlight(item.subtitle, keyword)}</span>` : ''}
                ${item.metrics ? `
                    <div class="grid grid-cols-3 gap-2 text-xs text-gray-600 mt-2">
                        <span>ROE ${item.metrics.profitability}</span>
                        <span>Growth ${item.metrics.growth}</span>
                        <span>PER ${item.metrics.valuation}</span>
                    </div>
                ` : ''}
            </button>
        `).join('');
    }

    function highlight(text, keyword) {
        if (!keyword) return text;
        const normalized = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${normalized})`, 'ig');
        return text.replace(regex, '<mark class="bg-yellow-200">$1</mark>');
    }

    return { initialize, updateCache };
})();

window.DeepCompareSelectionSearch = DeepCompareSelectionSearch;

console.log('✅ DeepCompare SelectionSearch 모듈 로드 완료');
