/**
 * AdvancedFilterManager - 고급 필터링 시스템
 * 거래소, 업종, 수치 범위 필터 지원
 */

class AdvancedFilterManager {
    constructor() {
        this.filters = {
            exchange: '',
            industry: '',
            marketCapMin: null,
            marketCapMax: null,
            perMin: null,
            perMax: null,
            pbrMin: null,
            pbrMax: null,
            roeMin: null,
            roeMax: null,
            dividendMin: null,
            dividendMax: null
        };
        
        this.activeFilters = new Set();
        this.filterPresets = new Map();
        
        console.log('🔧 AdvancedFilterManager 초기화');
    }

    /**
     * 필터 시스템 초기화
     */
    initialize() {
        this.populateExchangeFilter();
        this.populateIndustryFilter();
        this.setupEventListeners();
        this.setupFilterPresets();
        this.initializeFilterPresets();
        
        console.log('✅ 고급 필터링 시스템 초기화 완료');
    }

    /**
     * 거래소 필터 옵션 생성
     */
    populateExchangeFilter() {
        if (!window.allData || window.allData.length === 0) {
            console.log('⏳ 데이터 로딩 대기 중... (거래소 필터)');
            return;
        }

        const exchanges = [...new Set(window.allData.map(company => company.Exchange || company.exchange))]
            .filter(exchange => exchange && exchange !== '' && exchange !== '-')
            .sort();

        console.log(`발견된 거래소: ${exchanges.length}개`, exchanges);

        const exchangeSelect = document.getElementById('exchange-filter');
        if (exchangeSelect) {
            // 기존 옵션 제거 (첫 번째 "모든 거래소" 제외)
            while (exchangeSelect.children.length > 1) {
                exchangeSelect.removeChild(exchangeSelect.lastChild);
            }

            exchanges.forEach(exchange => {
                const count = window.allData.filter(company => 
                    (company.Exchange || company.exchange) === exchange
                ).length;
                
                const option = document.createElement('option');
                option.value = exchange;
                option.textContent = `${exchange} (${count}개)`;
                exchangeSelect.appendChild(option);
            });
        }
    }

    /**
     * 업종 필터 옵션 생성 (기존 함수 개선)
     */
    populateIndustryFilter() {
        if (!window.allData || window.allData.length === 0) {
            console.log('⏳ 데이터 로딩 대기 중... (업종 필터)');
            return;
        }

        const industries = [...new Set(window.allData.map(company => company.industry))]
            .filter(industry => industry && industry !== '' && industry !== '-')
            .sort();

        console.log(`발견된 업종: ${industries.length}개`, industries);

        const industrySelect = document.getElementById('industry-filter');
        if (industrySelect) {
            // 기존 옵션 제거 (첫 번째 "모든 업종" 제외)
            while (industrySelect.children.length > 1) {
                industrySelect.removeChild(industrySelect.lastChild);
            }

            industries.forEach(industry => {
                const count = window.allData.filter(company => company.industry === industry).length;
                
                const option = document.createElement('option');
                option.value = industry;
                option.textContent = `${industry} (${count}개)`;
                industrySelect.appendChild(option);
            });
        }
    }

    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        // 드롭다운 필터
        const exchangeFilter = document.getElementById('exchange-filter');
        const industryFilter = document.getElementById('industry-filter');
        
        if (exchangeFilter) {
            exchangeFilter.addEventListener('change', () => this.updateFilters());
        }
        
        if (industryFilter) {
            industryFilter.addEventListener('change', () => this.updateFilters());
        }

        // 수치 범위 필터 (디바운스 적용)
        const numericInputs = [
            'market-cap-min', 'market-cap-max',
            'per-min', 'per-max',
            'pbr-min', 'pbr-max', 
            'roe-min', 'roe-max',
            'dividend-min', 'dividend-max'
        ];

        numericInputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) {
                input.addEventListener('input', this.debounce(() => this.updateFilters(), 500));
            }
        });

        // 액션 버튼
        const applyBtn = document.getElementById('apply-filters');
        const clearBtn = document.getElementById('clear-all-filters');
        
        if (applyBtn) {
            applyBtn.addEventListener('click', () => this.applyFilters());
        }
        
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearAllFilters());
        }
    }

    /**
     * 필터 값 업데이트
     */
    updateFilters() {
        // 드롭다운 필터
        this.filters.exchange = document.getElementById('exchange-filter')?.value || '';
        this.filters.industry = document.getElementById('industry-filter')?.value || '';
        
        // 수치 범위 필터
        this.filters.marketCapMin = this.parseNumber('market-cap-min');
        this.filters.marketCapMax = this.parseNumber('market-cap-max');
        this.filters.perMin = this.parseNumber('per-min');
        this.filters.perMax = this.parseNumber('per-max');
        this.filters.pbrMin = this.parseNumber('pbr-min');
        this.filters.pbrMax = this.parseNumber('pbr-max');
        this.filters.roeMin = this.parseNumber('roe-min');
        this.filters.roeMax = this.parseNumber('roe-max');
        this.filters.dividendMin = this.parseNumber('dividend-min');
        this.filters.dividendMax = this.parseNumber('dividend-max');
        
        // 활성 필터 추적
        this.updateActiveFilters();
        
        // 필터 상태 표시 업데이트
        this.updateFilterStatus();
        
        console.log('🔧 필터 업데이트:', this.filters);
    }

    /**
     * 숫자 입력값 파싱
     */
    parseNumber(inputId) {
        const input = document.getElementById(inputId);
        if (!input || !input.value.trim()) return null;
        
        const value = parseFloat(input.value);
        return isNaN(value) ? null : value;
    }

    /**
     * 활성 필터 추적
     */
    updateActiveFilters() {
        this.activeFilters.clear();
        
        if (this.filters.exchange) this.activeFilters.add('거래소');
        if (this.filters.industry) this.activeFilters.add('업종');
        if (this.filters.marketCapMin !== null || this.filters.marketCapMax !== null) this.activeFilters.add('시가총액');
        if (this.filters.perMin !== null || this.filters.perMax !== null) this.activeFilters.add('PER');
        if (this.filters.pbrMin !== null || this.filters.pbrMax !== null) this.activeFilters.add('PBR');
        if (this.filters.roeMin !== null || this.filters.roeMax !== null) this.activeFilters.add('ROE');
        if (this.filters.dividendMin !== null || this.filters.dividendMax !== null) this.activeFilters.add('배당수익률');
    }

    /**
     * 필터 적용
     */
    applyFilters() {
        console.log('🔍 고급 필터 적용 시작');
        
        if (!window.allData || window.allData.length === 0) {
            console.warn('데이터가 없습니다');
            return;
        }

        let filteredData = [...window.allData];
        let filterCount = 0;

        // 거래소 필터
        if (this.filters.exchange) {
            filteredData = filteredData.filter(company => 
                (company.Exchange || company.exchange) === this.filters.exchange
            );
            filterCount++;
            console.log(`거래소 필터 적용: ${this.filters.exchange} (${filteredData.length}개)`);
        }

        // 업종 필터
        if (this.filters.industry) {
            filteredData = filteredData.filter(company => 
                company.industry === this.filters.industry
            );
            filterCount++;
            console.log(`업종 필터 적용: ${this.filters.industry} (${filteredData.length}개)`);
        }

        // 시가총액 필터
        if (this.filters.marketCapMin !== null || this.filters.marketCapMax !== null) {
            filteredData = filteredData.filter(company => {
                const marketCap = parseFloat(company['(USD mn)']);
                if (isNaN(marketCap)) return false;
                
                if (this.filters.marketCapMin !== null && marketCap < this.filters.marketCapMin) return false;
                if (this.filters.marketCapMax !== null && marketCap > this.filters.marketCapMax) return false;
                
                return true;
            });
            filterCount++;
            console.log(`시가총액 필터 적용 (${filteredData.length}개)`);
        }

        // PER 필터
        if (this.filters.perMin !== null || this.filters.perMax !== null) {
            filteredData = filteredData.filter(company => {
                const per = parseFloat(company['PER (Oct-25)']);
                if (isNaN(per) || per <= 0) return false;
                
                if (this.filters.perMin !== null && per < this.filters.perMin) return false;
                if (this.filters.perMax !== null && per > this.filters.perMax) return false;
                
                return true;
            });
            filterCount++;
            console.log(`PER 필터 적용 (${filteredData.length}개)`);
        }

        // PBR 필터
        if (this.filters.pbrMin !== null || this.filters.pbrMax !== null) {
            filteredData = filteredData.filter(company => {
                const pbr = parseFloat(company['PBR (Oct-25)']);
                if (isNaN(pbr) || pbr <= 0) return false;
                
                if (this.filters.pbrMin !== null && pbr < this.filters.pbrMin) return false;
                if (this.filters.pbrMax !== null && pbr > this.filters.pbrMax) return false;
                
                return true;
            });
            filterCount++;
            console.log(`PBR 필터 적용 (${filteredData.length}개)`);
        }

        // ROE 필터
        if (this.filters.roeMin !== null || this.filters.roeMax !== null) {
            filteredData = filteredData.filter(company => {
                const roe = parseFloat(company['ROE (Fwd)']);
                if (isNaN(roe)) return false;
                
                if (this.filters.roeMin !== null && roe < this.filters.roeMin) return false;
                if (this.filters.roeMax !== null && roe > this.filters.roeMax) return false;
                
                return true;
            });
            filterCount++;
            console.log(`ROE 필터 적용 (${filteredData.length}개)`);
        }

        // 배당수익률 필터
        if (this.filters.dividendMin !== null || this.filters.dividendMax !== null) {
            filteredData = filteredData.filter(company => {
                const dividend = parseFloat(company['DY (FY+1)']);
                if (isNaN(dividend)) return false;
                
                if (this.filters.dividendMin !== null && dividend < this.filters.dividendMin) return false;
                if (this.filters.dividendMax !== null && dividend > this.filters.dividendMax) return false;
                
                return true;
            });
            filterCount++;
            console.log(`배당수익률 필터 적용 (${filteredData.length}개)`);
        }

        console.log(`✅ 총 ${filterCount}개 필터 적용 완료: ${filteredData.length}개 기업`);

        // 결과 표시
        window.currentData = filteredData;
        if (window.renderTable) {
            window.renderTable(filteredData);
        }

        // 페이지네이션 업데이트
        if (window.paginationManager) {
            window.paginationManager.setData(filteredData);
        }

        // 필터 상태 업데이트
        this.updateFilterStatus();
    }

    /**
     * 필터 상태 표시 업데이트
     */
    updateFilterStatus() {
        const statusElement = document.getElementById('filter-status');
        if (!statusElement) return;

        if (this.activeFilters.size === 0) {
            statusElement.textContent = '활성 필터 없음';
            statusElement.className = 'text-sm text-gray-600';
            return;
        }

        const filterList = Array.from(this.activeFilters).join(', ');
        const resultCount = window.currentData ? window.currentData.length : 0;
        
        statusElement.innerHTML = `
            <span class="text-blue-600 font-medium">활성 필터:</span> 
            ${filterList} 
            <span class="text-gray-500">→</span> 
            <span class="font-bold text-green-600">${resultCount.toLocaleString()}개 기업</span>
        `;
        statusElement.className = 'text-sm';
    }

    /**
     * 모든 필터 초기화
     */
    clearAllFilters() {
        console.log('🔄 모든 필터 초기화');
        
        // 필터 값 초기화
        Object.keys(this.filters).forEach(key => {
            this.filters[key] = typeof this.filters[key] === 'string' ? '' : null;
        });

        // UI 초기화
        document.getElementById('exchange-filter').value = '';
        document.getElementById('industry-filter').value = '';
        
        const numericInputs = [
            'market-cap-min', 'market-cap-max',
            'per-min', 'per-max',
            'pbr-min', 'pbr-max',
            'roe-min', 'roe-max',
            'dividend-min', 'dividend-max'
        ];

        numericInputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) input.value = '';
        });

        // 활성 필터 초기화
        this.activeFilters.clear();

        // 전체 데이터 표시
        window.currentData = window.allData;
        if (window.renderTable) {
            window.renderTable(window.allData);
        }

        // 페이지네이션 초기화
        if (window.paginationManager) {
            window.paginationManager.setData(window.allData);
        }

        // 상태 업데이트
        this.updateFilterStatus();
    }

    /**
     * 필터 프리셋 설정
     */
    setupFilterPresets() {
        this.filterPresets.set('나스닥_반도체', {
            exchange: 'NASDAQ',
            industry: '반도체',
            name: '나스닥 반도체'
        });

        this.filterPresets.set('저PER_고배당', {
            perMax: 15,
            dividendMin: 3,
            name: '저PER 고배당'
        });

        this.filterPresets.set('대형주_안정성', {
            marketCapMin: 10000,
            roeMin: 10,
            name: '대형주 안정성'
        });

        console.log('📋 필터 프리셋 설정 완료:', this.filterPresets.size);
    }

    /**
     * 디바운스 함수
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * 현재 필터 상태 반환
     */
    getFilterState() {
        return {
            filters: { ...this.filters },
            activeFilters: Array.from(this.activeFilters),
            resultCount: window.currentData ? window.currentData.length : 0
        };
    }
    /**
     * 필터 프리셋 UI 초기화
     */
    initializeFilterPresets() {
        const presetButtons = document.querySelectorAll('.filter-preset-btn');
        presetButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                this.applyFilterPreset(preset);
                
                // 버튼 활성화 상태 업데이트
                presetButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // 필터 저장 버튼
        const saveBtn = document.getElementById('save-filter-preset');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveCurrentFilter());
        }

        console.log('🎯 필터 프리셋 UI 초기화 완료');
    }

    /**
     * 필터 프리셋 적용
     */
    applyFilterPreset(presetName) {
        console.log(`🎯 필터 프리셋 적용: ${presetName}`);
        
        // 기존 필터 초기화
        this.clearAllFilters();
        
        const presets = {
            'nasdaq-tech': {
                name: '나스닥 기술주',
                exchange: 'NASDAQ',
                industry: '반도체',
                description: '나스닥 상장 반도체 기업'
            },
            'value-stocks': {
                name: '저PER 가치주',
                perMax: 15,
                pbrMax: 2,
                roeMin: 10,
                description: 'PER 15 이하, PBR 2 이하, ROE 10% 이상'
            },
            'dividend-stocks': {
                name: '고배당 주식',
                dividendMin: 3,
                roeMin: 8,
                description: '배당수익률 3% 이상, ROE 8% 이상'
            },
            'large-cap': {
                name: '대형주 안정성',
                marketCapMin: 10000,
                roeMin: 12,
                description: '시가총액 100억달러 이상, ROE 12% 이상'
            },
            'growth-stocks': {
                name: '고성장 주식',
                roeMin: 20,
                perMax: 30,
                description: 'ROE 20% 이상, PER 30 이하'
            }
        };

        const preset = presets[presetName];
        if (!preset) {
            console.warn(`알 수 없는 프리셋: ${presetName}`);
            return;
        }

        // 프리셋 값 적용
        if (preset.exchange) {
            document.getElementById('exchange-filter').value = preset.exchange;
            this.filters.exchange = preset.exchange;
        }
        
        if (preset.industry) {
            document.getElementById('industry-filter').value = preset.industry;
            this.filters.industry = preset.industry;
        }
        
        if (preset.marketCapMin !== undefined) {
            document.getElementById('market-cap-min').value = preset.marketCapMin;
            this.filters.marketCapMin = preset.marketCapMin;
        }
        
        if (preset.perMax !== undefined) {
            document.getElementById('per-max').value = preset.perMax;
            this.filters.perMax = preset.perMax;
        }
        
        if (preset.pbrMax !== undefined) {
            document.getElementById('pbr-max').value = preset.pbrMax;
            this.filters.pbrMax = preset.pbrMax;
        }
        
        if (preset.roeMin !== undefined) {
            document.getElementById('roe-min').value = preset.roeMin;
            this.filters.roeMin = preset.roeMin;
        }
        
        if (preset.dividendMin !== undefined) {
            document.getElementById('dividend-min').value = preset.dividendMin;
            this.filters.dividendMin = preset.dividendMin;
        }

        // 필터 적용
        this.applyFilters();
        
        // 상태 업데이트
        this.updateActiveFilters();
        this.updateFilterStatus();
        
        console.log(`✅ ${preset.name} 프리셋 적용 완료: ${preset.description}`);
    }

    /**
     * 현재 필터 저장
     */
    saveCurrentFilter() {
        const filterName = prompt('필터 이름을 입력하세요:');
        if (!filterName) return;

        const currentFilter = {
            name: filterName,
            filters: { ...this.filters },
            savedAt: new Date().toISOString()
        };

        // localStorage에 저장
        const savedFilters = JSON.parse(localStorage.getItem('savedFilters') || '[]');
        savedFilters.push(currentFilter);
        localStorage.setItem('savedFilters', JSON.stringify(savedFilters));

        console.log(`💾 필터 저장 완료: ${filterName}`);
        alert(`필터 "${filterName}"이 저장되었습니다.`);
    }

    /**
     * 실시간 결과 미리보기
     */
    showFilterPreview() {
        if (!window.allData || window.allData.length === 0) return;

        let previewData = [...window.allData];
        let filterCount = 0;

        // 각 필터별 결과 수 계산
        const preview = {
            total: previewData.length,
            exchange: this.filters.exchange ? previewData.filter(c => (c.Exchange || c.exchange) === this.filters.exchange).length : null,
            industry: this.filters.industry ? previewData.filter(c => c.industry === this.filters.industry).length : null,
            marketCap: (this.filters.marketCapMin || this.filters.marketCapMax) ? 
                previewData.filter(c => {
                    const cap = parseFloat(c['(USD mn)']);
                    if (isNaN(cap)) return false;
                    if (this.filters.marketCapMin && cap < this.filters.marketCapMin) return false;
                    if (this.filters.marketCapMax && cap > this.filters.marketCapMax) return false;
                    return true;
                }).length : null
        };

        // 미리보기 표시 (향후 UI 구현)
        console.log('🔍 필터 미리보기:', preview);
    }
}

// 전역 인스턴스 생성
window.advancedFilterManager = new AdvancedFilterManager();

console.log('✅ AdvancedFilterManager 로드 완료 - 고급 필터링 시스템');