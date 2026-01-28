# 100x Daily Wrap (마켓랩) 완전 자동화 파이프라인 구축 제안

## 1. 배경 및 목표
현재 Daily Wrap 리포트 작성은 **3~4시간**의 상당한 수동 작업 시간이 소요됩니다. 이는 데이터 수집, 수치 계산, 다양한 소스 취합, 그리고 1,600줄 이상의 HTML 파일에 대한 정교한 포맷팅 때문입니다.

본 제안은 이러한 **반복적인 데이터 수집, 계산, 포맷팅 작업을 완전히 자동화**하여, 100x 팀(스타크와 서브 에이전트)이 전략적 분석과 고품질 코멘터리 작성에 집중할 수 있는 환경을 조성하는 것을 목표로 합니다.

---

## 2. 기존 프로세스의 한계 분석
`100x-daily-wrap-template.html`과 `wrap-generate-prompt.txt`를 분석한 결과, 현재 프로세스는 다음과 같은 구조적 한계가 있습니다:

1.  **수동 데이터 추출 (High Effort):**
    *   외신 검색 (Zai Search), Fed 데이터(FRED), IB 리서치 등을 매번 수동으로 검색하고 확인.
    *   Jason 파일(Part 1, 2)에 수동으로 데이터를 정리하는 과정 필요.
2.  **단일 HTML 템플릿 의존 (Low Flexibility):**
    *   1,600줄 이상의 HTML 파일 내부에 직접 데이터를 넣는 방식은 오류 발생 가능성이 높고, LLM이 수정하기에도 번거롭습니다.
    *   디자인과 데이터가 강하게 결합(Coupling)되어 있어, 데이터만 교체하기 어렵습니다.
3.  **분산된 관리 (Inconsistency):**
    *   데이터와 결과물이 분리되어 있어 형상 관리(Version Control)가 어렵고, 히스토리 추적이 불편합니다.

---

## 3. 제안하는 완전 자동화 파이프라인

스타크와 서브 에이전트가 **100% 자율적으로** 수행하기 위한 파이프라인 설계안입니다.

### A. 데이터 수집 계층 (Data Layer)
에이전트가 실행되면 가장 먼저 외부 데이터를 자동 수집합니다.

| 데이터 유형 | 소스 | 목적 | 비고 |
| :--- | :--- | :--- | :--- |
| **거시 지표** | `FRED API` | Fed资产负债表, TGA, RRP 데이터 자동 수집 | 100x 유동성 지표 계산용 |
| **시장 지수** | `Yahoo Finance` / `yfinance` | S&P 500, Nasdaq, VIX, 10Y Treasury 종가/변동률 | 핵심 지표 섹션 |
| **환율/원자재** | `Yahoo Finance` | DXY, USD/KRW, Gold, Oil, NatGas | 멀티에셋 대시보드 |
| **암호화폐** | `Binance API` / `CoinGecko` | BTC, ETH 가격 및 변동률 | 디지털 자산 섹션 |
| **외신/뉴스** | `Zai Search API` / `Brave Search` | Market Moving News, Economic News | "오늘의 논점" 작성용 |
| **IB 리서치** | `Zai Search API` | MS, GS, JPM 등 주요 투자은행 리서치 업데이트 | 월스트리트 인텔리전스 섹션 |
| **섹터 데이터** | `SPDR ETF Data` | XLE, XLF, XLK 등 섹터별 수익률 | 섹터 순환 동향 히트맵 |

**구현 방식:** Python 스크립트(`fetcher.py`)를 통해 매일 아침 지정된 시간에 API를 호출하여 `data/YYYY-MM-DD.json` 형태로 저장합니다.

### B. 템플릿 엔진 적용 (Presentation Layer)
LLM이 HTML 태그를 직접 생성하는 것은 번거롭고 비효율적입니다. **데이터와 디자인을 분리**하는 표준적인 템플릿 엔진을 적용합니다.

