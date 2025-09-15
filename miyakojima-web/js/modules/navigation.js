// 미야코지마 웹 플랫폼 - 네비게이션 모듈
// Miyakojima Web Platform - Navigation Module

/**
 * 네비게이션 관리 클래스
 * 섹션 전환, URL 해시 관리, 히스토리 관리
 */
class NavigationManager {
    constructor() {
        this.currentSection = 'dashboard';
        this.sectionHistory = [];
        this.maxHistorySize = 10;
        this.isInitialized = false;

        this.sections = {
            dashboard: { title: '대시보드', icon: 'dashboard' },
            budget: { title: '예산 관리', icon: 'dollar-sign' },
            itinerary: { title: '일정 관리', icon: 'calendar' },
            poi: { title: '장소 탐색', icon: 'map-pin' }
        };
    }

    /**
     * 네비게이션 모듈 초기화
     */
    async init() {
        Logger.info('Navigation 모듈 초기화 시작...');

        try {
            // URL 해시에서 초기 섹션 설정
            this.initializeFromHash();

            // 이벤트 리스너 설정
            this.setupEventListeners();

            // 초기 섹션 활성화
            this.navigateToSection(this.currentSection, false);

            this.isInitialized = true;
            Logger.info('Navigation 모듈 초기화 완료');

        } catch (error) {
            Logger.error('Navigation 모듈 초기화 실패:', error);
            throw error;
        }
    }

