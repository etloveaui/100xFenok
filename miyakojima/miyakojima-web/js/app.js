// 미야코지마 웹 플랫폼 - 중앙 집중식 초기화 시스템
// Miyakojima Web Platform - Centralized Module Initialization System

/**
 * 모듈 초기화 관리자
 * 의존성 순서에 따른 단계적 모듈 로딩 및 초기화
 */
class ModuleInitializer {
    constructor() {
        this.modules = new Map();
        this.initializationOrder = [];
        this.loadedModules = new Set();
        this.initializationPromise = null;
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1초
        
        this.setupModuleDefinitions();
    }
    
    /**
     * 모듈 정의 및 의존성 설정
     */
    setupModuleDefinitions() {
        // Phase 1: 기본 설정 및 유틸리티 (의존성 없음)
        this.defineModule('config', {
            dependencies: [],
            checkReady: () => window.CONFIG && window.ConfigStatus?.isReady,
            initialize: () => {
                console.log('🔍 CONFIG 초기화 시도. ConfigStatus 존재:', !!window.ConfigStatus);
                if (window.ConfigStatus && window.ConfigStatus.init) {
                    return window.ConfigStatus.init();
                } else {
                    console.error('❌ ConfigStatus가 정의되지 않았음!');
                    throw new Error('ConfigStatus not found');
                }
            },
            timeout: 5000
        });
        
        this.defineModule('utils', {
            dependencies: ['config'],
            checkReady: () => window.Utils && window.ModuleStatus?.isReady,
            initialize: () => window.ModuleStatus?.init(),
            timeout: 5000
        });
        
        // Phase 2: 저장소 및 API (utils 의존)
        this.defineModule('storage', {
            dependencies: ['utils'],
            checkReady: () => window.storage && window.StorageStatus?.isReady,
            initialize: () => window.StorageStatus?.init(),
            timeout: 10000
        });
        
        this.defineModule('api', {
            dependencies: ['config', 'utils', 'storage'],
            checkReady: () => window.backendAPI && window.APIStatus?.isReady,
            initialize: () => window.APIStatus?.init(),
            timeout: 15000,
            optional: true // API는 선택적 모듈
        });
        
        // Phase 3: 비즈니스 로직 모듈 (storage, api 의존)
        this.defineModule('budget', {
            dependencies: ['utils', 'storage'],
            checkReady: () => window.BudgetTracker || window.BudgetStatus?.isReady,
            initialize: async () => {
                if (window.BudgetStatus) {
                    await window.BudgetStatus.init();
                }
            },
            timeout: 10000,
            optional: true
        });
        
        this.defineModule('location', {
            dependencies: ['config', 'utils'],
            checkReady: () => window.LocationTracker || window.LocationStatus?.isReady,
            initialize: async () => {
                if (window.LocationStatus) {
                    await window.LocationStatus.init();
                }
            },
            timeout: 15000,
            optional: true
        });
        
        this.defineModule('poi', {
            dependencies: ['config', 'utils', 'storage'],
            checkReady: () => window.poiManager && window.POIStatus?.isReady,
            initialize: () => window.POIStatus?.init(),
            timeout: 15000,
            optional: true
        });
        
        this.defineModule('itinerary', {
            dependencies: ['config', 'utils', 'storage'],
            checkReady: () => window.itinerary && window.ItineraryStatus?.isReady,
            initialize: () => window.ItineraryStatus?.init(),
            timeout: 10000,
            optional: true
        });
        
        // Phase 4: 메인 애플리케이션 (모든 모듈 의존)
        this.defineModule('app', {
            dependencies: ['config', 'utils', 'storage', 'budget', 'location', 'poi', 'itinerary'],
            checkReady: () => window.app && window.app.isInitialized,
            initialize: () => this.initializeMainApp(),
            timeout: 20000
        });
        
        // 초기화 순서 계산
        this.calculateInitializationOrder();
    }
    
    /**
     * 모듈 정의
     */
    defineModule(name, config) {
        this.modules.set(name, {
            name,
            dependencies: config.dependencies || [],
            checkReady: config.checkReady,
            initialize: config.initialize,
            timeout: config.timeout || 10000,
            optional: config.optional || false,
            status: 'pending', // pending, loading, ready, failed
            error: null,
            retryCount: 0
        });
    }
    
