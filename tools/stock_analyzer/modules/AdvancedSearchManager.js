/**
 * AdvancedSearchManager - 고도화된 검색 시스템
 */

class AdvancedSearchManager {
    constructor() {
        this.searchIndex = new Map();
        this.searchHistory = [];
        this.suggestions = [];
        this.isIndexed = false;
        
        console.log('🔍 AdvancedSearchManager 초기화');
    }

    /**
     * 고급 검색 시스템 초기화
     */
    initialize(data) {
        this.buildSearchIndex(data);
        this.setupAdvancedSearchUI();
        this.setupSearchEvents();
        
        console.log('✅ 고급 검색 시스템 초기화 완료');
    }

    /**
     * 검색 인덱스 구축
     */
    buildSearchIndex(data) {
        console.log('🔍 고급 검색 인덱스 구축 중...');
        const startTime = performance.now();
        
        this.searchIndex.clear();
        
        // 데이터 유효성 검증 강화
        if (!this.validateSearchData(data)) {
            console.error('❌ 검색 인덱스 구축 실패: 데이터 검증 실패');
            return;
        }
        
        let validItemsCount = 0;
        let skippedItemsCount = 0;
        
        data.forEach((company, index) => {
            try {
                // 개별 항목 검증
                if (!this.validateSearchItem(company, index)) {
                    skippedItemsCount++;
                    return;
                }
                
                // 티커 인덱싱 (필수 필드)
                if (company.Ticker && this.isValidSearchTerm(company.Ticker)) {
                    this.addToIndex(company.Ticker.toLowerCase(), company, index, 'ticker');
                }
                
                // 회사명 인덱싱 (필수 필드)
                if (company.corpName && this.isValidSearchTerm(company.corpName)) {
                    this.addToIndex(company.corpName.toLowerCase(), company, index, 'name');
                    // 회사명 단어별 인덱싱
                    const words = this.extractSearchWords(company.corpName);
                    words.forEach(word => {
                        if (word.length > 2) {
                            this.addToIndex(word, company, index, 'name_word');
                        }
                    });
                }
                
                // 업종 인덱싱 (선택 필드)
                if (company.industry && this.isValidSearchTerm(company.industry)) {
                    this.addToIndex(company.industry.toLowerCase(), company, index, 'industry');
                }
                
                // 거래소 인덱싱 (선택 필드)
                if (company.exchange && this.isValidSearchTerm(company.exchange)) {
                    this.addToIndex(company.exchange.toLowerCase(), company, index, 'exchange');
                } else if (company.Exchange && this.isValidSearchTerm(company.Exchange)) {
                    // 대소문자 변형 처리
                    this.addToIndex(company.Exchange.toLowerCase(), company, index, 'exchange');
                }
                
                validItemsCount++;
                
            } catch (error) {
                console.warn(`⚠️ 검색 인덱스 구축 중 오류 (인덱스 ${index}):`, error);
                skippedItemsCount++;
            }
        });
        
        const endTime = performance.now();
        this.isIndexed = true;
        
        console.log(`✅ 검색 인덱스 구축 완료 (${(endTime - startTime).toFixed(2)}ms)`);
        console.log(`📊 인덱스 통계:`, {
            총키워드: this.searchIndex.size,
            유효항목: validItemsCount,
            건너뛴항목: skippedItemsCount,
            성공률: `${((validItemsCount / data.length) * 100).toFixed(1)}%`
        });
        
        // 인덱스 품질 검증
        this.validateIndexQuality();
    }
    
    /**
     * 검색 데이터 유효성 검증
     */
    validateSearchData(data) {
        if (!data) {
            console.error('❌ 검색 데이터가 null 또는 undefined입니다.');
            return false;
        }
        
        if (!Array.isArray(data)) {
            console.error('❌ 검색 데이터가 배열이 아닙니다:', typeof data);
            return false;
        }
        
        if (data.length === 0) {
            console.warn('⚠️ 검색 데이터 배열이 비어있습니다.');
            return false;
        }
        
        // 샘플 데이터 검증
        const sampleSize = Math.min(5, data.length);
        let validSamples = 0;
        
        for (let i = 0; i < sampleSize; i++) {
            if (this.validateSearchItem(data[i], i)) {
                validSamples++;
            }
        }
        
        const validationRate = (validSamples / sampleSize) * 100;
        if (validationRate < 60) {
            console.error(`❌ 샘플 데이터 검증 실패: ${validationRate.toFixed(1)}% 유효`);
            return false;
        }
        
        console.log(`✅ 검색 데이터 검증 통과: ${data.length}개 항목, 샘플 유효율 ${validationRate.toFixed(1)}%`);
        return true;
    }
    
