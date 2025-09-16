// 🎯 MCP 도구 자동 선택 및 오케스트레이션 시스템
// 상황별로 최적의 MCP 도구 조합을 자동 선택하는 스마트 시스템

class MCPOrchestrator {
  constructor() {
    this.workPhases = {
      PLANNING: 'planning',
      IMPLEMENTATION: 'implementation',
      VALIDATION: 'validation',
      ANALYSIS: 'analysis'
    };

    this.mcpTools = {
      SEQUENTIAL: 'sequential-thinking',
      CONTEXT7: 'context7',
      MORPHLLM: 'morphllm',
      PLAYWRIGHT: 'playwright',
      SERENA: 'serena',
      MAGIC: 'magic'
    };

    this.complexityThresholds = {
      SIMPLE: 1,
      MODERATE: 3,
      COMPLEX: 5,
      ULTRA_COMPLEX: 8
    };
  }

  /**
   * 작업 복잡도를 자동 분석
   * @param {Object} taskInfo - 작업 정보
   * @returns {number} 복잡도 점수 (1-10)
   */
  analyzeComplexity(taskInfo) {
    let complexity = 0;

    // 파일 수 기반 복잡도
    if (taskInfo.fileCount > 10) complexity += 3;
    else if (taskInfo.fileCount > 5) complexity += 2;
    else if (taskInfo.fileCount > 2) complexity += 1;

    // 디렉토리 수 기반 복잡도
    if (taskInfo.directoryCount > 5) complexity += 2;
    else if (taskInfo.directoryCount > 2) complexity += 1;

    // 작업 단계 수 기반 복잡도
    if (taskInfo.stepCount > 7) complexity += 3;
    else if (taskInfo.stepCount > 4) complexity += 2;
    else if (taskInfo.stepCount > 2) complexity += 1;

    // 기술 스택 복잡도
    if (taskInfo.hasAPI) complexity += 1;
    if (taskInfo.hasDatabase) complexity += 1;
    if (taskInfo.hasUI) complexity += 1;
    if (taskInfo.hasMultipleLanguages) complexity += 2;

    return Math.min(complexity, 10);
  }

  /**
   * 작업 단계에 따른 최적 MCP 도구 조합 선택
   * @param {string} phase - 작업 단계
   * @param {number} complexity - 복잡도 점수
   * @param {Object} context - 추가 컨텍스트 정보
   * @returns {Array} 추천 MCP 도구 배열
   */
  selectMCPTools(phase, complexity, context = {}) {
    const tools = [];

    switch (phase) {
      case this.workPhases.PLANNING:
        // 계획 수립 단계: 분석과 설계가 핵심
        if (complexity >= this.complexityThresholds.MODERATE) {
          tools.push(this.mcpTools.SEQUENTIAL); // 필수: 체계적 분석
        }

        if (context.needsDocumentation || context.hasFramework) {
          tools.push(this.mcpTools.CONTEXT7); // 공식 문서 참조
        }

        if (complexity >= this.complexityThresholds.COMPLEX) {
          tools.push('agent-mode-opus'); // 최고급 계획 생성
        }
        break;

      case this.workPhases.IMPLEMENTATION:
        // 구현 단계: 실제 코드 작성과 편집
        if (context.bulkEdits || context.fileCount > 5) {
          tools.push(this.mcpTools.MORPHLLM); // 패턴 기반 대량 편집
        }

        if (context.hasUI || context.needsComponents) {
          tools.push(this.mcpTools.MAGIC); // UI 컴포넌트 생성
        }

        if (context.needsMemory || context.hasLargeCodebase) {
          tools.push(this.mcpTools.SERENA); // 메모리 관리
        }

        if (complexity >= this.complexityThresholds.MODERATE) {
          tools.push(this.mcpTools.SEQUENTIAL); // 구현 전략 분석
        }
        break;

      case this.workPhases.VALIDATION:
        // 검증 단계: 테스트와 품질 확인
        if (context.hasUI || context.needsBrowserTest) {
          tools.push(this.mcpTools.PLAYWRIGHT); // E2E 테스트
        }

        if (complexity >= this.complexityThresholds.MODERATE) {
          tools.push(this.mcpTools.SEQUENTIAL); // 체계적 검증
        }

        if (context.needsPerformanceTest) {
          tools.push(this.mcpTools.PLAYWRIGHT); // 성능 테스트
        }
        break;

      case this.workPhases.ANALYSIS:
        // 분석 단계: 문제 해결과 최적화
        tools.push(this.mcpTools.SEQUENTIAL); // 필수: 체계적 분석

        if (context.needsDocumentation) {
          tools.push(this.mcpTools.CONTEXT7); // 레퍼런스 검색
        }

        if (context.hasLargeCodebase) {
          tools.push(this.mcpTools.SERENA); // 코드베이스 탐색
        }
        break;

      default:
        // 기본: Sequential으로 시작
        tools.push(this.mcpTools.SEQUENTIAL);
    }

    return [...new Set(tools)]; // 중복 제거
  }