1.  **Template (.html):**
    *   기존 디자인을 유지하되, 데이터가 들어갈 부분을 플레이스홀더로 변경합니다.
    *   예시:
        ```html
        <!-- 기존 -->
        <p class="text-2xl font-bold text-green-600">[지수 값]</p>

        <!-- 신규 (Jinja2/Handlebars 문법) -->
        <p class="text-2xl font-bold text-green-600">{{ metrics.sp500.value }}</p>
        ```

2.  **Data (.json):**
    *   `data/YYYY-MM-DD.json` 파일에 모든 섹터의 데이터를 구조화하여 저장합니다.
    *   LLM은 이 JSON 스키마를 참고하여 데이터를 생성하거나, 기존 JSON 데이터를 수정합니다.

3.  **Rendering:**
    *   파이썬 `Jinja2` 라이브러리를 사용하여 `Template + Data = Final HTML`을 렌더링합니다.

### C. 에이전트 자율 워크플로우 (Agent Workflow)
서브 에이전트가 이 파이프라인을 어떻게 실행하는지 보여줍니다.

1.  **트리거:** 매일 오전 8시 (KST) 또는 Boss의 "!generate_wrap" 명령어 수신 시 실행.
2.  **수집:** `fetcher.py`를 호출하여 `data/YYYY-MM-DD.json` 업데이트.
3.  **생성 (LLM Task):**
    *   **Input:** `wrap-generate-prompt.txt` + `data/YYYY-MM-DD.json` (Market Data)
    *   **Task:** "오늘의 논점", "주요 변화 요인", "코멘트" 등 **핵심 텍스트와 분석 데이터**를 생성하여 `analysis.json`으로 저장. (HTML 생성이 아닌 데이터 생성에 집중)
4.  **렌더링:** `renderer.py` 실행.
    *   `template-core.html` + `data/YYYY-MM-DD.json` + `analysis.json` 병합.
5.  **출력:** `/home/etloveaui/clawd/100xFenok/100x/daily-wrap/YYYY-MM-DD_100x-daily-wrap.html` 생성.
6.  **인덱싱:** `index.html` 또는 `README.md`에 생성된 파일 링크 자동 추가.

---

## 4. 기대 효과

| 항목 | 기존 (수동) | 자동화 후 | 개선도 |
| :--- | :--- | :--- | :--- |
| **작업 시간** | 3~4시간 | 5~10분 | **90% 감소** |
| **데이터 오류** | 높음 (수동 입력) | 낮음 (API 연동) | **정확도 향상** |
| **일관성** |変動 (매일 다름) | 고정 (템플릿 기반) | **품질 안정화** |
| **확장성** | 낮음 (변경 어려움) | 높음 (데이터 추가 용이) | **유연성 확보** |

---

## 5. 실행 로드맵 (Roadmap)

1.  **Phase 1: 데이터 파이프라인 구축 (1주차)**
    *   FRED API, Yahoo Finance API 연동 스크립트 작성.
    *   `data/YYYY-MM-DD.json` 스키마 정의 및 생성기 개발.
2.  **Phase 2: 템플릿 리팩토링 (2주차)**
    *   `100x-daily-wrap-template.html`을 `template-core.html`과 분리.
    *   Jinja2 문법 적용 및 HTML 검증.
3.  **Phase 3: 파이프라인 통합 및 오토메이션 (3주차)**
    *   `render.py` 스크립트 작성.
    *   에이전트 워크플로우 정의 및 테스트.

---

## 6. 즉시 실행 가능한 액션 플랜

스타크, 아래 단계에 따라 즉시 개발을 진행할 수 있습니다.

1.  **파일 분리:** 디자인 코드(`styles.css`)와 구조 코드(`template-core.html`) 분리.
2.  **데이터 스키마 작성:** 모든 섹션(Key Metrics, Sector Data, IB Updates 등)이 들어갈 JSON 스키마 초안 작성.
3.  **렌더러 개발:** Python Jinja2를 활용한 HTML 생성기 코딩 시작.

이 파이프라인이 완성되면, Boss는 단순히 "오늘도 리포트 만들어줘"라는 지시만 내리면 되고, 스타크는 더 깊은 시장 분석과 전략 수립에 에너지를 쏟을 수 있을 것입니다.
