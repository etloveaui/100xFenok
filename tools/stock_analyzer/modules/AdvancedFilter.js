/**
 * AdvancedFilter - 실제 작동하는 고급 필터 시스템
 */

class AdvancedFilter {
    constructor() {
        this.filters = {
            per: { min: null, max: null },
            pbr: { min: null, max: null },
            roe: { min: null, max: null },
            marketCap: { min: null, max: null },
            dividend: { min: null, max: null },
            industries: [],
            exchanges: []
        };
        
        this.isActive = false;
        this.dataIndex = null; // 성능 최적화용 인덱스
        this.availableOptions = { industries: [], exchanges: [] }; // 동적 옵션
        console.log('🔧 AdvancedFilter 초기화 - Task 5&6 완성 버전');
    }

    /**
     * 필터 시스템 초기화
     */
    initialize() {
        this.setupEventListeners();
        this.setupPresetButtons();
        this.buildDataIndex(); // 성능 최적화용 인덱스 구축
        this.populateCategoryOptions(); // 동적 옵션 생성
        this.setupMultiSelectDropdowns(); // 다중 선택 드롭다운 설정
        this.loadFilterState(); // 저장된 필터 상태 복원
        console.log('✅ AdvancedFilter 초기화 완료 - Task 5&6 기능 포함');
    }

    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        // 수치 범위 필터 이벤트
        const rangeInputs = [
            'per-min', 'per-max',
            'pbr-min', 'pbr-max', 
            'roe-min', 'roe-max',
            'market-cap-min', 'market-cap-max',
            'dividend-min', 'dividend-max'
        ];

        rangeInputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('input', () => {
                    this.updateFilters();
                    this.applyFilters();
                });
            }
        });

        // 카테고리 필터 이벤트
        const categorySelects = ['industry-filter', 'exchange-filter'];
        categorySelects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                select.addEventListener('change', () => {
                    this.updateFilters();
                    this.applyFilters();
                });
            }
        });

        // 필터 적용 버튼
        const applyBtn = document.getElementById('apply-filters');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                this.applyFilters();
            });
        }

        // 필터 초기화 버튼
        const clearBtn = document.getElementById('clear-all-filters');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.clearAllFilters();
            });
        }
    }

    /**
     * 프리셋 버튼 설정
     */
    setupPresetButtons() {
        const presetButtons = document.querySelectorAll('.filter-preset-btn');
        presetButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                this.applyPreset(preset);
            });
        });
    }

    /**
     * 현재 입력값으로 필터 업데이트
     */
    updateFilters() {
        // PER 필터
        this.filters.per.min = this.getInputValue('per-min');
        this.filters.per.max = this.getInputValue('per-max');

        // PBR 필터
        this.filters.pbr.min = this.getInputValue('pbr-min');
        this.filters.pbr.max = this.getInputValue('pbr-max');

        // ROE 필터
        this.filters.roe.min = this.getInputValue('roe-min');
        this.filters.roe.max = this.getInputValue('roe-max');

        // 시가총액 필터
        this.filters.marketCap.min = this.getInputValue('market-cap-min');
        this.filters.marketCap.max = this.getInputValue('market-cap-max');

        // 배당수익률 필터
        this.filters.dividend.min = this.getInputValue('dividend-min');
        this.filters.dividend.max = this.getInputValue('dividend-max');

        // 업종 필터
        const industrySelect = document.getElementById('industry-filter');
        this.filters.industries = industrySelect && industrySelect.value ? [industrySelect.value] : [];

        // 거래소 필터
        const exchangeSelect = document.getElementById('exchange-filter');
        this.filters.exchanges = exchangeSelect && exchangeSelect.value ? [exchangeSelect.value] : [];

        // 필터 활성 상태 확인
        this.isActive = this.hasActiveFilters();
    }

    /**
     * 입력 필드 값 가져오기
     */
    getInputValue(id) {
        const input = document.getElementById(id);
        if (!input || !input.value.trim()) return null;
        const value = parseFloat(input.value);
        return isNaN(value) ? null : value;
    }

    /**
     * 활성 필터가 있는지 확인
     */
    hasActiveFilters() {
        return (
            this.filters.per.min !== null || this.filters.per.max !== null ||
            this.filters.pbr.min !== null || this.filters.pbr.max !== null ||
            this.filters.roe.min !== null || this.filters.roe.max !== null ||
            this.filters.marketCap.min !== null || this.filters.marketCap.max !== null ||
            this.filters.dividend.min !== null || this.filters.dividend.max !== null ||
            this.filters.industries.length > 0 ||
            this.filters.exchanges.length > 0
        );
    }

    /**
     * 필터 적용
     */
    applyFilters() {
        if (!window.allData || !Array.isArray(window.allData)) {
            console.warn('⚠️ 데이터가 로딩되지 않았습니다.');
            return;
        }

        console.log('🔧 고급 필터 적용 시작:', this.filters);

        let filteredData = [...window.allData];

        // PER 필터 적용
        if (this.filters.per.min !== null || this.filters.per.max !== null) {
            filteredData = this.applyNumericFilter(filteredData, 'PER (Oct-25)', this.filters.per);
        }

        // PBR 필터 적용
        if (this.filters.pbr.min !== null || this.filters.pbr.max !== null) {
            filteredData = this.applyNumericFilter(filteredData, 'PBR (Oct-25)', this.filters.pbr);
        }

        // ROE 필터 적용
        if (this.filters.roe.min !== null || this.filters.roe.max !== null) {
            filteredData = this.applyNumericFilter(filteredData, 'ROE (Fwd)', this.filters.roe);
        }

        // 시가총액 필터 적용
        if (this.filters.marketCap.min !== null || this.filters.marketCap.max !== null) {
            filteredData = this.applyNumericFilter(filteredData, '(USD mn)', this.filters.marketCap);
        }

        // 배당수익률 필터 적용
        if (this.filters.dividend.min !== null || this.filters.dividend.max !== null) {
            filteredData = this.applyNumericFilter(filteredData, 'DY (FY+1)', this.filters.dividend);
        }

        // 업종 필터 적용
        if (this.filters.industries.length > 0) {
            filteredData = filteredData.filter(company => 
                this.filters.industries.includes(company.industry)
            );
        }

        // 거래소 필터 적용
        if (this.filters.exchanges.length > 0) {
            filteredData = filteredData.filter(company => 
                this.filters.exchanges.includes(company.Exchange)
            );
        }

        console.log(`✅ 고급 필터 적용 완료: ${window.allData.length} → ${filteredData.length}개`);

        // 필터 상태 업데이트
        this.updateFilterStatus(filteredData.length);

        // 테이블 업데이트
        if (typeof renderTable === 'function') {
            renderTable(filteredData);
        }

        // 전역 변수 업데이트
        window.currentData = filteredData;
    }

    /**
     * 수치 범위 필터 적용
     */
    applyNumericFilter(data, field, range) {
        return data.filter(company => {
            const value = parseFloat(company[field]);
            if (isNaN(value)) return false;

            if (range.min !== null && value < range.min) return false;
            if (range.max !== null && value > range.max) return false;

            return true;
        });
    }

    /**
     * 필터 상태 표시 업데이트
     */
    updateFilterStatus(resultCount) {
        const statusElement = document.getElementById('filter-status');
        if (!statusElement) return;

        if (this.isActive) {
            const activeFilters = this.getActiveFiltersList();
            statusElement.innerHTML = `
                <div class="text-sm">
                    <span class="text-blue-600 font-medium">활성 필터:</span>
                    <span class="text-gray-600">${activeFilters.join(', ')}</span>
                    <span class="text-green-600 font-medium ml-2">${resultCount.toLocaleString()}개 결과</span>
                </div>
            `;
        } else {
            statusElement.innerHTML = `
                <span class="text-gray-500">필터 없음 - ${resultCount.toLocaleString()}개 전체 결과</span>
            `;
        }
    }

    /**
     * 활성 필터 목록 생성
     */
    getActiveFiltersList() {
        const active = [];

        if (this.filters.per.min !== null || this.filters.per.max !== null) {
            const min = this.filters.per.min || '0';
            const max = this.filters.per.max || '∞';
            active.push(`PER ${min}-${max}`);
        }

        if (this.filters.pbr.min !== null || this.filters.pbr.max !== null) {
            const min = this.filters.pbr.min || '0';
            const max = this.filters.pbr.max || '∞';
            active.push(`PBR ${min}-${max}`);
        }

        if (this.filters.roe.min !== null || this.filters.roe.max !== null) {
            const min = this.filters.roe.min || '0';
            const max = this.filters.roe.max || '∞';
            active.push(`ROE ${min}-${max}%`);
        }

        if (this.filters.industries.length > 0) {
            active.push(`업종: ${this.filters.industries.join(', ')}`);
        }

        if (this.filters.exchanges.length > 0) {
            active.push(`거래소: ${this.filters.exchanges.join(', ')}`);
        }

        return active;
    }

    /**
     * 프리셋 적용
     */
    applyPreset(presetName) {
        this.clearAllFilters();

        switch (presetName) {
            case 'nasdaq-tech':
                this.setInputValue('exchange-filter', 'NASDAQ');
                break;
            case 'value-stocks':
                this.setInputValue('per-min', '');
                this.setInputValue('per-max', '15');
                this.setInputValue('pbr-min', '');
                this.setInputValue('pbr-max', '2');
                break;
            case 'dividend-stocks':
                this.setInputValue('dividend-min', '3');
                break;
            case 'large-cap':
                this.setInputValue('market-cap-min', '10000');
                break;
            case 'growth-stocks':
                this.setInputValue('roe-min', '15');
                break;
        }

        this.updateFilters();
        this.applyFilters();

        console.log(`🎯 프리셋 적용: ${presetName}`);
    }

    /**
     * 입력 필드 값 설정
     */
    setInputValue(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.value = value;
        }
    }

    /**
     * 모든 필터 초기화
     */
    clearAllFilters() {
        // 입력 필드 초기화
        const inputs = [
            'per-min', 'per-max', 'pbr-min', 'pbr-max',
            'roe-min', 'roe-max', 'market-cap-min', 'market-cap-max',
            'dividend-min', 'dividend-max'
        ];

        inputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) input.value = '';
        });

        // 선택 필드 초기화
        const selects = ['industry-filter', 'exchange-filter'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (select) select.value = '';
        });

        // 필터 객체 초기화
        this.filters = {
            per: { min: null, max: null },
            pbr: { min: null, max: null },
            roe: { min: null, max: null },
            marketCap: { min: null, max: null },
            dividend: { min: null, max: null },
            industries: [],
            exchanges: []
        };

        this.isActive = false;

        // 전체 데이터로 복원
        if (window.allData && typeof renderTable === 'function') {
            renderTable(window.allData);
            window.currentData = window.allData;
        }

        this.updateFilterStatus(window.allData ? window.allData.length : 0);

        console.log('🔄 모든 필터 초기화 완료');
    }

    /**
     * Task 6: 성능 최적화용 데이터 인덱스 구축
     */
    buildDataIndex() {
        if (!window.allData || !Array.isArray(window.allData)) return;

        console.log('🚀 데이터 인덱스 구축 시작...');
        const startTime = performance.now();

        this.dataIndex = {
            byIndustry: {},
            byExchange: {},
            byPER: [],
            byPBR: [],
            byROE: [],
            byMarketCap: []
        };

        window.allData.forEach((company, index) => {
            // 업종별 인덱스
            const industry = company.industry || 'Unknown';
            if (!this.dataIndex.byIndustry[industry]) {
                this.dataIndex.byIndustry[industry] = [];
            }
            this.dataIndex.byIndustry[industry].push(index);

            // 거래소별 인덱스
            const exchange = company.Exchange || 'Unknown';
            if (!this.dataIndex.byExchange[exchange]) {
                this.dataIndex.byExchange[exchange] = [];
            }
            this.dataIndex.byExchange[exchange].push(index);

            // 수치 인덱스 (정렬된 배열로 이진 검색 가능)
            const per = parseFloat(company['PER (Oct-25)']);
            const pbr = parseFloat(company['PBR (Oct-25)']);
            const roe = parseFloat(company['ROE (Fwd)']);
            const marketCap = parseFloat(company['(USD mn)']);

            if (!isNaN(per)) this.dataIndex.byPER.push({ value: per, index });
            if (!isNaN(pbr)) this.dataIndex.byPBR.push({ value: pbr, index });
            if (!isNaN(roe)) this.dataIndex.byROE.push({ value: roe, index });
            if (!isNaN(marketCap)) this.dataIndex.byMarketCap.push({ value: marketCap, index });
        });

        // 수치 인덱스 정렬
        this.dataIndex.byPER.sort((a, b) => a.value - b.value);
        this.dataIndex.byPBR.sort((a, b) => a.value - b.value);
        this.dataIndex.byROE.sort((a, b) => a.value - b.value);
        this.dataIndex.byMarketCap.sort((a, b) => a.value - b.value);

        const endTime = performance.now();
        console.log(`✅ 데이터 인덱스 구축 완료 (${(endTime - startTime).toFixed(2)}ms)`);
    }

    /**
     * Task 5: 동적 카테고리 옵션 생성
     */
    populateCategoryOptions() {
        if (!window.allData || !Array.isArray(window.allData)) return;

        // 업종 목록 추출
        const industries = [...new Set(window.allData.map(company => company.industry).filter(Boolean))];
        this.availableOptions.industries = industries.sort();

        // 거래소 목록 추출
        const exchanges = [...new Set(window.allData.map(company => company.Exchange).filter(Boolean))];
        this.availableOptions.exchanges = exchanges.sort();

        console.log(`📊 동적 옵션 생성: 업종 ${industries.length}개, 거래소 ${exchanges.length}개`);
    }

    /**
     * Task 5: 다중 선택 드롭다운 설정
     */
    setupMultiSelectDropdowns() {
        this.setupMultiSelect('industry', this.availableOptions.industries);
        this.setupMultiSelect('exchange', this.availableOptions.exchanges);
    }

    /**
     * 다중 선택 드롭다운 개별 설정
     */
    setupMultiSelect(type, options) {
        const multiselect = document.getElementById(`${type}-multiselect`);
        const dropdown = document.getElementById(`${type}-dropdown`);
        const selectedContainer = document.getElementById(`${type}-selected`);

        if (!multiselect || !dropdown || !selectedContainer) return;

        // 드롭다운 옵션 생성
        dropdown.innerHTML = options.map(option => `
            <div class="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0" 
                 data-value="${option}">
                <label class="flex items-center cursor-pointer">
                    <input type="checkbox" class="mr-2" value="${option}">
                    <span class="text-sm">${option}</span>
                </label>
            </div>
        `).join('');

        // 드롭다운 토글
        multiselect.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });

        // 옵션 선택 처리
        dropdown.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') {
                this.updateMultiSelectDisplay(type);
                this.updateFilters();
                this.applyFilters();
            }
        });

        // 외부 클릭시 드롭다운 닫기
        document.addEventListener('click', () => {
            dropdown.classList.add('hidden');
        });
    }

    /**
     * 다중 선택 표시 업데이트
     */
    updateMultiSelectDisplay(type) {
        const dropdown = document.getElementById(`${type}-dropdown`);
        const multiselect = document.getElementById(`${type}-multiselect`);
        const selectedContainer = document.getElementById(`${type}-selected`);

        const checkboxes = dropdown.querySelectorAll('input[type="checkbox"]:checked');
        const selectedValues = Array.from(checkboxes).map(cb => cb.value);

        // 선택된 항목 태그 표시
        selectedContainer.innerHTML = selectedValues.map(value => `
            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                ${value}
                <button type="button" class="ml-1 text-blue-600 hover:text-blue-800" 
                        onclick="window.advancedFilter.removeSelection('${type}', '${value}')">
                    <i class="fas fa-times text-xs"></i>
                </button>
            </span>
        `).join('');

        // 메인 버튼 텍스트 업데이트
        if (selectedValues.length === 0) {
            multiselect.innerHTML = `<span class="text-gray-500">${type === 'industry' ? '업종' : '거래소'} 선택...</span>`;
        } else {
            multiselect.innerHTML = `<span class="text-gray-900">${selectedValues.length}개 선택됨</span>`;
        }
    }

    /**
     * 선택 항목 제거
     */
    removeSelection(type, value) {
        const dropdown = document.getElementById(`${type}-dropdown`);
        const checkbox = dropdown.querySelector(`input[value="${value}"]`);
        if (checkbox) {
            checkbox.checked = false;
            this.updateMultiSelectDisplay(type);
            this.updateFilters();
            this.applyFilters();
        }
    }

    /**
     * Task 6: 필터 상태 저장
     */
    saveFilterState() {
        try {
            const state = {
                filters: this.filters,
                timestamp: Date.now()
            };
            localStorage.setItem('advancedFilterState', JSON.stringify(state));
        } catch (error) {
            console.warn('필터 상태 저장 실패:', error);
        }
    }

    /**
     * Task 6: 필터 상태 복원
     */
    loadFilterState() {
        try {
            const saved = localStorage.getItem('advancedFilterState');
            if (!saved) return;

            const state = JSON.parse(saved);
            const age = Date.now() - state.timestamp;
            
            // 24시간 이내의 상태만 복원
            if (age > 24 * 60 * 60 * 1000) {
                localStorage.removeItem('advancedFilterState');
                return;
            }

            // 필터 상태 복원
            this.filters = { ...this.filters, ...state.filters };
            this.restoreUIState();
            
            console.log('📥 필터 상태 복원 완료');
        } catch (error) {
            console.warn('필터 상태 복원 실패:', error);
            localStorage.removeItem('advancedFilterState');
        }
    }

    /**
     * UI 상태 복원
     */
    restoreUIState() {
        // 수치 입력 필드 복원
        const numericFields = [
            ['per-min', this.filters.per.min],
            ['per-max', this.filters.per.max],
            ['pbr-min', this.filters.pbr.min],
            ['pbr-max', this.filters.pbr.max],
            ['roe-min', this.filters.roe.min],
            ['roe-max', this.filters.roe.max],
            ['market-cap-min', this.filters.marketCap.min],
            ['market-cap-max', this.filters.marketCap.max],
            ['dividend-min', this.filters.dividend.min],
            ['dividend-max', this.filters.dividend.max]
        ];

        numericFields.forEach(([id, value]) => {
            if (value !== null) {
                this.setInputValue(id, value);
            }
        });

        // 다중 선택 복원
        this.restoreMultiSelect('industry', this.filters.industries);
        this.restoreMultiSelect('exchange', this.filters.exchanges);
    }

    /**
     * 다중 선택 상태 복원
     */
    restoreMultiSelect(type, selectedValues) {
        if (!selectedValues || selectedValues.length === 0) return;

        const dropdown = document.getElementById(`${type}-dropdown`);
        if (!dropdown) return;

        selectedValues.forEach(value => {
            const checkbox = dropdown.querySelector(`input[value="${value}"]`);
            if (checkbox) {
                checkbox.checked = true;
            }
        });

        this.updateMultiSelectDisplay(type);
    }

    /**
     * Task 6: 성능 최적화된 필터 적용 (오버라이드)
     */
    applyFilters() {
        if (!window.allData || !Array.isArray(window.allData)) {
            console.warn('⚠️ 데이터가 로딩되지 않았습니다.');
            return;
        }

        console.log('🚀 성능 최적화된 필터 적용 시작:', this.filters);
        const startTime = performance.now();

        let candidateIndices = new Set(window.allData.map((_, index) => index));

        // 카테고리 필터 먼저 적용 (인덱스 활용)
        if (this.filters.industries.length > 0) {
            const industryIndices = new Set();
            this.filters.industries.forEach(industry => {
                if (this.dataIndex.byIndustry[industry]) {
                    this.dataIndex.byIndustry[industry].forEach(idx => industryIndices.add(idx));
                }
            });
            candidateIndices = new Set([...candidateIndices].filter(idx => industryIndices.has(idx)));
        }

        if (this.filters.exchanges.length > 0) {
            const exchangeIndices = new Set();
            this.filters.exchanges.forEach(exchange => {
                if (this.dataIndex.byExchange[exchange]) {
                    this.dataIndex.byExchange[exchange].forEach(idx => exchangeIndices.add(idx));
                }
            });
            candidateIndices = new Set([...candidateIndices].filter(idx => exchangeIndices.has(idx)));
        }

        // 수치 필터 적용
        const filteredData = [...candidateIndices].map(idx => window.allData[idx]).filter(company => {
            // PER 필터
            if (this.filters.per.min !== null || this.filters.per.max !== null) {
                const per = parseFloat(company['PER (Oct-25)']);
                if (isNaN(per)) return false;
                if (this.filters.per.min !== null && per < this.filters.per.min) return false;
                if (this.filters.per.max !== null && per > this.filters.per.max) return false;
            }

            // PBR 필터
            if (this.filters.pbr.min !== null || this.filters.pbr.max !== null) {
                const pbr = parseFloat(company['PBR (Oct-25)']);
                if (isNaN(pbr)) return false;
                if (this.filters.pbr.min !== null && pbr < this.filters.pbr.min) return false;
                if (this.filters.pbr.max !== null && pbr > this.filters.pbr.max) return false;
            }

            // ROE 필터
            if (this.filters.roe.min !== null || this.filters.roe.max !== null) {
                const roe = parseFloat(company['ROE (Fwd)']);
                if (isNaN(roe)) return false;
                if (this.filters.roe.min !== null && roe < this.filters.roe.min) return false;
                if (this.filters.roe.max !== null && roe > this.filters.roe.max) return false;
            }

            // 시가총액 필터
            if (this.filters.marketCap.min !== null || this.filters.marketCap.max !== null) {
                const marketCap = parseFloat(company['(USD mn)']);
                if (isNaN(marketCap)) return false;
                if (this.filters.marketCap.min !== null && marketCap < this.filters.marketCap.min) return false;
                if (this.filters.marketCap.max !== null && marketCap > this.filters.marketCap.max) return false;
            }

            // 배당수익률 필터
            if (this.filters.dividend.min !== null || this.filters.dividend.max !== null) {
                const dividend = parseFloat(company['DY (FY+1)']);
                if (isNaN(dividend)) return false;
                if (this.filters.dividend.min !== null && dividend < this.filters.dividend.min) return false;
                if (this.filters.dividend.max !== null && dividend > this.filters.dividend.max) return false;
            }

            return true;
        });

        const endTime = performance.now();
        const processingTime = (endTime - startTime).toFixed(2);
        console.log(`✅ 성능 최적화된 필터 적용 완료: ${window.allData.length} → ${filteredData.length}개 (${processingTime}ms)`);

        // 성능 표시기 업데이트
        this.showPerformanceIndicator(processingTime, filteredData.length);

        // 필터 상태 저장
        this.saveFilterState();

        // 필터 상태 업데이트
        this.updateFilterStatus(filteredData.length);

        // 테이블 업데이트
        if (typeof renderTable === 'function') {
            renderTable(filteredData);
        }

        // 전역 변수 업데이트
        window.currentData = filteredData;
    }

    /**
     * 필터 업데이트 (다중 선택 지원)
     */
    updateFilters() {
        // 기존 수치 필터 업데이트
        this.filters.per.min = this.getInputValue('per-min');
        this.filters.per.max = this.getInputValue('per-max');
        this.filters.pbr.min = this.getInputValue('pbr-min');
        this.filters.pbr.max = this.getInputValue('pbr-max');
        this.filters.roe.min = this.getInputValue('roe-min');
        this.filters.roe.max = this.getInputValue('roe-max');
        this.filters.marketCap.min = this.getInputValue('market-cap-min');
        this.filters.marketCap.max = this.getInputValue('market-cap-max');
        this.filters.dividend.min = this.getInputValue('dividend-min');
        this.filters.dividend.max = this.getInputValue('dividend-max');

        // 다중 선택 카테고리 필터 업데이트
        this.filters.industries = this.getMultiSelectValues('industry');
        this.filters.exchanges = this.getMultiSelectValues('exchange');

        // 필터 활성 상태 확인
        this.isActive = this.hasActiveFilters();
    }

    /**
     * 다중 선택 값 가져오기
     */
    getMultiSelectValues(type) {
        const dropdown = document.getElementById(`${type}-dropdown`);
        if (!dropdown) return [];

        const checkboxes = dropdown.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    /**
     * Task 6: 성능 표시기 표시
     */
    showPerformanceIndicator(processingTime, resultCount) {
        const indicator = document.getElementById('performance-indicator');
        const text = document.getElementById('performance-text');
        
        if (!indicator || !text) return;

        const isOptimized = parseFloat(processingTime) < 100; // 100ms 이하면 최적화됨
        const emoji = isOptimized ? '⚡' : '🔄';
        
        text.textContent = `${emoji} ${processingTime}ms | ${resultCount.toLocaleString()}개 결과`;
        indicator.classList.add('show');

        // 3초 후 자동 숨김
        setTimeout(() => {
            indicator.classList.remove('show');
        }, 3000);
    }
}

// 전역 인스턴스 생성
window.advancedFilter = new AdvancedFilter();

console.log('✅ AdvancedFilter 로드 완료 - Task 5&6 완성: 다중 선택 + 성능 최적화');