  /**
   * 자동 MCP 도구 선택 및 추천
   * @param {Object} taskDescription - 작업 설명
   * @returns {Object} 추천 도구와 실행 계획
   */
  autoSelectMCP(taskDescription) {
    const complexity = this.analyzeComplexity(taskDescription);
    const phase = this.detectWorkPhase(taskDescription);
    const context = this.extractContext(taskDescription);

    const recommendedTools = this.selectMCPTools(phase, complexity, context);

    const executionPlan = this.createExecutionPlan(recommendedTools, complexity);

    return {
      complexity,
      phase,
      recommendedTools,
      executionPlan,
      reasoning: this.generateReasoning(phase, complexity, context, recommendedTools)
    };
  }

  /**
   * 작업 단계 자동 감지
   * @param {Object} taskDescription - 작업 설명
   * @returns {string} 감지된 작업 단계
   */
  detectWorkPhase(taskDescription) {
    const description = taskDescription.description?.toLowerCase() || '';

    // 계획 단계 키워드
    if (description.includes('계획') || description.includes('설계') ||
        description.includes('분석') || description.includes('plan')) {
      return this.workPhases.PLANNING;
    }

    // 구현 단계 키워드
    if (description.includes('구현') || description.includes('작성') ||
        description.includes('생성') || description.includes('개발')) {
      return this.workPhases.IMPLEMENTATION;
    }

    // 검증 단계 키워드
    if (description.includes('테스트') || description.includes('검증') ||
        description.includes('확인') || description.includes('검사')) {
      return this.workPhases.VALIDATION;
    }

    // 분석 단계 키워드
    if (description.includes('디버그') || description.includes('문제') ||
        description.includes('오류') || description.includes('최적화')) {
      return this.workPhases.ANALYSIS;
    }

    // 기본값: 분석 단계
    return this.workPhases.ANALYSIS;
  }

  /**
   * 컨텍스트 정보 추출
   * @param {Object} taskDescription - 작업 설명
   * @returns {Object} 추출된 컨텍스트
   */
  extractContext(taskDescription) {
    const context = {
      hasUI: false,
      hasAPI: false,
      hasDatabase: false,
      needsDocumentation: false,
      bulkEdits: false,
      needsBrowserTest: false,
      hasFramework: false,
      needsMemory: false,
      hasLargeCodebase: false,
      hasMultipleLanguages: false,
      needsComponents: false,
      needsPerformanceTest: false
    };

    const description = taskDescription.description?.toLowerCase() || '';
    const files = taskDescription.files || [];

    // UI 관련 감지
    if (description.includes('ui') || description.includes('컴포넌트') ||
        description.includes('버튼') || description.includes('화면')) {
      context.hasUI = true;
      context.needsComponents = true;
    }

    // API 관련 감지
    if (description.includes('api') || description.includes('서버') ||
        description.includes('통신') || description.includes('요청')) {
      context.hasAPI = true;
    }

    // 대량 편집 감지
    if (taskDescription.fileCount > 5 || description.includes('일괄') ||
        description.includes('모든') || description.includes('전체')) {
      context.bulkEdits = true;
    }

    // 브라우저 테스트 감지
    if (description.includes('테스트') || description.includes('브라우저') ||
        description.includes('e2e') || description.includes('ui 테스트')) {
      context.needsBrowserTest = true;
    }

    // 문서 필요성 감지
    if (description.includes('문서') || description.includes('가이드') ||
        description.includes('설명서') || description.includes('매뉴얼')) {
      context.needsDocumentation = true;
    }

    // 프레임워크 감지
    if (description.includes('react') || description.includes('vue') ||
        description.includes('angular') || description.includes('shadcn')) {
      context.hasFramework = true;
    }

    // 대형 코드베이스 감지
    if (taskDescription.fileCount > 20 || taskDescription.directoryCount > 10) {
      context.hasLargeCodebase = true;
      context.needsMemory = true;
    }

    return context;
  }

