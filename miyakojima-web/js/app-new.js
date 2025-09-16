// js/app-new.js
import { Logger, DOMUtils } from './utils.js';
import { poiManager } from './modules/poi.js';
import { budgetManager } from './modules/budget.js';
import { itineraryManager } from './modules/itinerary.js';
import { diningManager } from './modules/dining.js';
import { weatherWidget } from './modules/weather-widget.js';
import { GoogleMapsManager } from './maps.js';
import { locationService } from './services/location.js';
import { locationUI } from './modules/location-ui.js';

export class App {
    constructor() {
        this.isInitialized = false;
        this.modules = new Map();
        this.currentSection = 'dashboard';
        this.retryAttempts = 0;
        this.maxRetries = 3;
        this.googleMapsManager = null;
    }

    // initialize 메서드 추가 - start와 동일한 기능
    async initialize() {
        return await this.start();
    }

    async start() {
        try {
            console.log('🚀 앱 시작...');

            // 기본 UI 초기화
            await this.initializeUI();

            // 모듈들 로딩 (더 안전한 방식)
            await this.loadModulesSafely();

            this.isInitialized = true;
            console.log('✅ 앱 시작 완료');

            // 기본 대시보드 표시
            this.showSection('dashboard');

        } catch (error) {
            console.error('❌ 앱 시작 실패:', error);

            // 재시도 로직
            if (this.retryAttempts < this.maxRetries) {
                this.retryAttempts++;
                console.log(`🔄 앱 시작 재시도 (${this.retryAttempts}/${this.maxRetries})`);
                setTimeout(() => this.start(), 2000);
                return;
            }

            this.showErrorMessage(`앱을 시작할 수 없습니다: ${error.message}`);
        }
    }

    async loadModulesSafely() {
        try {
            console.log('🔄 모듈 로딩 시작...');

            // 모든 모듈을 개별적으로 초기화 (실패해도 계속 진행)
            const modulePromises = [
                this.initializePOIManager().catch(err => ({ error: 'poi', reason: err })),
                this.initializeBudgetManager().catch(err => ({ error: 'budget', reason: err })),
                this.initializeItineraryManager().catch(err => ({ error: 'itinerary', reason: err })),
                this.initializeDiningManager().catch(err => ({ error: 'dining', reason: err })),
                this.initializeWeatherWidget().catch(err => ({ error: 'weather', reason: err })),
                this.initializeGoogleMapsManager().catch(err => ({ error: 'maps', reason: err })),
                this.initializeLocationService().catch(err => ({ error: 'location', reason: err }))
            ];

            const results = await Promise.allSettled(modulePromises);

            // 실패한 모듈들 로깅
            results.forEach((result, index) => {
                if (result.status === 'rejected' || (result.value && result.value.error)) {
                    const moduleName = ['POI', 'Budget', 'Itinerary', 'Dining', 'Weather', 'Maps', 'Location'][index];
                    console.warn(`⚠️ ${moduleName} 모듈 초기화 실패:`, result.reason || result.value.reason);
                }
            });

            // 최소 1개 모듈이라도 성공했는지 확인
            const successCount = results.filter(result =>
                result.status === 'fulfilled' && (!result.value || !result.value.error)
            ).length;

            if (successCount === 0) {
                throw new Error('모든 모듈 초기화가 실패했습니다.');
            }

            console.log(`✅ 모듈 로딩 완료 (성공: ${successCount}/${results.length})`);
        } catch (error) {
            console.error('❌ 모듈 로딩 실패:', error);
            throw error;
        }
    }

    async initializePOIManager() {
        try {
            await poiManager.initialize();
            this.modules.set('poi', poiManager);
            console.log('✅ POI 매니저 등록 완료');
        } catch (error) {
            console.error('POI 매니저 초기화 실패:', error);
            throw error;
        }
    }

    async initializeBudgetManager() {
        try {
            await budgetManager.initialize();
            this.modules.set('budget', budgetManager);
            console.log('✅ 예산 매니저 등록 완료');
        } catch (error) {
            console.error('예산 매니저 초기화 실패:', error);
            throw error;
        }
    }

    async initializeItineraryManager() {
        try {
            await itineraryManager.initialize();
            this.modules.set('itinerary', itineraryManager);
            console.log('✅ 일정 매니저 등록 완료');
        } catch (error) {
            console.error('일정 매니저 초기화 실패:', error);
            throw error;
        }
    }

    async initializeDiningManager() {
        try {
            await diningManager.initialize();
            this.modules.set('dining', diningManager);
            console.log('✅ 다이닝 매니저 등록 완료');
        } catch (error) {
            console.error('다이닝 매니저 초기화 실패:', error);
            throw error;
        }
    }

    async initializeWeatherWidget() {
        try {
            await weatherWidget.initialize();
            this.modules.set('weather', weatherWidget);
            console.log('✅ 날씨 위젯 등록 완료');
        } catch (error) {
            console.error('날씨 위젯 초기화 실패:', error);
            throw error;
        }
    }

