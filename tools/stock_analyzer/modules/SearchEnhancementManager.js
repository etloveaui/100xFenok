/**
 * SearchEnhancementManager - 검색 기능 개선 시스템
 */

class SearchEnhancementManager {
    constructor() {
        this.industries = [];
        this.exchanges = [];
        this.isInitialized = false;
        
        console.log('🔍 SearchEnhancementManager 초기화');
    }

    /**
     * 검색 개선 시스템 초기화
     */
    initialize(data) {
        if (!data || !Array.isArray(data)) {
            console.warn('⚠️ SearchEnhancementManager: 유효하지 않은 데이터');
            return;
        }

        this.extractFilterOptions(data);
        this.createIndustryDropdown();
        this.createExchangeFilter();
        this.setupFilterEvents();
        
        this.isInitialized = true;
        console.log('✅ 검색 개선 시스템 초기화 완료');
    }

    /**
     * 필터 옵션 추출
     */
    extractFilterOptions(data) {
        const industrySet = new Set();
        const exchangeSet = new Set();

        data.forEach(company => {
            // 업종 추출
            if (company.industry && company.industry !== '' && company.industry !== '-') {
                industrySet.add(company.industry.trim());
            }
            
            // 거래소 추출
            const exchange = company.Exchange || company.exchange;
            if (exchange && exchange !== '' && exchange !== '-') {
                exchangeSet.add(exchange.trim());
            }
        });

        this.industries = Array.from(industrySet).sort();
        this.exchanges = Array.from(exchangeSet).sort();

        console.log(`📊 필터 옵션 추출 완료: ${this.industries.length}개 업종, ${this.exchanges.length}개 거래소`);
    }

    /**
     * 업종 드롭다운 생성
     */
    createIndustryDropdown() {
        const industryFilter = document.getElementById('industry-filter');
        if (!industryFilter) {
            console.warn('⚠️ 업종 필터 요소를 찾을 수 없습니다.');
            return;
        }

        // 기존 옵션 제거 (첫 번째 옵션 제외)
        while (industryFilter.children.length > 1) {
            industryFilter.removeChild(industryFilter.lastChild);
        }

        // 업종 옵션 추가
        this.industries.forEach(industry => {
            const option = document.createElement('option');
            option.value = industry;
            option.textContent = industry;
            industryFilter.appendChild(option);
        });

        console.log(`✅ 업종 드롭다운 생성 완료: ${this.industries.length}개 옵션`);
    }

    /**
     * 거래소 필터 생성
     */
    createExchangeFilter() {
        const exchangeFilter = document.getElementById('exchange-filter');
        if (!exchangeFilter) {
            console.warn('⚠️ 거래소 필터 요소를 찾을 수 없습니다.');
            return;
        }

        // 기존 옵션 제거 (첫 번째 옵션 제외)
        while (exchangeFilter.children.length > 1) {
            exchangeFilter.removeChild(exchangeFilter.lastChild);
        }

        // 거래소 옵션 추가
        this.exchanges.forEach(exchange => {
            const option = document.createElement('option');
            option.value = exchange;
            option.textContent = exchange;
            exchangeFilter.appendChild(option);
        });

        console.log(`✅ 거래소 필터 생성 완료: ${this.exchanges.length}개 옵션`);
    }

    /**
     * 필터 이벤트 설정
     */
    setupFilterEvents() {
        // 업종 필터 이벤트
        const industryFilter = document.getElementById('industry-filter');
        if (industryFilter) {
            industryFilter.addEventListener('change', (e) => {
                this.handleIndustryFilter(e.target.value);
            });
        }

        // 거래소 필터 이벤트
        const exchangeFilter = document.getElementById('exchange-filter');
        if (exchangeFilter) {
            exchangeFilter.addEventListener('change', (e) => {
                this.handleExchangeFilter(e.target.value);
            });
        }

        console.log('✅ 필터 이벤트 설정 완료');
    }

