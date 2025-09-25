알겠습니다. 모든 최종 데이터와 요구사항을 확인했으며, 승인에 따라 **Miyakojima-Web 프로젝트 재구축을 위한 최종 실행 계획과 Claude Code용 프롬프트 시리즈**를 제공합니다.

### **최종 전략 요약**

  * **언어**: 모든 산출물은 **한국어**로 생성됩니다.
  * **아키텍처**: **GitHub Pages(프론트엔드) + Google Sheets(데이터베이스) + Google Apps Script(API)** 조합으로 확정합니다.
  * **데이터 처리**: `NewData` 폴더의 최종 JSON 데이터는 `README.md`의 지침에 따라 **반드시 가공 및 변환**하여 Google Sheets에 최적화된 구조로 저장합니다.
  * **작업 방식**: AI가 스스로 \*\*마스터플랜(체크리스트)\*\*을 수립하도록 유도하고, 우리는 그 계획을 기반으로 한 번에 **하나의 작업만 지시**하여 과거의 실패를 반복하지 않습니다.

-----

## 🦾 Claude Code 프로젝트 실행 프롬프트 (최종 버전)

아래 프롬프트들을 순서대로 Claude Code에 입력하세요. 각 단계는 이전 단계의 결과물을 입력으로 사용하여 AI의 컨텍스트 유실을 방지합니다. **Phase 2와 3은 Opus 모델 사용을, Phase 4는 Sonnet 모델 사용을 권장합니다.**

### **Phase 2: 데이터-주도 설계 (Data-Driven Design)**

**목표**: 제공된 모든 최종 JSON 데이터를 분석하여, Google Sheets 기반 데이터베이스의 구조와 이를 제어할 Apps Script API의 명세를 **한국어로** 설계하고 문서화합니다.

```prompt
/sc:design --orchestrate --think-hard

**[프로젝트 2단계: 데이터 변환 설계 및 API 명세화]**

**1. 목표:**
   - `miyakojima-web/NewData/` 폴더 내 모든 최종 JSON 데이터(`core_data`, `data`, `knowledge`)를 종합적으로 분석한다.
   - 이 복잡한 JSON 데이터를 Google Sheets에서 효율적으로 관리하기 위한 최적의 **데이터 구조(스키마)**를 설계한다.
   - 설계된 데이터 구조를 기반으로, 웹앱이 데이터를 읽고 쓸(Read/Write) 수 있는 **Google Apps Script API 명세**를 확정한다.
   - **모든 산출물은 반드시 한국어로 작성한다.**

**2. 핵심 규칙:**
   - `NewData/README.md`의 "절대 데이터를 그대로 참조해 쓰지 말고, 가공해서 쓸 것"이라는 지침을 반드시 준수한다.

**3. 담당 에이전트 및 역할:**
   - **`backend_architect`**:
     1. 모든 JSON 파일을 분석하여, 데이터를 어떤 Google Sheets **시트(탭)들로 분리**할지 결정하고, 각 시트의 **컬럼명, 데이터 타입, 예시 데이터**를 포함한 **데이터 스키마**를 `miyakojima-web/docs/data_schema_ko.md` 파일로 생성한다.
     2. 웹앱이 호출할 Google Apps Script의 **API 명세(엔드포인트, HTTP Method, Request/Response JSON 구조)**를 `miyakojima-web/docs/api_specification_ko.md` 파일로 생성한다. (데이터 조회(GET) 및 수정(POST) 기능 포함)
   - **`system_architect`**: 두 설계 문서를 바탕으로 GitHub Pages, Google Sheets, Apps Script 간의 데이터 흐름을 시각화한 **아키텍처 다이어그램**과 설명을 포함한 `miyakojima-web/docs/architecture_blueprint_ko.md` 문서를 생성한다.

**4. 완료 조건:**
   - `data_schema_ko.md`, `api_specification_ko.md`, `architecture_blueprint_ko.md` 세 개의 파일이 `miyakojima-web/docs/` 폴더 내에 **한국어로** 생성되어야 한다.
```

-----

### **Phase 3: AI 주도 마스터플랜(체크리스트) 수립**

