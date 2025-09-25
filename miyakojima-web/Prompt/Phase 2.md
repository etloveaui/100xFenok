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