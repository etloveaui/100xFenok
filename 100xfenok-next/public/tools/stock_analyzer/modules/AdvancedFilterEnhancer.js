/**
 * AdvancedFilterEnhancer - 고급 필터 기능 개선 시스템
 */

class AdvancedFilterEnhancer {
    constructor() {
        this.isInitialized = false;
        this.filterRanges = new Map();
        this.savedFilters = new Map();
        this.activeFilters = new Map();
        
        console.log('🔧 AdvancedFilterEnhancer 초기화');
    }

    /**
     * 고급 필터 시스템 초기화
     */
    initialize() {
        if (this.isInitialized) return;
        
        this.createAdvancedFilterPanel();
        this.setupRangeFilters();
        this.setupFilterPresets();
        this.setupFilterSaveLoad();
        
        this.isInitialized = true;
        console.log('✅ 고급 필터 시스템 초기화 완료');
    }

    /**
     * 고급 필터 패널 생성
     */
    createAdvancedFilterPanel() {
        // 기존 패널 제거
        const existingPanel = document.getElementById('advanced-filter-panel');
        if (existingPanel) {
            existingPanel.remove();
        }

        // 검색 컨테이너 찾기
        const searchContainer = document.querySelector('.search-container') || 
                              document.querySelector('#search-input')?.parentElement;
        
        if (!searchContainer) {
            console.warn('⚠️ 검색 컨테이너를 찾을 수 없습니다.');
            return;
        }

        // 고급 필터 패널 생성
        const panel = document.createElement('div');
        panel.id = 'advanced-filter-panel';
        panel.className = 'mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200';
        panel.style.display = 'none'; // 초기에는 숨김

        panel.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-bold text-gray-800">
                    <i class="fas fa-sliders-h mr-2"></i>고급 필터
                </h3>
                <div class="space-x-2">
                    <button id="filter-preset-btn" class="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
                        <i class="fas fa-bookmark mr-1"></i>프리셋
                    </button>
                    <button id="save-filter-btn" class="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700">
                        <i class="fas fa-save mr-1"></i>저장
                    </button>
                    <button id="clear-all-filters-btn" class="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700">
                        <i class="fas fa-times mr-1"></i>초기화
                    </button>
                </div>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <!-- PER 필터 -->
                <div class="filter-group">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        PER (Price-to-Earnings)
                    </label>
                    <div class="space-y-2">
                        <div class="flex space-x-2">
                            <input type="number" id="per-min" placeholder="최소" class="w-full px-2 py-1 border rounded text-sm">
                            <input type="number" id="per-max" placeholder="최대" class="w-full px-2 py-1 border rounded text-sm">
                        </div>
                        <input type="range" id="per-range" min="0" max="100" step="0.1" class="w-full">
                        <div class="text-xs text-gray-500 text-center" id="per-display">0 - 100</div>
                    </div>
                </div>

                <!-- PBR 필터 -->
                <div class="filter-group">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        PBR (Price-to-Book)
                    </label>
                    <div class="space-y-2">
                        <div class="flex space-x-2">
                            <input type="number" id="pbr-min" placeholder="최소" class="w-full px-2 py-1 border rounded text-sm">
                            <input type="number" id="pbr-max" placeholder="최대" class="w-full px-2 py-1 border rounded text-sm">
                        </div>
                        <input type="range" id="pbr-range" min="0" max="20" step="0.1" class="w-full">
                        <div class="text-xs text-gray-500 text-center" id="pbr-display">0 - 20</div>
                    </div>
                </div>

                <!-- ROE 필터 -->
                <div class="filter-group">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        ROE (Return on Equity) %
                    </label>
                    <div class="space-y-2">
                        <div class="flex space-x-2">
                            <input type="number" id="roe-min" placeholder="최소" class="w-full px-2 py-1 border rounded text-sm">
                            <input type="number" id="roe-max" placeholder="최대" class="w-full px-2 py-1 border rounded text-sm">
                        </div>
                        <input type="range" id="roe-range" min="-50" max="100" step="0.1" class="w-full">
                        <div class="text-xs text-gray-500 text-center" id="roe-display">-50 - 100</div>
                    </div>
                </div>
            </div>
            
            <div class="mt-4 flex justify-between items-center">
                <div class="text-sm text-gray-600">
                    <span id="filter-result-count">0</span>개 기업이 조건에 맞습니다.
                </div>
                <button id="apply-advanced-filters-btn" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                    <i class="fas fa-filter mr-2"></i>필터 적용
                </button>
            </div>
        `;

        // 검색 컨테이너 다음에 추가
        searchContainer.parentNode.insertBefore(panel, searchContainer.nextSibling);

        // 고급 필터 토글 버튼 추가
        this.addAdvancedFilterToggle(searchContainer);
    }

    /**
     * 고급 필터 토글 버튼 추가
     */
    addAdvancedFilterToggle(searchContainer) {
        // 기존 토글 버튼 제거
        const existingToggle = document.getElementById('advanced-filter-toggle');
        if (existingToggle) {
            existingToggle.remove();
        }

        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'advanced-filter-toggle';
        toggleBtn.className = 'ml-2 px-3 py-2 bg-gray-600 text-white rounded-md text-sm hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500';
        toggleBtn.innerHTML = '<i class="fas fa-sliders-h mr-1"></i>고급 필터';
        
        toggleBtn.addEventListener('click', () => {
            this.toggleAdvancedFilterPanel();
        });

        // 검색 입력 필드 옆에 추가
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput.parentNode) {
            searchInput.parentNode.insertBefore(toggleBtn, searchInput.nextSibling);
        } else {
            searchContainer.appendChild(toggleBtn);
        }
    }

    /**
     * 고급 필터 패널 토글
     */
    toggleAdvancedFilterPanel() {
        const panel = document.getElementById('advanced-filter-panel');
        if (!panel) return;

        const isVisible = panel.style.display !== 'none';
        panel.style.display = isVisible ? 'none' : 'block';
        
        const toggleBtn = document.getElementById('advanced-filter-toggle');
        if (toggleBtn) {
            toggleBtn.innerHTML = isVisible ? 
                '<i class="fas fa-sliders-h mr-1"></i>고급 필터' : 
                '<i class="fas fa-times mr-1"></i>닫기';
        }

        if (!isVisible) {
            // 패널이 열릴 때 데이터 범위 초기화
            this.initializeFilterRanges();
        }
    }

    /**
     * 범위 필터 설정
     */
    setupRangeFilters() {
        const filters = [
            { id: 'per', field: 'PER (Oct-25)', min: 0, max: 100 },
            { id: 'pbr', field: 'PBR (Oct-25)', min: 0, max: 20 },
            { id: 'roe', field: 'ROE (Fwd)', min: -50, max: 100 }
        ];

        filters.forEach(filter => {
            this.setupSingleRangeFilter(filter);
        });
    }

    /**
     * 단일 범위 필터 설정
     */
    setupSingleRangeFilter(filter) {
        const minInput = document.getElementById(`${filter.id}-min`);
        const maxInput = document.getElementById(`${filter.id}-max`);
        const rangeSlider = document.getElementById(`${filter.id}-range`);
        const display = document.getElementById(`${filter.id}-display`);

        if (!minInput || !maxInput || !rangeSlider || !display) return;

        // 초기값 설정
        minInput.value = filter.min;
        maxInput.value = filter.max;
        rangeSlider.min = filter.min;
        rangeSlider.max = filter.max;
        rangeSlider.value = filter.max;

        // 이벤트 리스너 추가
        const updateFilter = () => {
            const min = parseFloat(minInput.value) || filter.min;
            const max = parseFloat(maxInput.value) || filter.max;
            
            display.textContent = `${min.toLocaleString()} - ${max.toLocaleString()}`;
            
            this.activeFilters.set(filter.id, {
                field: filter.field,
                min: min,
                max: max
            });
            
            // 실시간 결과 개수 업데이트
            this.updateFilterResultCount();
        };

        minInput.addEventListener('input', updateFilter);
        maxInput.addEventListener('input', updateFilter);
        
        rangeSlider.addEventListener('input', (e) => {
            maxInput.value = e.target.value;
            updateFilter();
        });

        // 초기 필터 설정
        updateFilter();
    }

    /**
     * 필터 범위 초기화
     */
    initializeFilterRanges() {
        if (!window.allData || window.allData.length === 0) {
            console.warn('⚠️ 데이터가 없어 필터 범위를 초기화할 수 없습니다.');
            return;
        }

        const fields = [
            { id: 'per', field: 'PER (Oct-25)' },
            { id: 'pbr', field: 'PBR (Oct-25)' },
            { id: 'roe', field: 'ROE (Fwd)' }
        ];

        fields.forEach(({ id, field }) => {
            const values = window.allData
                .map(company => parseFloat(company[field]))
                .filter(value => !isNaN(value) && isFinite(value));
            
            if (values.length > 0) {
                const min = Math.min(...values);
                const max = Math.max(...values);
                
                this.filterRanges.set(id, { min, max, field });
                
                // UI 업데이트
                const minInput = document.getElementById(`${id}-min`);
                const maxInput = document.getElementById(`${id}-max`);
                const rangeSlider = document.getElementById(`${id}-range`);
                
                if (minInput && maxInput && rangeSlider) {
                    minInput.placeholder = `최소 (${min.toFixed(1)})`;
                    maxInput.placeholder = `최대 (${max.toFixed(1)})`;
                    rangeSlider.min = min;
                    rangeSlider.max = max;
                }
            }
        });

        console.log('📊 필터 범위 초기화 완료:', this.filterRanges);
    }

    /**
     * 필터 프리셋 설정
     */
    setupFilterPresets() {
        const presetBtn = document.getElementById('filter-preset-btn');
        if (!presetBtn) return;

        presetBtn.addEventListener('click', () => {
            this.showFilterPresets();
        });
    }

    /**
     * 필터 프리셋 표시
     */
    showFilterPresets() {
        const presets = {
            '저평가 우량주': {
                'per': { min: 0, max: 15 },
                'pbr': { min: 0, max: 2 },
                'roe': { min: 10, max: 100 }
            },
            '고성장주': {
                'roe': { min: 15, max: 100 }
            }
        };

        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        modal.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-md mx-4">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-bold">필터 프리셋</h3>
                    <button class="text-gray-500 hover:text-gray-700 text-xl">&times;</button>
                </div>
                <div class="space-y-2">
                    ${Object.keys(presets).map(name => `
                        <button class="w-full text-left px-3 py-2 rounded hover:bg-gray-100 preset-btn" data-preset="${name}">
                            <strong>${name}</strong>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;

        // 이벤트 리스너
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.textContent === '×') {
                modal.remove();
            }
            
