/**
 * CardViewManager - 테이블/카드 뷰 전환 시스템
 */

class CardViewManager {
    constructor() {
        this.currentView = 'table'; // 'table' or 'card'
        this.cardContainer = null;
        this.tableContainer = null;
        
        console.log('🎴 CardViewManager 초기화');
    }

    /**
     * 뷰 전환 버튼 이벤트 리스너 추가 (HTML에 이미 버튼이 있음)
     */
    addViewToggleButton() {
        // HTML에 이미 버튼이 있으므로 이벤트 리스너만 추가
        const tableBtn = document.getElementById('table-view-btn');
        const cardBtn = document.getElementById('card-view-btn');
        
        if (tableBtn && cardBtn) {
            console.log('🎴 뷰 전환 버튼 이벤트 리스너 추가');
            tableBtn.addEventListener('click', () => this.switchToTableView());
            cardBtn.addEventListener('click', () => this.switchToCardView());
        } else {
            console.warn('뷰 전환 버튼을 찾을 수 없습니다');
        }
    }

    /**
     * 테이블 뷰로 전환
     */
    switchToTableView() {
        console.log('🔄 테이블 뷰로 전환');
        this.currentView = 'table';
        
        // 버튼 스타일 업데이트
        this.updateButtonStyles();
        
        // 카드 컨테이너 숨기기
        if (this.cardContainer) {
            this.cardContainer.style.display = 'none';
        }
        
        // 테이블 컨테이너 표시
        const tableContainer = document.getElementById('results-table');
        if (tableContainer) {
            tableContainer.style.display = 'block';
            this.tableContainer = tableContainer;
        }
        
        // 테이블 다시 렌더링
        if (window.currentData && window.currentData.length > 0) {
            renderTable(window.currentData);
        }
    }

    /**
     * 카드 뷰로 전환
     */
    switchToCardView() {
        console.log('🔄 카드 뷰로 전환 시작');
        
        try {
            this.currentView = 'card';
            
            // 버튼 스타일 업데이트
            this.updateButtonStyles();
            
            // 테이블 컨테이너 숨기기
            if (this.tableContainer) {
                this.tableContainer.style.display = 'none';
            }
            
            // 카드 컨테이너 생성/표시
            this.createCardContainer();
            
            // 즉시 카드 뷰 렌더링
            const dataToRender = this.getCurrentData();
            if (dataToRender && dataToRender.length > 0) {
                console.log(`📊 렌더링할 데이터: ${dataToRender.length}개`);
                this.renderCardView(dataToRender);
            } else {
                console.warn('⚠️ 렌더링할 데이터가 없습니다.');
                this.showEmptyCardState();
            }
            
            console.log('✅ 카드 뷰 전환 완료');
            
        } catch (error) {
            console.error('❌ 카드 뷰 전환 오류:', error);
            this.showCardErrorState(error);
        }
    }
    
    /**
     * 현재 데이터 가져오기
     */
    getCurrentData() {
        // 여러 소스에서 데이터 확인
        if (window.filteredData && window.filteredData.length > 0) {
            console.log('📊 filteredData 사용:', window.filteredData.length);
            return window.filteredData;
        }
        
        if (window.currentData && window.currentData.length > 0) {
            console.log('📊 currentData 사용:', window.currentData.length);
            return window.currentData;
        }
        
        if (window.allData && window.allData.length > 0) {
            console.log('📊 allData 사용:', window.allData.length);
            return window.allData;
        }
        
        console.warn('⚠️ 사용 가능한 데이터가 없습니다.');
        return [];
    }

    /**
     * 버튼 스타일 업데이트
     */
    updateButtonStyles() {
        const tableBtn = document.getElementById('table-view-btn');
        const cardBtn = document.getElementById('card-view-btn');
        
        if (tableBtn && cardBtn) {
            if (this.currentView === 'table') {
                tableBtn.className = 'px-4 py-2 rounded-md text-sm font-medium transition-colors bg-white text-gray-900 shadow-sm';
                cardBtn.className = 'px-4 py-2 rounded-md text-sm font-medium transition-colors text-gray-600 hover:text-gray-900';
            } else {
                tableBtn.className = 'px-4 py-2 rounded-md text-sm font-medium transition-colors text-gray-600 hover:text-gray-900';
                cardBtn.className = 'px-4 py-2 rounded-md text-sm font-medium transition-colors bg-white text-gray-900 shadow-sm';
            }
        }
    }

