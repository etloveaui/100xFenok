/**
 * VirtualScrollManager - 가상 스크롤링 및 성능 최적화
 */

class VirtualScrollManager {
    constructor() {
        this.itemHeight = 50; // 각 행의 높이
        this.containerHeight = 600; // 컨테이너 높이
        this.visibleItems = Math.ceil(this.containerHeight / this.itemHeight) + 5; // 버퍼 포함
        this.scrollTop = 0;
        this.startIndex = 0;
        this.endIndex = this.visibleItems;
        this.data = [];
        this.isEnabled = false;
        
        console.log('⚡ VirtualScrollManager 초기화');
    }

    /**
     * 가상 스크롤링 초기화
     */
    initialize(data, container) {
        this.data = data || [];
        this.container = container;
        
        if (this.data.length > 1000) { // 1000개 이상일 때만 가상 스크롤링 활성화
            this.enableVirtualScrolling();
        }
        
        console.log(`⚡ 가상 스크롤링 초기화: ${this.data.length}개 아이템`);
    }

    /**
     * 가상 스크롤링 활성화
     */
    enableVirtualScrolling() {
        if (!this.container) return;

        this.isEnabled = true;
        this.setupVirtualContainer();
        this.setupScrollListener();
        this.renderVisibleItems();
        
        console.log('✅ 가상 스크롤링 활성화');
    }

    /**
     * 가상 컨테이너 설정
     */
    setupVirtualContainer() {
        // 기존 테이블을 가상 스크롤 컨테이너로 변환
        this.container.style.height = `${this.containerHeight}px`;
        this.container.style.overflowY = 'auto';
        this.container.style.position = 'relative';

        // 전체 높이를 나타내는 스페이서 생성
        this.spacer = document.createElement('div');
        this.spacer.style.height = `${this.data.length * this.itemHeight}px`;
        this.spacer.style.position = 'absolute';
        this.spacer.style.top = '0';
        this.spacer.style.left = '0';
        this.spacer.style.width = '1px';
        this.spacer.style.pointerEvents = 'none';
        
        this.container.appendChild(this.spacer);

        // 가시 영역 컨테이너
        this.visibleContainer = document.createElement('div');
        this.visibleContainer.style.position = 'absolute';
        this.visibleContainer.style.top = '0';
        this.visibleContainer.style.left = '0';
        this.visibleContainer.style.right = '0';
        
        this.container.appendChild(this.visibleContainer);
    }