**목표**: 2단계에서 확정된 3개의 설계 문서를 기반으로, 실제 개발을 위한 상세한 기술 \*\*마스터플랜(Master Plan)\*\*을 AI가 직접 **한국어 체크리스트** 형태로 작성하게 합니다.

```prompt
/sc:workflow --task-manage --think-hard

**[프로젝트 3단계: 개발 마스터플랜 수립]**

**1. 목표:**
   - 2단계에서 생성된 설계 문서 3개(`architecture_blueprint_ko.md`, `data_schema_ko.md`, `api_specification_ko.md`)를 모두 읽고, `miyakojima-web`을 완성하기 위한 상세하고 실행 가능한 **단계별 개발 계획(체크리스트)**을 `miyakojima-web/master_plan_ko.md` 파일로 생성한다.
   - **모든 산출물은 반드시 한국어로 작성한다.**

**2. 담당 에이전트 및 역할:**
   - **`system_architect`**: 전체 계획을 총괄하며, 작업을 논리적 순서에 따라 `phase`와 `task`로 분할한다. (예: Phase 1: 데이터 마이그레이션, Phase 2: 백엔드 API 구축 등)
   - 이 작업은 일관성을 위해 **혼자(Single Agent)** 수행해야 한다.

**3. 실행 절차:**
   - `Task Management` 모드를 활성화하여 `phase` -> `task` -> `todo`의 위계로 계획을 수립한다.
   - 각 `task`는 **하루 안에 끝낼 수 있는 작고 명확한 단위**여야 한다.
   - 각 `task`에는 **가장 적절한 담당 에이전트 1명**(예: Apps Script는 `backend_architect`, 프론트는 `frontend_architect`)과 **구체적인 완료 조건(Definition of Done)**을 명시해야 한다.
   - **가장 중요한 첫 Task는 `NewData`의 JSON 파일들을 `data_schema_ko.md` 기반의 새 Google Sheets 구조로 변환하고 업로드하는 '데이터 마이그레이션 스크립트'를 작성하는 것이어야 한다.**
   - 최종 생성된 계획을 `miyakojima-web/master_plan_ko.md` 파일로 저장한다.

**4. 완료 조건:**
   - `miyakojima-web/master_plan_ko.md` 파일이 생성되어야 한다.
   - 파일에는 MVP(최소 기능 제품) 구현을 위한 모든 기술적 작업이 **한국어 체크리스트 형식**으로 명확하게 나열되어야 한다.
```

-----

### **Phase 4: 체크리스트 기반 점진적 구현 (반복 수행)**

**목표**: 3단계에서 수립된 마스터플랜의 **체크리스트 항목을 하나씩** 실행하여, 프로젝트를 점진적으로 완성합니다. 이제부터는 아래 프롬프트 템플릿만 반복해서 사용하시면 됩니다.

```prompt
# [Task 실행 템플릿]

/sc:implement --task-id="[master_plan_ko.md에서 실행할 Task ID 입력]" --validate --safe-mode

**1. 목표:**
   - `miyakojima-web/master_plan_ko.md`의 Task `[Task ID]`를 완료한다.

**2. 핵심 컨텍스트 파일:**
   - `miyakojima-web/master_plan_ko.md`
   - `miyakojima-web/docs/architecture_blueprint_ko.md`
   - `miyakojima-web/docs/data_schema_ko.md`
   - `miyakojima-web/docs/api_specification_ko.md`

**3. 지시사항:**
   - `master_plan_ko.md`에서 이 Task에 명시된 **담당 에이전트**를 활성화하여 작업을 수행하라.
   - Task의 **완료 조건**을 명확히 충족시키는 결과물을 만들어라.
   - 코드와 주석을 포함한 모든 산출물은 **한국어**로 작성하는 것을 우선으로 하되, 기술적 명료성을 위해 필요한 경우(함수명, 변수명 등) 영어를 사용하라.
   - `--validate` 플래그에 따라, 코드 생성 후 자체적으로 테스트 또는 검증 절차를 거쳐 안정성을 확보하라.

**4. 완료 조건:**
   - Task의 모든 요구사항이 코드로 구현되고, 검증 절차를 통과해야 한다.
   - 작업 완료 후, `master_plan_ko.md`의 해당 Task 상태를 '완료'로 업데이트하는 수정 제안(diff)을 하라.
```