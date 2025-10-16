# 🤝 다중 에이전트 협업 가이드

## 📦 에이전트별 작업 패키지

### Claude Code (UI/Foundation Specialist)
```javascript
// 담당 영역
const claudeCodePackage = {
    phase1: {
        core: [
            'DataSkeleton.js',      // 데이터 추상화
            'UIFramework.js',       // UI 프레임워크
            'EventSystem.js'        // 이벤트 시스템
        ]
    },
    phase3: {
        modules: [
            'EconomicDashboard/',   // 경제지표 대시보드
            'MomentumHeatmap/'      // 모멘텀 히트맵
        ]
    }
};
```

### Gemini CLI (Analytics Specialist)
```javascript
// 담당 영역
const geminiPackage = {
    phase3: {
        modules: [
            'SmartAnalytics/',      // AI 분석 엔진
            'DeepCompare/'          // 다차원 비교
        ]
    },
    automation: [
        'WeeklyDataProcessor.py',   // 데이터 자동화
        'DataCleaner.py'            // 데이터 정제
    ]
};
```

### Codex (Portfolio/Testing Specialist)
```javascript
// 담당 영역
const codexPackage = {
    phase3: {
        modules: [
            'PortfolioBuilder/'     // 포트폴리오 최적화
        ]
    },
    testing: [
        'TestSuite/',              // 테스트 시스템
        'IntegrationTests/'        // 통합 테스트
    ]
};
```

## 🔌 표준 인터페이스 정의

### 1. 데이터 접근 인터페이스
```javascript
// 모든 에이전트가 사용할 데이터 접근 API
class DataInterface {
    /**
     * 데이터 쿼리
     * @param {Object} options 쿼리 옵션
     * @returns {Array} 쿼리 결과
     */
    static query(options) {
        return window.dataSkeleton.query(options);
    }

    /**
     * 데이터 변경 구독
     * @param {Function} callback 콜백 함수
     * @returns {Function} 언구독 함수
     */
    static subscribe(callback) {
        return window.dataSkeleton.subscribe(callback);
    }

    /**
     * 스키마 정보 조회
     * @returns {Object} 데이터 스키마
     */
    static getSchema() {
        return window.dataSkeleton.getSchema();
    }
}
```

### 2. UI 컴포넌트 인터페이스
```javascript
// UI 컴포넌트 생성 API
class UIInterface {
    /**
     * 차트 컴포넌트 생성
     * @param {String} type 차트 타입
     * @param {Object} config 설정
     * @returns {Component} 차트 컴포넌트
     */
    static createChart(type, config) {
        return window.uiFramework.createComponent(`Chart.${type}`, config);
    }

    /**
     * 테이블 컴포넌트 생성
     * @param {Object} config 설정
     * @returns {Component} 테이블 컴포넌트
     */
    static createTable(config) {
        return window.uiFramework.createComponent('Table', config);
    }

    /**
     * 필터 컴포넌트 생성
     * @param {Object} config 설정
     * @returns {Component} 필터 컴포넌트
     */
    static createFilter(config) {
        return window.uiFramework.createComponent('Filter', config);
    }
}
```

### 3. 모듈 등록 인터페이스
```javascript
// 모듈 등록 API
class ModuleInterface {
    /**
     * 모듈 등록
     * @param {String} name 모듈 이름
     * @param {Object} module 모듈 객체
     */
    static register(name, module) {
        // 모듈 검증
        if (!module.init || !module.render) {
            throw new Error('Module must have init() and render() methods');
        }

        // 등록
        window.moduleRegistry.register(name, module);

        // 이벤트 발행
        window.eventSystem.emit('module:registered', { name, module });
    }

    /**
     * 모듈 조회
     * @param {String} name 모듈 이름
     * @returns {Object} 모듈 객체
     */
    static get(name) {
        return window.moduleRegistry.get(name);
    }
}
```

### 4. 이벤트 통신 인터페이스
```javascript
// 이벤트 통신 API
class EventInterface {
    /**
     * 이벤트 발행
     * @param {String} eventName 이벤트 이름
     * @param {Any} data 데이터
     */
    static emit(eventName, data) {
        window.eventSystem.emit(eventName, data);
    }

    /**
     * 이벤트 구독
     * @param {String} eventName 이벤트 이름
     * @param {Function} handler 핸들러
     * @returns {Function} 언구독 함수
     */
    static on(eventName, handler) {
        return window.eventSystem.on(eventName, handler);
    }
}
```

## 📋 작업 규칙 및 가이드라인

### 1. 파일 구조 규칙
```
modules/[ModuleName]/
├── index.js              # 모듈 진입점
├── [ModuleName].js       # 메인 클래스
├── components/           # 컴포넌트
│   └── *.js
├── styles/              # 스타일시트
│   └── *.css
├── tests/               # 테스트
│   └── *.test.js
└── README.md            # 모듈 문서
```