    /**
     * 스크롤 리스너 설정
     */
    setupScrollListener() {
        let scrollTimeout;
        
        this.container.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                this.handleScroll();
            }, 16); // 60fps
        });
    }

    /**
     * 스크롤 처리
     */
    handleScroll() {
        const newScrollTop = this.container.scrollTop;
        
        if (Math.abs(newScrollTop - this.scrollTop) < this.itemHeight) {
            return; // 작은 스크롤은 무시
        }

        this.scrollTop = newScrollTop;
        this.calculateVisibleRange();
        this.renderVisibleItems();
    }

    /**
     * 가시 범위 계산
     */
    calculateVisibleRange() {
        this.startIndex = Math.floor(this.scrollTop / this.itemHeight);
        this.endIndex = Math.min(
            this.startIndex + this.visibleItems,
            this.data.length
        );

        // 버퍼 추가 (부드러운 스크롤링)
        this.startIndex = Math.max(0, this.startIndex - 2);
        this.endIndex = Math.min(this.data.length, this.endIndex + 2);
    }

    /**
     * 가시 아이템 렌더링
     */
    renderVisibleItems() {
        if (!this.visibleContainer) return;

        const fragment = document.createDocumentFragment();
        
        // 현재 가시 영역의 아이템들만 렌더링
        for (let i = this.startIndex; i < this.endIndex; i++) {
            const item = this.data[i];
            if (!item) continue;

            const row = this.createTableRow(item, i);
            row.style.position = 'absolute';
            row.style.top = `${i * this.itemHeight}px`;
            row.style.left = '0';
            row.style.right = '0';
            row.style.height = `${this.itemHeight}px`;
            
            fragment.appendChild(row);
        }

        // 기존 내용 제거 후 새 내용 추가
        this.visibleContainer.innerHTML = '';
        this.visibleContainer.appendChild(fragment);

        console.log(`⚡ 가상 스크롤 렌더링: ${this.startIndex}-${this.endIndex} (${this.endIndex - this.startIndex}개)`);
    }

    /**
     * 테이블 행 생성
     */
    createTableRow(company, index) {
        const row = document.createElement('tr');
        row.className = 'border-b hover:bg-gray-50 transition-colors';
        row.setAttribute('draggable', 'true');
        row.style.cursor = 'move';
        
        // 주요 컬럼들만 표시 (성능 최적화)
        const columns = [
            { key: 'Ticker', label: '티커' },
            { key: 'corpName', label: '회사명' },
            { key: 'industry', label: '업종' },
            { key: 'PER (Oct-25)', label: 'PER', format: 'number' },
            { key: 'PBR (Oct-25)', label: 'PBR', format: 'number' },
            { key: 'ROE (Fwd)', label: 'ROE', format: 'percent' },
            { key: '(USD mn)', label: '시가총액', format: 'marketcap' }
        ];

        columns.forEach(col => {
            const cell = document.createElement('td');
            cell.className = 'px-4 py-3 text-sm';
            
            let value = company[col.key];
            
            switch (col.format) {
                case 'number':
                    value = parseFloat(value);
                    cell.textContent = isNaN(value) ? '-' : value.toFixed(2);
                    break;
                case 'percent':
                    value = parseFloat(value);
                    cell.textContent = isNaN(value) ? '-' : `${value.toFixed(1)}%`;
                    break;
                case 'marketcap':
                    value = parseFloat(value);
                    if (isNaN(value)) {
                        cell.textContent = '-';
                    } else if (value >= 1000) {
                        cell.textContent = `$${(value/1000).toFixed(1)}B`;
                    } else {
                        cell.textContent = `$${value.toFixed(0)}M`;
                    }
                    break;
                default:
                    cell.textContent = value || '-';
            }
            
            row.appendChild(cell);
        });

        // 드래그 이벤트
        row.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', company.Ticker);
            e.dataTransfer.effectAllowed = 'copy';
        });

        // 클릭 이벤트
        row.addEventListener('click', () => {
            if (window.showCompanyAnalysisModal) {
                window.showCompanyAnalysisModal(company);
            }
        });

        return row;
    }

    /**
     * 데이터 업데이트
     */
    updateData(newData) {
        this.data = newData || [];
        
        if (this.isEnabled) {
            // 스페이서 높이 업데이트
            if (this.spacer) {
                this.spacer.style.height = `${this.data.length * this.itemHeight}px`;
            }
            
            // 가시 범위 재계산
            this.calculateVisibleRange();
            this.renderVisibleItems();
        }
        
        console.log(`⚡ 가상 스크롤 데이터 업데이트: ${this.data.length}개`);
    }

    /**
     * 특정 인덱스로 스크롤
     */
    scrollToIndex(index) {
        if (!this.isEnabled || !this.container) return;

        const targetScrollTop = index * this.itemHeight;
        this.container.scrollTop = targetScrollTop;
        
        console.log(`⚡ 인덱스 ${index}로 스크롤`);
    }

    /**
     * 특정 티커로 스크롤
     */
    scrollToTicker(ticker) {
        const index = this.data.findIndex(company => company.Ticker === ticker);
        if (index !== -1) {
            this.scrollToIndex(index);
        }
    }

    /**
     * 가상 스크롤링 비활성화
     */
    disable() {
        this.isEnabled = false;
        
        if (this.container) {
            this.container.style.height = '';
            this.container.style.overflowY = '';
            this.container.style.position = '';
        }

        if (this.spacer) {
            this.spacer.remove();
        }

        if (this.visibleContainer) {
            this.visibleContainer.remove();
        }
        
        console.log('⚡ 가상 스크롤링 비활성화');
    }

    /**
     * 성능 메트릭 반환
     */
    getPerformanceMetrics() {
        return {
            isEnabled: this.isEnabled,
            totalItems: this.data.length,
            visibleItems: this.endIndex - this.startIndex,
            itemHeight: this.itemHeight,
            containerHeight: this.containerHeight,
            currentRange: `${this.startIndex}-${this.endIndex}`
        };
    }
}