    /**
     * 의존성 기반 초기화 순서 계산 (Topological Sort)
     */
    calculateInitializationOrder() {
        const visited = new Set();
        const temp = new Set();
        const order = [];
        
        const visit = (moduleName) => {
            if (temp.has(moduleName)) {
                throw new Error(`Circular dependency detected involving ${moduleName}`);
            }
            if (visited.has(moduleName)) return;
            
            temp.add(moduleName);
            const module = this.modules.get(moduleName);
            
            if (module) {
                for (const dep of module.dependencies) {
                    if (this.modules.has(dep)) {
                        visit(dep);
                    }
                }
                visited.add(moduleName);
                order.push(moduleName);
            }
            
            temp.delete(moduleName);
        };
        
        for (const moduleName of this.modules.keys()) {
            visit(moduleName);
        }
        
        this.initializationOrder = order;
        Logger.info('모듈 초기화 순서 계산 완료:', this.initializationOrder);
    }
    
    /**
     * 모든 모듈 초기화 시작
     */
    async initialize() {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }
        
        this.initializationPromise = this.performInitialization();
        return this.initializationPromise;
    }
    
    /**
     * 실제 초기화 수행
     */
    async performInitialization() {
        Logger.info('=== 미야코지마 앱 모듈 초기화 시작 ===');
        this.showLoadingState('앱 초기화 중...');
        
        const startTime = Date.now();
        const results = {
            total: this.modules.size,
            succeeded: 0,
            failed: 0,
            skipped: 0,
            errors: []
        };
        
        try {
            // 순차적으로 모듈 초기화
            for (const moduleName of this.initializationOrder) {
                const result = await this.initializeModule(moduleName);
                
                if (result.success) {
                    results.succeeded++;
                } else if (result.skipped) {
                    results.skipped++;
                } else {
                    results.failed++;
                    results.errors.push({
                        module: moduleName,
                        error: result.error
                    });
                }
            }
            
            const duration = Date.now() - startTime;
            Logger.info(`=== 모듈 초기화 완료 (${duration}ms) ===`, results);
            
            // 초기화 결과에 따른 처리
            if (results.failed > 0) {
                Logger.warn('일부 모듈 초기화 실패:', results.errors);
                this.showNotification(
                    `앱이 부분적으로 로드되었습니다. (${results.succeeded}/${results.total} 성공)`,
                    'warning'
                );
            } else {
                Logger.info('모든 모듈 초기화 성공!');
                this.showNotification('앱이 성공적으로 로드되었습니다!', 'success');
            }
            
            return results;
            
        } catch (error) {
            Logger.error('치명적 초기화 오류:', error);
            this.showError('앱 초기화에 실패했습니다: ' + error.message);
            throw error;
        } finally {
            this.hideLoadingState();
        }
    }
    
    /**
     * 개별 모듈 초기화
     */
    async initializeModule(moduleName) {
        const module = this.modules.get(moduleName);
        if (!module) {
            return { success: false, error: 'Module not found' };
        }
        
        Logger.info(`[${moduleName}] 초기화 시작...`);
        module.status = 'loading';
        
        try {
            // 의존성 확인
            const missingDeps = await this.checkDependencies(moduleName);
            if (missingDeps.length > 0) {
                throw new Error(`Missing dependencies: ${missingDeps.join(', ')}`);
            }
            
            // 이미 준비된 경우 스킵
            if (module.checkReady && module.checkReady()) {
                Logger.info(`[${moduleName}] 이미 초기화됨`);
                module.status = 'ready';
                this.loadedModules.add(moduleName);
                return { success: true, skipped: true };
            }
            
            // 모듈 초기화 실행 (타임아웃 적용)
            await Promise.race([
                this.executeModuleInitialization(module),
                this.createTimeout(module.timeout, `${moduleName} initialization timeout`)
            ]);
            
            // 초기화 후 준비 상태 확인
            const isReady = await this.waitForModuleReady(module, 5000);
            
            if (isReady) {
                module.status = 'ready';
                this.loadedModules.add(moduleName);
                Logger.info(`[${moduleName}] 초기화 완료 ✓`);
                return { success: true };
            } else {
                throw new Error('Module failed to become ready after initialization');
            }
            
        } catch (error) {
            Logger.error(`[${moduleName}] 초기화 실패:`, error);
            
            // 선택적 모듈이고 재시도 횟수가 남은 경우
            if (module.optional && module.retryCount < this.maxRetries) {
                module.retryCount++;
                Logger.warn(`[${moduleName}] 재시도 ${module.retryCount}/${this.maxRetries}...`);
                
                await this.delay(this.retryDelay * module.retryCount);
                return await this.initializeModule(moduleName);
            }
            
            module.status = 'failed';
            module.error = error.message;
            
            if (module.optional) {
                Logger.warn(`[${moduleName}] 선택적 모듈 초기화 실패 (스킵)`);
                return { success: false, skipped: true };
            } else {
                return { success: false, error: error.message };
            }
        }
    }
    
    /**
     * 의존성 확인
     */
    async checkDependencies(moduleName) {
        const module = this.modules.get(moduleName);
        const missingDeps = [];
        
        for (const depName of module.dependencies) {
            const dep = this.modules.get(depName);
            
            if (!dep) {
                missingDeps.push(depName);
                continue;
            }
            
            if (!this.loadedModules.has(depName) && !dep.optional) {
                missingDeps.push(depName);
            }
        }
        
        return missingDeps;
    }
    
    /**
     * 모듈 초기화 실행
     */
    async executeModuleInitialization(module) {
        if (module.initialize && typeof module.initialize === 'function') {
            await module.initialize();
        }
    }
    
    /**
     * 모듈 준비 상태 대기
     */
    async waitForModuleReady(module, timeout = 5000) {
        if (!module.checkReady) return true;
        
        const startTime = Date.now();
        const checkInterval = 100;
        
        while (Date.now() - startTime < timeout) {
            if (module.checkReady()) {
                return true;
            }
            await this.delay(checkInterval);
        }
        
        return false;
    }
    
    /**
     * 메인 앱 초기화
     */
    async initializeMainApp() {
        Logger.info('메인 애플리케이션 초기화 시작...');
        
        if (!window.app) {
            window.app = new MiyakojimaApp();
            await window.app.initialize();
        }
    }
    
    /**
     * 유틸리티 메서드들
     */
    createTimeout(ms, message) {
        return new Promise((_, reject) => 
            setTimeout(() => reject(new Error(message)), ms)
        );
    }
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    showLoadingState(message) {
        const loader = document.getElementById('app-loader') || this.createLoader();
        loader.innerHTML = `
            <div class="loader-content">
                <div class="spinner"></div>
                <p>${message}</p>
                <div class="progress-info">
                    <small>모듈을 순차적으로 로드하는 중...</small>
                </div>
            </div>
        `;
        loader.style.display = 'flex';
    }
    
    createLoader() {
        const loader = document.createElement('div');
        loader.id = 'app-loader';
        loader.className = 'app-loader';
        loader.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255, 255, 255, 0.95);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        document.body.appendChild(loader);
        return loader;
    }
    
    hideLoadingState() {
        // 로딩 화면 숨기기
        const loader = document.getElementById('loading-screen');
        if (loader) {
            loader.style.display = 'none';
        }
        
        // 메인 콘텐츠 표시
        const mainContent = document.getElementById('main-container');
        if (mainContent) {
            mainContent.style.display = 'block';
        }
        
        // 앱 컨테이너 표시
        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.style.display = 'flex';
        }
        
        Logger.info('로딩 화면 숨기기 및 메인 콘텐츠 표시 완료');
    }
    
    showNotification(message, type = 'info') {
        // 간단한 알림 구현
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 6px;
            color: white;
            font-weight: 500;
            z-index: 10000;
            max-width: 300px;
            background: ${type === 'success' ? '#4CAF50' : type === 'warning' ? '#FF9800' : '#2196F3'};
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }
    
    showError(message) {
        this.showNotification(message, 'error');
        this.hideLoadingState();
        
        // 오류 상태 표시
        document.body.innerHTML = `
            <div class="error-state" style="
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                height: 100vh;
                text-align: center;
                color: #666;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            ">
                <h1>앱 로딩 실패</h1>
                <p>${message}</p>
                <button onclick="location.reload()" style="
                    padding: 12px 24px;
                    background: #2196F3;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    margin-top: 20px;
                ">다시 시도</button>
            </div>
        `;
    }
    
    /**
     * 초기화 상태 조회
     */
    getInitializationStatus() {
        const status = {};
        for (const [name, module] of this.modules) {
            status[name] = {
                status: module.status,
                error: module.error,
                retryCount: module.retryCount,
                optional: module.optional
            };
        }
        return status;
    }
}

