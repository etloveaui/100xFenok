# 미야코지마 웹 플랫폼 - 중앙 집중식 초기화 시스템

## 개요

미야코지마 웹 플랫폼의 모듈 초기화 순서 문제를 해결하기 위해 구현된 중앙 집중식 초기화 시스템입니다. 

### 해결된 문제
- ❌ 여러 JS 파일이 DOMContentLoaded에서 동시 초기화
- ❌ Utils, POIManager, BudgetTracker 등 상호 참조 실패
- ❌ 경쟁 상황(race condition)으로 인한 "undefined" 오류
- ❌ 의존성 무시로 인한 불안정한 동작

### 개선된 점
- ✅ 의존성 기반 순차적 모듈 초기화
- ✅ 각 모듈의 초기화 상태 확인 메커니즘
- ✅ 오류 처리 및 재시도 로직
- ✅ 실시간 초기화 진행률 모니터링
- ✅ 개발자 도구를 통한 디버깅 지원

## 아키텍처

### 초기화 순서 (Topological Sort)

```
Phase 1: 기본 설정
├── config.js (기본 설정)
└── utils.js (유틸리티 함수)

Phase 2: 데이터 레이어  
├── storage.js (로컬 스토리지)
└── api.js (백엔드 API) [선택적]

Phase 3: 비즈니스 로직
├── budget.js (예산 관리) [선택적]
├── location.js (위치 추적) [선택적] 
├── poi.js (관심 장소) [선택적]
└── itinerary.js (일정 관리) [선택적]

Phase 4: 메인 앱
└── app.js (메인 애플리케이션)
```

### 모듈 상태 관리

각 모듈은 다음 상태를 가집니다:
- `pending`: 초기화 대기 중
- `loading`: 초기화 진행 중
- `ready`: 초기화 완료
- `failed`: 초기화 실패

## 핵심 컴포넌트

### 1. ModuleInitializer 클래스

```javascript
class ModuleInitializer {
    constructor() {
        this.modules = new Map();           // 모듈 정의 저장
        this.initializationOrder = [];      // 의존성 기반 순서
        this.loadedModules = new Set();     // 로드 완료 모듈
        this.maxRetries = 3;               // 재시도 횟수
    }
}
```

**주요 메서드:**
- `defineModule()`: 모듈 및 의존성 정의
- `calculateInitializationOrder()`: 위상 정렬로 순서 계산
- `initializeModule()`: 개별 모듈 초기화
- `checkDependencies()`: 의존성 확인

### 2. 모듈별 상태 관리 객체

각 모듈 파일에는 상태 관리 객체가 추가됩니다:

```javascript
// 예: utils.js
window.ModuleStatus = {
    isReady: false,
    init: () => {
        // 모듈 초기화 로직
        StorageUtils.cleanExpired();
        window.ModuleStatus.isReady = true;
        
        // 초기화 완료 이벤트 발생
        window.dispatchEvent(new CustomEvent('moduleReady', { 
            detail: { moduleName: 'utils' }
        }));
    }
};
```

### 3. 의존성 정의

```javascript
// app.js에서 모듈 정의
this.defineModule('poi', {
    dependencies: ['config', 'utils', 'storage'],  // 의존 모듈들
    checkReady: () => window.poiManager && window.POIStatus?.isReady,
    initialize: () => window.POIStatus?.init(),
    timeout: 15000,      // 타임아웃 (15초)
    optional: true       // 선택적 모듈 (실패해도 계속 진행)
});
```

## 사용법

### 1. 기본 사용

HTML에서 스크립트 로딩:

```html
<!-- 올바른 순서로 스크립트 로드 -->
<script src="js/config.js"></script>
<script src="js/utils.js"></script>
<script src="js/storage.js"></script>
<script src="js/api.js"></script>
<script src="js/budget.js"></script>
<script src="js/location.js"></script>
<script src="js/poi.js"></script>
<script src="js/itinerary.js"></script>
<script src="js/app.js"></script>  <!-- 마지막에 로드 -->
```

### 2. 새 모듈 추가

새 모듈을 추가할 때는 다음 패턴을 따릅니다:

