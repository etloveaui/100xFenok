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