    /**
     * 업종 필터 처리
     */
    handleIndustryFilter(selectedIndustry) {
        console.log(`🏭 업종 필터 적용: ${selectedIndustry || '전체'}`);
        
        if (!selectedIndustry) {
            // 전체 선택 시 필터 제거
            this.removeFilter('industry');
        } else {
            // 특정 업종 필터 적용
            this.applyFilter('industry', selectedIndustry);
        }
    }

    /**
     * 거래소 필터 처리
     */
    handleExchangeFilter(selectedExchange) {
        console.log(`🏛️ 거래소 필터 적용: ${selectedExchange || '전체'}`);
        
        if (!selectedExchange) {
            // 전체 선택 시 필터 제거
            this.removeFilter('exchange');
        } else {
            // 특정 거래소 필터 적용
            this.applyFilter('exchange', selectedExchange);
        }
    }

    /**
     * 필터 적용
     */
    applyFilter(filterType, filterValue) {
        if (!window.allData) {
            console.warn('⚠️ 데이터가 로드되지 않았습니다.');
            return;
        }

        let filteredData = [...window.allData];

        // 현재 적용된 다른 필터들 유지
        const industryFilter = document.getElementById('industry-filter');
        const exchangeFilter = document.getElementById('exchange-filter');

        if (industryFilter && industryFilter.value && filterType !== 'industry') {
            filteredData = filteredData.filter(company => 
                company.industry === industryFilter.value
            );
        }

        if (exchangeFilter && exchangeFilter.value && filterType !== 'exchange') {
            filteredData = filteredData.filter(company => 
                (company.Exchange || company.exchange) === exchangeFilter.value
            );
        }

        // 새로운 필터 적용
        if (filterType === 'industry') {
            filteredData = filteredData.filter(company => 
                company.industry === filterValue
            );
        } else if (filterType === 'exchange') {
            filteredData = filteredData.filter(company => 
                (company.Exchange || company.exchange) === filterValue
            );
        }

        // 결과 표시
        this.displayFilteredResults(filteredData, filterType, filterValue);
    }

    /**
     * 필터 제거
     */
    removeFilter(filterType) {
        if (!window.allData) return;

        let filteredData = [...window.allData];

        // 다른 활성 필터들 유지
        const industryFilter = document.getElementById('industry-filter');
        const exchangeFilter = document.getElementById('exchange-filter');

        if (industryFilter && industryFilter.value && filterType !== 'industry') {
            filteredData = filteredData.filter(company => 
                company.industry === industryFilter.value
            );
        }

        if (exchangeFilter && exchangeFilter.value && filterType !== 'exchange') {
            filteredData = filteredData.filter(company => 
                (company.Exchange || company.exchange) === exchangeFilter.value
            );
        }

        // 결과 표시
        this.displayFilteredResults(filteredData, null, null);
    }

    /**
     * 필터링된 결과 표시
     */
    displayFilteredResults(filteredData, filterType, filterValue) {
        // 전역 데이터 업데이트
        window.currentData = filteredData;

        // 테이블 렌더링
        if (window.renderTable) {
            window.renderTable(filteredData);
        }

        // 카드 뷰가 활성화된 경우 카드도 업데이트
        if (window.cardViewManager && window.cardViewManager.getCurrentView() === 'card') {
            window.cardViewManager.renderCardView(filteredData);
        }

        // 필터 상태 업데이트
        this.updateFilterStatus(filteredData.length, filterType, filterValue);

        console.log(`📊 필터링 완료: ${filteredData.length}개 결과`);
    }

    /**
     * 필터 상태 업데이트
     */
    updateFilterStatus(resultCount, filterType, filterValue) {
        const filterStatus = document.getElementById('filter-status');
        if (!filterStatus) return;

        let statusText = `${resultCount.toLocaleString()}개 기업`;
        
        if (filterType && filterValue) {
            const filterTypeText = filterType === 'industry' ? '업종' : '거래소';
            statusText += ` (${filterTypeText}: ${filterValue})`;
        }

        // 활성 필터들 표시
        const activeFilters = this.getActiveFilters();
        if (activeFilters.length > 0) {
            statusText += ` | 필터: ${activeFilters.join(', ')}`;
        }

        filterStatus.textContent = statusText;
    }

