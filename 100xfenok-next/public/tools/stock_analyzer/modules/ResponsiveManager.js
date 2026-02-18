/**
 * ResponsiveManager - 반응형 디자인 및 크로스 디바이스 최적화
 */

class ResponsiveManager {
    constructor() {
        this.currentDevice = 'desktop';
        this.breakpoints = {
            mobile: 768,
            tablet: 1024,
            desktop: 1440
        };
        this.isInitialized = false;
        
        console.log('📱 ResponsiveManager 초기화');
    }

    /**
     * 반응형 시스템 초기화
     */
    initialize() {
        this.detectDevice();
        this.setupEventListeners();
        this.applyDeviceOptimizations();
        this.setupTouchGestures();
        this.setupKeyboardShortcuts();
        
        this.isInitialized = true;
        console.log(`✅ 반응형 시스템 초기화 완료 - 현재 디바이스: ${this.currentDevice}`);
    }

    /**
     * 디바이스 타입 감지
     */
    detectDevice() {
        const width = window.innerWidth;
        const oldDevice = this.currentDevice;
        
        if (width < this.breakpoints.mobile) {
            this.currentDevice = 'mobile';
        } else if (width < this.breakpoints.tablet) {
            this.currentDevice = 'tablet';
        } else {
            this.currentDevice = 'desktop';
        }

        if (oldDevice !== this.currentDevice && this.isInitialized) {
            console.log(`📱 디바이스 변경: ${oldDevice} → ${this.currentDevice}`);
            this.handleDeviceChange();
        }
    }

    /**
     * 터치 제스처 설정
     */
    setupTouchGestures() {
        // AdvancedChartManager의 터치 제스처 설정
        if (window.advancedChartManager) {
            window.advancedChartManager.setupTouchGestures();
        }
    }

    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        let resizeTimeout;
        