### 2. 모듈 구현 템플릿
```javascript
// modules/[ModuleName]/[ModuleName].js
export default class [ModuleName] {
    constructor() {
        this.name = '[ModuleName]';
        this.version = '1.0.0';
        this.dependencies = [];
    }

    /**
     * 모듈 초기화
     * @returns {Promise<void>}
     */
    async init() {
        // 데이터 구독
        this.unsubscribe = DataInterface.subscribe((data) => {
            this.handleDataUpdate(data);
        });

        // 이벤트 리스너
        EventInterface.on('system:ready', () => {
            this.onSystemReady();
        });
    }

    /**
     * 모듈 렌더링
     * @param {HTMLElement} container
     * @returns {HTMLElement}
     */
    render(container) {
        const element = document.createElement('div');
        element.className = this.name.toLowerCase();

        // UI 컴포넌트 생성
        const chart = UIInterface.createChart('line', {
            data: this.data,
            options: this.chartOptions
        });

        element.appendChild(chart.render());
        container.appendChild(element);

        return element;
    }

    /**
     * 모듈 소멸
     */
    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    }
}
```

### 3. 데이터 요청 규칙
```javascript
// ✅ 올바른 예시
const data = DataInterface.query({
    filter: {
        country: 'USA',
        marketCap: { $gt: 1000000000 }
    },
    sort: { field: 'marketCap', order: 'desc' },
    limit: 100,
    projection: ['ticker', 'name', 'marketCap', 'revenue']
});

// ❌ 잘못된 예시 (직접 접근)
const data = window.dataSkeleton.rawData; // 직접 접근 금지
```

### 4. 이벤트 명명 규칙
```javascript
// 시스템 이벤트
'system:ready'          // 시스템 준비 완료
'system:error'          // 시스템 오류

// 데이터 이벤트
'data:updated'          // 데이터 갱신
'data:error'            // 데이터 오류

// 모듈 이벤트
'module:registered'     // 모듈 등록
'module:ready'          // 모듈 준비
'module:error'          // 모듈 오류

// 커스텀 이벤트 (모듈명 접두사)
'economicDashboard:indicatorUpdated'
'momentumHeatmap:periodChanged'
'portfolioBuilder:optimizationComplete'
```

### 5. 에러 처리 규칙
```javascript
class ModuleBase {
    handleError(error, context) {
        console.error(`[${this.name}] Error in ${context}:`, error);

        // 시스템에 에러 보고
        EventInterface.emit('module:error', {
            module: this.name,
            context,
            error: error.message,
            stack: error.stack
        });

        // 사용자에게 알림 (선택적)
        if (this.showUserErrors) {
            this.showErrorMessage(error.message);
        }
    }
}
```

## 🔄 통합 테스트 체크리스트

### 각 모듈 완성 시
- [ ] 모듈 초기화 테스트
- [ ] 데이터 쿼리 테스트
- [ ] 이벤트 발행/구독 테스트
- [ ] UI 렌더링 테스트
- [ ] 에러 처리 테스트
- [ ] 메모리 누수 테스트

### 전체 통합 시
- [ ] 모듈 간 통신 테스트
- [ ] 데이터 일관성 테스트
- [ ] 성능 벤치마크
- [ ] 브라우저 호환성
- [ ] 모바일 반응형

## 📝 코드 리뷰 체크리스트

### 코드 품질
- [ ] ESLint 통과
- [ ] JSDoc 주석 완성
- [ ] 단위 테스트 작성
- [ ] 에러 처리 구현

### 성능
- [ ] 불필요한 리렌더링 방지
- [ ] 메모리 누수 체크
- [ ] 대용량 데이터 처리
- [ ] 비동기 처리 최적화

### 문서화
- [ ] README.md 작성
- [ ] API 문서 작성
- [ ] 사용 예시 제공
- [ ] 변경 이력 기록

## 🎯 협업 워크플로우

### 1. 모듈 개발 시작
```bash
# 1. 브랜치 생성
git checkout -b feature/module-name

# 2. 모듈 구조 생성
mkdir -p modules/ModuleName/{components,styles,tests}

# 3. 기본 파일 생성
touch modules/ModuleName/{index.js,ModuleName.js,README.md}
```

### 2. 개발 진행
```javascript
// 1. 인터페이스 사용
import { DataInterface, UIInterface, EventInterface } from '../../core/interfaces';

// 2. 모듈 구현
export default class ModuleName {
    // 구현...
}

// 3. 모듈 등록
ModuleInterface.register('ModuleName', new ModuleName());
```

### 3. 테스트 및 통합
```bash
# 1. 단위 테스트
npm run test:module ModuleName

# 2. 통합 테스트
npm run test:integration

# 3. 린트 체크
npm run lint

# 4. PR 생성
git push origin feature/module-name
```

## 🚨 주의사항

### 절대 하지 말아야 할 것
1. **직접 DOM 조작** - UIFramework 사용
2. **전역 변수 오염** - 네임스페이스 사용
3. **동기 파일 로딩** - 비동기 처리
4. **하드코딩된 경로** - 설정 파일 사용

### 반드시 해야 할 것
1. **에러 경계 설정** - try/catch 사용
2. **메모리 정리** - destroy 메서드 구현
3. **이벤트 언구독** - 메모리 누수 방지
4. **성능 모니터링** - 디버깅 도구 활용

---
*이 가이드는 모든 에이전트가 준수해야 할 협업 규칙입니다.*
*질문이나 개선사항이 있으면 즉시 공유해주세요.*