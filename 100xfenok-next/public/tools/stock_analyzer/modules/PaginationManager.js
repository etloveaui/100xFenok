/**
 * PaginationManager 모듈
 * 페이지 단위 데이터 분할 및 네비게이션 관리
 */

class PaginationManager {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 50; // 기본 페이지 크기
        this.totalItems = 0;
        this.totalPages = 0;
        this.data = [];
        
        // 이벤트 리스너
        this.eventListeners = new Map();
        
        // 페이지 크기 옵션
        this.pageSizeOptions = [25, 50, 100, 200];
    }
    
    /**
     * 데이터 설정 및 페이징 초기화
     */
    setData(data) {
        this.data = data || [];
        this.totalItems = this.data.length;
        this.calculateTotalPages();
        
        // 현재 페이지가 범위를 벗어나면 조정
        if (this.currentPage > this.totalPages) {
            this.currentPage = Math.max(1, this.totalPages);
        }
        
        this.emit('dataChanged', {
            totalItems: this.totalItems,
            totalPages: this.totalPages,
            currentPage: this.currentPage
        });
        
        return this.getCurrentPageData();
    }
    
    /**
     * 전체 페이지 수 계산
     */
    calculateTotalPages() {
        this.totalPages = Math.ceil(this.totalItems / this.pageSize);
        if (this.totalPages === 0) this.totalPages = 1;
    }
    
    /**
     * 현재 페이지 데이터 가져오기
     */
    getCurrentPageData() {
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = Math.min(startIndex + this.pageSize, this.totalItems);
        
        const pageData = this.data.slice(startIndex, endIndex);
        
        return {
            data: pageData,
            pagination: {
                currentPage: this.currentPage,
                totalPages: this.totalPages,
                totalItems: this.totalItems,
                pageSize: this.pageSize,
                startIndex: startIndex + 1,
                endIndex: endIndex,
                hasNext: this.currentPage < this.totalPages,
                hasPrev: this.currentPage > 1
            }
        };
    }
    
    /**
     * 다음 페이지로 이동
     */
    nextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            this.emit('pageChanged', this.getCurrentPageData());
            return this.getCurrentPageData();
        }
        return null;
    }
    
    /**
     * 이전 페이지로 이동
     */
    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.emit('pageChanged', this.getCurrentPageData());
            return this.getCurrentPageData();
        }
        return null;
    }
    
    /**
     * 첫 페이지로 이동
     */
    firstPage() {
        if (this.currentPage !== 1) {
            this.currentPage = 1;
            this.emit('pageChanged', this.getCurrentPageData());
            return this.getCurrentPageData();
        }
        return null;
    }
    
    /**
     * 마지막 페이지로 이동
     */
    lastPage() {
        if (this.currentPage !== this.totalPages) {
            this.currentPage = this.totalPages;
            this.emit('pageChanged', this.getCurrentPageData());
            return this.getCurrentPageData();
        }
        return null;
    }
    
    /**
     * 특정 페이지로 이동
     */
    goToPage(pageNumber) {
        const targetPage = parseInt(pageNumber);
        
        if (isNaN(targetPage) || targetPage < 1 || targetPage > this.totalPages) {
            console.warn(`PaginationManager: Invalid page number ${pageNumber}`);
            return null;
        }
        
        if (this.currentPage !== targetPage) {
            this.currentPage = targetPage;
            this.emit('pageChanged', this.getCurrentPageData());
            return this.getCurrentPageData();
        }
        
        return null;
    }
    
    /**
     * 페이지 크기 변경
     */
    setPageSize(newSize) {
        const size = parseInt(newSize);
        
        if (isNaN(size) || size < 1) {
            console.warn(`PaginationManager: Invalid page size ${newSize}`);
            return;
        }
        
        // 현재 첫 번째 아이템의 인덱스 계산
        const currentFirstItemIndex = (this.currentPage - 1) * this.pageSize;
        
        // 새로운 페이지 크기 적용
        this.pageSize = size;
        this.calculateTotalPages();
        
        // 현재 첫 번째 아이템이 포함된 페이지로 이동
        this.currentPage = Math.floor(currentFirstItemIndex / this.pageSize) + 1;
        
        // 페이지 범위 검증
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages;
        }
        
        this.emit('pageSizeChanged', {
            pageSize: this.pageSize,
            currentPage: this.currentPage,
            totalPages: this.totalPages
        });
        
        this.emit('pageChanged', this.getCurrentPageData());
    }
    
    /**
     * 페이지 네비게이션 정보 가져오기
     */
    getNavigationInfo() {
        const maxVisiblePages = 5;
        const halfVisible = Math.floor(maxVisiblePages / 2);
        
        let startPage = Math.max(1, this.currentPage - halfVisible);
        let endPage = Math.min(this.totalPages, startPage + maxVisiblePages - 1);
        
        // 끝 페이지 기준으로 시작 페이지 재조정
        if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }
        
        const pages = [];
        for (let i = startPage; i <= endPage; i++) {
            pages.push({
                number: i,
                isCurrent: i === this.currentPage,
                isClickable: i !== this.currentPage
            });
        }
        
        return {
            pages,
            showFirstLast: this.totalPages > maxVisiblePages,
            showPrevNext: this.totalPages > 1,
            hasNext: this.currentPage < this.totalPages,
            hasPrev: this.currentPage > 1,
            currentPage: this.currentPage,
            totalPages: this.totalPages,
            totalItems: this.totalItems,
            pageSize: this.pageSize,
            startItem: (this.currentPage - 1) * this.pageSize + 1,
            endItem: Math.min(this.currentPage * this.pageSize, this.totalItems)
        };
    }
    
    /**
     * 검색 결과에 맞게 페이징 리셋
     */
    resetForNewData(data) {
        this.currentPage = 1;
        return this.setData(data);
    }
    
    /**
     * 현재 상태 정보
     */
    getState() {
        return {
            currentPage: this.currentPage,
            pageSize: this.pageSize,
            totalItems: this.totalItems,
            totalPages: this.totalPages,
            pageSizeOptions: this.pageSizeOptions
        };
    }
    
    /**
     * 이벤트 리스너 등록
     */
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }
    
    /**
     * 이벤트 발생
     */
    emit(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`PaginationManager: Error in event listener for ${event}:`, error);
                }
            });
        }
    }
    
    /**
     * 페이징 통계
     */
    getStats() {
        return {
            currentPage: this.currentPage,
            totalPages: this.totalPages,
            totalItems: this.totalItems,
            pageSize: this.pageSize,
            itemsOnCurrentPage: this.getCurrentPageData().data.length,
            percentageComplete: ((this.currentPage / this.totalPages) * 100).toFixed(1)
        };
    }
}

// export default PaginationManager; // ES6 모듈 제거 - 브라우저 호환성