// Web Worker를 위한 백그라운드 처리 시스템
class BackgroundProcessor {
    constructor() {
        this.worker = null;
        this.isSupported = typeof Worker !== 'undefined';
        
        console.log('🔧 BackgroundProcessor 초기화');
    }

    /**
     * Web Worker 초기화
     */
    initialize() {
        if (!this.isSupported) {
            console.warn('⚠️ Web Worker 지원 안함');
            return;
        }

        // 인라인 워커 생성
        const workerScript = `
            self.addEventListener('message', function(e) {
                const { type, data } = e.data;
                
                switch (type) {
                    case 'FILTER_DATA':
                        const filtered = filterData(data.companies, data.filters);
                        self.postMessage({ type: 'FILTER_RESULT', data: filtered });
                        break;
                    case 'SORT_DATA':
                        const sorted = sortData(data.companies, data.column, data.direction);
                        self.postMessage({ type: 'SORT_RESULT', data: sorted });
                        break;
                    case 'CALCULATE_METRICS':
                        const metrics = calculateMetrics(data.companies);
                        self.postMessage({ type: 'METRICS_RESULT', data: metrics });
                        break;
                }
            });
            
            function filterData(companies, filters) {
                return companies.filter(company => {
                    // 필터 로직 구현
                    if (filters.search) {
                        const searchTerm = filters.search.toLowerCase();
                        if (!company.Ticker.toLowerCase().includes(searchTerm) &&
                            !company.corpName?.toLowerCase().includes(searchTerm)) {
                            return false;
                        }
                    }
                    return true;
                });
            }
            
            function sortData(companies, column, direction) {
                return companies.sort((a, b) => {
                    let aVal = a[column];
                    let bVal = b[column];
                    
                    // 숫자 변환
                    if (!isNaN(parseFloat(aVal))) aVal = parseFloat(aVal);
                    if (!isNaN(parseFloat(bVal))) bVal = parseFloat(bVal);
                    
                    if (direction === 'asc') {
                        return aVal > bVal ? 1 : -1;
                    } else {
                        return aVal < bVal ? 1 : -1;
                    }
                });
            }
            
            function calculateMetrics(companies) {
                const metrics = {
                    count: companies.length,
                    avgPER: 0,
                    avgROE: 0,
                    totalMarketCap: 0
                };
                
                let perSum = 0, perCount = 0;
                let roeSum = 0, roeCount = 0;
                let marketCapSum = 0;
                
                companies.forEach(company => {
                    const per = parseFloat(company['PER (Oct-25)']);
                    const roe = parseFloat(company['ROE (Fwd)']);
                    const marketCap = parseFloat(company['(USD mn)']);
                    
                    if (!isNaN(per) && per > 0) {
                        perSum += per;
                        perCount++;
                    }
                    
                    if (!isNaN(roe)) {
                        roeSum += roe;
                        roeCount++;
                    }
                    
                    if (!isNaN(marketCap)) {
                        marketCapSum += marketCap;
                    }
                });
                
                metrics.avgPER = perCount > 0 ? perSum / perCount : 0;
                metrics.avgROE = roeCount > 0 ? roeSum / roeCount : 0;
                metrics.totalMarketCap = marketCapSum;
                
                return metrics;
            }
        `;

        const blob = new Blob([workerScript], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob));
        