    /**
     * 개별 검색 항목 검증
     */
    validateSearchItem(item, index) {
        if (!item || typeof item !== 'object') {
            console.warn(`⚠️ 유효하지 않은 항목 (인덱스 ${index}): null 또는 객체가 아님`);
            return false;
        }
        
        // 필수 필드 검증
        if (!item.Ticker || typeof item.Ticker !== 'string' || item.Ticker.trim() === '') {
            console.warn(`⚠️ 유효하지 않은 Ticker (인덱스 ${index}):`, item.Ticker);
            return false;
        }
        
        if (!item.corpName || typeof item.corpName !== 'string' || item.corpName.trim() === '') {
            console.warn(`⚠️ 유효하지 않은 corpName (인덱스 ${index}):`, item.corpName);
            return false;
        }
        
        return true;
    }
    
    /**
     * 검색어 유효성 검증
     */
    isValidSearchTerm(term) {
        if (!term || typeof term !== 'string') {
            return false;
        }
        
        const cleanTerm = term.trim();
        
        // 빈 문자열 또는 너무 짧은 문자열
        if (cleanTerm.length === 0 || cleanTerm.length > 200) {
            return false;
        }
        
        // 잘못된 패턴들
        const invalidPatterns = [
            /^0-0x2a0x2a$/,
            /^undefined$/i,
            /^null$/i,
            /^NaN$/i,
            /^\s*$/,
            /^-+$/,
            /^#+$/
        ];
        
        return !invalidPatterns.some(pattern => pattern.test(cleanTerm));
    }
    
    /**
     * 검색 단어 추출
     */
    extractSearchWords(text) {
        if (!text || typeof text !== 'string') {
            return [];
        }
        
        return text.toLowerCase()
            .replace(/[^\w\s가-힣]/g, ' ') // 특수문자를 공백으로 변환
            .split(/\s+/)
            .filter(word => word.length > 0)
            .filter(word => this.isValidSearchTerm(word));
    }
    
    /**
     * 인덱스 품질 검증
     */
    validateIndexQuality() {
        const stats = {
            totalKeywords: this.searchIndex.size,
            tickerKeywords: 0,
            nameKeywords: 0,
            industryKeywords: 0,
            exchangeKeywords: 0
        };
        
        this.searchIndex.forEach((entries, keyword) => {
            const types = new Set(entries.map(entry => entry.type));
            
            if (types.has('ticker')) stats.tickerKeywords++;
            if (types.has('name') || types.has('name_word')) stats.nameKeywords++;
            if (types.has('industry')) stats.industryKeywords++;
            if (types.has('exchange')) stats.exchangeKeywords++;
        });
        
        console.log('📊 검색 인덱스 품질 분석:', stats);
        
        // 품질 경고
        if (stats.tickerKeywords === 0) {
            console.warn('⚠️ Ticker 키워드가 없습니다.');
        }
        
        if (stats.nameKeywords === 0) {
            console.warn('⚠️ 회사명 키워드가 없습니다.');
        }
        
        if (stats.totalKeywords < 100) {
            console.warn('⚠️ 검색 인덱스 크기가 작습니다. 데이터 품질을 확인하세요.');
        }
        
        return stats;
    }
    
    /**
     * 검색 인덱스 재구축
     */
    rebuildSearchIndex() {
        console.log('🔄 검색 인덱스 재구축 시작');
        
        if (window.allData && Array.isArray(window.allData)) {
            this.buildSearchIndex(window.allData);
            
            if (window.loadingManager) {
                window.loadingManager.showFeedback(
                    '검색 인덱스가 재구축되었습니다.',
                    'success',
                    3000
                );
            }
        } else {
            console.error('❌ 검색 인덱스 재구축 실패: allData를 사용할 수 없습니다.');
            
            if (window.loadingManager) {
                window.loadingManager.showFeedback(
                    '검색 인덱스 재구축에 실패했습니다.',
                    'error',
                    3000
                );
            }
        }
    }

