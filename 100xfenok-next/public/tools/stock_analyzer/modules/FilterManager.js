/**
 * FilterManager - 고급 필터링 시스템
 */

class FilterManager {
    constructor() {
        this.filters = {
            // 범위 필터
            per: { min: null, max: null },
            pbr: { min: null, max: null },
            roe: { min: null, max: null },
            marketCap: { min: null, max: null },
            
            // 카테고리 필터
            industries: [],
            exchanges: [],
            
            // 텍스트 필터
            search: '',
            
            // 복합 필터
            quality: false,
            value: false,
            growth: false
        };
        
        this.filteredData = [];
        this.originalData = [];
        this.filterHistory = [];
        
        console.log('🔧 FilterManager 초기화');
    }

    /**
     * 필터 시스템 초기화
     */
    initialize(data) {
        this.originalData = data || window.allData || [];
        this.filteredData = [...this.originalData];
        
        this.setupFilterUI();
        this.setupEventListeners();
        this.extractFilterOptions();
        
        console.log(`✅ FilterManager 초기화 완료 - ${this.originalData.length}개 기업 데이터`);
    }

    /**
     * 필터 UI 설정
     */
    setupFilterUI() {
        this.createRangeFilters();
        this.createCategoryFilters();
        this.createPresetFilters();
    }

    /**
     * 범위 필터 생성
     */
    createRangeFilters() {
        const rangeFilters = [
            { key: 'per', label: 'PER', dataKey: 'PER (Oct-25)', min: 0, max: 100 },
            { key: 'pbr', label: 'PBR', dataKey: 'PBR (Oct-25)', min: 0, max: 20 },
            { key: 'roe', label: 'ROE (%)', dataKey: 'ROE (Fwd)', min: -50, max: 100 },
            { key: 'marketCap', label: '시가총액 (백만달러)', dataKey: '(USD mn)', min: 0, max: 1000000 }
        ];

        rangeFilters.forEach(filter => {
            this.createRangeSlider(filter);
        });
    }