    /**
     * URL 해시에서 초기 섹션 설정
     */
    initializeFromHash() {
        const hash = window.location.hash.slice(1);

        if (hash && this.isValidSection(hash)) {
            this.currentSection = hash;
            Logger.info(`URL 해시에서 섹션 설정: ${hash}`);
        } else {
            Logger.info(`기본 섹션 사용: ${this.currentSection}`);
        }
    }

    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        // 네비게이션 버튼 클릭 이벤트
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const section = e.currentTarget.dataset.section;
                if (section) {
                    this.navigateToSection(section);
                }
            });
        });

        // 브라우저 뒤로가기/앞으로가기 이벤트
        window.addEventListener('popstate', (e) => {
            if (e.state && e.state.section) {
                this.navigateToSection(e.state.section, false);
            } else {
                this.initializeFromHash();
                this.navigateToSection(this.currentSection, false);
            }
        });

        // 키보드 단축키 (선택사항)
        document.addEventListener('keydown', (e) => {
            if (e.altKey || e.ctrlKey) {
                this.handleKeyboardShortcut(e);
            }
        });
    }

    /**
     * 섹션으로 이동
     * @param {string} sectionName - 이동할 섹션명
     * @param {boolean} updateHistory - 히스토리 업데이트 여부 (기본: true)
     */
    navigateToSection(sectionName, updateHistory = true) {
        if (!this.isValidSection(sectionName)) {
            Logger.warn(`유효하지 않은 섹션: ${sectionName}`);
            return false;
        }

        // 현재 섹션과 동일한 경우 스킵
        if (sectionName === this.currentSection && updateHistory) {
            Logger.info(`이미 현재 섹션입니다: ${sectionName}`);
            return true;
        }

        Logger.info(`섹션 이동: ${this.currentSection} → ${sectionName}`);

        try {
            // 이전 섹션 비활성화
            this.deactivateSection(this.currentSection);

            // 새 섹션 활성화
            this.activateSection(sectionName);

            // 히스토리 관리
            if (updateHistory) {
                this.updateHistory(sectionName);
            }

            // 현재 섹션 업데이트
            const previousSection = this.currentSection;
            this.currentSection = sectionName;

            // URL 해시 업데이트
            if (updateHistory) {
                this.updateUrlHash(sectionName);
            }

            // 섹션 변경 이벤트 발생
            this.dispatchSectionChangeEvent(sectionName, previousSection);

            // 섹션별 특별 처리
            this.handleSectionSpecificActions(sectionName);

            return true;

        } catch (error) {
            Logger.error(`섹션 이동 실패: ${sectionName}`, error);
            return false;
        }
    }

    /**
     * 섹션 활성화
     */
    activateSection(sectionName) {
        // 섹션 컨테이너 활성화
        const sectionElement = document.getElementById(`${sectionName}-section`);
        if (sectionElement) {
            sectionElement.classList.add('active');
            sectionElement.style.display = 'block';
        } else {
            Logger.warn(`섹션 요소를 찾을 수 없음: ${sectionName}-section`);
        }

        // 네비게이션 버튼 활성화
        const navButton = document.querySelector(`[data-section="${sectionName}"]`);
        if (navButton) {
            navButton.classList.add('active');
            navButton.setAttribute('aria-selected', 'true');
        }

        // 접근성: 포커스 관리
        this.manageFocus(sectionElement);

        Logger.info(`섹션 활성화 완료: ${sectionName}`);
    }

    /**
     * 섹션 비활성화
     */
    deactivateSection(sectionName) {
        // 섹션 컨테이너 비활성화
        const sectionElement = document.getElementById(`${sectionName}-section`);
        if (sectionElement) {
            sectionElement.classList.remove('active');
            sectionElement.style.display = 'none';
        }

        // 네비게이션 버튼 비활성화
        const navButton = document.querySelector(`[data-section="${sectionName}"]`);
        if (navButton) {
            navButton.classList.remove('active');
            navButton.setAttribute('aria-selected', 'false');
        }

        Logger.info(`섹션 비활성화 완료: ${sectionName}`);
    }

    /**
     * 유효한 섹션인지 확인
     */
    isValidSection(sectionName) {
        return Object.keys(this.sections).includes(sectionName);
    }

    /**
     * 히스토리 업데이트
     */
    updateHistory(sectionName) {
        // 히스토리에 추가
        this.sectionHistory.push({
            section: sectionName,
            timestamp: Date.now()
        });

        // 히스토리 크기 제한
        if (this.sectionHistory.length > this.maxHistorySize) {
            this.sectionHistory.shift();
        }

        // 브라우저 히스토리 업데이트
        const state = {
            section: sectionName,
            timestamp: Date.now()
        };

        const url = `${window.location.pathname}${window.location.search}#${sectionName}`;
        window.history.pushState(state, this.sections[sectionName].title, url);
    }

    /**
     * URL 해시 업데이트
     */
    updateUrlHash(sectionName) {
        window.location.hash = sectionName;
    }

    /**
     * 포커스 관리 (접근성)
     */
    manageFocus(sectionElement) {
        if (sectionElement) {
            // 섹션의 첫 번째 포커스 가능한 요소에 포커스
            const focusableElements = sectionElement.querySelectorAll(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );

            if (focusableElements.length > 0) {
                focusableElements[0].focus();
            } else {
                // 포커스 가능한 요소가 없으면 섹션 자체에 포커스
                sectionElement.setAttribute('tabindex', '-1');
                sectionElement.focus();
            }
        }
    }

    /**
     * 섹션 변경 이벤트 발생
     */
    dispatchSectionChangeEvent(newSection, previousSection) {
        const event = new CustomEvent('sectionChange', {
            detail: {
                newSection,
                previousSection,
                timestamp: Date.now()
            }
        });

        window.dispatchEvent(event);
        Logger.info(`섹션 변경 이벤트 발생: ${previousSection} → ${newSection}`);
    }

    /**
     * 섹션별 특별 처리
     */
    handleSectionSpecificActions(sectionName) {
        switch (sectionName) {
            case 'dashboard':
                // 대시보드 데이터 새로고침
                this.refreshDashboardData();
                break;

            case 'budget':
                // 예산 차트 업데이트
                this.updateBudgetChart();
                break;

            case 'itinerary':
                // 일정 타임라인 업데이트
                this.updateItineraryTimeline();
                break;

            case 'poi':
                // POI 지도 초기화
                this.initializePOIMap();
                break;
        }
    }

    /**
     * 키보드 단축키 처리
     */
    handleKeyboardShortcut(e) {
        const shortcuts = {
            '1': 'dashboard',
            '2': 'budget',
            '3': 'itinerary',
            '4': 'poi'
        };

        if (shortcuts[e.key]) {
            e.preventDefault();
            this.navigateToSection(shortcuts[e.key]);
        }
    }

    /**
     * 이전 섹션으로 이동
     */
    goBack() {
        if (this.sectionHistory.length > 1) {
            // 현재 섹션 제거
            this.sectionHistory.pop();

            // 이전 섹션으로 이동
            const previousEntry = this.sectionHistory[this.sectionHistory.length - 1];
            this.navigateToSection(previousEntry.section, false);

            return true;
        }

        return false;
    }

    /**
     * 섹션별 특별 처리 메서드들
     */
    refreshDashboardData() {
        // 대시보드 모듈에 새로고침 요청
        if (window.dynamicDashboard && typeof window.dynamicDashboard.refresh === 'function') {
            window.dynamicDashboard.refresh();
        }
    }

    updateBudgetChart() {
        // 예산 모듈에 차트 업데이트 요청
        if (window.budgetTracker && typeof window.budgetTracker.refreshChart === 'function') {
            window.budgetTracker.refreshChart();
        }
    }

    updateItineraryTimeline() {
        // 일정 모듈에 타임라인 업데이트 요청
        if (window.itinerary && typeof window.itinerary.refreshTimeline === 'function') {
            window.itinerary.refreshTimeline();
        }
    }

    initializePOIMap() {
        // POI 모듈에 지도 초기화 요청
        if (window.poiManager && typeof window.poiManager.initializeMap === 'function') {
            window.poiManager.initializeMap();
        }
    }

    /**
     * 현재 섹션 정보 반환
     */
    getCurrentSection() {
        return {
            name: this.currentSection,
            title: this.sections[this.currentSection]?.title,
            history: this.sectionHistory.slice()
        };
    }

    /**
     * 네비게이션 상태 초기화
     */
    reset() {
        this.currentSection = 'dashboard';
        this.sectionHistory = [];
        this.navigateToSection('dashboard');
        Logger.info('네비게이션 상태 초기화 완료');
    }
}

// 전역 네비게이션 매니저 인스턴스 생성
const navigationManager = new NavigationManager();

// 모듈 상태 관리
window.NavigationStatus = {
    isReady: false,
    manager: navigationManager,

    init: async () => {
        console.log('🧭 NAVIGATION 초기화 시작!');

        try {
            await navigationManager.init();
            window.NavigationStatus.isReady = true;

            console.log('✅ NAVIGATION 초기화 성공!');

            // 모듈 초기화 완료 이벤트 발생
            window.dispatchEvent(new CustomEvent('moduleReady', {
                detail: { moduleName: 'navigation' }
            }));

        } catch (error) {
            console.error('❌ NAVIGATION 초기화 실패:', error);
            throw error;
        }
    }
};

// 전역 객체로 노출
window.navigationManager = navigationManager;

// ES6 모듈 지원
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NavigationManager, navigationManager };
}