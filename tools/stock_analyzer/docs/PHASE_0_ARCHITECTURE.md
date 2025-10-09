# Phase 0: Stock Analyzer Global Expansion 아키텍처 설계

## 🎯 설계 목표
- **무손상 확장**: 기존 시스템 기능 100% 보존
- **매주 데이터 교체**: 30초 이내 원클릭 갱신
- **다중 에이전트 협업**: 명확한 API 경계
- **점진적 마이그레이션**: 단계별 안전한 전환

## 📊 시스템 아키텍처

### Layer 1: Core Foundation (신규)
```
📦 Core Foundation Layer
├── DataSkeleton.js       # 데이터 추상화 계층
├── UIFramework.js        # UI 컴포넌트 팩토리
├── EventSystem.js        # 이벤트 버스 시스템
└── ModuleRegistry.js     # 모듈 생명주기 관리
```

### Layer 2: Legacy Bridge (통합)
```
🔗 Legacy Bridge Layer
├── LegacyAdapter.js      # 기존 매니저 래퍼
├── DataMigrator.js       # 데이터 변환 브릿지
└── EventProxy.js         # 이벤트 시스템 프록시
```

### Layer 3: Module Ecosystem (확장)
```
🎨 Module Ecosystem
├── modules/
│   ├── EconomicDashboard/
│   ├── MomentumHeatmap/
│   ├── SmartAnalytics/
│   ├── DeepCompare/
│   └── PortfolioBuilder/
```

## 🏗️ DataSkeleton 아키텍처

### 핵심 설계 원칙
1. **Schema-Driven**: 스키마 기반 자동 매핑
2. **Zero-Config**: 설정 없이 자동 감지
3. **Reactive Binding**: 구독 패턴으로 실시간 갱신
4. **Error Resilient**: 부분 실패 허용

### DataSkeleton 클래스 설계
```javascript
class DataSkeleton {
    // 📊 데이터 스토어
    #rawData = new Map();          // 원본 데이터 저장
    #processedData = new Map();    // 처리된 데이터 캐시
    #schema = null;                 // 데이터 스키마
    #validators = new Map();       // 검증 규칙

    // 🔄 구독 시스템
    #subscribers = new Set();       // 데이터 변경 구독자
    #moduleSubscribers = new Map(); // 모듈별 구독자

    // 🔧 데이터 교체 파이프라인
    async replaceWeeklyData(csvData) {
        // 1단계: 정제 (0-0x2a0x2a 패턴 제거)
        const cleaned = await this.#cleanData(csvData);

        // 2단계: 스키마 자동 감지
        const schema = await this.#detectSchema(cleaned);

        // 3단계: 필드 매핑
        const mapped = await this.#mapFields(cleaned, schema);

        // 4단계: 검증
        const validated = await this.#validate(mapped);

        // 5단계: 저장 및 캐시
        await this.#store(validated);

        // 6단계: 구독자 알림
        await this.#notifyAll(validated);
    }

    // 🔍 쿼리 인터페이스
    query(options = {}) {
        const {
            filter = {},
            sort = null,
            limit = null,
            offset = 0,
            projection = null
        } = options;

        // 캐시 확인
        const cacheKey = this.#getCacheKey(options);
        if (this.#processedData.has(cacheKey)) {
            return this.#processedData.get(cacheKey);
        }

        // 쿼리 실행
        let result = this.#executeQuery(filter, sort, limit, offset, projection);

        // 캐시 저장
        this.#processedData.set(cacheKey, result);

        return result;
    }

    // 📡 구독 시스템
    subscribe(callback, options = {}) {
        const { module = 'global', events = ['data:change'] } = options;

        const subscription = {
            id: crypto.randomUUID(),
            callback,
            events,
            module
        };

        this.#subscribers.add(subscription);

        // 언구독 함수 반환
        return () => {
            this.#subscribers.delete(subscription);
        };
    }
}
```

## 🎨 UIFramework 인터페이스 설계

### 컴포넌트 계층 구조
```
UIFramework
├── BaseComponent           # 모든 컴포넌트 기본 클래스
├── DataComponent          # 데이터 바인딩 컴포넌트
│   ├── ChartComponent    # 차트 기본
│   │   ├── LineChart
│   │   ├── BarChart
│   │   ├── HeatMap
│   │   └── BubbleChart
│   ├── TableComponent    # 테이블 기본
│   │   ├── DataTable
│   │   ├── PivotTable
│   │   └── TreeTable
│   └── FilterComponent   # 필터 기본
│       ├── RangeFilter
│       ├── SelectFilter
│       └── SearchFilter
└── LayoutComponent        # 레이아웃 컴포넌트
    ├── GridLayout
    ├── FlexLayout
    └── ResponsiveLayout
```

### UIFramework 클래스 설계
```javascript
class UIFramework {
    // 🏭 컴포넌트 팩토리
    createComponent(type, config) {
        const Component = this.#componentRegistry.get(type);

        if (!Component) {
            throw new Error(`Unknown component type: ${type}`);
        }

        return new Component({
            ...config,
            framework: this,
            eventSystem: this.#eventSystem,
            dataSkeleton: this.#dataSkeleton
        });
    }

    // 📱 반응형 레이아웃 빌더
    createResponsiveLayout(config) {
        return new ResponsiveLayout({
            breakpoints: {
                mobile: 768,
                tablet: 1024,
                desktop: 1440
            },
            ...config
        });
    }

    // 🎨 테마 시스템
    applyTheme(themeName) {
        const theme = this.#themes.get(themeName);
        if (theme) {
            document.documentElement.setAttribute('data-theme', themeName);
            this.#currentTheme = theme;
        }
    }

    // 🔄 라이프사이클 관리
    mountComponent(component, container) {
        component.beforeMount();
        container.appendChild(component.render());
        component.afterMount();

        this.#mountedComponents.set(component.id, component);
    }
}
```