    /**
     * 활성 필터 목록 반환
     */
    getActiveFilters() {
        const activeFilters = [];
        
        const industryFilter = document.getElementById('industry-filter');
        if (industryFilter && industryFilter.value) {
            activeFilters.push(`업종: ${industryFilter.value}`);
        }

        const exchangeFilter = document.getElementById('exchange-filter');
        if (exchangeFilter && exchangeFilter.value) {
            activeFilters.push(`거래소: ${exchangeFilter.value}`);
        }

        return activeFilters;
    }

    /**
     * 모든 필터 초기화
     */
    clearAllFilters() {
        const industryFilter = document.getElementById('industry-filter');
        const exchangeFilter = document.getElementById('exchange-filter');

        if (industryFilter) industryFilter.value = '';
        if (exchangeFilter) exchangeFilter.value = '';

        // 전체 데이터 표시
        if (window.allData) {
            this.displayFilteredResults(window.allData, null, null);
        }

        console.log('🧹 모든 필터 초기화 완료');
    }

    /**
     * 고급 검색 기능
     */
    performAdvancedSearch(searchTerm, filters = {}) {
        if (!window.allData) return [];

        let results = [...window.allData];

        // 텍스트 검색
        if (searchTerm && searchTerm.trim()) {
            const term = searchTerm.toLowerCase().trim();
            results = results.filter(company => {
                return (
                    company.Ticker?.toLowerCase().includes(term) ||
                    company.corpName?.toLowerCase().includes(term) ||
                    company.industry?.toLowerCase().includes(term) ||
                    (company.Exchange || company.exchange)?.toLowerCase().includes(term)
                );
            });
        }

        // 업종 필터
        if (filters.industry) {
            results = results.filter(company => company.industry === filters.industry);
        }

        // 거래소 필터
        if (filters.exchange) {
            results = results.filter(company => 
                (company.Exchange || company.exchange) === filters.exchange
            );
        }

        // 수치 범위 필터
        if (filters.perMin !== undefined || filters.perMax !== undefined) {
            results = results.filter(company => {
                const per = parseFloat(company['PER (Oct-25)']);
                if (isNaN(per)) return false;
                
                if (filters.perMin !== undefined && per < filters.perMin) return false;
                if (filters.perMax !== undefined && per > filters.perMax) return false;
                
                return true;
            });
        }

        if (filters.roeMin !== undefined || filters.roeMax !== undefined) {
            results = results.filter(company => {
                const roe = parseFloat(company['ROE (Fwd)']);
                if (isNaN(roe)) return false;
                
                if (filters.roeMin !== undefined && roe < filters.roeMin) return false;
                if (filters.roeMax !== undefined && roe > filters.roeMax) return false;
                
                return true;
            });
        }

        return results;
    }

    /**
     * 검색 제안 생성
     */
    generateSearchSuggestions(query) {
        if (!query || query.length < 2) return [];

        const suggestions = [];
        const term = query.toLowerCase();

        // 업종 제안
        this.industries.forEach(industry => {
            if (industry.toLowerCase().includes(term)) {
                suggestions.push({
                    type: 'industry',
                    text: industry,
                    label: '업종'
                });
            }
        });

        // 거래소 제안
        this.exchanges.forEach(exchange => {
            if (exchange.toLowerCase().includes(term)) {
                suggestions.push({
                    type: 'exchange',
                    text: exchange,
                    label: '거래소'
                });
            }
        });

        return suggestions.slice(0, 10); // 최대 10개
    }

    /**
     * 필터 통계 반환
     */
    getFilterStats() {
        return {
            industries: this.industries.length,
            exchanges: this.exchanges.length,
            isInitialized: this.isInitialized
        };
    }
}

// 전역 인스턴스 생성
window.searchEnhancementManager = new SearchEnhancementManager();

console.log('✅ SearchEnhancementManager 로드 완료 - 검색 기능 개선 시스템');