    async initializeGoogleMapsManager() {
        try {
            const googleMapsManager = new GoogleMapsManager();
            await googleMapsManager.initialize();
            this.modules.set('maps', googleMapsManager);
            console.log('✅ 구글맵 매니저 등록 완료');
        } catch (error) {
            console.error('구글맵 매니저 초기화 실패:', error);
            throw error;
        }
    }

    async initializeLocationService() {
        try {
            // 위치 UI 초기화
            locationUI.initialize();
            window.locationUI = locationUI; // 전역에서 접근 가능하도록

            // 위치 서비스 시작
            locationService.startTracking();
            this.modules.set('location', locationService);
            console.log('✅ 위치 추적 서비스 등록 완료');

            // 위치 업데이트 구독
            locationService.subscribe((event, data) => {
                if (event === 'update') {
                    console.log('📍 현재 위치 업데이트:', data);
                    // POI 매니저에 위치 업데이트
                    if (this.modules.get('poi')) {
                        this.modules.get('poi').userLocation = data;
                    }
                    // UI 상태 업데이트
                    locationUI.updateStatusIndicator('active');
                } else if (event === 'error') {
                    locationUI.updateStatusIndicator('error');
                }
            });
        } catch (error) {
            console.error('위치 서비스 초기화 실패:', error);
            throw error;
        }
    }

    showSection(sectionName) {
        try {
            // 이전 섹션 비활성화
            const sections = document.querySelectorAll('.section');
            sections.forEach(section => {
                section.classList.remove('active');
            });

            // 새 섹션 활성화
            const targetSection = document.getElementById(`${sectionName}-section`);
            if (targetSection) {
                targetSection.classList.add('active');
                this.currentSection = sectionName;

                // 네비게이션 버튼 상태 업데이트
                this.updateNavigationStates(sectionName);

                // 섹션별 특별 처리
                this.handleSectionActivation(sectionName);
            } else {
                console.warn(`섹션을 찾을 수 없습니다: ${sectionName}-section`);
            }

            console.log(`📱 섹션 전환: ${sectionName}`);
        } catch (error) {
            console.error('섹션 전환 실패:', error);
        }
    }

    updateNavigationStates(activeSection) {
        try {
            const navButtons = document.querySelectorAll('.nav-btn');
            navButtons.forEach(btn => {
                const section = btn.dataset.section;
                btn.classList.toggle('active', section === activeSection);
            });
        } catch (error) {
            console.error('네비게이션 상태 업데이트 실패:', error);
        }
    }

    handleSectionActivation(sectionName) {
        try {
            // 섹션이 활성화될 때 필요한 추가 처리
            switch (sectionName) {
                case 'poi':
                    if (this.modules.get('poi')) {
                        // POI 섹션 특별 처리
                    }
                    break;
                case 'budget':
                    if (this.modules.get('budget')) {
                        // 예산 섹션 특별 처리
                    }
                    break;
                case 'itinerary':
                    if (this.modules.get('itinerary')) {
                        // 일정 섹션 특별 처리
                    }
                    break;
                case 'dining':
                    if (this.modules.get('dining')) {
                        // 다이닝 섹션 특별 처리
                    }
                    break;
                case 'dashboard':
                    this.renderDashboardStats();
                    break;
            }
        } catch (error) {
            console.error(`섹션 활성화 처리 실패 (${sectionName}):`, error);
        }
    }

    showDashboard() {
        this.showSection('dashboard');
        this.renderDashboardStats();
    }

    renderDashboardStats() {
        try {
            // 기본 통계 정보를 안전하게 렌더링
            const statsContainer = document.getElementById('dashboard-stats');
            if (!statsContainer) {
                // 대시보드 stats 컨테이너가 없다면 기본 정보만 업데이트
                this.updateBasicDashboardInfo();
                return;
            }

            const poiStats = this.modules.get('poi')?.getStats() || {};
            const budgetStats = this.modules.get('budget')?.getStats() || {};
            const itineraryStats = this.modules.get('itinerary')?.getStats() || {};
            const diningStats = this.modules.get('dining')?.getStats() || {};

            statsContainer.innerHTML = `
                <div class="stat-card">
                    <h3>관심 장소</h3>
                    <p class="stat-number">${poiStats.total || 0}</p>
                    <p class="stat-label">개의 POI</p>
                </div>

                <div class="stat-card">
                    <h3>예산 현황</h3>
                    <p class="stat-number">${this.formatCurrency(budgetStats.grandTotal || 0)}</p>
                    <p class="stat-label">총 지출</p>
                </div>

                <div class="stat-card">
                    <h3>여행 일정</h3>
                    <p class="stat-number">${itineraryStats.totalDays || 5}</p>
                    <p class="stat-label">일 일정</p>
                </div>

                <div class="stat-card">
                    <h3>레스토랑</h3>
                    <p class="stat-number">${diningStats.total || 0}</p>
                    <p class="stat-label">개 맛집</p>
                </div>
            `;

            // 빠른 액세스 링크 렌더링
            this.renderQuickActions();
        } catch (error) {
            console.error('대시보드 통계 렌더링 실패:', error);
            this.updateBasicDashboardInfo();
        }
    }