  /**
   * 실행 계획 생성
   * @param {Array} tools - 선택된 도구들
   * @param {number} complexity - 복잡도
   * @returns {Object} 실행 계획
   */
  createExecutionPlan(tools, complexity) {
    const plan = {
      parallel: [],
      sequential: [],
      estimated_time: 0,
      resource_usage: 'low'
    };

    // 복잡도에 따른 실행 전략
    if (complexity >= this.complexityThresholds.COMPLEX) {
      // 복잡한 작업: 순차 실행 위주
      plan.sequential = tools;
      plan.estimated_time = tools.length * 15; // 도구당 15분 예상
      plan.resource_usage = 'high';
    } else if (complexity >= this.complexityThresholds.MODERATE) {
      // 중간 복잡도: 일부 병렬 가능
      const [first, ...rest] = tools;
      plan.sequential = [first];
      plan.parallel = rest;
      plan.estimated_time = Math.max(10, rest.length * 8); // 병렬 실행으로 시간 단축
      plan.resource_usage = 'medium';
    } else {
      // 단순한 작업: 병렬 실행 가능
      plan.parallel = tools;
      plan.estimated_time = Math.max(5, tools.length * 3);
      plan.resource_usage = 'low';
    }

    return plan;
  }

  /**
   * 추천 이유 생성
   * @param {string} phase - 작업 단계
   * @param {number} complexity - 복잡도
   * @param {Object} context - 컨텍스트
   * @param {Array} tools - 선택된 도구들
   * @returns {string} 추천 이유
   */
  generateReasoning(phase, complexity, context, tools) {
    let reasoning = `작업 단계: ${phase}, 복잡도: ${complexity}/10\n\n`;

    reasoning += "선택된 MCP 도구들:\n";
    tools.forEach(tool => {
      switch(tool) {
        case this.mcpTools.SEQUENTIAL:
          reasoning += `• ${tool}: 체계적 분석 및 구조화된 접근이 필요\n`;
          break;
        case this.mcpTools.CONTEXT7:
          reasoning += `• ${tool}: 공식 문서 참조 및 베스트 프랙티스 적용\n`;
          break;
        case this.mcpTools.MORPHLLM:
          reasoning += `• ${tool}: 대량 파일 편집 및 패턴 기반 변환\n`;
          break;
        case this.mcpTools.PLAYWRIGHT:
          reasoning += `• ${tool}: 브라우저 자동화 및 E2E 테스트\n`;
          break;
        case this.mcpTools.SERENA:
          reasoning += `• ${tool}: 대형 코드베이스 메모리 관리\n`;
          break;
        case this.mcpTools.MAGIC:
          reasoning += `• ${tool}: UI 컴포넌트 생성 및 디자인 시스템\n`;
          break;
        default:
          reasoning += `• ${tool}: 작업 특성에 최적화된 도구\n`;
      }
    });

    return reasoning;
  }
}

// 미야코지마 웹 프로젝트 특화 MCP 선택기
class MiyakojimaWebMCPSelector extends MCPOrchestrator {
  constructor() {
    super();
    this.projectContext = {
      isVanillaJS: true,
      hasShadcnUI: true,
      hasGoogleAPIs: true,
      isMobileFirst: true,
      hasMultipleComponents: true
    };
  }

  /**
   * 미야코지마 웹 프로젝트 특화 도구 선택
   * @param {Object} task - 작업 정보
   * @returns {Object} 프로젝트 특화 추천
   */
  selectForMiyakojima(task) {
    const baseRecommendation = this.autoSelectMCP(task);

    // 프로젝트 특화 조정
    if (task.description?.includes('shadcn') || task.description?.includes('ui')) {
      if (!baseRecommendation.recommendedTools.includes(this.mcpTools.MAGIC)) {
        baseRecommendation.recommendedTools.push(this.mcpTools.MAGIC);
      }
    }

    if (task.description?.includes('테스트') || task.description?.includes('브라우저')) {
      if (!baseRecommendation.recommendedTools.includes(this.mcpTools.PLAYWRIGHT)) {
        baseRecommendation.recommendedTools.push(this.mcpTools.PLAYWRIGHT);
      }
    }

    if (task.description?.includes('css') || task.description?.includes('스타일')) {
      if (!baseRecommendation.recommendedTools.includes(this.mcpTools.MORPHLLM)) {
        baseRecommendation.recommendedTools.push(this.mcpTools.MORPHLLM);
      }
    }

    return baseRecommendation;
  }
}

// 전역 인스턴스 생성
const mcpOrchestrator = new MCPOrchestrator();
const miyakojimaMCPSelector = new MiyakojimaWebMCPSelector();

// 사용 예시 및 테스트
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MCPOrchestrator,
    MiyakojimaWebMCPSelector,
    mcpOrchestrator,
    miyakojimaMCPSelector
  };
}

// 브라우저 환경에서 전역 객체로 노출
if (typeof window !== 'undefined') {
  window.MCPOrchestration = {
    mcpOrchestrator,
    miyakojimaMCPSelector
  };
}