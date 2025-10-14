/**
 * LoadingManager - 로딩 상태 및 피드백 시스템
 */

class LoadingManager {
    constructor() {
        this.loadingStates = new Map();
        this.progressBars = new Map();
        this.currentOperations = new Set();
        
        console.log('⏳ LoadingManager 초기화');
    }

    /**
     * 로딩 시스템 초기화
     */
    initialize() {
        this.createGlobalLoader();
        this.setupProgressIndicators();
        
        console.log('✅ 로딩 시스템 초기화 완료');
    }

    /**
     * 전역 로더 생성
     */
    createGlobalLoader() {
        if (document.getElementById('global-loader')) return;

        const loader = document.createElement('div');
        loader.id = 'global-loader';
        loader.className = 'fixed inset-0 bg-white bg-opacity-90 flex items-center justify-center z-50';
        loader.style.display = 'none';
        
        loader.innerHTML = `
            <div class="text-center">
                <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                <div class="text-lg font-semibold text-gray-700 mb-2" id="global-loader-title">로딩 중...</div>
                <div class="text-sm text-gray-500" id="global-loader-message">잠시만 기다려주세요</div>
                <div class="w-64 bg-gray-200 rounded-full h-2 mt-4">
                    <div id="global-loader-progress" class="bg-blue-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
                </div>
                <div class="text-xs text-gray-400 mt-2" id="global-loader-percent">0%</div>
            </div>
        `;

        document.body.appendChild(loader);
    }

    /**
     * 진행률 표시기 설정
     */
    setupProgressIndicators() {
        // 데이터 로딩 진행률 표시
        this.createDataLoadingIndicator();
        
        // 필터링 진행률 표시
        this.createFilteringIndicator();
        
        // 차트 로딩 진행률 표시
        this.createChartLoadingIndicator();
    }

    /**
     * 데이터 로딩 표시기 생성
     */
    createDataLoadingIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'data-loading-indicator';
        indicator.className = 'fixed top-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg z-40';
        indicator.style.display = 'none';
        
        indicator.innerHTML = `
            <div class="flex items-center">
                <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                <span class="text-sm font-medium">데이터 로딩 중...</span>
            </div>
        `;

