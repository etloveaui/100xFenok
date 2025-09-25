/sc:load --introspect --task-manage

**[프로젝트 1단계: 현상 분석 및 기준선 설정]**

**1. 목표:**
   - `miyakojima-web` 프로젝트의 전체 코드, 파일 구조, 그리고 우리의 대화 기록을 종합적으로 분석하여 현재 상태(As-Is)를 정의한다.
   - 이 분석을 바탕으로 기술 부채, 잠재적 리스크, 그리고 가장 먼저 해결해야 할 우선순위를 식별한다.

**2. 담당 에이전트 및 역할:**
   - **`root_cause_analyst`**: 현재 코드가 왜 '스켈레톤' 수준에 머물러 있는지, 기술적 관점에서 근본 원인을 추론한다. (예: 데이터 모델 부재, 핵심 비즈니스 로직 부재 등)
   - **`system_architect`**: 전체 코드 구조와 컴포넌트 간의 관계를 분석한다.
   - **`technical_writer`**: 위 분석 내용을 종합하여, 사람이 이해할 수 있는 **"프로젝트 현황 분석 보고서 (Project Status Analysis Report)"**를 `miyakojima-web/docs/project_status_report.md` 파일로 생성한다. (docs 폴더가 없다면 생성할 것)

**3. 실행 절차:**
   - `think_about_collected_information()`를 사용하여 프로젝트 전체 파일을 스캔하고 컨텍스트를 파악한다.
   - `root_cause_analyst`가 원인 분석을, `system_architect`가 구조 분석을 수행한다.
   - `technical_writer`가 두 분석 결과를 취합하여 지정된 위치에 보고서를 작성한다.

**4. 완료 조건:**
   - `miyakojima-web/docs/project_status_report.md` 파일이 생성되어야 한다.
   - 보고서에는 현재 아키텍처, 핵심 문제점, 그리고 해결 우선순위가 명확하게 기술되어야 한다.