    /**
     * 카드 컨테이너 생성
     */
    createCardContainer() {
        let cardContainer = document.getElementById('card-view-container');
        
        if (!cardContainer) {
            console.log('🎴 카드 컨테이너 생성 중...');
            
            // 테이블 컨테이너 찾기
            const tableContainer = document.getElementById('results-table');
            if (!tableContainer) {
                console.error('❌ 테이블 컨테이너를 찾을 수 없습니다.');
                return;
            }
            
            const parentNode = tableContainer.parentNode;
            if (!parentNode) {
                console.error('❌ 테이블 컨테이너의 부모 노드를 찾을 수 없습니다.');
                return;
            }
            
            // 카드 컨테이너 생성
            cardContainer = document.createElement('div');
            cardContainer.id = 'card-view-container';
            cardContainer.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-4';
            cardContainer.style.display = 'none';
            
            // 테이블 다음에 삽입
            parentNode.insertBefore(cardContainer, tableContainer.nextSibling);
            
            console.log('✅ 카드 컨테이너 생성 완료');
        }
        
        if (cardContainer) {
            // 카드 컨테이너 표시
            cardContainer.style.display = 'grid';
            this.cardContainer = cardContainer;
            
            console.log('📱 카드 컨테이너 활성화');
        } else {
            console.error('❌ 카드 컨테이너 생성/찾기 실패');
        }
    }

    /**
     * 카드 뷰 렌더링
     */
    renderCardView(data) {
        if (!this.cardContainer) {
            console.warn('⚠️ 카드 컨테이너가 없습니다. 생성을 시도합니다.');
            this.createCardContainer();
            if (!this.cardContainer) {
                console.error('❌ 카드 컨테이너 생성 실패');
                return;
            }
        }

        console.log(`🎴 카드 뷰 렌더링: ${data.length}개 기업`);
        
        // 로딩 상태 표시
        this.showCardLoadingState();
        
        // 비동기로 카드 렌더링 (UI 블로킹 방지)
        setTimeout(() => {
            this.renderCardsAsync(data);
        }, 10);
    }
    
    /**
     * 카드 로딩 상태 표시
     */
    showCardLoadingState() {
        if (this.cardContainer) {
            this.cardContainer.innerHTML = `
                <div class="col-span-full flex items-center justify-center py-12">
                    <div class="text-center">
                        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <p class="text-gray-600">카드 뷰를 로딩 중입니다...</p>
                    </div>
                </div>
            `;
        }
    }
    
    /**
     * 비동기 카드 렌더링
     */
    renderCardsAsync(data) {
        try {
            // 페이지네이션 정보 확인 (전역 변수 사용)
            let pageData = data;
            
            // 페이지네이션이 활성화된 경우에만 적용
            if (typeof currentPage !== 'undefined' && typeof pageSize !== 'undefined' && pageSize > 0) {
                const startIndex = (currentPage - 1) * pageSize;
                const endIndex = startIndex + pageSize;
                pageData = data.slice(startIndex, endIndex);
                console.log(`📄 페이지네이션 적용: ${startIndex}-${endIndex} (총 ${data.length}개 중 ${pageData.length}개 표시)`);
            } else {
                // 페이지네이션이 없는 경우 처음 50개만 표시 (성능 고려)
                pageData = data.slice(0, 50);
                console.log(`📄 기본 제한 적용: 처음 50개 표시 (총 ${data.length}개)`);
            }
            
            if (pageData.length === 0) {
                this.showEmptyCardState();
                return;
            }
            
            // 카드 HTML 생성
            const cardsHTML = pageData.map(company => this.createCompanyCard(company)).join('');
            this.cardContainer.innerHTML = cardsHTML;
            
            // 카드 클릭 이벤트 추가
            this.addCardClickEvents();
            
            console.log(`✅ 카드 뷰 렌더링 완료: ${pageData.length}개 카드`);
            
            // 성공 피드백
            if (window.loadingManager) {
                window.loadingManager.showFeedback(
                    `카드 뷰로 전환되었습니다. (${pageData.length}개 기업)`,
                    'success',
                    2000
                );
            }
            
        } catch (error) {
            console.error('❌ 카드 뷰 렌더링 오류:', error);
            this.showCardErrorState(error);
        }
    }
    
    /**
     * 빈 카드 상태 표시
     */
    showEmptyCardState() {
        if (this.cardContainer) {
            this.cardContainer.innerHTML = `
                <div class="col-span-full flex items-center justify-center py-12">
                    <div class="text-center">
                        <i class="fas fa-inbox text-4xl text-gray-300 mb-4"></i>
                        <p class="text-gray-600">표시할 기업이 없습니다.</p>
                        <p class="text-sm text-gray-500 mt-2">필터를 조정하거나 검색어를 확인해보세요.</p>
                    </div>
                </div>
            `;
        }
    }
    