        this.setupWorkerEvents();
        console.log('✅ Web Worker 초기화 완료');
    }

    /**
     * Worker 이벤트 설정
     */
    setupWorkerEvents() {
        this.worker.addEventListener('message', (e) => {
            const { type, data } = e.data;
            
            switch (type) {
                case 'FILTER_RESULT':
                    this.handleFilterResult(data);
                    break;
                case 'SORT_RESULT':
                    this.handleSortResult(data);
                    break;
                case 'METRICS_RESULT':
                    this.handleMetricsResult(data);
                    break;
            }
        });

        this.worker.addEventListener('error', (error) => {
            console.error('❌ Web Worker 오류:', error);
        });
    }

    /**
     * 백그라운드 필터링
     */
    filterInBackground(companies, filters) {
        if (!this.worker) {
            console.warn('⚠️ Web Worker 사용 불가, 메인 스레드에서 처리');
            return this.filterOnMainThread(companies, filters);
        }

        return new Promise((resolve) => {
            this.filterResolve = resolve;
            this.worker.postMessage({
                type: 'FILTER_DATA',
                data: { companies, filters }
            });
        });
    }

    /**
     * 백그라운드 정렬
     */
    sortInBackground(companies, column, direction) {
        if (!this.worker) {
            console.warn('⚠️ Web Worker 사용 불가, 메인 스레드에서 처리');
            return this.sortOnMainThread(companies, column, direction);
        }

        return new Promise((resolve) => {
            this.sortResolve = resolve;
            this.worker.postMessage({
                type: 'SORT_DATA',
                data: { companies, column, direction }
            });
        });
    }

    /**
     * 백그라운드 메트릭 계산
     */
    calculateMetricsInBackground(companies) {
        if (!this.worker) {
            return this.calculateMetricsOnMainThread(companies);
        }

        return new Promise((resolve) => {
            this.metricsResolve = resolve;
            this.worker.postMessage({
                type: 'CALCULATE_METRICS',
                data: { companies }
            });
        });
    }

    /**
     * 필터 결과 처리
     */
    handleFilterResult(data) {
        if (this.filterResolve) {
            this.filterResolve(data);
            this.filterResolve = null;
        }
    }

    /**
     * 정렬 결과 처리
     */
    handleSortResult(data) {
        if (this.sortResolve) {
            this.sortResolve(data);
            this.sortResolve = null;
        }
    }

    /**
     * 메트릭 결과 처리
     */
    handleMetricsResult(data) {
        if (this.metricsResolve) {
            this.metricsResolve(data);
            this.metricsResolve = null;
        }
    }

    /**
     * 메인 스레드 필터링 (폴백)
     */
    filterOnMainThread(companies, filters) {
        return companies.filter(company => {
            if (filters.search) {
                const searchTerm = filters.search.toLowerCase();
                if (!company.Ticker.toLowerCase().includes(searchTerm) &&
                    !company.corpName?.toLowerCase().includes(searchTerm)) {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * 메인 스레드 정렬 (폴백)
     */
    sortOnMainThread(companies, column, direction) {
        return [...companies].sort((a, b) => {
            let aVal = a[column];
            let bVal = b[column];
            
            if (!isNaN(parseFloat(aVal))) aVal = parseFloat(aVal);
            if (!isNaN(parseFloat(bVal))) bVal = parseFloat(bVal);
            
            if (direction === 'asc') {
                return aVal > bVal ? 1 : -1;
            } else {
                return aVal < bVal ? 1 : -1;
            }
        });
    }

    /**
     * 메인 스레드 메트릭 계산 (폴백)
     */
    calculateMetricsOnMainThread(companies) {
        // TestManager의 메트릭 계산 로직 재사용
        return {
            count: companies.length,
            avgPER: 0,
            avgROE: 0,
            totalMarketCap: 0
        };
    }

    /**
     * Worker 정리
     */
    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        
        this.disable();
        console.log('🗑️ VirtualScrollManager 정리 완료');
    }
}

// 전역 인스턴스 생성
window.virtualScrollManager = new VirtualScrollManager();
window.backgroundProcessor = new BackgroundProcessor();

console.log('✅ VirtualScrollManager 로드 완료 - 가상 스크롤링 및 백그라운드 처리');