/**
 * 메인 애플리케이션 클래스 (기존 MiyakojimaApp 단순화)
 */
class MiyakojimaApp {
    constructor() {
        this.isInitialized = false;
        this.modules = {};
        this.currentSection = 'dashboard';
        this.isOnline = navigator.onLine;
    }
    
    async initialize() {
        Logger.info('MiyakojimaApp 초기화 시작...');
        
        try {
            // 모듈 참조 설정
            this.setupModuleReferences();
            
            // 이벤트 리스너 설정
            this.setupEventListeners();
            
            // 사용자 데이터 로드
            await this.loadUserData();
            
            // 연결 모니터링 설정
            this.setupConnectivityMonitoring();
            
            // 초기 섹션 표시
            this.navigateToSection(this.currentSection);
            
            this.isInitialized = true;
            Logger.info('MiyakojimaApp 초기화 완료');
            
        } catch (error) {
            Logger.error('MiyakojimaApp 초기화 실패:', error);
            throw error;
        }
    }
    
    setupModuleReferences() {
        // 초기화된 모듈들에 대한 참조 설정
        this.modules.budget = window.budgetTracker || this.createMockBudget();
        this.modules.location = window.locationTracker || this.createMockLocation();
        this.modules.poi = window.poiManager || this.createMockPOI();
        this.modules.itinerary = window.itinerary || this.createMockItinerary();
    }
    