    /**
     * 카드 오류 상태 표시
     */
    showCardErrorState(error) {
        if (this.cardContainer) {
            this.cardContainer.innerHTML = `
                <div class="col-span-full flex items-center justify-center py-12">
                    <div class="text-center">
                        <i class="fas fa-exclamation-triangle text-4xl text-red-300 mb-4"></i>
                        <p class="text-red-600">카드 뷰 로딩 중 오류가 발생했습니다.</p>
                        <p class="text-sm text-gray-500 mt-2">${error.message}</p>
                        <button onclick="window.cardViewManager.switchToCardView()" 
                                class="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                            다시 시도
                        </button>
                    </div>
                </div>
            `;
        }
        
        if (window.loadingManager) {
            window.loadingManager.showFeedback(
                '카드 뷰 로딩에 실패했습니다.',
                'error',
                3000
            );
        }
    }

    /**
     * 개별 기업 카드 생성
     */
    createCompanyCard(company) {
        const ticker = company.Ticker || '-';
        const corpName = company.corpName || '-';
        const industry = company.industry || '-';
        const exchange = company.Exchange || company.exchange || '-';
        const currentPrice = this.formatNumber(company['Price (Oct-25)'] || company['현재가']);
        const dailyChange = this.formatPercentage(company['Return (Y)'] || company['전일대비']);
        const marketCap = this.formatMarketCap(company['(USD mn)']);
        const per = this.formatNumber(company['PER (Oct-25)']);
        const pbr = this.formatNumber(company['PBR (Oct-25)']);
        const roe = this.formatPercentage(company['ROE (Fwd)']);
        const opm = this.formatPercentage(company['OPM (Fwd)']);
        const yearReturn = this.formatPercentage(company['Return (Y)']);
        
        // 텍스트 길이 제한 및 툴팁용 원본 텍스트 보존
        const truncatedCorpName = this.truncateText(corpName, 25);
        const truncatedIndustry = this.truncateText(industry, 15);
        const truncatedExchange = this.truncateText(exchange, 10);
        
        // 일일 변화율에 따른 색상 결정
        const dailyChangeColor = this.getDailyChangeColor(company['Return (Y)'] || company['전일대비']);
        const yearReturnColor = this.getReturnColor(company['Return (Y)']);
        
        return `
            <div class="company-card bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 p-4 cursor-pointer border border-gray-200 min-h-[280px] max-w-[300px]" 
                 data-ticker="${ticker}">
                <!-- 헤더 -->
                <div class="flex justify-between items-start mb-3 min-h-[60px]">
                    <div class="flex-1 min-w-0 pr-2">
                        <h3 class="font-bold text-lg text-blue-600 font-mono truncate" title="${ticker}">${ticker}</h3>
                        <p class="text-sm text-gray-600 break-words line-clamp-2 leading-tight" 
                           title="${corpName}" 
                           style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-height: 2.5em;">
                           ${truncatedCorpName}
                        </p>
                    </div>
                    <div class="text-right flex-shrink-0 min-w-0">
                        <p class="text-xs text-gray-500 truncate" title="${exchange}">${truncatedExchange}</p>
                        <p class="text-xs text-gray-500 truncate" title="${industry}">${truncatedIndustry}</p>
                    </div>
                </div>
                
                <!-- 가격 정보 -->
                <div class="mb-3 p-2 bg-gray-50 rounded">
                    <div class="flex justify-between items-center">
                        <span class="text-sm text-gray-600">현재가</span>
                        <span class="font-mono font-bold">${currentPrice}</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-sm text-gray-600">전일대비</span>
                        <span class="font-mono font-bold ${dailyChangeColor}">${dailyChange}</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-sm text-gray-600">시가총액</span>
                        <span class="font-mono text-sm">${marketCap}</span>
                    </div>
                </div>
                
                <!-- 핵심 지표 -->
                <div class="grid grid-cols-2 gap-2 mb-3">
                    <div class="text-center p-2 bg-blue-50 rounded">
                        <p class="text-xs text-gray-600">PER</p>
                        <p class="font-mono font-bold text-sm">${per}</p>
                    </div>
                    <div class="text-center p-2 bg-green-50 rounded">
                        <p class="text-xs text-gray-600">PBR</p>
                        <p class="font-mono font-bold text-sm">${pbr}</p>
                    </div>
                    <div class="text-center p-2 bg-purple-50 rounded">
                        <p class="text-xs text-gray-600">ROE</p>
                        <p class="font-mono font-bold text-sm">${roe}</p>
                    </div>
                    <div class="text-center p-2 bg-orange-50 rounded">
                        <p class="text-xs text-gray-600">영업이익률</p>
                        <p class="font-mono font-bold text-sm">${opm}</p>
                    </div>
                </div>
                
                <!-- 수익률 -->
                <div class="text-center p-2 bg-gray-100 rounded">
                    <p class="text-xs text-gray-600">연간수익률</p>
                    <p class="font-mono font-bold ${yearReturnColor}">${yearReturn}</p>
                </div>
            </div>
        `;
    }

