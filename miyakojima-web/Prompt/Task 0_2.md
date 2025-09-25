/sc:implement --task-id="0.2" --validate

**1. 목표:**
   - `miyakojima-web/master_plan_ko.md`의 **Task 0.2**를 완료한다: **Google Apps Script 프로젝트 생성 및 clasp 설정.**

**2. 핵심 컨텍스트 파일:**
   - `miyakojima-web/master_plan_ko.md`
   - `miyakojima-web/docs/gcp_setup_guide.md` (Task 0.1의 결과물)

**3. 지시사항:**
   - `master_plan_ko.md`에 명시된 담당 에이전트 **`devops_architect`**를 활성화하여 작업을 수행하라.
   - 로컬 개발 환경에 **Node.js와 npm**이 설치되어 있다고 가정하고, **`clasp`** (Command Line Apps Script Projects)를 설치하고 Google 계정과 연동하는 방법을 안내하라.
   - `miyakojima-web` 프로젝트 루트에 `gas` (Google Apps Script) 라는 이름의 새 폴더를 생성하고, 그 안에 새로운 Apps Script 프로젝트를 `clasp create` 명령어로 생성하는 절차를 보여줘라.
   - Task 0.1에서 생성한 GCP 프로젝트와 이 Apps Script 프로젝트를 연결하는 방법(`clasp link`)을 설명하라.
   - 이 작업 역시 코드 생성이 아니라, **사용자가 로컬에서 Apps Script 개발 환경을 구축할 수 있도록 돕는 절차 안내서**를 생성하는 것이다. 최종 산출물은 `miyakojima-web/docs/clasp_setup_guide.md` 파일로 저장하라.

**4. 완료 조건:**
   - `miyakojima-web/docs/clasp_setup_guide.md` 파일이 생성되어야 한다.
   - `miyakojima-web/gas/` 폴더가 생성되고 그 안에 `appsscript.json` 파일이 clasp에 의해 생성되어야 한다.
   - `master_plan_ko.md`의 해당 Task 상태를 '완료'로 업데이트하는 수정 제안(diff)을 하라.