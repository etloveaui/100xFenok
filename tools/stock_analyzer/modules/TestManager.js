/**
 * TestManager - 통합 테스트 및 품질 보증 시스템
 */

class TestManager {
    constructor() {
        this.testResults = [];
        this.testSuites = new Map();
        this.isRunning = false;
        
        console.log('🧪 TestManager 초기화');
    }

    /**
     * 테스트 시스템 초기화
     */
    initialize() {
        this.setupTestSuites();
        this.createTestUI();
        
        console.log('✅ 테스트 시스템 초기화 완료');
    }

    /**
     * 테스트 스위트 설정
     */
    setupTestSuites() {
        // 1. 데이터 로딩 테스트
        this.testSuites.set('dataLoading', {
            name: '데이터 로딩 테스트',
            tests: [
                () => this.testDataLoad(),
                () => this.testDataIntegrity(),
                () => this.testDataTypes(),
                () => this.testDataSize()
            ]
        });

        // 2. 필터링 시스템 테스트
        this.testSuites.set('filtering', {
            name: '필터링 시스템 테스트',
            tests: [
                () => this.testBasicFiltering(),
                () => this.testRangeFiltering(),
                () => this.testCategoryFiltering(),
                () => this.testPresetFiltering(),
                () => this.testFilterCombination()
            ]
        });

        // 3. UI 컴포넌트 테스트
        this.testSuites.set('ui', {
            name: 'UI 컴포넌트 테스트',
            tests: [
                () => this.testTableRendering(),
                () => this.testCardView(),
                () => this.testModalSystem(),
                () => this.testTabNavigation(),
                () => this.testResponsiveDesign()
            ]
        });

        // 4. 차트 시스템 테스트
        this.testSuites.set('charts', {
            name: '차트 시스템 테스트',
            tests: [
                () => this.testChartCreation(),
                () => this.testChartInteraction(),
                () => this.testChartResponsive(),
                () => this.testAdvancedCharts()
            ]
        });

        // 5. 성능 테스트
        this.testSuites.set('performance', {
            name: '성능 테스트',
            tests: [
                () => this.testLoadingPerformance(),
                () => this.testRenderingPerformance(),
                () => this.testMemoryUsage(),
                () => this.testLargeDataset()
            ]
        });
    }