    /**
     * 일일 변화율 색상 결정
     */
    getDailyChangeColor(value) {
        const num = parseFloat(value);
        if (isNaN(num)) return 'text-gray-500';
        return num > 0 ? 'text-green-600' : num < 0 ? 'text-red-600' : 'text-gray-500';
    }

    /**
     * 수익률 색상 결정
     */
    getReturnColor(value) {
        const num = parseFloat(value);
        if (isNaN(num)) return 'text-gray-500';
        return num > 0 ? 'text-green-600' : num < 0 ? 'text-red-600' : 'text-gray-500';
    }

    /**
     * 카드 클릭 이벤트 추가
     */
    addCardClickEvents() {
        const cards = document.querySelectorAll('.company-card');
        cards.forEach(card => {
            card.addEventListener('click', (e) => {
                const ticker = e.currentTarget.dataset.ticker;
                console.log(`🎴 카드 클릭: ${ticker}`);
                
                // 기업 상세 모달 열기 (기존 함수 활용)
                if (window.openCompanyModal && ticker) {
                    const company = window.currentData?.find(c => c.Ticker === ticker);
                    if (company) {
                        window.openCompanyModal(company);
                    }
                }
            });
        });
    }

    /**
     * 숫자 포맷터
     */
    formatNumber(value) {
        if (value === null || value === undefined || value === '' || value === '-') return '-';
        const num = parseFloat(value);
        if (isNaN(num)) return '-';
        return num.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    }

    /**
     * 퍼센트 포맷터
     */
    formatPercentage(value) {
        if (value === null || value === undefined || value === '' || value === '-') return '-';
        const num = parseFloat(value);
        if (isNaN(num)) return '-';
        const formatted = num.toFixed(2);
        return num > 0 ? `+${formatted}%` : `${formatted}%`;
    }

    /**
     * 시가총액 포맷터
     */
    formatMarketCap(value) {
        if (value === null || value === undefined || value === '' || value === '-') return '-';
        const num = parseFloat(value);
        if (isNaN(num)) return '-';
        
        if (num >= 1000) {
            return `${(num / 1000).toFixed(1)}B`;
        } else {
            return `${num.toFixed(0)}M`;
        }
    }

    /**
     * 텍스트 자르기 (오버플로우 방지)
     */
    truncateText(text, maxLength) {
        if (!text || typeof text !== 'string') return '-';
        
        const cleanText = text.trim();
        if (cleanText.length <= maxLength) return cleanText;
        
        return cleanText.substring(0, maxLength - 3) + '...';
    }
    
    /**
     * 텍스트 줄바꿈 처리
     */
    wrapText(text, maxLength) {
        if (!text || typeof text !== 'string') return '-';
        
        const words = text.trim().split(' ');
        const lines = [];
        let currentLine = '';
        
        words.forEach(word => {
            if ((currentLine + word).length <= maxLength) {
                currentLine += (currentLine ? ' ' : '') + word;
            } else {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
            }
        });
        
        if (currentLine) lines.push(currentLine);
        
        // 최대 2줄까지만 표시
        return lines.slice(0, 2).join('<br>');
    }
    
    /**
     * HTML 이스케이프 처리
     */
    escapeHtml(text) {
        if (!text || typeof text !== 'string') return '';
        
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 현재 뷰 모드 반환
     */
    getCurrentView() {
        return this.currentView;
    }

    /**
     * 초기화
     */
    initialize() {
        this.addViewToggleButton();
        console.log('✅ CardViewManager 초기화 완료');
    }
}

// 전역 인스턴스 생성
window.cardViewManager = new CardViewManager();

console.log('✅ CardViewManager 로드 완료 - 테이블/카드 뷰 전환 시스템');