    /**
     * 인덱스에 항목 추가
     */
    addToIndex(key, company, index, type) {
        if (!this.searchIndex.has(key)) {
            this.searchIndex.set(key, []);
        }
        
        this.searchIndex.get(key).push({
            company,
            index,
            type,
            relevance: this.calculateRelevance(type)
        });
    }

    /**
     * 관련성 점수 계산
     */
    calculateRelevance(type) {
        const scores = {
            ticker: 100,
            name: 90,
            name_word: 70,
            industry: 60,
            exchange: 50
        };
        return scores[type] || 10;
    }

    /**
     * 고급 검색 UI 설정
     */
    setupAdvancedSearchUI() {
        const searchContainer = document.querySelector('.search-container') || 
                               document.getElementById('search-input')?.parentElement;
        
        if (!searchContainer) return;

        // 기존 검색창 개선
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.placeholder = '티커, 회사명, 업종으로 검색... (예: AAPL, Apple, Technology)';
            searchInput.setAttribute('autocomplete', 'off');
        }

        // 검색 제안 드롭다운 생성
        this.createSuggestionDropdown(searchContainer);
        
        // 검색 히스토리 UI 생성
        this.createSearchHistory(searchContainer);
        
        // 고급 검색 옵션 생성
        this.createAdvancedOptions(searchContainer);
    }

    /**
     * 검색 제안 드롭다운 생성
     */
    createSuggestionDropdown(container) {
        if (document.getElementById('search-suggestions')) return;

        const dropdown = document.createElement('div');
        dropdown.id = 'search-suggestions';
        dropdown.className = 'absolute top-full left-0 right-0 bg-white border border-gray-300 rounded-b-lg shadow-lg z-50 max-h-64 overflow-y-auto';
        dropdown.style.display = 'none';
        
        container.style.position = 'relative';
        container.appendChild(dropdown);
    }

    /**
     * 검색 히스토리 UI 생성
     */
    createSearchHistory(container) {
        const historyButton = document.createElement('button');
        historyButton.id = 'search-history-btn';
        historyButton.className = 'absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600';
        historyButton.innerHTML = '<i class="fas fa-history"></i>';
        historyButton.title = '검색 기록';
        
        container.appendChild(historyButton);
        
        historyButton.addEventListener('click', () => {
            this.showSearchHistory();
        });
    }

    /**
     * 고급 검색 옵션 생성
     */
    createAdvancedOptions(container) {
        const advancedToggle = document.createElement('button');
        advancedToggle.id = 'advanced-search-toggle';
        advancedToggle.className = 'text-xs text-blue-600 hover:text-blue-800 mt-1';
        advancedToggle.textContent = '고급 검색';
        
        const advancedPanel = document.createElement('div');
        advancedPanel.id = 'advanced-search-panel';
        advancedPanel.className = 'mt-2 p-3 border rounded-lg bg-gray-50';
        advancedPanel.style.display = 'none';
        
        advancedPanel.innerHTML = `
            <div class="grid grid-cols-2 gap-3 text-sm">
                <div>
                    <label class="block text-gray-700 mb-1">검색 범위</label>
                    <select id="search-scope" class="w-full px-2 py-1 border rounded">
                        <option value="all">전체</option>
                        <option value="ticker">티커만</option>
                        <option value="name">회사명만</option>
                        <option value="industry">업종만</option>
                    </select>
                </div>
                <div>
                    <label class="block text-gray-700 mb-1">정렬 기준</label>
                    <select id="search-sort" class="w-full px-2 py-1 border rounded">
                        <option value="relevance">관련성</option>
                        <option value="alphabetical">알파벳순</option>
                        <option value="market-cap">시가총액</option>
                    </select>
                </div>
            </div>
            <div class="mt-3 flex items-center">
                <input type="checkbox" id="exact-match" class="mr-2">
                <label for="exact-match" class="text-sm text-gray-700">정확히 일치</label>
            </div>
        `;
        
        container.appendChild(advancedToggle);
        container.appendChild(advancedPanel);
        
        advancedToggle.addEventListener('click', () => {
            const isVisible = advancedPanel.style.display !== 'none';
            advancedPanel.style.display = isVisible ? 'none' : 'block';
            advancedToggle.textContent = isVisible ? '고급 검색' : '간단 검색';
        });
    }

    /**
     * 검색 이벤트 설정
     */
    setupSearchEvents() {
        const searchInput = document.getElementById('search-input');
        if (!searchInput) return;

        let searchTimeout;
        
        // 실시간 검색 제안
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this.handleSearchInput(e.target.value);
            }, 200);
        });

        // 키보드 네비게이션
        searchInput.addEventListener('keydown', (e) => {
            this.handleKeyNavigation(e);
        });

        // 포커스 이벤트
        searchInput.addEventListener('focus', () => {
            this.showSuggestions();
        });

        // 외부 클릭 시 제안 숨김
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                this.hideSuggestions();
            }
        });
    }   
 /**
     * 검색 입력 처리
     */
    handleSearchInput(query) {
        if (!query || query.length < 2) {
            this.hideSuggestions();
            return;
        }

        const suggestions = this.generateSuggestions(query);
        this.displaySuggestions(suggestions);
        
        // 실시간 하이라이트
        this.highlightSearchResults(query);
    }

    /**
     * 검색 제안 생성
     */
    generateSuggestions(query) {
        const normalizedQuery = query.toLowerCase().trim();
        const suggestions = [];
        const maxSuggestions = 10;

        // 정확한 매치 우선
        for (const [key, results] of this.searchIndex) {
            if (key.startsWith(normalizedQuery)) {
                results.forEach(result => {
                    if (suggestions.length < maxSuggestions) {
                        suggestions.push({
                            text: this.formatSuggestion(result),
                            company: result.company,
                            type: result.type,
                            relevance: result.relevance + (key === normalizedQuery ? 50 : 0)
                        });
                    }
                });
            }
        }

        // 부분 매치
        if (suggestions.length < maxSuggestions) {
            for (const [key, results] of this.searchIndex) {
                if (key.includes(normalizedQuery) && !key.startsWith(normalizedQuery)) {
                    results.forEach(result => {
                        if (suggestions.length < maxSuggestions) {
                            suggestions.push({
                                text: this.formatSuggestion(result),
                                company: result.company,
                                type: result.type,
                                relevance: result.relevance
                            });
                        }
                    });
                }
            }
        }

        // 관련성 순으로 정렬
        return suggestions
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, maxSuggestions);
    }

    /**
     * 제안 텍스트 포맷팅
     */
    formatSuggestion(result) {
        const { company, type } = result;
        
        switch (type) {
            case 'ticker':
                return `${company.Ticker} - ${company.corpName || ''}`;
            case 'name':
            case 'name_word':
                return `${company.corpName} (${company.Ticker})`;
            case 'industry':
                return `${company.industry} - ${company.Ticker}`;
            case 'exchange':
                return `${company.Exchange}: ${company.Ticker}`;
            default:
                return company.Ticker;
        }
    }

    /**
     * 제안 표시
     */
    displaySuggestions(suggestions) {
        const dropdown = document.getElementById('search-suggestions');
        if (!dropdown) return;

        if (suggestions.length === 0) {
            dropdown.style.display = 'none';
            return;
        }

        dropdown.innerHTML = suggestions.map((suggestion, index) => `
            <div class="suggestion-item px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0" 
                 data-index="${index}">
                <div class="flex items-center justify-between">
                    <span class="text-sm">${this.highlightMatch(suggestion.text, document.getElementById('search-input').value)}</span>
                    <span class="text-xs text-gray-500 ml-2">${this.getTypeLabel(suggestion.type)}</span>
                </div>
            </div>
        `).join('');

        // 클릭 이벤트 추가
        dropdown.querySelectorAll('.suggestion-item').forEach((item, index) => {
            item.addEventListener('click', () => {
                this.selectSuggestion(suggestions[index]);
            });
        });

        dropdown.style.display = 'block';
    }

    /**
     * 매치 하이라이트
     */
    highlightMatch(text, query) {
        if (!query) return text;
        
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<mark class="bg-yellow-200">$1</mark>');
    }

    /**
     * 타입 라벨 반환
     */
    getTypeLabel(type) {
        const labels = {
            ticker: '티커',
            name: '회사명',
            name_word: '회사명',
            industry: '업종',
            exchange: '거래소'
        };
        return labels[type] || '';
    }

    /**
     * 제안 선택
     */
    selectSuggestion(suggestion) {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = suggestion.company.Ticker;
            this.addToHistory(suggestion.company.Ticker);
        }

        this.hideSuggestions();
        this.performSearch(suggestion.company.Ticker);
    }

    /**
     * 제안 숨김
     */
    hideSuggestions() {
        const dropdown = document.getElementById('search-suggestions');
        if (dropdown) {
            dropdown.style.display = 'none';
        }
    }

    /**
     * 제안 표시
     */
    showSuggestions() {
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput.value.length >= 2) {
            this.handleSearchInput(searchInput.value);
        }
    }

    /**
     * 키보드 네비게이션 처리
     */
    handleKeyNavigation(e) {
        const dropdown = document.getElementById('search-suggestions');
        if (!dropdown || dropdown.style.display === 'none') return;

        const items = dropdown.querySelectorAll('.suggestion-item');
        const currentActive = dropdown.querySelector('.suggestion-item.active');
        let activeIndex = currentActive ? Array.from(items).indexOf(currentActive) : -1;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                activeIndex = Math.min(activeIndex + 1, items.length - 1);
                this.setActiveSuggestion(items, activeIndex);
                break;
            case 'ArrowUp':
                e.preventDefault();
                activeIndex = Math.max(activeIndex - 1, 0);
                this.setActiveSuggestion(items, activeIndex);
                break;
            case 'Enter':
                e.preventDefault();
                if (currentActive) {
                    currentActive.click();
                } else {
                    this.performSearch(e.target.value);
                }
                break;
            case 'Escape':
                this.hideSuggestions();
                break;
        }
    }

    /**
     * 활성 제안 설정
     */
    setActiveSuggestion(items, activeIndex) {
        items.forEach((item, index) => {
            if (index === activeIndex) {
                item.classList.add('active', 'bg-blue-100');
            } else {
                item.classList.remove('active', 'bg-blue-100');
            }
        });
    }    /*
*
     * 검색 실행
     */
    performSearch(query) {
        if (!query) return;

        this.addToHistory(query);
        
        // 기존 필터 매니저와 연동
        if (window.filterManager) {
            window.filterManager.filters.search = query;
            window.filterManager.applyFilters();
        }

        // 검색 결과 하이라이트
        this.highlightSearchResults(query);
        
        console.log(`🔍 검색 실행: "${query}"`);
    }

    /**
     * 검색 결과 하이라이트
     */
    highlightSearchResults(query) {
        if (!query) return;

        // 테이블의 모든 셀에서 검색어 하이라이트
        const table = document.querySelector('#results-table table');
        if (table) {
            const cells = table.querySelectorAll('td');
            cells.forEach(cell => {
                this.highlightTextInElement(cell, query);
            });
        }

        // 카드 뷰에서도 하이라이트
        const cards = document.querySelectorAll('.company-card');
        cards.forEach(card => {
            this.highlightTextInElement(card, query);
        });
    }

    /**
     * 요소 내 텍스트 하이라이트
     */
    highlightTextInElement(element, query) {
        if (!element || !query) return;

        // 기존 하이라이트 제거
        this.removeHighlights(element);

        const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (regex.test(node.textContent)) {
                textNodes.push(node);
            }
        }

        textNodes.forEach(textNode => {
            const highlightedHTML = textNode.textContent.replace(regex, 
                '<mark class="bg-yellow-200 px-1 rounded">$1</mark>');
            
            const wrapper = document.createElement('span');
            wrapper.innerHTML = highlightedHTML;
            textNode.parentNode.replaceChild(wrapper, textNode);
        });
    }

    /**
     * 하이라이트 제거
     */
    removeHighlights(element) {
        const highlights = element.querySelectorAll('mark');
        highlights.forEach(mark => {
            const parent = mark.parentNode;
            parent.replaceChild(document.createTextNode(mark.textContent), mark);
            parent.normalize();
        });
    }

    /**
     * 정규식 이스케이프
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * 검색 기록에 추가
     */
    addToHistory(query) {
        if (!query || this.searchHistory.includes(query)) return;

        this.searchHistory.unshift(query);
        
        // 최대 20개까지만 유지
        if (this.searchHistory.length > 20) {
            this.searchHistory = this.searchHistory.slice(0, 20);
        }

        // 로컬 스토리지에 저장
        try {
            localStorage.setItem('stockAnalyzer_searchHistory', JSON.stringify(this.searchHistory));
        } catch (e) {
            console.warn('검색 기록 저장 실패:', e);
        }
    }

    /**
     * 검색 기록 로드
     */
    loadSearchHistory() {
        try {
            const saved = localStorage.getItem('stockAnalyzer_searchHistory');
            if (saved) {
                this.searchHistory = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('검색 기록 로드 실패:', e);
            this.searchHistory = [];
        }
    }

    /**
     * 검색 기록 표시
     */
    showSearchHistory() {
        this.loadSearchHistory();
        
        if (this.searchHistory.length === 0) {
            this.showMessage('검색 기록이 없습니다.');
            return;
        }

        const dropdown = document.getElementById('search-suggestions');
        if (!dropdown) return;

        dropdown.innerHTML = `
            <div class="px-3 py-2 bg-gray-100 text-xs font-medium text-gray-700 border-b">
                최근 검색어
                <button class="float-right text-red-500 hover:text-red-700" onclick="window.advancedSearchManager.clearHistory()">
                    전체 삭제
                </button>
            </div>
            ${this.searchHistory.map((query, index) => `
                <div class="suggestion-item px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0 flex justify-between items-center" 
                     data-query="${query}">
                    <span class="text-sm">${query}</span>
                    <button class="text-xs text-gray-400 hover:text-red-500 ml-2" onclick="window.advancedSearchManager.removeFromHistory('${query}')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `).join('')}
        `;

        // 클릭 이벤트 추가
        dropdown.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'I') {
                    const query = item.dataset.query;
                    document.getElementById('search-input').value = query;
                    this.hideSuggestions();
                    this.performSearch(query);
                }
            });
        });

        dropdown.style.display = 'block';
    }

    /**
     * 검색 기록에서 제거
     */
    removeFromHistory(query) {
        this.searchHistory = this.searchHistory.filter(item => item !== query);
        try {
            localStorage.setItem('stockAnalyzer_searchHistory', JSON.stringify(this.searchHistory));
        } catch (e) {
            console.warn('검색 기록 저장 실패:', e);
        }
        this.showSearchHistory(); // 업데이트된 기록 표시
    }

    /**
     * 검색 기록 전체 삭제
     */
    clearHistory() {
        this.searchHistory = [];
        try {
            localStorage.removeItem('stockAnalyzer_searchHistory');
        } catch (e) {
            console.warn('검색 기록 삭제 실패:', e);
        }
        this.hideSuggestions();
        this.showMessage('검색 기록이 삭제되었습니다.');
    }

    /**
     * 메시지 표시
     */
    showMessage(message) {
        if (window.loadingManager) {
            window.loadingManager.showFeedback(message, 'info', 2000);
        } else {
            alert(message);
        }
    }

    /**
     * 자연어 검색 처리
     */
    processNaturalLanguageQuery(query) {
        const patterns = [
            { pattern: /PER\s*(\d+)\s*이하/i, filter: (match) => ({ per: { min: 0, max: parseInt(match[1]) } }) },
            { pattern: /PBR\s*(\d+)\s*이하/i, filter: (match) => ({ pbr: { min: 0, max: parseInt(match[1]) } }) },
            { pattern: /ROE\s*(\d+)%?\s*이상/i, filter: (match) => ({ roe: { min: parseInt(match[1]), max: 100 } }) },
            { pattern: /시가총액\s*(\d+)억?\s*이상/i, filter: (match) => ({ marketCap: { min: parseInt(match[1]) * 100, max: 1000000 } }) }
        ];

        for (const { pattern, filter } of patterns) {
            const match = query.match(pattern);
            if (match) {
                const filterConfig = filter(match);
                this.applyNaturalLanguageFilter(filterConfig);
                return true;
            }
        }

        return false;
    }

    /**
     * 자연어 필터 적용
     */
    applyNaturalLanguageFilter(filterConfig) {
        if (window.filterManager) {
            Object.assign(window.filterManager.filters, filterConfig);
            window.filterManager.applyFilters();
            
            console.log('🗣️ 자연어 검색 필터 적용:', filterConfig);
        }
    }

    /**
     * 검색 통계 반환
     */
    getSearchStats() {
        return {
            indexSize: this.searchIndex.size,
            historySize: this.searchHistory.length,
            isIndexed: this.isIndexed
        };
    }
}

// 전역 인스턴스 생성
window.advancedSearchManager = new AdvancedSearchManager();

console.log('✅ AdvancedSearchManager 로드 완료 - 고도화된 검색 시스템');