    /**
     * 테스트 UI 생성
     */
    createTestUI() {
        if (document.getElementById('test-panel')) return;

        const testPanel = document.createElement('div');
        testPanel.id = 'test-panel';
        testPanel.className = 'fixed top-4 left-4 bg-white shadow-lg rounded-lg border p-4 z-50 max-w-md';
        testPanel.style.display = 'none';
        
        testPanel.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-bold text-gray-900">🧪 통합 테스트</h3>
                <button id="close-test-panel" class="text-gray-500 hover:text-gray-700">×</button>
            </div>
            
            <div class="mb-4">
                <button id="run-all-tests" class="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
                    모든 테스트 실행
                </button>
            </div>
            
            <div id="test-suites" class="space-y-2 mb-4">
                <!-- 테스트 스위트들이 여기에 추가됩니다 -->
            </div>
            
            <div id="test-results" class="max-h-64 overflow-y-auto">
                <!-- 테스트 결과가 여기에 표시됩니다 -->
            </div>
        `;

        document.body.appendChild(testPanel);

        // 이벤트 리스너
        this.setupTestUIEvents();
        
        // 테스트 스위트 UI 생성
        this.renderTestSuites();
    }

    /**
     * 테스트 UI 이벤트 설정
     */
    setupTestUIEvents() {
        // 패널 닫기
        document.getElementById('close-test-panel').addEventListener('click', () => {
            document.getElementById('test-panel').style.display = 'none';
        });

        // 모든 테스트 실행
        document.getElementById('run-all-tests').addEventListener('click', () => {
            this.runAllTests();
        });
    }

    /**
     * 테스트 스위트 UI 렌더링
     */
    renderTestSuites() {
        const container = document.getElementById('test-suites');
        container.innerHTML = '';

        this.testSuites.forEach((suite, key) => {
            const suiteDiv = document.createElement('div');
            suiteDiv.className = 'border rounded p-2';
            suiteDiv.innerHTML = `
                <div class="flex justify-between items-center">
                    <span class="text-sm font-medium">${suite.name}</span>
                    <button class="run-suite-btn text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700" data-suite="${key}">
                        실행
                    </button>
                </div>
                <div class="text-xs text-gray-500 mt-1">${suite.tests.length}개 테스트</div>
            `;
            container.appendChild(suiteDiv);

            // 개별 스위트 실행 버튼
            suiteDiv.querySelector('.run-suite-btn').addEventListener('click', (e) => {
                const suiteKey = e.target.dataset.suite;
                this.runTestSuite(suiteKey);
            });
        });
    }

    /**
     * 모든 테스트 실행
     */
    async runAllTests() {
        if (this.isRunning) return;

        this.isRunning = true;
        this.testResults = [];
        
        console.log('🧪 모든 테스트 실행 시작');
        this.updateTestResults('🚀 통합 테스트 시작...', 'info');

        for (const [key, suite] of this.testSuites) {
            await this.runTestSuite(key);
        }

        this.generateTestReport();
        this.isRunning = false;
        
        console.log('✅ 모든 테스트 완료');
    }

    /**
     * 테스트 스위트 실행
     */
    async runTestSuite(suiteKey) {
        const suite = this.testSuites.get(suiteKey);
        if (!suite) return;

        console.log(`🧪 ${suite.name} 실행 중...`);
        this.updateTestResults(`📋 ${suite.name} 실행 중...`, 'info');

        const suiteResults = [];
        
        for (let i = 0; i < suite.tests.length; i++) {
            const test = suite.tests[i];
            try {
                const result = await test();
                suiteResults.push(result);
                
                const status = result.passed ? '✅' : '❌';
                this.updateTestResults(`${status} ${result.name}`, result.passed ? 'success' : 'error');
                
            } catch (error) {
                const result = {
                    name: `테스트 ${i + 1}`,
                    passed: false,
                    error: error.message
                };
                suiteResults.push(result);
                this.updateTestResults(`❌ ${result.name} - ${error.message}`, 'error');
            }
        }

        this.testResults.push({
            suite: suite.name,
            results: suiteResults
        });
    }

    /**
     * 데이터 로딩 테스트
     */
    async testDataLoad() {
        const startTime = performance.now();
        
        try {
            const hasData = window.allData && window.allData.length > 0;
            const loadTime = performance.now() - startTime;
            
            return {
                name: '데이터 로딩 테스트',
                passed: hasData,
                details: `${window.allData?.length || 0}개 기업 데이터, ${loadTime.toFixed(2)}ms`,
                metrics: { loadTime, dataCount: window.allData?.length || 0 }
            };
        } catch (error) {
            return {
                name: '데이터 로딩 테스트',
                passed: false,
                error: error.message
            };
        }
    }

    /**
     * 데이터 무결성 테스트
     */
    async testDataIntegrity() {
        if (!window.allData || window.allData.length === 0) {
            return {
                name: '데이터 무결성 테스트',
                passed: false,
                error: '데이터가 없습니다'
            };
        }

        const sampleSize = Math.min(100, window.allData.length);
        const sample = window.allData.slice(0, sampleSize);
        
        let validCount = 0;
        let issues = [];

        sample.forEach((company, index) => {
            if (!company.Ticker) {
                issues.push(`${index}: Ticker 누락`);
            } else if (!company.industry) {
                issues.push(`${index}: industry 누락`);
            } else {
                validCount++;
            }
        });

        const validityRate = (validCount / sampleSize) * 100;
        
        return {
            name: '데이터 무결성 테스트',
            passed: validityRate >= 90,
            details: `유효성: ${validityRate.toFixed(1)}%, 문제: ${issues.length}개`,
            issues: issues.slice(0, 5) // 최대 5개만 표시
        };
    }

    /**
     * 데이터 타입 테스트
     */
    async testDataTypes() {
        if (!window.allData || window.allData.length === 0) {
            return {
                name: '데이터 타입 테스트',
                passed: false,
                error: '데이터가 없습니다'
            };
        }

        const sample = window.allData[0];
        const numericFields = ['PER (Oct-25)', 'PBR (Oct-25)', 'ROE (Fwd)', '(USD mn)'];
        
        let typeErrors = [];
        
        numericFields.forEach(field => {
            const value = sample[field];
            if (value !== null && value !== undefined && value !== '' && isNaN(parseFloat(value))) {
                typeErrors.push(`${field}: ${value} (숫자가 아님)`);
            }
        });

        return {
            name: '데이터 타입 테스트',
            passed: typeErrors.length === 0,
            details: typeErrors.length > 0 ? `타입 오류: ${typeErrors.length}개` : '모든 타입 정상',
            errors: typeErrors.slice(0, 3)
        };
    }

    /**
     * 데이터 크기 테스트
     */
    async testDataSize() {
        const dataSize = JSON.stringify(window.allData || []).length;
        const dataSizeMB = (dataSize / 1024 / 1024).toFixed(2);
        
        return {
            name: '데이터 크기 테스트',
            passed: dataSize > 0 && dataSize < 50 * 1024 * 1024, // 50MB 미만
            details: `데이터 크기: ${dataSizeMB}MB`,
            metrics: { sizeBytes: dataSize, sizeMB: parseFloat(dataSizeMB) }
        };
    }

    /**
     * 기본 필터링 테스트
     */
    async testBasicFiltering() {
        if (!window.filterManager) {
            return {
                name: '기본 필터링 테스트',
                passed: false,
                error: 'FilterManager가 없습니다'
            };
        }

        try {
            // 검색 필터 테스트
            window.filterManager.filters.search = 'AAPL';
            window.filterManager.applyFilters();
            
            const searchResults = window.filterManager.getFilteredData();
            const hasApple = searchResults.some(company => company.Ticker === 'AAPL');
            
            // 필터 초기화
            window.filterManager.resetFilters();
            
            return {
                name: '기본 필터링 테스트',
                passed: hasApple,
                details: `검색 결과: ${searchResults.length}개`,
                metrics: { searchResultCount: searchResults.length }
            };
        } catch (error) {
            return {
                name: '기본 필터링 테스트',
                passed: false,
                error: error.message
            };
        }
    }

    /**
     * 범위 필터링 테스트
     */
    async testRangeFiltering() {
        if (!window.filterManager) {
            return {
                name: '범위 필터링 테스트',
                passed: false,
                error: 'FilterManager가 없습니다'
            };
        }

        try {
            // PER 범위 필터 테스트
            window.filterManager.filters.per = { min: 10, max: 20 };
            window.filterManager.applyFilters();
            
            const rangeResults = window.filterManager.getFilteredData();
            const validRange = rangeResults.every(company => {
                const per = parseFloat(company['PER (Oct-25)']);
                return isNaN(per) || (per >= 10 && per <= 20);
            });
            
            // 필터 초기화
            window.filterManager.resetFilters();
            
            return {
                name: '범위 필터링 테스트',
                passed: validRange,
                details: `범위 필터 결과: ${rangeResults.length}개`,
                metrics: { rangeResultCount: rangeResults.length }
            };
        } catch (error) {
            return {
                name: '범위 필터링 테스트',
                passed: false,
                error: error.message
            };
        }
    }

    /**
     * 카테고리 필터링 테스트
     */
    async testCategoryFiltering() {
        if (!window.filterManager) {
            return {
                name: '카테고리 필터링 테스트',
                passed: false,
                error: 'FilterManager가 없습니다'
            };
        }

        try {
            // 업종 필터 테스트
            window.filterManager.filters.industries = ['Technology'];
            window.filterManager.applyFilters();
            
            const categoryResults = window.filterManager.getFilteredData();
            const validCategory = categoryResults.every(company => 
                company.industry === 'Technology'
            );
            
            // 필터 초기화
            window.filterManager.resetFilters();
            
            return {
                name: '카테고리 필터링 테스트',
                passed: validCategory,
                details: `카테고리 필터 결과: ${categoryResults.length}개`,
                metrics: { categoryResultCount: categoryResults.length }
            };
        } catch (error) {
            return {
                name: '카테고리 필터링 테스트',
                passed: false,
                error: error.message
            };
        }
    }

    /**
     * 프리셋 필터링 테스트
     */
    async testPresetFiltering() {
        if (!window.filterManager) {
            return {
                name: '프리셋 필터링 테스트',
                passed: false,
                error: 'FilterManager가 없습니다'
            };
        }

        try {
            // 우량주 프리셋 테스트
            window.filterManager.applyPresetFilter('quality');
            
            const presetResults = window.filterManager.getFilteredData();
            const hasResults = presetResults.length > 0;
            
            // 필터 초기화
            window.filterManager.resetFilters();
            
            return {
                name: '프리셋 필터링 테스트',
                passed: hasResults,
                details: `프리셋 필터 결과: ${presetResults.length}개`,
                metrics: { presetResultCount: presetResults.length }
            };
        } catch (error) {
            return {
                name: '프리셋 필터링 테스트',
                passed: false,
                error: error.message
            };
        }
    }

    /**
     * 필터 조합 테스트
     */
    async testFilterCombination() {
        if (!window.filterManager) {
            return {
                name: '필터 조합 테스트',
                passed: false,
                error: 'FilterManager가 없습니다'
            };
        }

        try {
            // 복합 필터 테스트
            window.filterManager.filters.per = { min: 0, max: 25 };
            window.filterManager.filters.industries = ['Technology'];
            window.filterManager.applyFilters();
            
            const combinedResults = window.filterManager.getFilteredData();
            const validCombination = combinedResults.every(company => {
                const per = parseFloat(company['PER (Oct-25)']);
                return company.industry === 'Technology' && 
                       (isNaN(per) || per <= 25);
            });
            
            // 필터 초기화
            window.filterManager.resetFilters();
            
            return {
                name: '필터 조합 테스트',
                passed: validCombination,
                details: `조합 필터 결과: ${combinedResults.length}개`,
                metrics: { combinedResultCount: combinedResults.length }
            };
        } catch (error) {
            return {
                name: '필터 조합 테스트',
                passed: false,
                error: error.message
            };
        }
    }

    /**
     * 테이블 렌더링 테스트
     */
    async testTableRendering() {
        const table = document.querySelector('#results-table table');
        const hasTable = !!table;
        const hasRows = table ? table.querySelectorAll('tbody tr').length > 0 : false;
        
        return {
            name: '테이블 렌더링 테스트',
            passed: hasTable && hasRows,
            details: hasTable ? `테이블 행 수: ${table.querySelectorAll('tbody tr').length}개` : '테이블 없음',
            metrics: { 
                hasTable, 
                rowCount: table ? table.querySelectorAll('tbody tr').length : 0 
            }
        };
    }

    /**
     * 카드 뷰 테스트
     */
    async testCardView() {
        const cardContainer = document.getElementById('card-container');
        const hasCardContainer = !!cardContainer;
        
        // 카드 뷰 전환 테스트
        if (window.cardViewManager) {
            try {
                window.cardViewManager.showCardView();
                const isCardViewActive = cardContainer && !cardContainer.classList.contains('hidden');
                
                return {
                    name: '카드 뷰 테스트',
                    passed: hasCardContainer && isCardViewActive,
                    details: `카드 컨테이너: ${hasCardContainer ? '존재' : '없음'}`,
                    metrics: { hasCardContainer, isCardViewActive }
                };
            } catch (error) {
                return {
                    name: '카드 뷰 테스트',
                    passed: false,
                    error: error.message
                };
            }
        }

        return {
            name: '카드 뷰 테스트',
            passed: false,
            error: 'CardViewManager가 없습니다'
        };
    }

    /**
     * 모달 시스템 테스트
     */
    async testModalSystem() {
        // 테스트용 모달 열기
        if (window.allData && window.allData.length > 0) {
            try {
                const testCompany = window.allData[0];
                if (window.showCompanyAnalysisModal) {
                    window.showCompanyAnalysisModal(testCompany);
                    
                    const modal = document.getElementById('company-analysis-modal');
                    const isModalVisible = modal && !modal.classList.contains('hidden');
                    
                    // 모달 닫기
                    if (modal) {
                        modal.classList.add('hidden');
                    }
                    
                    return {
                        name: '모달 시스템 테스트',
                        passed: isModalVisible,
                        details: `모달 표시: ${isModalVisible ? '성공' : '실패'}`,
                        metrics: { isModalVisible }
                    };
                }
            } catch (error) {
                return {
                    name: '모달 시스템 테스트',
                    passed: false,
                    error: error.message
                };
            }
        }

        return {
            name: '모달 시스템 테스트',
            passed: false,
            error: '테스트 데이터 또는 모달 함수가 없습니다'
        };
    }

    /**
     * 탭 네비게이션 테스트
     */
    async testTabNavigation() {
        const tabs = ['screener', 'dashboard', 'portfolio'];
        let passedTabs = 0;

        for (const tab of tabs) {
            try {
                if (window.dashboardManager) {
                    window.dashboardManager.switchTab(tab);
                    
                    const tabContent = document.getElementById(`${tab}-content`);
                    const isActive = tabContent && !tabContent.classList.contains('hidden');
                    
                    if (isActive) passedTabs++;
                }
            } catch (error) {
                console.warn(`탭 ${tab} 테스트 실패:`, error);
            }
        }

        return {
            name: '탭 네비게이션 테스트',
            passed: passedTabs === tabs.length,
            details: `성공한 탭: ${passedTabs}/${tabs.length}개`,
            metrics: { passedTabs, totalTabs: tabs.length }
        };
    }

    /**
     * 반응형 디자인 테스트
     */
    async testResponsiveDesign() {
        const hasResponsiveManager = !!window.responsiveManager;
        let deviceDetection = false;
        
        if (hasResponsiveManager) {
            const currentDevice = window.responsiveManager.getCurrentDevice();
            deviceDetection = ['mobile', 'tablet', 'desktop'].includes(currentDevice);
        }

        return {
            name: '반응형 디자인 테스트',
            passed: hasResponsiveManager && deviceDetection,
            details: `디바이스: ${hasResponsiveManager ? window.responsiveManager.getCurrentDevice() : '감지 불가'}`,
            metrics: { hasResponsiveManager, deviceDetection }
        };
    }

    /**
     * 차트 생성 테스트
     */
    async testChartCreation() {
        const hasChartManager = !!window.chartManager;
        const hasAdvancedChartManager = !!window.advancedChartManager;
        
        return {
            name: '차트 생성 테스트',
            passed: hasChartManager && hasAdvancedChartManager,
            details: `ChartManager: ${hasChartManager ? '존재' : '없음'}, AdvancedChartManager: ${hasAdvancedChartManager ? '존재' : '없음'}`,
            metrics: { hasChartManager, hasAdvancedChartManager }
        };
    }

    /**
     * 차트 인터랙션 테스트
     */
    async testChartInteraction() {
        // Chart.js 라이브러리 확인
        const hasChartJS = typeof Chart !== 'undefined';
        
        return {
            name: '차트 인터랙션 테스트',
            passed: hasChartJS,
            details: `Chart.js: ${hasChartJS ? '로드됨' : '없음'}`,
            metrics: { hasChartJS }
        };
    }

    /**
     * 차트 반응형 테스트
     */
    async testChartResponsive() {
        const chartContainers = document.querySelectorAll('.chart-container');
        const hasChartContainers = chartContainers.length > 0;
        
        return {
            name: '차트 반응형 테스트',
            passed: hasChartContainers,
            details: `차트 컨테이너: ${chartContainers.length}개`,
            metrics: { chartContainerCount: chartContainers.length }
        };
    }

    /**
     * 고급 차트 테스트
     */
    async testAdvancedCharts() {
        const advancedChartCanvases = [
            'valuation-matrix-chart',
            'sector-performance-chart'
        ];
        
        let existingCanvases = 0;
        advancedChartCanvases.forEach(id => {
            if (document.getElementById(id)) {
                existingCanvases++;
            }
        });
        
        return {
            name: '고급 차트 테스트',
            passed: existingCanvases > 0,
            details: `고급 차트 캔버스: ${existingCanvases}/${advancedChartCanvases.length}개`,
            metrics: { existingCanvases, totalCanvases: advancedChartCanvases.length }
        };
    }

    /**
     * 로딩 성능 테스트
     */
    async testLoadingPerformance() {
        const performanceEntries = performance.getEntriesByType('navigation');
        const loadTime = performanceEntries.length > 0 ? performanceEntries[0].loadEventEnd - performanceEntries[0].fetchStart : 0;
        
        return {
            name: '로딩 성능 테스트',
            passed: loadTime > 0 && loadTime < 5000, // 5초 미만
            details: `로딩 시간: ${loadTime.toFixed(2)}ms`,
            metrics: { loadTime }
        };
    }

    /**
     * 렌더링 성능 테스트
     */
    async testRenderingPerformance() {
        const startTime = performance.now();
        
        // 테이블 재렌더링 테스트
        if (window.renderTable && window.allData) {
            window.renderTable(window.allData.slice(0, 100));
        }
        
        const renderTime = performance.now() - startTime;
        
        return {
            name: '렌더링 성능 테스트',
            passed: renderTime < 1000, // 1초 미만
            details: `렌더링 시간: ${renderTime.toFixed(2)}ms`,
            metrics: { renderTime }
        };
    }

    /**
     * 메모리 사용량 테스트
     */
    async testMemoryUsage() {
        if (!performance.memory) {
            return {
                name: '메모리 사용량 테스트',
                passed: false,
                error: 'Memory API 지원 안함'
            };
        }

        const memory = performance.memory;
        const usedMB = (memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
        const limitMB = (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2);
        const usagePercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
        
        return {
            name: '메모리 사용량 테스트',
            passed: usagePercent < 80, // 80% 미만
            details: `메모리 사용량: ${usedMB}MB / ${limitMB}MB (${usagePercent.toFixed(1)}%)`,
            metrics: { usedMB: parseFloat(usedMB), limitMB: parseFloat(limitMB), usagePercent }
        };
    }

    /**
     * 대용량 데이터셋 테스트
     */
    async testLargeDataset() {
        const dataCount = window.allData ? window.allData.length : 0;
        const isLargeDataset = dataCount >= 1000;
        
        return {
            name: '대용량 데이터셋 테스트',
            passed: isLargeDataset,
            details: `데이터 수: ${dataCount.toLocaleString()}개`,
            metrics: { dataCount, isLargeDataset }
        };
    }

    /**
     * 테스트 결과 업데이트
     */
    updateTestResults(message, type = 'info') {
        const resultsContainer = document.getElementById('test-results');
        if (!resultsContainer) return;

        const resultDiv = document.createElement('div');
        resultDiv.className = `text-xs p-2 border-l-2 mb-1 ${this.getResultClass(type)}`;
        resultDiv.textContent = message;
        
        resultsContainer.appendChild(resultDiv);
        resultsContainer.scrollTop = resultsContainer.scrollHeight;
    }

    /**
     * 결과 클래스 반환
     */
    getResultClass(type) {
        const classes = {
            success: 'border-green-500 bg-green-50 text-green-800',
            error: 'border-red-500 bg-red-50 text-red-800',
            warning: 'border-yellow-500 bg-yellow-50 text-yellow-800',
            info: 'border-blue-500 bg-blue-50 text-blue-800'
        };
        return classes[type] || classes.info;
    }

    /**
     * 테스트 리포트 생성
     */
    generateTestReport() {
        let totalTests = 0;
        let passedTests = 0;
        
        this.testResults.forEach(suiteResult => {
            suiteResult.results.forEach(result => {
                totalTests++;
                if (result.passed) passedTests++;
            });
        });

        const successRate = totalTests > 0 ? (passedTests / totalTests * 100).toFixed(1) : 0;
        
        this.updateTestResults(`📊 테스트 완료: ${passedTests}/${totalTests} 성공 (${successRate}%)`, 
                              successRate >= 80 ? 'success' : 'warning');

        // 콘솔에 상세 리포트 출력
        console.group('🧪 통합 테스트 리포트');
        console.log(`총 테스트: ${totalTests}개`);
        console.log(`성공: ${passedTests}개`);
        console.log(`실패: ${totalTests - passedTests}개`);
        console.log(`성공률: ${successRate}%`);
        
        this.testResults.forEach(suiteResult => {
            console.group(`📋 ${suiteResult.suite}`);
            suiteResult.results.forEach(result => {
                const status = result.passed ? '✅' : '❌';
                console.log(`${status} ${result.name}${result.details ? ` - ${result.details}` : ''}`);
                if (result.error) console.error(`   오류: ${result.error}`);
            });
            console.groupEnd();
        });
        console.groupEnd();
    }

    /**
     * 테스트 패널 표시/숨김
     */
    toggleTestPanel() {
        const panel = document.getElementById('test-panel');
        if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        } else {
            this.createTestUI();
            document.getElementById('test-panel').style.display = 'block';
        }
    }

    /**
     * 테스트 결과 반환
     */
    getTestResults() {
        return this.testResults;
    }
}

// 전역 인스턴스 생성
window.testManager = new TestManager();

// 개발 모드에서 테스트 패널 키보드 단축키 (Ctrl+Shift+T)
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        window.testManager.toggleTestPanel();
    }
});

console.log('✅ TestManager 로드 완료 - 통합 테스트 시스템');