            if (e.target.classList.contains('preset-btn') || e.target.closest('.preset-btn')) {
                const presetName = e.target.dataset.preset || e.target.closest('.preset-btn').dataset.preset;
                this.applyFilterPreset(presets[presetName]);
                modal.remove();
            }
        });

        document.body.appendChild(modal);
    }

    /**
     * 필터 프리셋 적용
     */
    applyFilterPreset(preset) {
        Object.entries(preset).forEach(([filterId, range]) => {
            const minInput = document.getElementById(`${filterId}-min`);
            const maxInput = document.getElementById(`${filterId}-max`);
            
            if (minInput && maxInput) {
                minInput.value = range.min;
                maxInput.value = range.max;
                
                // 이벤트 트리거
                minInput.dispatchEvent(new Event('input'));
                maxInput.dispatchEvent(new Event('input'));
            }
        });

        if (window.loadingManager) {
            window.loadingManager.showFeedback('프리셋이 적용되었습니다.', 'success', 2000);
        }
    }

    /**
     * 필터 저장/로드 설정
     */
    setupFilterSaveLoad() {
        const saveBtn = document.getElementById('save-filter-btn');
        const clearBtn = document.getElementById('clear-all-filters-btn');
        const applyBtn = document.getElementById('apply-advanced-filters-btn');

        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.saveCurrentFilters();
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.clearAllFilters();
            });
        }

        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                this.applyAdvancedFilters();
            });
        }
    }

    /**
     * 현재 필터 저장
     */
    saveCurrentFilters() {
        const filterName = prompt('필터 이름을 입력하세요:');
        if (!filterName) return;

        const currentFilters = {};
        this.activeFilters.forEach((value, key) => {
            currentFilters[key] = value;
        });

        this.savedFilters.set(filterName, currentFilters);

        if (window.loadingManager) {
            window.loadingManager.showFeedback(`필터 "${filterName}"이 저장되었습니다.`, 'success', 2000);
        }
    }

    /**
     * 모든 필터 초기화
     */
    clearAllFilters() {
        const inputs = document.querySelectorAll('#advanced-filter-panel input[type="number"]');
        inputs.forEach(input => {
            input.value = '';
        });

        this.activeFilters.clear();
        this.updateFilterResultCount();

        if (window.loadingManager) {
            window.loadingManager.showFeedback('모든 필터가 초기화되었습니다.', 'info', 2000);
        }
    }

    /**
     * 고급 필터 적용
     */
    applyAdvancedFilters() {
        if (!window.allData || window.allData.length === 0) {
            console.warn('⚠️ 필터를 적용할 데이터가 없습니다.');
            return;
        }

        let filteredData = [...window.allData];

        // 각 필터 적용
        this.activeFilters.forEach((filter, filterId) => {
            if (filter.min !== undefined && filter.max !== undefined) {
                filteredData = filteredData.filter(company => {
                    const value = parseFloat(company[filter.field]);
                    if (isNaN(value)) return false;
                    
                    return value >= filter.min && value <= filter.max;
                });
            }
        });

        console.log(`🔍 고급 필터 적용 결과: ${filteredData.length}개 기업`);

        // 결과 업데이트
        this.updateResults(filteredData);
        
        // 피드백 표시
        if (window.loadingManager) {
            window.loadingManager.showFeedback(
                `고급 필터 적용: ${filteredData.length}개 기업 표시`,
                'success',
                3000
            );
        }
    }

    /**
     * 필터 결과 개수 업데이트
     */
    updateFilterResultCount() {
        if (!window.allData || this.activeFilters.size === 0) {
            const countElement = document.getElementById('filter-result-count');
            if (countElement) {
                countElement.textContent = window.allData ? window.allData.length : 0;
            }
            return;
        }

        let filteredData = [...window.allData];

        this.activeFilters.forEach((filter, filterId) => {
            if (filter.min !== undefined && filter.max !== undefined) {
                filteredData = filteredData.filter(company => {
                    const value = parseFloat(company[filter.field]);
                    if (isNaN(value)) return false;
                    
                    return value >= filter.min && value <= filter.max;
                });
            }
        });

        const countElement = document.getElementById('filter-result-count');
        if (countElement) {
            countElement.textContent = filteredData.length;
        }
    }

    /**
     * 결과 업데이트
     */
    updateResults(filteredData) {
        // 전역 변수 업데이트
        window.filteredData = filteredData;
        window.currentData = filteredData;

        // 테이블 업데이트
        if (typeof renderTable === 'function') {
            renderTable(filteredData);
        } else if (window.renderTable) {
            window.renderTable(filteredData);
        }

        // 카드 뷰 업데이트 (현재 카드 뷰인 경우)
        if (window.cardViewManager && window.cardViewManager.getCurrentView() === 'card') {
            window.cardViewManager.renderCardView(filteredData);
        }

        // 페이지네이션 업데이트
        if (typeof updatePagination === 'function') {
            updatePagination(filteredData.length);
        }
    }

    /**
     * 필터 상태 반환
     */
    getFilterStatus() {
        return {
            isInitialized: this.isInitialized,
            activeFilters: this.activeFilters.size,
            savedFilters: this.savedFilters.size,
            availableData: window.allData ? window.allData.length : 0
        };
    }
}

// 전역 인스턴스 생성
window.advancedFilterEnhancer = new AdvancedFilterEnhancer();

console.log('✅ AdvancedFilterEnhancer 로드 완료 - 고급 필터 시스템');