```javascript
// 1. 모듈 클래스 정의
class NewModule {
    constructor() {
        this.init();
    }
    
    async init() {
        // 초기화 로직
        Logger.info('NewModule 초기화 완료');
    }
}

// 2. 상태 관리 객체 추가
window.NewModuleStatus = {
    isReady: false,
    init: async () => {
        window.newModule = new NewModule();
        window.NewModuleStatus.isReady = true;
        
        window.dispatchEvent(new CustomEvent('moduleReady', { 
            detail: { moduleName: 'newModule' }
        }));
    }
};

// 3. app.js에서 모듈 정의 추가
this.defineModule('newModule', {
    dependencies: ['utils', 'storage'],  // 필요한 의존성
    checkReady: () => window.newModule && window.NewModuleStatus?.isReady,
    initialize: () => window.NewModuleStatus?.init(),
    timeout: 10000,
    optional: false  // 필수 모듈이면 false
});
```

### 3. 초기화 상태 확인

브라우저 콘솔에서 초기화 상태를 확인할 수 있습니다:

```javascript
// 전체 초기화 상태
console.log(window.debugApp.getInitializationStatus());

// 특정 모듈 정보
console.log(window.debugApp.getModules().get('poi'));

// 앱 재시작
window.debugApp.reinitialize();
```

## 테스트 및 디버깅

### 테스트 페이지 사용

`test-initialization.html` 파일을 브라우저에서 열어 실시간 초기화 상태를 모니터링할 수 있습니다.

**기능:**
- 📊 실시간 모듈 상태 표시
- 📈 초기화 진행률 바
- 🔧 기능 테스트 버튼
- 📝 초기화 로그 출력
- 💾 로그 파일 내보내기

### 개발자 도구

```javascript
// 초기화 상태 조회
window.debugApp.getInitializationStatus()

// 모듈 정보 조회  
window.debugApp.getModules()

// 강제 재초기화
window.debugApp.reinitialize()
```

## 오류 처리

### 재시도 메커니즘
- 선택적 모듈은 최대 3회 재시도
- 재시도 간격: 1초, 2초, 3초 (지수적 백오프)
- 필수 모듈 실패 시 전체 초기화 중단

### 타임아웃 처리
- 각 모듈별 개별 타임아웃 설정
- 기본 타임아웃: 10초
- 복잡한 모듈 (API, POI): 15초

### Fallback 메커니즘
- 실제 모듈 로드 실패 시 Mock 객체 생성
- 기본 기능은 유지하되 고급 기능 비활성화
- 사용자에게 부분적 로드 상태 알림

## 성능 최적화

### 병렬 초기화
- 의존성이 없는 모듈들은 병렬로 초기화
- Promise.race를 활용한 타임아웃 처리
- 순차적 의존성만 직렬로 처리

### 리소스 관리
- 메모리 사용량 모니터링
- 불필요한 모듈 언로드
- 가비지 컬렉션 최적화

## 모니터링 및 로깅

### 로그 레벨
- `Logger.info`: 정상적인 초기화 과정
- `Logger.warn`: 선택적 모듈 실패, 재시도
- `Logger.error`: 치명적 오류, 초기화 중단

### 메트릭
- 총 초기화 시간
- 모듈별 초기화 시간
- 실패율 및 재시도 횟수
- 메모리 사용량

## 문제 해결

### 자주 발생하는 문제

1. **"Module not found" 오류**
   - 스크립트 로딩 순서 확인
   - 파일 경로 검증
   - 네트워크 오류 확인

2. **의존성 순환 참조**
   - 모듈 간 의존성 그래프 확인
   - 공통 의존성 추출

3. **초기화 타임아웃**
   - 네트워크 상태 확인
   - 타임아웃 설정 조정
   - 비동기 로직 최적화

### 디버깅 팁
- 브라우저 개발자 도구 Network 탭에서 스크립트 로딩 확인
- Console 탭에서 초기화 로그 모니터링
- `test-initialization.html`로 시각적 디버깅

## 향후 계획

### 확장 기능
- [ ] 모듈 지연 로딩 (Lazy Loading)
- [ ] 동적 모듈 언로드/재로드
- [ ] 성능 메트릭 대시보드
- [ ] A/B 테스트를 위한 조건부 초기화

### 최적화
- [ ] 번들러 통합 (Webpack/Rollup)
- [ ] 트리 셰이킹으로 불필요한 코드 제거
- [ ] Service Worker와 연동한 캐싱 최적화

---

**생성일:** 2025-09-08  
**버전:** 1.0.0  
**작성자:** Claude Code Assistant