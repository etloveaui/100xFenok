# Stock Analyzer - 긴급 수정 가이드

**목표**: 404 에러 제거 및 모듈 정상 작동 (30분 내 완료)

---

## 1단계: HTML 스크립트 로딩 수정 (15분)

### 파일: `stock_analyzer.html`

#### 수정 위치 1: Line 1282-1287 직전에 추가

**기존 (Line 1282 이전):**
```html
    <!-- 핵심 매니저들만 로드 (6개) -->
    <script src="./modules/ErrorFixManager.js"></script>
```

**수정 후:**
```html
    <!-- ================================================ -->
    <!-- STEP 1: CORE FOUNDATION (가장 먼저 로드) -->
    <!-- ================================================ -->
    <script src="./core/EventSystem.js"></script>
    <script src="./core/DataSkeleton.js"></script>
    <script src="./core/UIFramework.js"></script>
    <script src="./core/ModuleRegistry.js"></script>
    <script src="./core/ErrorBoundary.js"></script>
    <script src="./core/DataProvider.js"></script>
    <script src="./core/StateManager.js"></script>
    <script src="./core/PerformanceMonitor.js"></script>
    <script src="./core/NavigationService.js"></script>

    <!-- ================================================ -->
    <!-- STEP 2: BASIC MANAGERS -->
    <!-- ================================================ -->
    <!-- 핵심 매니저들만 로드 (6개) -->
    <script src="./modules/ErrorFixManager.js"></script>
```

---

#### 수정 위치 2: Line 1326-1330 (EconomicDashboard)

**기존:**
```html
    <!-- EconomicDashboard 모듈 -->
    <script src="./modules/EconomicDashboard/EventSystem.js"></script>
    <script src="./modules/EconomicDashboard/DataSkeleton.js"></script>
    <script src="./modules/EconomicDashboard/UIFramework.js"></script>
    <script src="./modules/EconomicDashboard/EconomicDashboard.js"></script>
```

**수정 후:**
```html
    <!-- EconomicDashboard 모듈 (중복 제거) -->
    <script src="./modules/EconomicDashboard/EconomicDashboard.js"></script>
```

---

#### 수정 위치 3: Line 1332-1337 (MomentumHeatmap)

**기존:**
```html
    <!-- MomentumHeatmap 모듈 -->
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <script src="./modules/MomentumHeatmap/EventSystem.js"></script>
    <script src="./modules/MomentumHeatmap/DataSkeleton.js"></script>
    <script src="./modules/MomentumHeatmap/UIFramework.js"></script>
    <script src="./modules/MomentumHeatmap/MomentumHeatmap.js"></script>
```

**수정 후:**
```html
    <!-- MomentumHeatmap 모듈 (중복 제거) -->
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <script src="./modules/MomentumHeatmap/MomentumHeatmap.js"></script>
```

---

## 2단계: 테스팅/배포 스크립트 조건부 로딩 (10분)

### 파일: `stock_analyzer.html`

#### 수정 위치 4: Line 1301-1317 영역

**기존:**
```html
    <!-- Collaborative testing suite -->
    <script src="./testing/ModuleTestRunner.js"></script>
    <script src="./testing/IntegrationTests.js"></script>
    <script src="./testing/reporters/DefaultReporter.js"></script>
    <script src="./testing/CollaborativeTestSuite.js"></script>
    <script src="./testing/registerBuiltinTests.js"></script>

    <!-- Deployment system -->
    <script src="./deployment/CanaryDeployment.js"></script>
    <script src="./deployment/AutoRollback.js"></script>
    <script src="./deployment/HealthMonitor.js"></script>
    <script src="./deployment/DeploymentDashboard.js"></script>
    <script src="./deployment/SmartDeploymentSystem.js"></script>
```

**수정 후:**
```html
    <!-- ================================================ -->
    <!-- DEV ONLY: Testing & Deployment (조건부 로딩) -->
    <!-- ================================================ -->
    <script>
    (function() {
        const isDev = window.location.hostname === 'localhost'
                   || window.location.hostname === '127.0.0.1';

        if (isDev) {
            // 테스팅 시스템
            loadScript('./testing/ModuleTestRunner.js');
            loadScript('./testing/IntegrationTests.js');
            loadScript('./testing/reporters/DefaultReporter.js');
            loadScript('./testing/CollaborativeTestSuite.js');
            loadScript('./testing/registerBuiltinTests.js');

            // 배포 시스템
            loadScript('./deployment/CanaryDeployment.js');
            loadScript('./deployment/AutoRollback.js');
            loadScript('./deployment/HealthMonitor.js');
            loadScript('./deployment/DeploymentDashboard.js');
            loadScript('./deployment/SmartDeploymentSystem.js');

            console.log('✅ DEV MODE: Testing & Deployment systems loaded');
        }

        function loadScript(src) {
            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            document.currentScript.parentNode.insertBefore(script, document.currentScript.nextSibling);
        }
    })();
    </script>
```