        document.body.appendChild(indicator);
    }

    /**
     * 필터링 표시기 생성
     */
    createFilteringIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'filtering-indicator';
        indicator.className = 'fixed top-16 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-40';
        indicator.style.display = 'none';
        
        indicator.innerHTML = `
            <div class="flex items-center">
                <div class="animate-pulse h-4 w-4 bg-white rounded-full mr-2"></div>
                <span class="text-sm font-medium">필터링 중...</span>
            </div>
        `;

        document.body.appendChild(indicator);
    }

    /**
     * 차트 로딩 표시기 생성
     */
    createChartLoadingIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'chart-loading-indicator';
        indicator.className = 'fixed top-28 right-4 bg-purple-600 text-white px-4 py-2 rounded-lg shadow-lg z-40';
        indicator.style.display = 'none';
        
        indicator.innerHTML = `
            <div class="flex items-center">
                <div class="animate-bounce h-4 w-4 bg-white rounded-full mr-2"></div>
                <span class="text-sm font-medium">차트 생성 중...</span>
            </div>
        `;

        document.body.appendChild(indicator);
    }

    /**
     * 로딩 시작
     */
    startLoading(operationId, options = {}) {
        const {
            title = '로딩 중...',
            message = '잠시만 기다려주세요',
            showProgress = false,
            showGlobal = false
        } = options;

        this.currentOperations.add(operationId);
        this.loadingStates.set(operationId, {
            title,
            message,
            progress: 0,
            startTime: Date.now(),
            showProgress,
            showGlobal
        });

        if (showGlobal) {
            this.showGlobalLoader(title, message);
        }

        this.updateLoadingUI();
        
        console.log(`⏳ 로딩 시작: ${operationId}`);
    }

    /**
     * 로딩 진행률 업데이트
     */
    updateProgress(operationId, progress, message) {
        const state = this.loadingStates.get(operationId);
        if (!state) return;

        state.progress = Math.min(100, Math.max(0, progress));
        if (message) state.message = message;

        this.updateLoadingUI();
        
        // 전역 로더 업데이트
        if (state.showGlobal) {
            this.updateGlobalLoader(state.title, state.message, state.progress);
        }

        console.log(`📊 진행률 업데이트: ${operationId} - ${progress}%`);
    }

    /**
     * 로딩 완료
     */
    finishLoading(operationId, success = true, finalMessage) {
        const state = this.loadingStates.get(operationId);
        if (!state) return;

        const duration = Date.now() - state.startTime;
        
        this.currentOperations.delete(operationId);
        this.loadingStates.delete(operationId);

        if (state.showGlobal && this.currentOperations.size === 0) {
            this.hideGlobalLoader();
        }

        // 성공/실패 피드백 표시
        if (finalMessage) {
            this.showFeedback(finalMessage, success ? 'success' : 'error');
        }

        this.updateLoadingUI();
        
        console.log(`✅ 로딩 완료: ${operationId} (${duration}ms)`);
    }

    /**
     * 전역 로더 표시
     */
    showGlobalLoader(title, message) {
        const loader = document.getElementById('global-loader');
        const titleEl = document.getElementById('global-loader-title');
        const messageEl = document.getElementById('global-loader-message');
        
        if (loader && titleEl && messageEl) {
            titleEl.textContent = title;
            messageEl.textContent = message;
            loader.style.display = 'flex';
        }
    }

    /**
     * 전역 로더 업데이트
     */
    updateGlobalLoader(title, message, progress) {
        const titleEl = document.getElementById('global-loader-title');
        const messageEl = document.getElementById('global-loader-message');
        const progressEl = document.getElementById('global-loader-progress');
        const percentEl = document.getElementById('global-loader-percent');
        
        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.textContent = message;
        if (progressEl) progressEl.style.width = `${progress}%`;
        if (percentEl) percentEl.textContent = `${Math.round(progress)}%`;
    }

    /**
     * 전역 로더 숨기기
     */
    hideGlobalLoader() {
        const loader = document.getElementById('global-loader');
        if (loader) {
            loader.style.display = 'none';
        }
    }

    /**
     * 특정 표시기 표시
     */
    showIndicator(type) {
        const indicator = document.getElementById(`${type}-indicator`);
        if (indicator) {
            indicator.style.display = 'block';
        }
    }

    /**
     * 특정 표시기 숨기기
     */
    hideIndicator(type) {
        const indicator = document.getElementById(`${type}-indicator`);
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

    /**
     * 데이터 로딩 래퍼
     */
    async wrapDataLoading(operation, options = {}) {
        const operationId = `data-loading-${Date.now()}`;
        
        this.startLoading(operationId, {
            title: '데이터 로딩 중...',
            message: '주식 데이터를 불러오고 있습니다',
            showProgress: true,
            showGlobal: true,
            ...options
        });

        this.showIndicator('data-loading');

        try {
            // 진행률 시뮬레이션
            this.simulateProgress(operationId, 2000);
            
            const result = await operation();
            
            this.finishLoading(operationId, true, '데이터 로딩 완료!');
            this.hideIndicator('data-loading');
            
            return result;
        } catch (error) {
            this.finishLoading(operationId, false, '데이터 로딩 실패');
            this.hideIndicator('data-loading');
            throw error;
        }
    }

    /**
     * 필터링 래퍼
     */
    async wrapFiltering(operation, options = {}) {
        const operationId = `filtering-${Date.now()}`;
        
        this.startLoading(operationId, {
            title: '필터링 중...',
            message: '조건에 맞는 기업을 찾고 있습니다',
            ...options
        });

        this.showIndicator('filtering');

        try {
            const result = await operation();
            
            this.finishLoading(operationId, true);
            this.hideIndicator('filtering');
            
            return result;
        } catch (error) {
            this.finishLoading(operationId, false, '필터링 실패');
            this.hideIndicator('filtering');
            throw error;
        }
    }

    /**
     * 차트 생성 래퍼
     */
    async wrapChartCreation(operation, options = {}) {
        const operationId = `chart-${Date.now()}`;
        
        this.startLoading(operationId, {
            title: '차트 생성 중...',
            message: '시각화를 준비하고 있습니다',
            ...options
        });

        this.showIndicator('chart-loading');

        try {
            const result = await operation();
            
            this.finishLoading(operationId, true);
            this.hideIndicator('chart-loading');
            
            return result;
        } catch (error) {
            this.finishLoading(operationId, false, '차트 생성 실패');
            this.hideIndicator('chart-loading');
            throw error;
        }
    }

    /**
     * 진행률 시뮬레이션
     */
    simulateProgress(operationId, duration) {
        const steps = 20;
        const interval = duration / steps;
        let currentStep = 0;

        const timer = setInterval(() => {
            currentStep++;
            const progress = (currentStep / steps) * 100;
            
            this.updateProgress(operationId, progress);
            
            if (currentStep >= steps) {
                clearInterval(timer);
            }
        }, interval);
    }

    /**
     * 피드백 메시지 표시
     */
    showFeedback(message, type = 'info', duration = 3000) {
        const feedback = document.createElement('div');
        feedback.className = `fixed top-4 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg z-50 transition-all duration-300`;
        
        const colors = {
            success: 'bg-green-600 text-white',
            error: 'bg-red-600 text-white',
            warning: 'bg-yellow-600 text-white',
            info: 'bg-blue-600 text-white'
        };
        
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        feedback.className += ` ${colors[type] || colors.info}`;
        feedback.innerHTML = `
            <div class="flex items-center">
                <span class="mr-2">${icons[type] || icons.info}</span>
                <span class="font-medium">${message}</span>
            </div>
        `;

        document.body.appendChild(feedback);

        // 애니메이션 효과
        setTimeout(() => {
            feedback.style.transform = 'translateX(-50%) translateY(0)';
        }, 10);

        // 자동 제거
        setTimeout(() => {
            feedback.style.transform = 'translateX(-50%) translateY(-100%)';
            setTimeout(() => {
                if (feedback.parentNode) {
                    feedback.parentNode.removeChild(feedback);
                }
            }, 300);
        }, duration);
    }

    /**
     * 로딩 UI 업데이트
     */
    updateLoadingUI() {
        // 현재 활성 로딩 상태에 따라 UI 업데이트
        const hasActiveLoading = this.currentOperations.size > 0;

        // 탭 네비게이션은 항상 활성화 유지 (데이터 없어도 탭 전환 가능)
        // 전역 포인터 이벤트 비활성화 제거 - 특정 요소만 비활성화

        // 로딩 중인 요소들에 시각적 피드백
        this.updateLoadingElements();
    }

    /**
     * 로딩 요소 업데이트
     */
    updateLoadingElements() {
        const loadingElements = document.querySelectorAll('[data-loading]');
        
        loadingElements.forEach(element => {
            const operationId = element.dataset.loading;
            const isLoading = this.currentOperations.has(operationId);
            
            if (isLoading) {
                element.classList.add('opacity-50', 'pointer-events-none');
                element.style.cursor = 'wait';
            } else {
                element.classList.remove('opacity-50', 'pointer-events-none');
                element.style.cursor = '';
            }
        });
    }

    /**
     * 스켈레톤 로더 생성
     */
    createSkeletonLoader(container, type = 'table') {
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton-loader animate-pulse';
        
        if (type === 'table') {
            skeleton.innerHTML = `
                <div class="space-y-3">
                    ${Array(5).fill(0).map(() => `
                        <div class="grid grid-cols-6 gap-4">
                            ${Array(6).fill(0).map(() => `
                                <div class="h-4 bg-gray-200 rounded"></div>
                            `).join('')}
                        </div>
                    `).join('')}
                </div>
            `;
        } else if (type === 'card') {
            skeleton.innerHTML = `
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    ${Array(6).fill(0).map(() => `
                        <div class="border rounded-lg p-4">
                            <div class="h-4 bg-gray-200 rounded mb-2"></div>
                            <div class="h-3 bg-gray-200 rounded mb-2"></div>
                            <div class="h-3 bg-gray-200 rounded w-2/3"></div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else if (type === 'chart') {
            skeleton.innerHTML = `
                <div class="h-64 bg-gray-200 rounded-lg flex items-center justify-center">
                    <div class="text-gray-400">차트 로딩 중...</div>
                </div>
            `;
        }

        if (container) {
            container.appendChild(skeleton);
        }

        return skeleton;
    }

    /**
     * 스켈레톤 로더 제거
     */
    removeSkeletonLoader(container) {
        const skeletons = container.querySelectorAll('.skeleton-loader');
        skeletons.forEach(skeleton => skeleton.remove());
    }

    /**
     * 에러 상태 표시
     */
    showError(message, details = null) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        errorDiv.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-md mx-4">
                <div class="flex items-center mb-4">
                    <div class="text-red-600 text-2xl mr-3">❌</div>
                    <h3 class="text-lg font-bold text-gray-900">오류 발생</h3>
                </div>
                <p class="text-gray-700 mb-4">${message}</p>
                ${details ? `<details class="text-sm text-gray-500 mb-4">
                    <summary class="cursor-pointer">상세 정보</summary>
                    <pre class="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto">${details}</pre>
                </details>` : ''}
                <div class="flex justify-end">
                    <button class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700" onclick="this.closest('.fixed').remove()">
                        확인
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(errorDiv);
    }

    /**
     * 현재 로딩 상태 반환
     */
    getLoadingStates() {
        return Array.from(this.loadingStates.entries()).map(([id, state]) => ({
            id,
            ...state
        }));
    }

    /**
     * 모든 로딩 중지
     */
    stopAllLoading() {
        this.currentOperations.clear();
        this.loadingStates.clear();
        this.hideGlobalLoader();
        this.hideIndicator('data-loading');
        this.hideIndicator('filtering');
        this.hideIndicator('chart-loading');
        this.updateLoadingUI();
        
        console.log('🛑 모든 로딩 중지');
    }
}

// 전역 인스턴스 생성
window.loadingManager = new LoadingManager();

console.log('✅ LoadingManager 로드 완료 - 로딩 상태 및 피드백 시스템');