    /**
     * 범위 슬라이더 생성
     */
    createRangeSlider(config) {
        const container = document.getElementById('range-filters-container');
        if (!container) return;

        const filterDiv = document.createElement('div');
        filterDiv.className = 'range-filter mb-4';
        filterDiv.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <label class="text-sm font-medium text-gray-700">${config.label}</label>
                <div class="text-xs text-gray-500">
                    <span id="${config.key}-min-value">${config.min}</span> - 
                    <span id="${config.key}-max-value">${config.max}</span>
                </div>
            </div>
            <div class="range-slider-container relative">
                <input type="range" 
                       id="${config.key}-min" 
                       class="range-slider range-min" 
                       min="${config.min}" 
                       max="${config.max}" 
                       value="${config.min}"
                       step="${this.getStep(config)}">
                <input type="range" 
                       id="${config.key}-max" 
                       class="range-slider range-max" 
                       min="${config.min}" 
                       max="${config.max}" 
                       value="${config.max}"
                       step="${this.getStep(config)}">
                <div class="range-track"></div>
                <div class="range-fill" id="${config.key}-fill"></div>
            </div>
        `;

        container.appendChild(filterDiv);

        // 이벤트 리스너 추가
        this.setupRangeSliderEvents(config);
    }

    /**
     * 범위 슬라이더 스텝 계산
     */
    getStep(config) {
        if (config.key === 'marketCap') return 1000;
        if (config.key === 'roe') return 1;
        return 0.1;
    }

    /**
     * 범위 슬라이더 이벤트 설정
     */
    setupRangeSliderEvents(config) {
        const minSlider = document.getElementById(`${config.key}-min`);
        const maxSlider = document.getElementById(`${config.key}-max`);
        const minValue = document.getElementById(`${config.key}-min-value`);
        const maxValue = document.getElementById(`${config.key}-max-value`);
        const fill = document.getElementById(`${config.key}-fill`);

        const updateRange = () => {
            const min = parseFloat(minSlider.value);
            const max = parseFloat(maxSlider.value);

            // 최소값이 최대값보다 클 수 없음
            if (min > max) {
                minSlider.value = max;
                return;
            }

            // 값 표시 업데이트
            minValue.textContent = this.formatValue(config.key, min);
            maxValue.textContent = this.formatValue(config.key, max);

            // 필터 범위 시각화
            this.updateRangeFill(config.key, min, max, config.min, config.max);

            // 필터 적용
            this.filters[config.key] = { min, max };
            this.applyFilters();
        };

        minSlider.addEventListener('input', updateRange);
        maxSlider.addEventListener('input', updateRange);
    }

    /**
     * 범위 필 업데이트
     */
    updateRangeFill(key, min, max, rangeMin, rangeMax) {
        const fill = document.getElementById(`${key}-fill`);
        if (!fill) return;

        const minPercent = ((min - rangeMin) / (rangeMax - rangeMin)) * 100;
        const maxPercent = ((max - rangeMin) / (rangeMax - rangeMin)) * 100;

        fill.style.left = `${minPercent}%`;
        fill.style.width = `${maxPercent - minPercent}%`;
    }

    /**
     * 값 포맷팅
     */
    formatValue(key, value) {
        switch (key) {
            case 'marketCap':
                return value >= 1000 ? `${(value/1000).toFixed(1)}B` : `${value}M`;
            case 'roe':
                return `${value.toFixed(1)}%`;
            default:
                return value.toFixed(1);
        }
    }

    /**
     * 카테고리 필터 생성
     */
    createCategoryFilters() {
        this.createIndustryFilter();
        this.createExchangeFilter();
    }

    /**
     * 업종 필터 생성
     */
    createIndustryFilter() {
        const container = document.getElementById('industry-filter-container');
        if (!container) return;

        const industries = this.getUniqueValues('industry');
        
        const filterDiv = document.createElement('div');
        filterDiv.className = 'category-filter mb-4';
        filterDiv.innerHTML = `
            <label class="text-sm font-medium text-gray-700 mb-2 block">업종</label>
            <div class="max-h-40 overflow-y-auto border rounded p-2">
                <div class="mb-2">
                    <label class="flex items-center">
                        <input type="checkbox" id="industry-all" class="mr-2" checked>
                        <span class="text-sm">전체 선택</span>
                    </label>
                </div>
                ${industries.map(industry => `
                    <div class="mb-1">
                        <label class="flex items-center">
                            <input type="checkbox" class="industry-checkbox mr-2" value="${industry}" checked>
                            <span class="text-xs">${industry}</span>
                        </label>
                    </div>
                `).join('')}
            </div>
        `;

        container.appendChild(filterDiv);

        // 이벤트 리스너
        this.setupCategoryFilterEvents('industry');
    }

    /**
     * 거래소 필터 생성
     */
    createExchangeFilter() {
        const container = document.getElementById('exchange-filter-container');
        if (!container) return;

        const exchanges = this.getUniqueValues('Exchange');
        
        const filterDiv = document.createElement('div');
        filterDiv.className = 'category-filter mb-4';
        filterDiv.innerHTML = `
            <label class="text-sm font-medium text-gray-700 mb-2 block">거래소</label>
            <div class="max-h-32 overflow-y-auto border rounded p-2">
                <div class="mb-2">
                    <label class="flex items-center">
                        <input type="checkbox" id="exchange-all" class="mr-2" checked>
                        <span class="text-sm">전체 선택</span>
                    </label>
                </div>
                ${exchanges.map(exchange => `
                    <div class="mb-1">
                        <label class="flex items-center">
                            <input type="checkbox" class="exchange-checkbox mr-2" value="${exchange}" checked>
                            <span class="text-xs">${exchange}</span>
                        </label>
                    </div>
                `).join('')}
            </div>
        `;

        container.appendChild(filterDiv);

        // 이벤트 리스너
        this.setupCategoryFilterEvents('exchange');
    }

    /**
     * 카테고리 필터 이벤트 설정
     */
    setupCategoryFilterEvents(type) {
        const allCheckbox = document.getElementById(`${type}-all`);
        const checkboxes = document.querySelectorAll(`.${type}-checkbox`);

        // 전체 선택/해제
        allCheckbox.addEventListener('change', () => {
            checkboxes.forEach(cb => {
                cb.checked = allCheckbox.checked;
            });
            this.updateCategoryFilter(type);
        });

        // 개별 체크박스
        checkboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                // 전체 선택 상태 업데이트
                const checkedCount = Array.from(checkboxes).filter(c => c.checked).length;
                allCheckbox.checked = checkedCount === checkboxes.length;
                allCheckbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
                
                this.updateCategoryFilter(type);
            });
        });
    }

    /**
     * 카테고리 필터 업데이트
     */
    updateCategoryFilter(type) {
        const checkboxes = document.querySelectorAll(`.${type}-checkbox:checked`);
        const selectedValues = Array.from(checkboxes).map(cb => cb.value);
        
        if (type === 'industry') {
            this.filters.industries = selectedValues;
        } else if (type === 'exchange') {
            this.filters.exchanges = selectedValues;
        }

        this.applyFilters();
    }

    /**
     * 프리셋 필터 생성
     */
    createPresetFilters() {
        const container = document.getElementById('preset-filters-container');
        if (!container) return;

        const presets = [
            { key: 'quality', label: '우량주', icon: '⭐', description: 'ROE 15% 이상, PER 25 이하' },
            { key: 'value', label: '가치주', icon: '💎', description: 'PER 15 이하, PBR 2 이하' },
            { key: 'growth', label: '성장주', icon: '🚀', description: '매출성장률 20% 이상' },
            { key: 'dividend', label: '배당주', icon: '💰', description: '배당수익률 3% 이상' },
            { key: 'large-cap', label: '대형주', icon: '🏢', description: '시가총액 100억달러 이상' },
            { key: 'tech', label: '기술주', icon: '💻', description: '기술 관련 업종' }
        ];

        const filterDiv = document.createElement('div');
        filterDiv.className = 'preset-filters mb-4';
        filterDiv.innerHTML = `
            <label class="text-sm font-medium text-gray-700 mb-3 block">빠른 필터</label>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                ${presets.map(preset => `
                    <button class="preset-filter-btn p-3 border rounded-lg text-left hover:bg-blue-50 hover:border-blue-300 transition-colors" 
                            data-preset="${preset.key}"
                            title="${preset.description}">
                        <div class="flex items-center mb-1">
                            <span class="text-lg mr-2">${preset.icon}</span>
                            <span class="text-sm font-medium">${preset.label}</span>
                        </div>
                        <div class="text-xs text-gray-500">${preset.description}</div>
                    </button>
                `).join('')}
            </div>
        `;

        container.appendChild(filterDiv);

        // 이벤트 리스너
        this.setupPresetFilterEvents();
    }

    /**
     * 프리셋 필터 이벤트 설정
     */
    setupPresetFilterEvents() {
        const presetButtons = document.querySelectorAll('.preset-filter-btn');
        
        presetButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                this.applyPresetFilter(preset);
                
                // 버튼 활성화 상태 업데이트
                presetButtons.forEach(b => b.classList.remove('bg-blue-100', 'border-blue-500'));
                btn.classList.add('bg-blue-100', 'border-blue-500');
            });
        });
    }

    /**
     * 프리셋 필터 적용
     */
    applyPresetFilter(preset) {
        // 기존 필터 초기화
        this.resetFilters();

        switch (preset) {
            case 'quality':
                this.filters.roe = { min: 15, max: 100 };
                this.filters.per = { min: 0, max: 25 };
                break;
            case 'value':
                this.filters.per = { min: 0, max: 15 };
                this.filters.pbr = { min: 0, max: 2 };
                break;
            case 'growth':
                // 매출성장률 필터 (향후 구현)
                break;
            case 'dividend':
                // 배당수익률 필터 (향후 구현)
                break;
            case 'large-cap':
                this.filters.marketCap = { min: 100000, max: 1000000 };
                break;
            case 'tech':
                this.filters.industries = ['Technology', 'Software', 'Semiconductors', 'Internet'];
                break;
        }

        this.applyFilters();
        this.updateFilterUI();
        
        console.log(`🔧 프리셋 필터 적용: ${preset}`);
    }

    /**
     * 필터 적용
     */
    applyFilters() {
        let filtered = [...this.originalData];

        // 범위 필터 적용
        filtered = this.applyRangeFilters(filtered);
        
        // 카테고리 필터 적용
        filtered = this.applyCategoryFilters(filtered);
        
        // 텍스트 검색 필터 적용
        if (this.filters.search) {
            filtered = this.applySearchFilter(filtered);
        }

        this.filteredData = filtered;
        
        // 결과 업데이트
        this.updateResults();
        
        console.log(`🔍 필터 적용 완료: ${filtered.length}/${this.originalData.length}개 기업`);
    }

    /**
     * 범위 필터 적용
     */
    applyRangeFilters(data) {
        const rangeFilters = [
            { key: 'per', dataKey: 'PER (Oct-25)' },
            { key: 'pbr', dataKey: 'PBR (Oct-25)' },
            { key: 'roe', dataKey: 'ROE (Fwd)' },
            { key: 'marketCap', dataKey: '(USD mn)' }
        ];

        return data.filter(company => {
            return rangeFilters.every(filter => {
                const filterRange = this.filters[filter.key];
                if (!filterRange || (filterRange.min === null && filterRange.max === null)) {
                    return true;
                }

                const value = parseFloat(company[filter.dataKey]) || 0;
                const min = filterRange.min !== null ? filterRange.min : -Infinity;
                const max = filterRange.max !== null ? filterRange.max : Infinity;

                return value >= min && value <= max;
            });
        });
    }

    /**
     * 카테고리 필터 적용
     */
    applyCategoryFilters(data) {
        return data.filter(company => {
            // 업종 필터
            if (this.filters.industries.length > 0) {
                if (!this.filters.industries.includes(company.industry)) {
                    return false;
                }
            }

            // 거래소 필터
            if (this.filters.exchanges.length > 0) {
                if (!this.filters.exchanges.includes(company.Exchange)) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * 검색 필터 적용
     */
    applySearchFilter(data) {
        const searchTerm = this.filters.search.toLowerCase();
        
        return data.filter(company => {
            return company.Ticker.toLowerCase().includes(searchTerm) ||
                   (company.corpName && company.corpName.toLowerCase().includes(searchTerm)) ||
                   (company.industry && company.industry.toLowerCase().includes(searchTerm));
        });
    }

    /**
     * 결과 업데이트
     */
    updateResults() {
        // 메인 테이블 업데이트
        if (window.renderTable) {
            window.renderTable(this.filteredData);
        }

        // 결과 수 표시 업데이트
        this.updateResultCount();
        
        // 필터 상태 표시 업데이트
        this.updateFilterStatus();
    }

    /**
     * 결과 수 표시 업데이트
     */
    updateResultCount() {
        const countElement = document.getElementById('filter-result-count');
        if (countElement) {
            countElement.textContent = `${this.filteredData.length.toLocaleString()}개 기업`;
        }
    }

    /**
     * 필터 상태 표시 업데이트
     */
    updateFilterStatus() {
        const statusElement = document.getElementById('filter-status');
        if (!statusElement) return;

        const activeFilters = this.getActiveFilters();
        
        if (activeFilters.length === 0) {
            statusElement.innerHTML = '<span class="text-gray-500">필터 없음</span>';
        } else {
            statusElement.innerHTML = `
                <div class="flex flex-wrap gap-1">
                    ${activeFilters.map(filter => `
                        <span class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                            ${filter}
                            <button class="ml-1 hover:text-blue-600" onclick="window.filterManager.removeFilter('${filter}')">×</button>
                        </span>
                    `).join('')}
                    <button class="text-xs text-gray-500 hover:text-gray-700 ml-2" onclick="window.filterManager.resetFilters()">
                        모두 제거
                    </button>
                </div>
            `;
        }
    }

    /**
     * 활성 필터 목록 반환
     */
    getActiveFilters() {
        const active = [];

        // 범위 필터
        Object.entries(this.filters).forEach(([key, value]) => {
            if (key === 'per' || key === 'pbr' || key === 'roe' || key === 'marketCap') {
                if (value.min !== null || value.max !== null) {
                    active.push(`${key.toUpperCase()}: ${value.min || 0}-${value.max || '∞'}`);
                }
            }
        });

        // 카테고리 필터
        if (this.filters.industries.length > 0 && this.filters.industries.length < this.getUniqueValues('industry').length) {
            active.push(`업종: ${this.filters.industries.length}개 선택`);
        }

        if (this.filters.exchanges.length > 0 && this.filters.exchanges.length < this.getUniqueValues('Exchange').length) {
            active.push(`거래소: ${this.filters.exchanges.length}개 선택`);
        }

        return active;
    }

    /**
     * 필터 초기화
     */
    resetFilters() {
        this.filters = {
            per: { min: null, max: null },
            pbr: { min: null, max: null },
            roe: { min: null, max: null },
            marketCap: { min: null, max: null },
            industries: [],
            exchanges: [],
            search: '',
            quality: false,
            value: false,
            growth: false
        };

        this.applyFilters();
        this.updateFilterUI();
        
        console.log('🔄 필터 초기화 완료');
    }

    /**
     * 필터 UI 업데이트
     */
    updateFilterUI() {
        // 범위 슬라이더 초기화
        Object.keys(this.filters).forEach(key => {
            if (key === 'per' || key === 'pbr' || key === 'roe' || key === 'marketCap') {
                const minSlider = document.getElementById(`${key}-min`);
                const maxSlider = document.getElementById(`${key}-max`);
                
                if (minSlider && maxSlider) {
                    minSlider.value = minSlider.min;
                    maxSlider.value = maxSlider.max;
                    
                    // 값 표시 업데이트
                    const minValue = document.getElementById(`${key}-min-value`);
                    const maxValue = document.getElementById(`${key}-max-value`);
                    if (minValue) minValue.textContent = minSlider.min;
                    if (maxValue) maxValue.textContent = maxSlider.max;
                }
            }
        });

        // 카테고리 체크박스 초기화
        document.querySelectorAll('.industry-checkbox, .exchange-checkbox').forEach(cb => {
            cb.checked = true;
        });
        
        const industryAll = document.getElementById('industry-all');
        const exchangeAll = document.getElementById('exchange-all');
        if (industryAll) industryAll.checked = true;
        if (exchangeAll) exchangeAll.checked = true;
    }

    /**
     * 고유값 추출
     */
    getUniqueValues(key) {
        const values = this.originalData
            .map(item => item[key])
            .filter(value => value && value !== '')
            .filter((value, index, array) => array.indexOf(value) === index)
            .sort();
        
        return values;
    }

    /**
     * 필터 옵션 추출
     */
    extractFilterOptions() {
        // 업종 목록 추출
        this.availableIndustries = this.getUniqueValues('industry');
        
        // 거래소 목록 추출
        this.availableExchanges = this.getUniqueValues('Exchange');
        
        console.log(`📊 필터 옵션 추출 완료: ${this.availableIndustries.length}개 업종, ${this.availableExchanges.length}개 거래소`);
    }

    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        // 검색 입력 이벤트
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.filters.search = e.target.value;
                    this.applyFilters();
                }, 300);
            });
        }
    }

    /**
     * 필터된 데이터 반환
     */
    getFilteredData() {
        return this.filteredData;
    }

    /**
     * 필터 상태 반환
     */
    getFilterState() {
        return { ...this.filters };
    }
}

// 전역 인스턴스 생성
window.filterManager = new FilterManager();

console.log('✅ FilterManager 로드 완료 - 고급 필터링 시스템');