---

## 3단계: 초기화 순서 보장 (5분)

### 파일: `stock_analyzer_enhanced.js` (또는 메인 JS 파일)

#### 추가할 코드 (파일 시작 부분)

```javascript
/**
 * Stock Analyzer Enhanced - Main Application
 * 초기화 순서 보장
 */

(async function initializeStockAnalyzer() {
    console.log('🚀 Stock Analyzer 초기화 시작...');

    try {
        // Step 1: Core 시스템 확인
        if (!window.eventSystem) {
            throw new Error('EventSystem이 로드되지 않았습니다. HTML 스크립트 순서를 확인하세요.');
        }
        if (!window.dataSkeleton) {
            console.warn('⚠️ DataSkeleton이 없습니다. 기본 동작으로 진행합니다.');
        }
        if (!window.uiFramework) {
            console.warn('⚠️ UIFramework가 없습니다. 기본 동작으로 진행합니다.');
        }

        console.log('✅ Core 시스템 로드 확인 완료');

        // Step 2: 데이터 로드
        console.log('📊 데이터 로딩 중...');
        const response = await fetch('./data/enhanced_summary_data.json');

        if (!response.ok) {
            throw new Error(`데이터 로드 실패: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log(`✅ 데이터 로드 완료: ${data.companies?.length || 0}개 기업`);

        // 전역 저장
        window.stockData = data;

        // Step 3: DataSkeleton 초기화 (있는 경우)
        if (window.dataSkeleton) {
            window.dataSkeleton.init(data);
            console.log('✅ DataSkeleton 초기화 완료');
        }

        // Step 4: 매니저 초기화 (순차적)
        console.log('🔧 매니저 초기화 중...');

        const initPromises = [];

        // 기본 매니저
        if (window.errorFixManager) initPromises.push(window.errorFixManager.init?.());
        if (window.dataCleanupManager) initPromises.push(window.dataCleanupManager.init?.());
        if (window.columnManager) initPromises.push(window.columnManager.init?.());
        if (window.filterManager) initPromises.push(window.filterManager.init?.());
        if (window.paginationManager) initPromises.push(window.paginationManager.init?.());
        if (window.loadingManager) initPromises.push(window.loadingManager.init?.());

        await Promise.all(initPromises.filter(p => p));
        console.log('✅ 기본 매니저 초기화 완료');

        // Step 5: 기능 모듈 초기화
        console.log('🎨 기능 모듈 초기화 중...');

        const modulePromises = [];

        if (window.deepCompare) modulePromises.push(window.deepCompare.init?.());
        if (window.smartAnalytics) modulePromises.push(window.smartAnalytics.init?.());
        if (window.portfolioBuilder) modulePromises.push(window.portfolioBuilder.init?.());
        if (window.economicDashboard) modulePromises.push(window.economicDashboard.init?.());
        if (window.momentumHeatmap) modulePromises.push(window.momentumHeatmap.init?.());

        await Promise.all(modulePromises.filter(p => p));
        console.log('✅ 기능 모듈 초기화 완료');

        // Step 6: UI 렌더링
        console.log('🎨 UI 렌더링...');
        renderInitialUI();

        // Step 7: 이벤트 리스너 등록
        attachEventListeners();

        console.log('🎉 Stock Analyzer 초기화 완료!');

        // 초기화 완료 이벤트
        if (window.eventSystem) {
            window.eventSystem.emit('app:initialized', {
                timestamp: Date.now(),
                dataCount: data.companies?.length || 0
            });
        }

    } catch (error) {
        console.error('❌ 초기화 실패:', error);

        // 사용자에게 에러 표시
        if (window.loadingManager) {
            window.loadingManager.showFeedback(
                `초기화 실패: ${error.message}`,
                'error',
                5000
            );
        } else {
            alert(`Stock Analyzer 초기화 실패:\n${error.message}\n\n페이지를 새로고침해주세요.`);
        }
    }
})();

// 나머지 기존 코드...
```

---

## 4단계: 검증 체크리스트

### 브라우저에서 확인 (F12 개발자 도구)

#### 1. Console 탭 체크
```
예상 로그:
✅ EventSystem 초기화 완료
✅ EventSystem 전역 인스턴스 생성됨: window.eventSystem
✅ DataSkeleton 초기화 완료
✅ UIFramework 초기화 완료
🚀 Stock Analyzer 초기화 시작...
✅ Core 시스템 로드 확인 완료
📊 데이터 로딩 중...
✅ 데이터 로드 완료: 1250개 기업
✅ DataSkeleton 초기화 완료
🔧 매니저 초기화 중...
✅ 기본 매니저 초기화 완료
🎨 기능 모듈 초기화 중...
✅ 기능 모듈 초기화 완료
🎨 UI 렌더링...
🎉 Stock Analyzer 초기화 완료!
```

#### 2. Network 탭 체크
```
확인 사항:
✓ core/EventSystem.js          - 200 OK
✓ core/DataSkeleton.js          - 200 OK
✓ core/UIFramework.js           - 200 OK
✓ enhanced_summary_data.json    - 200 OK
✓ 모든 모듈 JS 파일             - 200 OK