    setupEventListeners() {
        // 네비게이션
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = e.currentTarget.dataset.section;
                this.navigateToSection(section);
            });
        });
        
        // 온라인/오프라인 이벤트
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateConnectivityStatus();
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.updateConnectivityStatus();
        });
    }
    
    navigateToSection(sectionName) {
        // 섹션 전환 로직
        document.querySelectorAll('.section').forEach(section => {
            section.classList.remove('active');
        });
        
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const targetSection = document.getElementById(`${sectionName}-section`);
        const targetNav = document.querySelector(`[data-section="${sectionName}"]`);
        
        if (targetSection) {
            targetSection.classList.add('active');
            this.currentSection = sectionName;
        }
        
        if (targetNav) {
            targetNav.classList.add('active');
        }
        
        // URL 해시 업데이트
        window.location.hash = sectionName;
    }
    
    async loadUserData() {
        const userData = localStorage.getItem('miyakojima_user_data');
        if (userData) {
            try {
                const parsed = JSON.parse(userData);
                this.userPreferences = parsed.preferences || {};
            } catch (error) {
                Logger.error('사용자 데이터 파싱 실패:', error);
            }
        }
        
        // URL 해시에서 초기 섹션 설정
        const hash = window.location.hash.slice(1);
        if (hash && ['dashboard', 'budget', 'itinerary', 'poi'].includes(hash)) {
            this.currentSection = hash;
        }
    }
    
    setupConnectivityMonitoring() {
        this.updateConnectivityStatus();
    }
    
    updateConnectivityStatus() {
        const indicator = document.getElementById('connectivity-status');
        if (indicator) {
            indicator.className = `connectivity-indicator ${this.isOnline ? 'online' : 'offline'}`;
            indicator.textContent = this.isOnline ? '온라인' : '오프라인';
        }
    }
    
    // Mock 객체들 (실제 모듈이 로드되지 않은 경우)
    createMockBudget() {
        return {
            init: () => Promise.resolve(),
            getDashboardSummary: () => Promise.resolve({ spent: 0, remaining: 20000 }),
            syncWithBackend: () => Promise.resolve()
        };
    }
    
    createMockLocation() {
        return {
            init: () => Promise.resolve(),
            getCurrentLocationData: () => Promise.resolve({ 
                lat: 24.7449, lng: 125.2813, address: '미야코지마' 
            })
        };
    }
    
    createMockPOI() {
        return {
            init: () => Promise.resolve(),
            getTodayRecommendations: () => Promise.resolve([]),
            syncUserData: () => Promise.resolve()
        };
    }
    
    createMockItinerary() {
        return {
            init: () => Promise.resolve(),
            getScheduleStats: () => ({ total: 0, completed: 0, remaining: 0, progress: 0 })
        };
    }
}

/**
 * 전역 초기화 시작점
 */
let moduleInitializer;
let app;

// DOM이 준비되면 초기화 시작
document.addEventListener('DOMContentLoaded', async () => {
    try {
        Logger.info('DOM 로드 완료, 모듈 초기화 시작');
        
        moduleInitializer = new ModuleInitializer();
        const results = await moduleInitializer.initialize();
        
        Logger.info('모듈 초기화 완료!', results);
        
        // 모든 모듈 초기화 완료 후 메인 앱 시작
        Logger.info('MiyakojimaApp 시작...');
        const miyakojimaApp = new MiyakojimaApp();
        await miyakojimaApp.initialize();
        
        // 로딩 화면 숨기고 메인 앱 표시
        moduleInitializer.hideLoadingState();
        
        Logger.info('✅ 미야코지마 앱 완전 초기화 완료!');
        
    } catch (error) {
        Logger.error('앱 초기화 치명적 오류:', error);
        if (moduleInitializer) {
            moduleInitializer.showError('앱 초기화에 실패했습니다: ' + error.message);
        }
    }
});

// 서비스 워커 등록 (PWA)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(registration => {
                Logger.info('Service Worker 등록 성공:', registration);
            })
            .catch(error => {
                Logger.warn('Service Worker 등록 실패:', error);
            });
    });
}

// 개발자 도구용 전역 객체
window.debugApp = {
    getInitializationStatus: () => moduleInitializer?.getInitializationStatus(),
    getModules: () => moduleInitializer?.modules,
    reinitialize: () => location.reload()
};