        // 화면 크기 변경 감지
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.detectDevice();
                this.applyDeviceOptimizations();
            }, 250);
        });

        // 화면 회전 감지
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                this.detectDevice();
                this.handleOrientationChange();
            }, 500);
        });

        // 터치 시작 감지
        document.addEventListener('touchstart', () => {
            document.body.classList.add('touch-device');
        }, { once: true });
    }

    /**
     * 디바이스별 최적화 적용
     */
    applyDeviceOptimizations() {
        document.body.className = document.body.className.replace(/device-\w+/g, '');
        document.body.classList.add(`device-${this.currentDevice}`);

        switch (this.currentDevice) {
            case 'mobile':
                this.applyMobileOptimizations();
                break;
            case 'tablet':
                this.applyTabletOptimizations();
                break;
            case 'desktop':
                this.applyDesktopOptimizations();
                break;
        }
    }

    /**
     * 모바일 최적화 적용
     */
    applyMobileOptimizations() {
        console.log('📱 모바일 최적화 적용');

        // 모바일 전용 CSS 클래스 추가
        document.body.classList.add('mobile-optimized');

        // 터치 친화적 버튼 크기 적용
        this.optimizeButtonSizes();

        // 모바일 네비게이션 설정
        this.setupMobileNavigation();

        // 카드 뷰 우선 표시
        this.prioritizeCardView();

        // 스와이프 제스처 활성화
        this.enableSwipeGestures();

        // 모바일 전용 UI 조정
        this.adjustMobileUI();
    }

    /**
     * 터치 친화적 버튼 크기 최적화
     */
    optimizeButtonSizes() {
        const style = document.createElement('style');
        style.id = 'mobile-button-optimization';
        style.textContent = `
            @media (max-width: 768px) {
                button, .btn, .tab-button {
                    min-height: 44px !important;
                    min-width: 44px !important;
                    padding: 12px 16px !important;
                    font-size: 16px !important;
                }
                
                .filter-preset-btn {
                    min-height: 40px !important;
                    padding: 8px 12px !important;
                    font-size: 14px !important;
                }
                
                input, select {
                    min-height: 44px !important;
                    font-size: 16px !important;
                    padding: 12px !important;
                }
            }
        `;
        
        // 기존 스타일 제거 후 추가
        const existing = document.getElementById('mobile-button-optimization');
        if (existing) existing.remove();
        document.head.appendChild(style);
    }

    /**
     * 모바일 네비게이션 설정
     */
    setupMobileNavigation() {
        // 햄버거 메뉴 생성
        this.createHamburgerMenu();
        
        // 탭 네비게이션 모바일 최적화
        this.optimizeTabNavigation();
    }

    /**
     * 햄버거 메뉴 생성
     */
    createHamburgerMenu() {
        if (document.getElementById('mobile-hamburger')) return;

        const hamburger = document.createElement('div');
        hamburger.id = 'mobile-hamburger';
        hamburger.className = 'fixed top-4 right-4 z-50 bg-white rounded-lg shadow-lg p-3 cursor-pointer md:hidden';
        hamburger.innerHTML = `
            <div class="hamburger-lines">
                <span class="block w-6 h-0.5 bg-gray-600 mb-1 transition-all"></span>
                <span class="block w-6 h-0.5 bg-gray-600 mb-1 transition-all"></span>
                <span class="block w-6 h-0.5 bg-gray-600 transition-all"></span>
            </div>
        `;

        // 모바일 메뉴 패널
        const mobileMenu = document.createElement('div');
        mobileMenu.id = 'mobile-menu-panel';
        mobileMenu.className = 'fixed top-0 right-0 w-80 h-full bg-white shadow-xl transform translate-x-full transition-transform z-40 md:hidden';
        mobileMenu.innerHTML = `
            <div class="p-6">
                <h3 class="text-lg font-bold mb-4">메뉴</h3>
                <div class="space-y-3">
                    <button class="mobile-menu-item w-full text-left p-3 rounded hover:bg-gray-100" data-tab="screener">
                        <i class="fas fa-filter mr-3"></i>스크리닝
                    </button>
                    <button class="mobile-menu-item w-full text-left p-3 rounded hover:bg-gray-100" data-tab="dashboard">
                        <i class="fas fa-chart-line mr-3"></i>대시보드
                    </button>
                    <button class="mobile-menu-item w-full text-left p-3 rounded hover:bg-gray-100" data-tab="portfolio">
                        <i class="fas fa-briefcase mr-3"></i>포트폴리오
                    </button>
                </div>
                
                <div class="mt-6 pt-6 border-t">
                    <h4 class="font-bold mb-3">빠른 필터</h4>
                    <div class="space-y-2">
                        <button class="w-full text-left p-2 text-sm rounded hover:bg-gray-100" onclick="window.advancedFilterManager?.applyFilterPreset('nasdaq-tech')">
                            📱 나스닥 기술주
                        </button>
                        <button class="w-full text-left p-2 text-sm rounded hover:bg-gray-100" onclick="window.advancedFilterManager?.applyFilterPreset('value-stocks')">
                            💎 저PER 가치주
                        </button>
                        <button class="w-full text-left p-2 text-sm rounded hover:bg-gray-100" onclick="window.advancedFilterManager?.applyFilterPreset('dividend-stocks')">
                            💰 고배당 주식
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(hamburger);
        document.body.appendChild(mobileMenu);

        // 이벤트 리스너
        hamburger.addEventListener('click', () => {
            const panel = document.getElementById('mobile-menu-panel');
            const isOpen = !panel.classList.contains('translate-x-full');
            
            if (isOpen) {
                panel.classList.add('translate-x-full');
                hamburger.classList.remove('active');
            } else {
                panel.classList.remove('translate-x-full');
                hamburger.classList.add('active');
            }
        });

        // 메뉴 아이템 클릭
        mobileMenu.querySelectorAll('.mobile-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const tab = item.dataset.tab;
                if (window.dashboardManager) {
                    window.dashboardManager.switchTab(tab);
                }
                // 메뉴 닫기
                document.getElementById('mobile-menu-panel').classList.add('translate-x-full');
                hamburger.classList.remove('active');
            });
        });

        // 외부 클릭 시 메뉴 닫기
        document.addEventListener('click', (e) => {
            if (!hamburger.contains(e.target) && !mobileMenu.contains(e.target)) {
                mobileMenu.classList.add('translate-x-full');
                hamburger.classList.remove('active');
            }
        });
    }

    /**
     * 탭 네비게이션 모바일 최적화
     */
    optimizeTabNavigation() {
        const tabContainer = document.querySelector('nav');
        if (tabContainer && this.currentDevice === 'mobile') {
            tabContainer.classList.add('hidden');
        } else if (tabContainer) {
            tabContainer.classList.remove('hidden');
        }
    }

    /**
     * 카드 뷰 우선 표시
     */
    prioritizeCardView() {
        if (this.currentDevice === 'mobile' && window.cardViewManager) {
            // 모바일에서는 카드 뷰를 기본으로 설정
            const cardViewBtn = document.getElementById('card-view-btn');
            const tableViewBtn = document.getElementById('table-view-btn');
            
            if (cardViewBtn && !cardViewBtn.classList.contains('bg-white')) {
                cardViewBtn.click();
            }
        }
    }

    /**
     * 스와이프 제스처 활성화
     */
    enableSwipeGestures() {
        if (this.currentDevice !== 'mobile') return;

        let startX, startY, startTime;
        const threshold = 50; // 최소 스와이프 거리
        const maxTime = 300; // 최대 스와이프 시간

        document.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            startTime = Date.now();
        });

        document.addEventListener('touchend', (e) => {
            if (!startX || !startY) return;

            const touch = e.changedTouches[0];
            const endX = touch.clientX;
            const endY = touch.clientY;
            const endTime = Date.now();

            const deltaX = endX - startX;
            const deltaY = endY - startY;
            const deltaTime = endTime - startTime;

            // 가로 스와이프만 처리 (세로 스크롤 방해 방지)
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold && deltaTime < maxTime) {
                if (deltaX > 0) {
                    this.handleSwipeRight();
                } else {
                    this.handleSwipeLeft();
                }
            }

            startX = startY = null;
        });
    }

    /**
     * 오른쪽 스와이프 처리 (이전 탭)
     */
    handleSwipeRight() {
        console.log('👉 오른쪽 스와이프 - 이전 탭');
        if (window.dashboardManager) {
            const currentTab = window.dashboardManager.getCurrentTab();
            const tabs = ['screener', 'dashboard', 'portfolio'];
            const currentIndex = tabs.indexOf(currentTab);
            const prevIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
            window.dashboardManager.switchTab(tabs[prevIndex]);
        }
    }

    /**
     * 왼쪽 스와이프 처리 (다음 탭)
     */
    handleSwipeLeft() {
        console.log('👈 왼쪽 스와이프 - 다음 탭');
        if (window.dashboardManager) {
            const currentTab = window.dashboardManager.getCurrentTab();
            const tabs = ['screener', 'dashboard', 'portfolio'];
            const currentIndex = tabs.indexOf(currentTab);
            const nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
            window.dashboardManager.switchTab(tabs[nextIndex]);
        }
    }

    /**
     * 모바일 UI 조정
     */
    adjustMobileUI() {
        // 검색창 최적화
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.placeholder = '검색...';
        }

        // 필터 패널 모바일 최적화
        this.optimizeFilterPanel();

        // 테이블 스크롤 개선
        this.optimizeTableScroll();
    }

    /**
     * 필터 패널 모바일 최적화
     */
    optimizeFilterPanel() {
        const filterPanel = document.getElementById('screener-panel');
        if (filterPanel && this.currentDevice === 'mobile') {
            // 모바일에서는 필터 패널을 접을 수 있게 만들기
            const header = filterPanel.querySelector('h2');
            if (header && !header.classList.contains('mobile-collapsible')) {
                header.classList.add('mobile-collapsible', 'cursor-pointer');
                header.innerHTML += ' <i class="fas fa-chevron-down ml-2 transition-transform"></i>';
                
                header.addEventListener('click', () => {
                    const content = filterPanel.querySelector('.grid');
                    const icon = header.querySelector('.fa-chevron-down');
                    
                    if (content.classList.contains('hidden')) {
                        content.classList.remove('hidden');
                        icon.style.transform = 'rotate(0deg)';
                    } else {
                        content.classList.add('hidden');
                        icon.style.transform = 'rotate(-90deg)';
                    }
                });
            }
        }
    }

    /**
     * 테이블 스크롤 개선
     */
    optimizeTableScroll() {
        const tableContainer = document.getElementById('results-table');
        if (tableContainer && this.currentDevice === 'mobile') {
            // 모바일에서 테이블 스크롤 개선
            tableContainer.style.overflowX = 'auto';
            tableContainer.style.webkitOverflowScrolling = 'touch';
            
            // 스크롤 인디케이터 추가
            if (!document.getElementById('mobile-scroll-indicator')) {
                const indicator = document.createElement('div');
                indicator.id = 'mobile-scroll-indicator';
                indicator.className = 'text-xs text-gray-500 text-center mt-2 md:hidden';
                indicator.textContent = '← 좌우로 스크롤하여 더 많은 정보를 확인하세요 →';
                tableContainer.parentNode.appendChild(indicator);
            }
        }
    }

    /**
     * 태블릿 최적화 적용
     */
    applyTabletOptimizations() {
        console.log('📱 태블릿 최적화 적용');
        
        document.body.classList.add('tablet-optimized');
        document.body.classList.remove('mobile-optimized', 'desktop-optimized');

        // 하이브리드 인터랙션 설정
        this.setupHybridInteraction();

        // 분할 화면 레이아웃
        this.setupSplitScreenLayout();
    }

    /**
     * 하이브리드 인터랙션 설정 (터치 + 마우스)
     */
    setupHybridInteraction() {
        // 터치와 마우스 이벤트 모두 지원
        document.body.classList.add('hybrid-interaction');
        
        // 드래그 앤 드롭 강화
        this.enhanceDragAndDrop();
    }

    /**
     * 분할 화면 레이아웃
     */
    setupSplitScreenLayout() {
        if (this.currentDevice === 'tablet') {
            const style = document.createElement('style');
            style.id = 'tablet-split-layout';
            style.textContent = `
                @media (min-width: 768px) and (max-width: 1024px) {
                    .tablet-split {
                        display: grid;
                        grid-template-columns: 300px 1fr;
                        gap: 1rem;
                    }
                    
                    #screener-panel {
                        position: sticky;
                        top: 0;
                        height: fit-content;
                        max-height: 100vh;
                        overflow-y: auto;
                    }
                }
            `;
            
            const existing = document.getElementById('tablet-split-layout');
            if (existing) existing.remove();
            document.head.appendChild(style);
        }
    }

    /**
     * 드래그 앤 드롭 강화
     */
    enhanceDragAndDrop() {
        // 태블릿에서 드래그 앤 드롭 개선
        document.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
        });
    }

    /**
     * 데스크톱 최적화 적용
     */
    applyDesktopOptimizations() {
        console.log('🖥️ 데스크톱 최적화 적용');
        
        document.body.classList.add('desktop-optimized');
        document.body.classList.remove('mobile-optimized', 'tablet-optimized');

        // 키보드 단축키 활성화
        this.enableKeyboardShortcuts();

        // 멀티 윈도우 모달 지원
        this.enableMultiWindowModals();

        // 마우스 호버 효과 활성화
        this.enableHoverEffects();
    }

    /**
     * 키보드 단축키 설정
     */
    setupKeyboardShortcuts() {
        if (this.currentDevice !== 'desktop') return;

        document.addEventListener('keydown', (e) => {
            // Ctrl+F: 검색 포커스
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                const searchInput = document.getElementById('search-input');
                if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                }
            }

            // 화살표 키: 테이블 네비게이션
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                this.handleTableNavigation(e);
            }

            // 숫자 키: 탭 전환
            if (e.key >= '1' && e.key <= '3' && e.altKey) {
                e.preventDefault();
                const tabs = ['screener', 'dashboard', 'portfolio'];
                const tabIndex = parseInt(e.key) - 1;
                if (window.dashboardManager && tabs[tabIndex]) {
                    window.dashboardManager.switchTab(tabs[tabIndex]);
                }
            }
        });
    }

    /**
     * 키보드 단축키 활성화
     */
    enableKeyboardShortcuts() {
        // 이미 setupKeyboardShortcuts에서 처리됨
        console.log('⌨️ 키보드 단축키 활성화');
    }

    /**
     * 테이블 네비게이션 처리
     */
    handleTableNavigation(e) {
        const table = document.querySelector('table');
        if (!table) return;

        const focusedElement = document.activeElement;
        if (focusedElement.tagName === 'TD' || focusedElement.tagName === 'TH') {
            e.preventDefault();
            // 테이블 셀 간 이동 로직
            const cells = Array.from(table.querySelectorAll('td, th'));
            const currentIndex = cells.indexOf(focusedElement);
            
            if (e.key === 'ArrowLeft' && currentIndex > 0) {
                cells[currentIndex - 1].focus();
            } else if (e.key === 'ArrowRight' && currentIndex < cells.length - 1) {
                cells[currentIndex + 1].focus();
            }
        }
    }

    /**
     * 멀티 윈도우 모달 지원
     */
    enableMultiWindowModals() {
        // 여러 기업 동시 분석을 위한 멀티 모달 지원
        this.modalStack = [];
        console.log('🪟 멀티 윈도우 모달 지원 활성화');
    }

    /**
     * 마우스 호버 효과 활성화
     */
    enableHoverEffects() {
        document.body.classList.add('hover-enabled');
        console.log('🖱️ 마우스 호버 효과 활성화');
    }

    /**
     * 디바이스 변경 처리
     */
    handleDeviceChange() {
        this.applyDeviceOptimizations();
        
        // 차트 매니저에 디바이스 변경 알림
        if (window.advancedChartManager) {
            window.advancedChartManager.handleDeviceChange();
        }
    }

    /**
     * 화면 회전 처리
     */
    handleOrientationChange() {
        console.log('🔄 화면 회전 감지');
        
        // 차트 리사이즈
        if (window.advancedChartManager) {
            window.advancedChartManager.resizeAllCharts();
        }

        // 레이아웃 재조정
        setTimeout(() => {
            this.applyDeviceOptimizations();
        }, 100);
    }

    /**
     * 현재 디바이스 타입 반환
     */
    getCurrentDevice() {
        return this.currentDevice;
    }

    /**
     * 디바이스별 설정 반환
     */
    getDeviceConfig() {
        const configs = {
            mobile: {
                maxTableColumns: 5,
                defaultView: 'card',
                enableSwipe: true,
                showHamburger: true
            },
            tablet: {
                maxTableColumns: 8,
                defaultView: 'table',
                enableSwipe: false,
                showHamburger: false
            },
            desktop: {
                maxTableColumns: 15,
                defaultView: 'table',
                enableSwipe: false,
                showHamburger: false
            }
        };

        return configs[this.currentDevice] || configs.desktop;
    }
}

// 전역 인스턴스 생성
window.responsiveManager = new ResponsiveManager();

console.log('✅ ResponsiveManager 로드 완료 - 반응형 크로스 디바이스 시스템');