❌ 다음 항목이 없어야 함:
   modules/EconomicDashboard/EventSystem.js     - 404 (제거됨)
   modules/EconomicDashboard/DataSkeleton.js    - 404 (제거됨)
   modules/EconomicDashboard/UIFramework.js     - 404 (제거됨)
   modules/MomentumHeatmap/EventSystem.js       - 404 (제거됨)
   modules/MomentumHeatmap/DataSkeleton.js      - 404 (제거됨)
   modules/MomentumHeatmap/UIFramework.js       - 404 (제거됨)
```

#### 3. 기능 동작 확인
```
테스트 항목:
□ 스크리닝 탭: 테이블 표시
□ 필터링: 필터 적용 가능
□ 대시보드 탭: EconomicDashboard 표시
□ 대시보드 탭: MomentumHeatmap 표시
□ 포트폴리오 탭: PortfolioBuilder 표시
□ 검색 기능: 티커/회사명 검색
□ 차트: 버블 차트, 레이더 차트 렌더링
```

---

## 5단계: 롤백 계획 (문제 발생 시)

### Git 사용 시
```bash
# 변경 사항 되돌리기
git checkout stock_analyzer.html

# 또는 특정 커밋으로 되돌리기
git reset --hard HEAD~1
```

### Git 미사용 시
```bash
# 백업 파일로 복원
cp stock_analyzer.html.backup stock_analyzer.html
```

### 긴급 임시 수정 (브라우저 콘솔)
```javascript
// 404 에러 무시하고 강제 초기화
window.eventSystem = {
    emit: () => {},
    on: () => () => {},
    off: () => {}
};

window.dataSkeleton = {
    query: () => window.stockData?.companies || [],
    subscribe: () => () => {}
};

// 페이지 새로고침
location.reload();
```

---

## 6단계: 성능 개선 보너스 (옵션)

### 스크립트 비동기 로딩 (추가 최적화)

```html
<!-- 비동기 로딩으로 성능 개선 -->
<script>
(function() {
    const scripts = [
        // Core (순차 로드)
        './core/EventSystem.js',
        './core/DataSkeleton.js',
        './core/UIFramework.js',
        './core/ModuleRegistry.js',

        // Managers (병렬 로드)
        './modules/ErrorFixManager.js',
        './modules/DataCleanupManager.js',
        './modules/ColumnManager.js',
        './modules/FilterManager.js',
        './modules/PaginationManager.js',
        './modules/LoadingManager.js'
    ];

    let currentIndex = 0;

    function loadNext() {
        if (currentIndex >= scripts.length) {
            // 모든 스크립트 로드 완료
            console.log('✅ All scripts loaded');
            return;
        }

        const script = document.createElement('script');
        script.src = scripts[currentIndex];
        script.async = false;
        script.onload = () => {
            currentIndex++;
            loadNext();
        };
        script.onerror = () => {
            console.error('❌ Failed to load:', scripts[currentIndex]);
            currentIndex++;
            loadNext();
        };

        document.head.appendChild(script);
    }

    loadNext();
})();
</script>
```

---

## 완료 확인

### 수정 완료 후 체크리스트

```
✅ stock_analyzer.html 수정 완료
   ├─ Core 시스템 로드 추가
   ├─ 중복 스크립트 제거 (6개)
   └─ 테스팅/배포 조건부 로딩

✅ 브라우저 테스트
   ├─ 404 에러 없음
   ├─ 모든 기능 작동
   └─ 콘솔 에러 없음

✅ 기능 검증
   ├─ 스크리닝 탭 작동
   ├─ 대시보드 탭 작동
   └─ 포트폴리오 탭 작동

✅ 성능 확인
   ├─ 페이지 로딩 시간 정상
   ├─ 메모리 사용량 정상
   └─ 네트워크 요청 최적화
```

---

## 문제 발생 시 연락처

**디버깅 로그 수집 방법:**
```javascript
// 브라우저 콘솔에서 실행
console.save = function(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'text/json'});
    const e = document.createEvent('MouseEvents');
    const a = document.createElement('a');
    a.download = filename;
    a.href = window.URL.createObjectURL(blob);
    a.dataset.downloadurl = ['text/json', a.download, a.href].join(':');
    e.initEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
    a.dispatchEvent(e);
};

// 디버그 정보 저장
console.save({
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    globalObjects: {
        eventSystem: !!window.eventSystem,
        dataSkeleton: !!window.dataSkeleton,
        uiFramework: !!window.uiFramework,
        stockData: !!window.stockData
    },
    errors: window.errorLog || []
}, 'stock-analyzer-debug.json');
```

---

**작성**: Claude Code (Root Cause Analyst)
**버전**: 1.0
**최종 수정**: 2025-10-16
