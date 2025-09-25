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