    updateBasicDashboardInfo() {
        try {
            // 기본 대시보드 정보만 업데이트
            const currentLocation = document.getElementById('current-location');
            if (currentLocation) {
                currentLocation.textContent = '미야코지마';
            }

            const locationDetail = document.getElementById('location-detail');
            if (locationDetail) {
                locationDetail.textContent = '여행 컴패니언 활성화됨';
            }

            const todaySpent = document.getElementById('today-spent');
            const todayRemaining = document.getElementById('today-remaining');
            if (todaySpent) todaySpent.textContent = '0 엔';
            if (todayRemaining) todayRemaining.textContent = '20,000 엔';

            const budgetProgress = document.getElementById('budget-progress');
            if (budgetProgress) {
                budgetProgress.style.width = '0%';
            }
        } catch (error) {
            console.error('기본 대시보드 정보 업데이트 실패:', error);
        }
    }

    renderQuickActions() {
        try {
            const actionsContainer = document.getElementById('quick-actions');
            if (!actionsContainer) return;

            const itineraryManager = this.modules.get('itinerary');
            const currentDay = itineraryManager?.currentDay || 'day1';
            const todaySchedule = itineraryManager?.getDaySchedule(currentDay);

            actionsContainer.innerHTML = `
                <div class="quick-action-card" onclick="app.showSection('poi')">
                    <h4>주변 장소</h4>
                    <p>근처 관광지 찾기</p>
                </div>

                <div class="quick-action-card" onclick="app.showSection('dining')">
                    <h4>맛집 찾기</h4>
                    <p>현지 레스토랑</p>
                </div>

                <div class="quick-action-card" onclick="app.showAddExpenseModal()">
                    <h4>지출 기록</h4>
                    <p>여행 경비 추가</p>
                </div>

                <div class="quick-action-card" onclick="app.showSection('itinerary')">
                    <h4>오늘 일정</h4>
                    <p>${todaySchedule ? todaySchedule.theme : '일정 확인'}</p>
                </div>
            `;
        } catch (error) {
            console.error('빠른 액션 렌더링 실패:', error);
        }
    }

    async initializeUI() {
        try {
            // 네비게이션 이벤트 리스너 설정
            const navButtons = document.querySelectorAll('.nav-btn');
            navButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const section = e.target.closest('.nav-btn')?.dataset.section;
                    if (section) {
                        this.showSection(section);
                    }
                });
            });

            console.log('✅ UI 초기화 완료');
        } catch (error) {
            console.error('UI 초기화 실패:', error);
            throw error;
        }
    }

    showAddExpenseModal() {
        const budgetManager = this.modules.get('budget');
        if (budgetManager) {
            this.showSection('budget');
        } else {
            console.warn('예산 매니저가 로드되지 않았습니다.');
            alert('예산 관리 기능을 사용할 수 없습니다.');
        }
    }

    showErrorMessage(message) {
        try {
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #f44336;
                color: white;
                padding: 20px;
                border-radius: 8px;
                z-index: 10000;
                text-align: center;
                max-width: 90%;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            `;
            errorDiv.innerHTML = `
                <h3>오류 발생</h3>
                <p>${message}</p>
                <button onclick="location.reload()" style="
                    margin-top: 10px;
                    padding: 8px 16px;
                    background: white;
                    color: #f44336;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                ">페이지 새로고침</button>
            `;
            document.body.appendChild(errorDiv);

            // 10초 후 자동 제거
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.parentNode.removeChild(errorDiv);
                }
            }, 10000);
        } catch (error) {
            console.error('오류 메시지 표시 실패:', error);
        }
    }

    formatCurrency(amount) {
        try {
            if (amount >= 1000000) {
                return `${(amount / 10000).toFixed(1)}만원`;
            } else if (amount >= 10000) {
                return `${(amount / 10000).toFixed(1)}만원`;
            } else {
                return `${amount.toLocaleString()}원`;
            }
        } catch (error) {
            return '0원';
        }
    }

    // 공용 메서드들
    getModule(moduleName) {
        return this.modules.get(moduleName);
    }

    getAllModuleStats() {
        const stats = {};
        this.modules.forEach((module, name) => {
            try {
                if (typeof module.getStats === 'function') {
                    stats[name] = module.getStats();
                }
            } catch (error) {
                console.error(`모듈 통계 조회 실패 (${name}):`, error);
                stats[name] = { error: true };
            }
        });
        return stats;
    }

    refreshAllModules() {
        return Promise.all(
            Array.from(this.modules.values())
                .filter(module => typeof module.initialize === 'function')
                .map(module => module.initialize().catch(err => console.error('모듈 새로고침 실패:', err)))
        );
    }

    // 디버그 메서드들
    debugInfo() {
        return {
            isInitialized: this.isInitialized,
            currentSection: this.currentSection,
            modules: Array.from(this.modules.keys()),
            stats: this.getAllModuleStats(),
            retryAttempts: this.retryAttempts
        };
    }
}