## 📡 EventSystem 설계

### 이벤트 흐름 아키텍처
```
Event Flow:
DataSkeleton → EventSystem → UIFramework → Modules
    ↑              ↓              ↓           ↓
    ←──────────────←──────────────←───────────←
```

### EventSystem 클래스 설계
```javascript
class EventSystem {
    // 이벤트 버스
    #eventBus = new Map();
    #eventQueue = [];
    #processing = false;

    // 이벤트 발행
    emit(eventName, payload) {
        const event = {
            name: eventName,
            payload,
            timestamp: Date.now(),
            source: this.#getCallSource()
        };

        // 큐에 추가
        this.#eventQueue.push(event);

        // 처리 시작
        if (!this.#processing) {
            this.#processQueue();
        }
    }

    // 이벤트 구독
    on(eventName, handler, options = {}) {
        const { priority = 0, once = false } = options;

        if (!this.#eventBus.has(eventName)) {
            this.#eventBus.set(eventName, new Set());
        }

        const subscription = { handler, priority, once };
        this.#eventBus.get(eventName).add(subscription);

        // 언구독 함수 반환
        return () => {
            this.#eventBus.get(eventName).delete(subscription);
        };
    }

    // 에러 격리
    #handleError(error, event) {
        console.error(`Event processing error:`, error);

        // 에러 이벤트 발행 (무한 루프 방지)
        if (event.name !== 'system:error') {
            this.emit('system:error', {
                originalEvent: event,
                error: error.message
            });
        }
    }
}
```

## 🤝 다중 에이전트 협업 인터페이스

### Gemini CLI 인터페이스
```javascript
// window.globalScouter 네임스페이스
window.globalScouter = {
    // 데이터 접근
    data: {
        query: (options) => dataSkeleton.query(options),
        subscribe: (callback) => dataSkeleton.subscribe(callback),
        getSchema: () => dataSkeleton.getSchema()
    },

    // 모듈 등록
    modules: {
        register: (name, module) => moduleRegistry.register(name, module),
        get: (name) => moduleRegistry.get(name),
        list: () => moduleRegistry.list()
    },

    // 이벤트
    events: {
        emit: (name, data) => eventSystem.emit(name, data),
        on: (name, handler) => eventSystem.on(name, handler)
    }
};
```

### Codex 인터페이스
```javascript
// window.stockAnalyzer 네임스페이스
window.stockAnalyzer = {
    // UI 컴포넌트
    ui: {
        createChart: (type, config) => uiFramework.createComponent(type, config),
        createTable: (config) => uiFramework.createComponent('DataTable', config),
        createFilter: (config) => uiFramework.createComponent('Filter', config)
    },

    // 분석 도구
    analytics: {
        momentum: (data) => smartAnalytics.analyzeMomentum(data),
        compare: (companies) => deepCompare.compareCompanies(companies),
        portfolio: (stocks) => portfolioBuilder.optimize(stocks)
    }
};
```

## 🔄 마이그레이션 전략

### Phase별 전환 계획

#### Phase 1: Foundation (기반 구축)
```
Week 1-2:
1. Core 시스템 구축 (DataSkeleton, UIFramework, EventSystem)
2. Legacy Bridge 구현
3. 기존 시스템과 병렬 실행
```

#### Phase 2: Migration (점진적 전환)
```
Week 3-4:
1. 기존 매니저를 하나씩 새 시스템으로 전환
2. 각 전환마다 회귀 테스트
3. 롤백 포인트 유지
```

#### Phase 3: Expansion (확장)
```
Week 5-6:
1. 새 모듈 추가 (Economic, Momentum 등)
2. 다중 에이전트 테스트
3. 성능 최적화
```

## 🛡️ 리스크 완화 전략

### 기술적 리스크
1. **데이터 무결성**
   - 체크섬 검증
   - 트랜잭션 로깅
   - 자동 백업

2. **성능 저하**
   - 점진적 로딩
   - 가상 스크롤링
   - 웹 워커 활용

3. **호환성 문제**
   - Feature Detection
   - Polyfill 적용
   - 점진적 개선

### 운영 리스크
1. **데이터 교체 실패**
   - 롤백 메커니즘
   - 검증 파이프라인
   - 알림 시스템

2. **에이전트 충돌**
   - 명확한 API 경계
   - 버전 관리
   - 통합 테스트

## 📋 구현 체크리스트

### DataSkeleton
- [ ] 데이터 정제 시스템
- [ ] 스키마 자동 감지
- [ ] 필드 매핑 엔진
- [ ] 구독 시스템
- [ ] 쿼리 엔진
- [ ] 캐싱 시스템

### UIFramework
- [ ] 컴포넌트 레지스트리
- [ ] 반응형 시스템
- [ ] 테마 엔진
- [ ] 라이프사이클 관리
- [ ] 데이터 바인딩

### EventSystem
- [ ] 이벤트 버스
- [ ] 우선순위 처리
- [ ] 에러 격리
- [ ] 이벤트 큐
- [ ] 디버깅 도구

### Integration
- [ ] Legacy Bridge
- [ ] Agent Interfaces
- [ ] Migration Tools
- [ ] Test Suites
- [ ] Documentation

## 🚀 다음 단계

1. **이 설계 검토 및 승인**
2. **Sonnet으로 전환**
3. **Phase 1 구현 시작**
   - DataSkeleton.js
   - UIFramework.js
   - EventSystem.js

---
*이 문서는 Phase 0 설계의 최종 버전입니다.*
*구현은 이 설계를 기반으로 진행됩니다.*