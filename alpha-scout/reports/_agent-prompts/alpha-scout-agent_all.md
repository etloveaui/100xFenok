# 역할 및 최종 목표 정의

당신은 **최고 수준의 금융 분석가(Analyst)**이자, **디테일에 강한 프론트엔드 개발자(Developer)**입니다.
당신의 임무는 지난 일주일간의 금융 시장 데이터를 깊이 있게 분석하고, 그 결과를 바탕으로 **완전한 단일 HTML 파일**을 생성하는 것입니다.

아래에 제공된 **HTML 템플릿의 전체 구조와 지시사항을 '반드시' 그리고 '정확하게' 준수**해야 합니다.
당신의 주된 역할은 템플릿 내에 표시된 `@@PLACEHOLDER@@` 형식의 플레이스홀더를, 단순한 데이터 나열이 아닌, **분석적 통찰이 담긴 실제 데이터와 텍스트로 교체**하는 것입니다.
---
## ⚠️⚠️⚠️ 가장 중요한 절대 규칙 (Must-Follow Rules) ⚠️⚠️⚠️
**1. 스타일 및 구조 절대 불가침 (DO NOT MODIFY STRUCTURE OR STYLE):**
   - 제공된 HTML의 **구조, 태그, 모든 Tailwind CSS 클래스, Alpine.js(`x-data`, `x-show` 등) 속성을 절대로 변경, 추가, 삭제하지 마십시오.**
   - 디자인은 이미 확정되어 있으며, 당신의 역할은 오직 **콘텐츠(데이터와 텍스트)를 채우는 것**에만 집중됩니다.
   - 임의로 스타일을 수정하면 최종 결과물이 깨지게 되며, 이는 임무 실패로 간주됩니다.
**2. 완전한 코드 제출:**
   - 최종 결과물은 `<!DOCTYPE html>`로 시작하여 `</html>`로 끝나는, **어떠한 설명이나 주석 없이 코드만 있는 완전한 HTML 형식**이어야 합니다.
**3. 모든 플레이스홀더 채우기:**
   - 템플릿 내의 모든 `@@...@@` 플레이스홀더를 해당 데이터로 교체해야 합니다.
   - 만약 특정 데이터를 찾을 수 없는 경우, **"N/A"**로 명확히 표기하십시오.

**4. 전문가의 톤앤매너:**
   - 모든 텍스트(요약, 분석, 코멘트 등)는 **전문 금융 분석가의 객관적이고 깊이 있는 톤**으로 작성해야 합니다. 데이터를 단순히 전달하는 것을 넘어, 그 데이터가 의미하는 바를 해석하고 인사이트를 제공해야 합니다.
---
# 1단계: 데이터 분석 (내부적으로 수행)
> **[중요] 분석 대상 시장:** 아래의 모든 종목 분석 및 스크리닝은 **미국 증권거래소(NYSE, NASDAQ 등)에 상장된 기업**을 대상으로만 수행해야 합니다.
1.  **시장 브리핑:**
    * 지난주 시장을 움직인 가장 중요한 거시경제 이벤트(예: FOMC, CPI 발표, 고용 보고서 등)를 식별하고 그 영향을 분석합니다.
    * S&P 500, 나스닥 100의 주간 성과(가격, 등락률), 10년물 국채금리의 주간 변동폭(**bp 단위**), VIX 지수의 주간 변동률을 계산합니다.
    * 11개 주요 섹터별 **주간 등락률** 및 **연초 대비(YTD) 등락률**을 모두 집계합니다.
    * 각 섹터의 **핵심 밸류에이션 지표**(예: 기술주는 Forward P/E, 금융주는 P/B)를 조사하고, 동종 업계 평균 또는 역사적 평균과 비교하여 **밸류에이션 수준(고평가, 저평가, 적정)을 판단**합니다.

2.  **가치 기반 스크리닝:**
    * 시가총액, 밸류에이션, 수익성, 재무 건전성 등을 종합적으로 고려하여 **내재가치 대비 저평가된 우량주 7개**를 선정합니다.
    * 각 주식의 투자 테마를 정의하고, 해당 주식의 가치 평가 논리를 뒷받침할 **가장 설득력 있는 핵심 지표 3가지**를 선정합니다. (예: P/FCF, EV/EBITDA, 배당수익률 등)
    * 선정된 주식에 대한 **핵심적인 투자 포인트 또는 리스크 요인 3가지**를 분석하여 요약합니다.

3.  **모멘텀 기반 스크리닝:**
    * 지난주 강력한 상승 모멘텀(가격, 거래량, 상대강도 등)을 보인 **시장 주도주 7개**를 선정합니다.
    * 각 주식의 모멘텀을 설명할 **가장 대표적인 기술적/기본적 지표 3가지**를 선정합니다. (예: 50일 신고가, RSI, 기관 순매수 등)
    * 해당 모멘텀의 **지속 가능성을 뒷받침하거나 위협할 수 있는 핵심 요인 3가지**를 분석하여 요약합니다.

4.  **월스트리트 컨센서스:**
    * 지난주 발표된 주요 투자은행(IB)의 투자의견 중 **가장 의미 있는 변경(상향/하향/신규) 10개**를 선정합니다.
    * 각 의견의 **발표 날짜**, 핵심 코멘트, 목표주가를 정확히 수집합니다.

5.  **다음 주 핵심 이벤트:**
    * 다가오는 주에 시장에 가장 큰 영향을 미칠 **핵심 이벤트 6가지**를 선정합니다. (경제지표, 기업실적, 정책/연설, 기타 중요 이벤트 등)
    * 각 이벤트의 카테고리, 날짜, 정확한 명칭, 그리고 시장에 미칠 예상 영향을 간결하게 분석합니다.

---

# 2단계: HTML 생성 (분석 결과를 아래 템플릿에 채우기)

## 2.0. 색상 클래스 규칙 (중앙 참조표)

아래 표는 플레이스홀더에 사용할 **정확한 CSS 클래스명**을 정의합니다. **반드시 이 표에 명시된 클래스명을 그대로 복사하여 사용하십시오.**

| 구분 | 조건 | 클래스명 |
| :--- | :--- | :--- |
| **성과/등락 색상** | 값이 **양수(+)**일 경우 | `text-positive` |
| (텍스트 색상) | 값이 **음수(-)**일 경우 | `text-negative` |
| | 값이 0 또는 보합일 경우 | `text-neutral` |
| | | |
| **밸류에이션 라벨** | **고평가** | BG: `bg-red-100`, TEXT: `text-red-800` |
| (배경+텍스트 색상) | **다소 고평가** | BG: `bg-orange-100`, TEXT: `text-orange-800` |
| | **적정** | BG: `bg-gray-100`, TEXT: `text-gray-800` |
| | **다소 저평가** | BG: `bg-sky-100`, TEXT: `text-sky-800` |
| | **저평가** | BG: `bg-green-100`, TEXT: `text-green-800` |
| | | |
| **IB 의견 라벨** | **상향 (Upgrade)**| BG: `bg-green-100`, TEXT: `text-green-800` |
| (배경+텍스트 색상) | **하향 (Downgrade)**| BG: `bg-red-100`, TEXT: `text-red-800` |
| | **신규 (New)** | BG: `bg-blue-100`, TEXT: `text-blue-800` |
| | **유지 (Reiterate)**| BG: `bg-gray-100`, TEXT: `text-gray-800` |

### 2.1. 헤더 및 시장 요약

-   `@@REPORT_DATE_YYYY_MM_DD@@`: **리포트 생성일(오늘)** 날짜를 `YYYY-MM-DD` 형식으로 기입합니다. (예: `2025-07-14`)
-   `@@HEADLINE_TEXT@@`: 지난주 시장의 가장 중요한 특징을 한 문장으로 요약한 **핵심 헤드라인**을 작성합니다. (예: `연준의 긴축 우려 속, 기술주 조정 심화`)
-   `@@HEADLINE_SUMMARY@@`: 헤드라인에 대한 2~3문장의 부가 설명을 작성합니다.
-   `@@SP500_...@@`, `@@NASDAQ_...@@` 등: 각 지표의 주간 등락률, 최종 가격, 변동폭을 기입합니다.
-   `@@..._COLOR@@`: **성과 값에 따라, 상단의 [2.0. 색상 클래스 규칙] 표를 참고**하여 `text-positive`, `text-negative`, `text-neutral` 중 하나를 **정확히 기입**합니다.

### 2.2. 주간 섹터 퍼포먼스 (카드형)

**반드시 11개 섹터 카드 전체를 채워야 합니다. 각각에 대해 다음을 반복합니다.** (예시: 섹터 1)

-   `@@SECTOR_1_NAME@@`: 섹터 이름 (예: `기술`, `금융`)
-   `@@SECTOR_1_VALUATION_LABEL@@`: 1단계에서 분석한 밸류에이션 평가 (예: `고평가`, `저평가`)
-   `@@SECTOR_1_VALUATION_BG_COLOR@@`, `@@SECTOR_1_VALUATION_TEXT_COLOR@@`: **[2.0. 색상 클래스 규칙]** 표의 **[밸류에이션 라벨]** 부분을 참고하여 정확한 클래스명을 기입합니다.
-   `@@SECTOR_1_WEEKLY_PERF@@`, `@@SECTOR_1_YTD_PERF@@`: 주간 및 YTD 성과를 숫자로 기입합니다.
-   `@@SECTOR_1_WEEKLY_COLOR@@`, `@@SECTOR_1_YTD_COLOR@@`: **[2.0. 색상 클래스 규칙]** 표의 **[성과/등락 색상]** 부분을 참고하여 정확한 클래스명을 기입합니다.
-   `@@SECTOR_1_VALUATION_METRIC_LABEL@@`: 해당 섹터의 밸류에이션을 판단하는 데 사용한 **가장 대표적인 지표명**을 기입합니다. (예: `Forward P/E`, `Price-to-Book (P/B)`)
-   `@@SECTOR_1_VALUATION_METRIC_VALUE@@`: 위 지표의 실제 값을 기입합니다. (예: `28.5x`, `1.8x`)

### 2.3. 가치/모멘텀 투자 발굴 (종목 카드)

**가치주 7개, 모멘텀주 7개 카드 전체를 채워야 합니다. 각각에 대해 다음을 반복합니다.** (예시: 가치주 1 - `_V1`)

-   `@@TICKER_V1@@`, `@@COMPANY_NAME_V1@@`, `@@THEME_V1@@` 등 기본 정보를 기입합니다.

-   **핵심 지표 미니 카드 (매우 중요):**
    -   `@@KEY_METRIC_1_LABEL_V1@@`: 이 주식의 투자 매력을 가장 잘 보여주는 **첫 번째 핵심 지표의 이름**을 기입합니다. (예: `잉여현금흐름 수익률`, `매출 성장률 (YoY)`, `순이익률`)
    -   `@@KEY_METRIC_1_VALUE_V1@@`: 해당 지표의 값을 기입합니다. (예: `8.2%`, `25%`, `15.3%`)
    -   **지표 2, 3에 대해서도 동일하게, 해당 종목에 가장 적합한 지표를 자율적으로 선정하여 기입합니다.** 고정된 지표를 사용하지 마십시오.

-   **상세 분석 (매우 중요):**
    -   `@@INSIGHT_1_TITLE_V1@@`: 이 주식에 투자해야 하는 **첫 번째 핵심 이유 또는 분석 포인트의 제목**을 작성합니다. (예: `독보적인 시장 지배력`, `예상보다 빠른 턴어라운드`, `숨겨진 자산 가치`)
    -   `@@INSIGHT_1_DESC_V1@@`: 위 제목에 대한 **구체적인 근거와 설명**을 1~2문장으로 작성합니다. (예: `주요 시장에서 60% 이상의 점유율을 차지하며, 이는 강력한 가격 결정력으로 이어집니다.`)
    -   **인사이트 2, 3에 대해서도 동일하게, LLM이 자율적으로 분석한 가장 중요한 포인트들을 제목과 설명으로 나누어 기입합니다.** 고정된 형식(전망, 리스크 등)을 따르지 말고, 가장 설득력 있는 내용을 자유롭게 구성하십시오.

### 2.4. 월스트리트 컨센서스 (테이블)

**반드시 10개 IB 의견 전체를 채워야 합니다. 각각에 대해 다음을 반복합니다.** (예시: `_U1`)

-   `@@TICKER_U1@@`, `@@BANK_U1@@` 등 모든 정보를 기입합니다.
-   `@@OPINION_DATE_U1@@`: **의견 발표일**을 `YYYY-MM-DD` 형식으로 정확히 기입합니다.
-   `@@OPINION_CHANGE_U1@@`: 의견 변경 내용을 기입합니다. (예: `Upgrade`)
-   `@@OPINION_BG_U1@@`, `@@OPINION_TEXT_U1@@`: **[2.0. 색상 클래스 규칙]** 표의 **[IB 의견 라벨]** 부분을 참고하여 정확한 클래스명을 기입합니다.

### 2.5. 다음 주 핵심 이벤트

**반드시 6개 이벤트 카드 전체를 채워야 합니다. 각각에 대해 다음을 반복합니다.** (예시: 이벤트 1)

-   `@@EVENT_1_CATEGORY@@`: 이벤트의 분류를 기입합니다. (예: `경제지표`, `기업실적`, `정책/연설`, `중요 이벤트`, `기타`)
-   `@@EVENT_1_DATE@@`: 이벤트 발생 날짜를 `MM-DD (요일)` 형식으로 기입합니다. (예: `07-15 (화)`)
-   `@@EVENT_1_TITLE@@`: 이벤트의 공식 명칭을 기입합니다. (예: `미국 6월 소매판매 발표`, `테슬라(TSLA) 2분기 실적발표`)
-   `@@EVENT_1_IMPACT@@`: 해당 이벤트가 시장에 미칠 것으로 예상되는 영향을 간결하게 분석하여 작성합니다. (예: `소비 둔화 폭에 따라 금리 인하 기대감이 자극될 수 있음.`)

```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700&family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
    <style>
        body { font-family: 'Noto Sans KR', sans-serif; background-color: #f8fafc; color: #1f2937; }
        .orbitron { font-family: 'Orbitron', monospace; }

        .content-card { background-color: white; border-radius: 0.75rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.07); padding: 2rem; }
        .section-title { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; display: flex; align-items: center; }
        .section-subtitle { font-size: 1rem; color: #4b5563; margin-bottom: 2.5rem; }

        .summary-highlight { text-align: center; margin-bottom: 3rem; }
        .summary-title { font-size: 1.25rem; font-weight: 600; color: #4b5563; margin-bottom: 1rem; }
        .summary-headline { font-size: 2.25rem; font-weight: 700; color: #111827; margin-bottom: 1rem; }
        .summary-text { font-size: 1.125rem; color: #374151; max-width: 48rem; margin: auto; }
        
        .stat-card { background-color: white; border-radius: 0.75rem; padding: 1.5rem; text-align: center; box-shadow: 0 1px 3px 0 rgba(0,0,0,0.07), 0 1px 2px -1px rgba(0,0,0,0.07); }
        .stat-label { font-size: 0.875rem; font-weight: 500; color: #6b7280; margin-bottom: 0.5rem; }
        .stat-number { font-size: 1.875rem; font-weight: 700; }
        
        .text-positive { color: #16a34a; }
        .text-negative { color: #dc2626; }
        .text-neutral { color: #4b5563; }

        /* 섹터 카드 */
        .sector-card { background-color: white; border-radius: 0.75rem; border: 1px solid #e5e7eb; padding: 1.5rem; transition: all 0.3s; }
        .sector-card:hover { transform: translateY(-5px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05); }
        .sector-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
        .sector-card-title { font-size: 1.125rem; font-weight: 600; }
        .sector-valuation-label { font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.75rem; border-radius: 9999px; }
        .sector-perf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; text-align: center; }
        .sector-perf-item .perf-label { font-size: 0.75rem; color: #6b7280; }
        .sector-perf-item .perf-value { font-size: 1.25rem; font-weight: 700; }

        /* 종목 카드 */
        .company-card { background-color: white; border-radius: 0.75rem; border: 1px solid #e5e7eb; padding: 1.5rem; display: flex; flex-direction: column; height: 100%; transition: box-shadow 0.3s, transform 0.3s; }
        .company-card:hover { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05); transform: translateY(-4px); }
        .ticker-symbol { font-size: 1.5rem; font-weight: 700; }
        .company-name { font-size: 0.875rem; color: #6b7280; margin-bottom: 1.5rem; }
        .theme-badge { background-color: #eef2ff; color: #4338ca; font-size: 0.75rem; font-weight: 500; padding: 0.25rem 0.75rem; border-radius: 9999px; align-self: flex-start; }
        .momentum-badge { background-color: #f0fdf4; color: #166534; font-size: 0.875rem; font-weight: 600; padding: 0.25rem 0.75rem; border-radius: 9999px; align-self: flex-start; }
        .metric-minicard-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.5rem; }
        .metric-minicard { background-color: #f9fafb; border: 1px solid #f3f4f6; border-radius: 0.5rem; padding: 1rem; text-align: center; }
        .metric-minicard-label { font-size: 0.75rem; color: #6b7280; margin-bottom: 0.25rem; }
        .metric-minicard-value { font-size: 1.25rem; font-weight: 600; }
        .analysis-box { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #f3f4f6; }
        .analysis-item { margin-bottom: 1rem; }
        .analysis-item-title { font-weight: 600; color: #374151; margin-bottom: 0.25rem; display: flex; align-items: center; }
        .analysis-item-title .fa-check-circle { color: #6366f1; margin-right: 0.5rem; font-size: 0.875rem; }
        .analysis-item-desc { font-size: 0.875rem; color: #4b5563; padding-left: 1.375rem; }
        .expand-button { margin-top: auto; background-color: #f9fafb; border: 1px solid #e5e7eb; color: #374151; font-weight: 500; width: 100%; padding: 0.75rem; border-radius: 0.5rem; display: flex; justify-content: center; align-items: center; gap: 0.5rem; transition: background-color 0.2s; }
        .expand-button:hover { background-color: #f3f4f6; }

        /* 월스트리트 테이블 */
        .table-container { border: 1px solid #e5e7eb; border-radius: 0.75rem; overflow: hidden; }
        .table-header { background-color: #f9fafb; }
        .table-header th { color: #374151; }
        .table-row:hover { background-color: #f9fafb; }
    </style>
</head>
<body class="antialiased">

    <header class="bg-white border-b border-gray-200 shadow-sm">
        <div class="container mx-auto px-6 py-12 text-center">
            <h1 class="text-4xl md:text-5xl font-bold orbitron text-gray-900 mb-2">100x Alpha Scout</h1>
            <p class="text-lg text-gray-600 mt-2">@@REPORT_DATE_YYYY_MM_DD@@ | Premium Weekly Intelligence</p>
        </div>
    </header>

    <main class="container mx-auto px-6 my-16">
        <!-- 금주의 시장 요약 -->
        <section class="mb-20">
            <div class="summary-highlight">
                <h2 class="summary-title">금주의 시장 요약</h2>
                <p class="summary-headline">@@HEADLINE_TEXT@@</p>
                <p class="summary-text">@@HEADLINE_SUMMARY@@</p>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div class="stat-card"><h4 class="stat-label">S&P 500 (주간)</h4><p class="stat-number text-@@SP500_COLOR@@">@@SP500_CHANGE_PERCENT@@%</p><div class="text-sm text-gray-500">@@SP500_PRICE@@</div></div>
                <div class="stat-card"><h4 class="stat-label">Nasdaq 100 (주간)</h4><p class="stat-number text-@@NASDAQ_COLOR@@">@@NASDAQ_CHANGE_PERCENT@@%</p><div class="text-sm text-gray-500">@@NASDAQ_PRICE@@</div></div>
                <div class="stat-card"><h4 class="stat-label">10년물 국채금리</h4><p class="stat-number text-@@TEN_YEAR_COLOR@@">@@TEN_YEAR_CHANGE_BP@@bp</p><div class="text-sm text-gray-500">@@TEN_YEAR_YIELD@@%</div></div>
                <div class="stat-card"><h4 class="stat-label">VIX</h4><p class="stat-number text-@@VIX_COLOR@@">@@VIX_CHANGE_PERCENT@@%</p><div class="text-sm text-gray-500">@@VIX_PRICE@@</div></div>
            </div>
        </section>

        <!-- 주간 섹터 퍼포먼스 (카드형으로 전면 개편) -->
        <section class="mb-20">
            <h2 class="section-title"><i class="fas fa-layer-group mr-3 text-blue-600"></i>주간 섹터 퍼포먼스</h2>
            <p class="section-subtitle">주간 및 연초 대비 성과와 밸류에이션을 통해 섹터별 현황을 종합적으로 분석합니다.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <!-- 섹터 카드 1 -->
                <div class="sector-card">
                    <div class="sector-card-header">
                        <h3 class="sector-card-title">@@SECTOR_1_NAME@@</h3>
                        <span class="sector-valuation-label @@SECTOR_1_VALUATION_BG_COLOR@@ @@SECTOR_1_VALUATION_TEXT_COLOR@@">@@SECTOR_1_VALUATION_LABEL@@</span>
                    </div>
                    <div class="sector-perf-grid">
                        <div class="sector-perf-item"><p class="perf-label">주간 성과</p><p class="perf-value text-@@SECTOR_1_WEEKLY_COLOR@@">@@SECTOR_1_WEEKLY_PERF@@%</p></div>
                        <div class="sector-perf-item"><p class="perf-label">YTD 성과</p><p class="perf-value text-@@SECTOR_1_YTD_COLOR@@">@@SECTOR_1_YTD_PERF@@%</p></div>
                    </div>
                    <div class="text-center mt-4 pt-4 border-t border-gray-100">
                        <p class="text-sm text-gray-500">@@SECTOR_1_VALUATION_METRIC_LABEL@@</p>
                        <p class="text-lg font-semibold">@@SECTOR_1_VALUATION_METRIC_VALUE@@</p>
                    </div>
                </div>
                <!-- 섹터 카드 2-11 (동일한 구조로 반복) -->
                <div class="sector-card"><div class="sector-card-header"><h3 class="sector-card-title">@@SECTOR_2_NAME@@</h3><span class="sector-valuation-label @@SECTOR_2_VALUATION_BG_COLOR@@ @@SECTOR_2_VALUATION_TEXT_COLOR@@">@@SECTOR_2_VALUATION_LABEL@@</span></div><div class="sector-perf-grid"><div class="sector-perf-item"><p class="perf-label">주간 성과</p><p class="perf-value text-@@SECTOR_2_WEEKLY_COLOR@@">@@SECTOR_2_WEEKLY_PERF@@%</p></div><div class="sector-perf-item"><p class="perf-label">YTD 성과</p><p class="perf-value text-@@SECTOR_2_YTD_COLOR@@">@@SECTOR_2_YTD_PERF@@%</p></div></div><div class="text-center mt-4 pt-4 border-t border-gray-100"><p class="text-sm text-gray-500">@@SECTOR_2_VALUATION_METRIC_LABEL@@</p><p class="text-lg font-semibold">@@SECTOR_2_VALUATION_METRIC_VALUE@@</p></div></div>
                <div class="sector-card"><div class="sector-card-header"><h3 class="sector-card-title">@@SECTOR_3_NAME@@</h3><span class="sector-valuation-label @@SECTOR_3_VALUATION_BG_COLOR@@ @@SECTOR_3_VALUATION_TEXT_COLOR@@">@@SECTOR_3_VALUATION_LABEL@@</span></div><div class="sector-perf-grid"><div class="sector-perf-item"><p class="perf-label">주간 성과</p><p class="perf-value text-@@SECTOR_3_WEEKLY_COLOR@@">@@SECTOR_3_WEEKLY_PERF@@%</p></div><div class="sector-perf-item"><p class="perf-label">YTD 성과</p><p class="perf-value text-@@SECTOR_3_YTD_COLOR@@">@@SECTOR_3_YTD_PERF@@%</p></div></div><div class="text-center mt-4 pt-4 border-t border-gray-100"><p class="text-sm text-gray-500">@@SECTOR_3_VALUATION_METRIC_LABEL@@</p><p class="text-lg font-semibold">@@SECTOR_3_VALUATION_METRIC_VALUE@@</p></div></div>
				<div class="sector-card"><div class="sector-card-header"><h3 class="sector-card-title">@@SECTOR_4_NAME@@</h3><span class="sector-valuation-label @@SECTOR_4_VALUATION_BG_COLOR@@ @@SECTOR_4_VALUATION_TEXT_COLOR@@">@@SECTOR_4_VALUATION_LABEL@@</span></div><div class="sector-perf-grid"><div class="sector-perf-item"><p class="perf-label">주간 성과</p><p class="perf-value text-@@SECTOR_4_WEEKLY_COLOR@@">@@SECTOR_4_WEEKLY_PERF@@%</p></div><div class="sector-perf-item"><p class="perf-label">YTD 성과</p><p class="perf-value text-@@SECTOR_4_YTD_COLOR@@">@@SECTOR_4_YTD_PERF@@%</p></div></div><div class="text-center mt-4 pt-4 border-t border-gray-100"><p class="text-sm text-gray-500">@@SECTOR_4_VALUATION_METRIC_LABEL@@</p><p class="text-lg font-semibold">@@SECTOR_4_VALUATION_METRIC_VALUE@@</p></div></div>
				<div class="sector-card"><div class="sector-card-header"><h3 class="sector-card-title">@@SECTOR_5_NAME@@</h3><span class="sector-valuation-label @@SECTOR_5_VALUATION_BG_COLOR@@ @@SECTOR_5_VALUATION_TEXT_COLOR@@">@@SECTOR_5_VALUATION_LABEL@@</span></div><div class="sector-perf-grid"><div class="sector-perf-item"><p class="perf-label">주간 성과</p><p class="perf-value text-@@SECTOR_5_WEEKLY_COLOR@@">@@SECTOR_5_WEEKLY_PERF@@%</p></div><div class="sector-perf-item"><p class="perf-label">YTD 성과</p><p class="perf-value text-@@SECTOR_5_YTD_COLOR@@">@@SECTOR_5_YTD_PERF@@%</p></div></div><div class="text-center mt-4 pt-4 border-t border-gray-100"><p class="text-sm text-gray-500">@@SECTOR_5_VALUATION_METRIC_LABEL@@</p><p class="text-lg font-semibold">@@SECTOR_5_VALUATION_METRIC_VALUE@@</p></div></div>
				<div class="sector-card"><div class="sector-card-header"><h3 class="sector-card-title">@@SECTOR_6_NAME@@</h3><span class="sector-valuation-label @@SECTOR_6_VALUATION_BG_COLOR@@ @@SECTOR_6_VALUATION_TEXT_COLOR@@">@@SECTOR_6_VALUATION_LABEL@@</span></div><div class="sector-perf-grid"><div class="sector-perf-item"><p class="perf-label">주간 성과</p><p class="perf-value text-@@SECTOR_6_WEEKLY_COLOR@@">@@SECTOR_6_WEEKLY_PERF@@%</p></div><div class="sector-perf-item"><p class="perf-label">YTD 성과</p><p class="perf-value text-@@SECTOR_6_YTD_COLOR@@">@@SECTOR_6_YTD_PERF@@%</p></div></div><div class="text-center mt-4 pt-4 border-t border-gray-100"><p class="text-sm text-gray-500">@@SECTOR_6_VALUATION_METRIC_LABEL@@</p><p class="text-lg font-semibold">@@SECTOR_6_VALUATION_METRIC_VALUE@@</p></div></div>
				<div class="sector-card"><div class="sector-card-header"><h3 class="sector-card-title">@@SECTOR_7_NAME@@</h3><span class="sector-valuation-label @@SECTOR_7_VALUATION_BG_COLOR@@ @@SECTOR_7_VALUATION_TEXT_COLOR@@">@@SECTOR_7_VALUATION_LABEL@@</span></div><div class="sector-perf-grid"><div class="sector-perf-item"><p class="perf-label">주간 성과</p><p class="perf-value text-@@SECTOR_7_WEEKLY_COLOR@@">@@SECTOR_7_WEEKLY_PERF@@%</p></div><div class="sector-perf-item"><p class="perf-label">YTD 성과</p><p class="perf-value text-@@SECTOR_7_YTD_COLOR@@">@@SECTOR_7_YTD_PERF@@%</p></div></div><div class="text-center mt-4 pt-4 border-t border-gray-100"><p class="text-sm text-gray-500">@@SECTOR_7_VALUATION_METRIC_LABEL@@</p><p class="text-lg font-semibold">@@SECTOR_7_VALUATION_METRIC_VALUE@@</p></div></div>
				<div class="sector-card"><div class="sector-card-header"><h3 class="sector-card-title">@@SECTOR_8_NAME@@</h3><span class="sector-valuation-label @@SECTOR_8_VALUATION_BG_COLOR@@ @@SECTOR_8_VALUATION_TEXT_COLOR@@">@@SECTOR_8_VALUATION_LABEL@@</span></div><div class="sector-perf-grid"><div class="sector-perf-item"><p class="perf-label">주간 성과</p><p class="perf-value text-@@SECTOR_8_WEEKLY_COLOR@@">@@SECTOR_8_WEEKLY_PERF@@%</p></div><div class="sector-perf-item"><p class="perf-label">YTD 성과</p><p class="perf-value text-@@SECTOR_8_YTD_COLOR@@">@@SECTOR_8_YTD_PERF@@%</p></div></div><div class="text-center mt-4 pt-4 border-t border-gray-100"><p class="text-sm text-gray-500">@@SECTOR_8_VALUATION_METRIC_LABEL@@</p><p class="text-lg font-semibold">@@SECTOR_8_VALUATION_METRIC_VALUE@@</p></div></div>
				<div class="sector-card"><div class="sector-card-header"><h3 class="sector-card-title">@@SECTOR_9_NAME@@</h3><span class="sector-valuation-label @@SECTOR_9_VALUATION_BG_COLOR@@ @@SECTOR_9_VALUATION_TEXT_COLOR@@">@@SECTOR_9_VALUATION_LABEL@@</span></div><div class="sector-perf-grid"><div class="sector-perf-item"><p class="perf-label">주간 성과</p><p class="perf-value text-@@SECTOR_9_WEEKLY_COLOR@@">@@SECTOR_9_WEEKLY_PERF@@%</p></div><div class="sector-perf-item"><p class="perf-label">YTD 성과</p><p class="perf-value text-@@SECTOR_9_YTD_COLOR@@">@@SECTOR_9_YTD_PERF@@%</p></div></div><div class="text-center mt-4 pt-4 border-t border-gray-100"><p class="text-sm text-gray-500">@@SECTOR_9_VALUATION_METRIC_LABEL@@</p><p class="text-lg font-semibold">@@SECTOR_9_VALUATION_METRIC_VALUE@@</p></div></div>
				<div class="sector-card"><div class="sector-card-header"><h3 class="sector-card-title">@@SECTOR_10_NAME@@</h3><span class="sector-valuation-label @@SECTOR_10_VALUATION_BG_COLOR@@ @@SECTOR_10_VALUATION_TEXT_COLOR@@">@@SECTOR_10_VALUATION_LABEL@@</span></div><div class="sector-perf-grid"><div class="sector-perf-item"><p class="perf-label">주간 성과</p><p class="perf-value text-@@SECTOR_10_WEEKLY_COLOR@@">@@SECTOR_10_WEEKLY_PERF@@%</p></div><div class="sector-perf-item"><p class="perf-label">YTD 성과</p><p class="perf-value text-@@SECTOR_10_YTD_COLOR@@">@@SECTOR_10_YTD_PERF@@%</p></div></div><div class="text-center mt-4 pt-4 border-t border-gray-100"><p class="text-sm text-gray-500">@@SECTOR_10_VALUATION_METRIC_LABEL@@</p><p class="text-lg font-semibold">@@SECTOR_10_VALUATION_METRIC_VALUE@@</p></div></div>
				<div class="sector-card"><div class="sector-card-header"><h3 class="sector-card-title">@@SECTOR_11_NAME@@</h3><span class="sector-valuation-label @@SECTOR_11_VALUATION_BG_COLOR@@ @@SECTOR_11_VALUATION_TEXT_COLOR@@">@@SECTOR_11_VALUATION_LABEL@@</span></div><div class="sector-perf-grid"><div class="sector-perf-item"><p class="perf-label">주간 성과</p><p class="perf-value text-@@SECTOR_11_WEEKLY_COLOR@@">@@SECTOR_11_WEEKLY_PERF@@%</p></div><div class="sector-perf-item"><p class="perf-label">YTD 성과</p><p class="perf-value text-@@SECTOR_11_YTD_COLOR@@">@@SECTOR_11_YTD_PERF@@%</p></div></div><div class="text-center mt-4 pt-4 border-t border-gray-100"><p class="text-sm text-gray-500">@@SECTOR_11_VALUATION_METRIC_LABEL@@</p><p class="text-lg font-semibold">@@SECTOR_11_VALUATION_METRIC_VALUE@@</p></div></div>
            </div>
        </section>

        <!-- 가치 투자 발굴 (미니 카드 및 분석 영역 개선) -->
        <section class="mb-20">
            <h2 class="section-title"><i class="fas fa-gem mr-3 text-indigo-600"></i>가치 투자 발굴: 저평가 우량주</h2>
            <p class="section-subtitle">내재가치 대비 저평가된 기업을 발굴합니다. 강력한 펀더멘털과 매력적인 진입 가격을 가진 종목에 주목합니다.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <!-- 가치주 카드 1 -->
                <div x-data="{ open: false }" class="company-card">
                    <div>
                        <div class="flex justify-between items-start mb-4">
                            <div><p class="ticker-symbol">@@TICKER_V1@@</p><p class="company-name">@@COMPANY_NAME_V1@@</p></div>
                            <span class="theme-badge">@@THEME_V1@@</span>
                        </div>
                        <div class="metric-minicard-grid">
                            <div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_V1@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_V1@@</p></div>
                            <div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_V1@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_V1@@</p></div>
                            <div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_V1@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_V1@@</p></div>
                        </div>
                    </div>
                    <div x-show="open" x-transition class="analysis-box">
                        <div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_V1@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_V1@@</p></div>
                        <div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_V1@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_V1@@</p></div>
                        <div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_V1@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_V1@@</p></div>
                    </div>
                    <button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button>
                </div>
                <!-- 가치주 카드 2-7 (동일한 구조로 반복) -->
                <div x-data="{ open: false }" class="company-card"><div><div class="flex justify-between items-start mb-4"><div><p class="ticker-symbol">@@TICKER_V2@@</p><p class="company-name">@@COMPANY_NAME_V2@@</p></div><span class="theme-badge">@@THEME_V2@@</span></div><div class="metric-minicard-grid"><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_V2@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_V2@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_V2@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_V2@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_V2@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_V2@@</p></div></div></div><div x-show="open" x-transition class="analysis-box"><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_V2@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_V2@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_V2@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_V2@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_V2@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_V2@@</p></div></div><button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button></div>
                <div x-data="{ open: false }" class="company-card"><div><div class="flex justify-between items-start mb-4"><div><p class="ticker-symbol">@@TICKER_V3@@</p><p class="company-name">@@COMPANY_NAME_V3@@</p></div><span class="theme-badge">@@THEME_V3@@</span></div><div class="metric-minicard-grid"><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_V3@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_V3@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_V3@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_V3@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_V3@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_V3@@</p></div></div></div><div x-show="open" x-transition class="analysis-box"><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_V3@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_V3@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_V3@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_V3@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_V3@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_V3@@</p></div></div><button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button></div>
				<div x-data="{ open: false }" class="company-card"><div><div class="flex justify-between items-start mb-4"><div><p class="ticker-symbol">@@TICKER_V4@@</p><p class="company-name">@@COMPANY_NAME_V4@@</p></div><span class="theme-badge">@@THEME_V4@@</span></div><div class="metric-minicard-grid"><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_V4@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_V4@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_V4@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_V4@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_V4@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_V4@@</p></div></div></div><div x-show="open" x-transition class="analysis-box"><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_V4@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_V4@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_V4@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_V4@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_V4@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_V4@@</p></div></div><button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button></div>
				<div x-data="{ open: false }" class="company-card"><div><div class="flex justify-between items-start mb-4"><div><p class="ticker-symbol">@@TICKER_V5@@</p><p class="company-name">@@COMPANY_NAME_V5@@</p></div><span class="theme-badge">@@THEME_V5@@</span></div><div class="metric-minicard-grid"><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_V5@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_V5@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_V5@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_V5@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_V5@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_V5@@</p></div></div></div><div x-show="open" x-transition class="analysis-box"><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_V5@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_V5@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_V5@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_V5@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_V5@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_V5@@</p></div></div><button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button></div>
				<div x-data="{ open: false }" class="company-card"><div><div class="flex justify-between items-start mb-4"><div><p class="ticker-symbol">@@TICKER_V6@@</p><p class="company-name">@@COMPANY_NAME_V6@@</p></div><span class="theme-badge">@@THEME_V6@@</span></div><div class="metric-minicard-grid"><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_V6@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_V6@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_V6@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_V6@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_V6@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_V6@@</p></div></div></div><div x-show="open" x-transition class="analysis-box"><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_V6@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_V6@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_V6@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_V6@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_V6@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_V6@@</p></div></div><button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button></div>
				<div x-data="{ open: false }" class="company-card"><div><div class="flex justify-between items-start mb-4"><div><p class="ticker-symbol">@@TICKER_V7@@</p><p class="company-name">@@COMPANY_NAME_V7@@</p></div><span class="theme-badge">@@THEME_V7@@</span></div><div class="metric-minicard-grid"><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_V7@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_V7@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_V7@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_V7@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_V7@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_V7@@</p></div></div></div><div x-show="open" x-transition class="analysis-box"><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_V7@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_V7@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_V7@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_V7@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_V7@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_V7@@</p></div></div><button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button></div>
			</div>
        </section>

        <!-- 모멘텀 트래커 (미니 카드 및 분석 영역 개선) -->
        <section class="mb-16">
            <h2 class="section-title"><i class="fas fa-rocket mr-3 text-green-600"></i>모멘텀 트래커: 시장 주도주</h2>
            <p class="section-subtitle">시장의 흐름을 주도하는 강력한 상승 동력을 가진 종목을 선별합니다. 기술적 지표와 수급을 함께 분석합니다.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <!-- 모멘텀 카드 1 -->
                <div x-data="{ open: false }" class="company-card">
                    <div>
                        <div class="flex justify-between items-start mb-4">
                            <div><p class="ticker-symbol">@@TICKER_M1@@</p><p class="company-name">@@COMPANY_NAME_M1@@</p></div>
                            <span class="momentum-badge">주간 @@PERF_M1@@%</span>
                        </div>
                        <div class="metric-minicard-grid">
                            <div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_M1@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_M1@@</p></div>
                            <div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_M1@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_M1@@</p></div>
                            <div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_M1@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_M1@@</p></div>
                        </div>
                    </div>
                    <div x-show="open" x-transition class="analysis-box">
                        <div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_M1@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_M1@@</p></div>
                        <div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_M1@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_M1@@</p></div>
                        <div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_M1@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_M1@@</p></div>
                    </div>
                    <button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button>
                </div>
                <!-- 모멘텀 카드 2-7 (동일한 구조로 반복) -->
                <div x-data="{ open: false }" class="company-card"><div><div class="flex justify-between items-start mb-4"><div><p class="ticker-symbol">@@TICKER_M2@@</p><p class="company-name">@@COMPANY_NAME_M2@@</p></div><span class="momentum-badge">주간 @@PERF_M2@@%</span></div><div class="metric-minicard-grid"><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_M2@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_M2@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_M2@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_M2@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_M2@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_M2@@</p></div></div></div><div x-show="open" x-transition class="analysis-box"><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_M2@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_M2@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_M2@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_M2@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_M2@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_M2@@</p></div></div><button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button></div>
                <div x-data="{ open: false }" class="company-card"><div><div class="flex justify-between items-start mb-4"><div><p class="ticker-symbol">@@TICKER_M3@@</p><p class="company-name">@@COMPANY_NAME_M3@@</p></div><span class="momentum-badge">주간 @@PERF_M3@@%</span></div><div class="metric-minicard-grid"><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_M3@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_M3@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_M3@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_M3@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_M3@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_M3@@</p></div></div></div><div x-show="open" x-transition class="analysis-box"><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_M3@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_M3@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_M3@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_M3@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_M3@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_M3@@</p></div></div><button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button></div>
				<div x-data="{ open: false }" class="company-card"><div><div class="flex justify-between items-start mb-4"><div><p class="ticker-symbol">@@TICKER_M4@@</p><p class="company-name">@@COMPANY_NAME_M4@@</p></div><span class="momentum-badge">주간 @@PERF_M4@@%</span></div><div class="metric-minicard-grid"><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_M4@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_M4@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_M4@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_M4@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_M4@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_M4@@</p></div></div></div><div x-show="open" x-transition class="analysis-box"><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_M4@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_M4@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_M4@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_M4@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_M4@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_M4@@</p></div></div><button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button></div>
				<div x-data="{ open: false }" class="company-card"><div><div class="flex justify-between items-start mb-4"><div><p class="ticker-symbol">@@TICKER_M5@@</p><p class="company-name">@@COMPANY_NAME_M5@@</p></div><span class="momentum-badge">주간 @@PERF_M5@@%</span></div><div class="metric-minicard-grid"><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_M5@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_M5@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_M5@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_M5@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_M5@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_M5@@</p></div></div></div><div x-show="open" x-transition class="analysis-box"><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_M5@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_M5@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_M5@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_M5@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_M5@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_M5@@</p></div></div><button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button></div>
				<div x-data="{ open: false }" class="company-card"><div><div class="flex justify-between items-start mb-4"><div><p class="ticker-symbol">@@TICKER_M6@@</p><p class="company-name">@@COMPANY_NAME_M6@@</p></div><span class="momentum-badge">주간 @@PERF_M6@@%</span></div><div class="metric-minicard-grid"><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_M6@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_M6@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_M6@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_M6@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_M6@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_M6@@</p></div></div></div><div x-show="open" x-transition class="analysis-box"><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_M6@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_M6@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_M6@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_M6@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_M6@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_M6@@</p></div></div><button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button></div>
				<div x-data="{ open: false }" class="company-card"><div><div class="flex justify-between items-start mb-4"><div><p class="ticker-symbol">@@TICKER_M7@@</p><p class="company-name">@@COMPANY_NAME_M7@@</p></div><span class="momentum-badge">주간 @@PERF_M7@@%</span></div><div class="metric-minicard-grid"><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_1_LABEL_M7@@</p><p class="metric-minicard-value">@@KEY_METRIC_1_VALUE_M7@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_2_LABEL_M7@@</p><p class="metric-minicard-value">@@KEY_METRIC_2_VALUE_M7@@</p></div><div class="metric-minicard"><p class="metric-minicard-label">@@KEY_METRIC_3_LABEL_M7@@</p><p class="metric-minicard-value">@@KEY_METRIC_3_VALUE_M7@@</p></div></div></div><div x-show="open" x-transition class="analysis-box"><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_1_TITLE_M7@@</h4><p class="analysis-item-desc">@@INSIGHT_1_DESC_M7@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_2_TITLE_M7@@</h4><p class="analysis-item-desc">@@INSIGHT_2_DESC_M7@@</p></div><div class="analysis-item"><h4 class="analysis-item-title"><i class="fas fa-check-circle"></i>@@INSIGHT_3_TITLE_M7@@</h4><p class="analysis-item-desc">@@INSIGHT_3_DESC_M7@@</p></div></div><button @click="open = !open" class="expand-button"><span x-text="open ? '간략히 보기' : '자세히 보기'"></span><i class="fas fa-chevron-down transition-transform" :class="open && 'rotate-180'"></i></button></div>
			</div>
        </section>

        <!-- 월스트리트 컨센서스 (기존 유지) -->
        <section>
            <h2 class="section-title"><i class="fas fa-university mr-3 text-gray-500"></i>월스트리트 컨센서스: Top 10 IB 의견</h2>
            <p class="section-subtitle">기관들의 최신 시각을 통해 시장의 컨센서스 변화를 확인합니다.</p>
            <div class="table-container">
                <table class="w-full text-sm min-w-[900px]">
                    <thead class="table-header">
                        <tr>
                            <th class="p-4 text-left font-semibold">순위</th><th class="p-4 text-left font-semibold">종목명</th><th class="p-4 text-left font-semibold">투자은행</th><th class="p-4 text-left font-semibold">날짜</th><th class="p-4 text-center font-semibold">의견</th><th class="p-4 text-right font-semibold">목표주가</th><th class="p-4 text-left font-semibold w-1/3">핵심 코멘트</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200">
                        <tr class="table-row"><td class="p-4 font-bold text-gray-500">1</td><td class="p-4 font-bold">@@TICKER_U1@@</td><td class="p-4 text-gray-600">@@BANK_U1@@</td><td class="p-4 text-gray-600">@@OPINION_DATE_U1@@</td><td class="p-4 text-center"><span class="px-3 py-1 text-xs font-semibold rounded-full @@OPINION_BG_U1@@ @@OPINION_TEXT_U1@@">@@OPINION_CHANGE_U1@@</span></td><td class="p-4 text-right font-semibold">@@PRICE_TARGET_U1@@</td><td class="p-4 text-gray-600">@@COMMENT_U1@@</td></tr>
                        <tr class="table-row"><td class="p-4 font-bold text-gray-500">2</td><td class="p-4 font-bold">@@TICKER_U2@@</td><td class="p-4 text-gray-600">@@BANK_U2@@</td><td class="p-4 text-gray-600">@@OPINION_DATE_U2@@</td><td class="p-4 text-center"><span class="px-3 py-1 text-xs font-semibold rounded-full @@OPINION_BG_U2@@ @@OPINION_TEXT_U2@@">@@OPINION_CHANGE_U2@@</span></td><td class="p-4 text-right font-semibold">@@PRICE_TARGET_U2@@</td><td class="p-4 text-gray-600">@@COMMENT_U2@@</td></tr>
						<tr class="table-row"><td class="p-4 font-bold text-gray-500">3</td><td class="p-4 font-bold">@@TICKER_U3@@</td><td class="p-4 text-gray-600">@@BANK_U3@@</td><td class="p-4 text-gray-600">@@OPINION_DATE_U3@@</td><td class="p-4 text-center"><span class="px-3 py-1 text-xs font-semibold rounded-full @@OPINION_BG_U3@@ @@OPINION_TEXT_U3@@">@@OPINION_CHANGE_U3@@</span></td><td class="p-4 text-right font-semibold">@@PRICE_TARGET_U3@@</td><td class="p-4 text-gray-600">@@COMMENT_U3@@</td></tr>
						<tr class="table-row"><td class="p-4 font-bold text-gray-500">4</td><td class="p-4 font-bold">@@TICKER_U4@@</td><td class="p-4 text-gray-600">@@BANK_U4@@</td><td class="p-4 text-gray-600">@@OPINION_DATE_U4@@</td><td class="p-4 text-center"><span class="px-3 py-1 text-xs font-semibold rounded-full @@OPINION_BG_U4@@ @@OPINION_TEXT_U4@@">@@OPINION_CHANGE_U4@@</span></td><td class="p-4 text-right font-semibold">@@PRICE_TARGET_U4@@</td><td class="p-4 text-gray-600">@@COMMENT_U4@@</td></tr>
						<tr class="table-row"><td class="p-4 font-bold text-gray-500">5</td><td class="p-4 font-bold">@@TICKER_U5@@</td><td class="p-4 text-gray-600">@@BANK_U5@@</td><td class="p-4 text-gray-600">@@OPINION_DATE_U5@@</td><td class="p-4 text-center"><span class="px-3 py-1 text-xs font-semibold rounded-full @@OPINION_BG_U5@@ @@OPINION_TEXT_U5@@">@@OPINION_CHANGE_U5@@</span></td><td class="p-4 text-right font-semibold">@@PRICE_TARGET_U5@@</td><td class="p-4 text-gray-600">@@COMMENT_U5@@</td></tr>
						<tr class="table-row"><td class="p-4 font-bold text-gray-500">6</td><td class="p-4 font-bold">@@TICKER_U6@@</td><td class="p-4 text-gray-600">@@BANK_U6@@</td><td class="p-4 text-gray-600">@@OPINION_DATE_U6@@</td><td class="p-4 text-center"><span class="px-3 py-1 text-xs font-semibold rounded-full @@OPINION_BG_U6@@ @@OPINION_TEXT_U6@@">@@OPINION_CHANGE_U6@@</span></td><td class="p-4 text-right font-semibold">@@PRICE_TARGET_U6@@</td><td class="p-4 text-gray-600">@@COMMENT_U6@@</td></tr>
						<tr class="table-row"><td class="p-4 font-bold text-gray-500">7</td><td class="p-4 font-bold">@@TICKER_U7@@</td><td class="p-4 text-gray-600">@@BANK_U7@@</td><td class="p-4 text-gray-600">@@OPINION_DATE_U7@@</td><td class="p-4 text-center"><span class="px-3 py-1 text-xs font-semibold rounded-full @@OPINION_BG_U7@@ @@OPINION_TEXT_U7@@">@@OPINION_CHANGE_U7@@</span></td><td class="p-4 text-right font-semibold">@@PRICE_TARGET_U7@@</td><td class="p-4 text-gray-600">@@COMMENT_U7@@</td></tr>
						<tr class="table-row"><td class="p-4 font-bold text-gray-500">8</td><td class="p-4 font-bold">@@TICKER_U8@@</td><td class="p-4 text-gray-600">@@BANK_U8@@</td><td class="p-4 text-gray-600">@@OPINION_DATE_U8@@</td><td class="p-4 text-center"><span class="px-3 py-1 text-xs font-semibold rounded-full @@OPINION_BG_U8@@ @@OPINION_TEXT_U8@@">@@OPINION_CHANGE_U8@@</span></td><td class="p-4 text-right font-semibold">@@PRICE_TARGET_U8@@</td><td class="p-4 text-gray-600">@@COMMENT_U8@@</td></tr>
						<tr class="table-row"><td class="p-4 font-bold text-gray-500">9</td><td class="p-4 font-bold">@@TICKER_U9@@</td><td class="p-4 text-gray-600">@@BANK_U9@@</td><td class="p-4 text-gray-600">@@OPINION_DATE_U9@@</td><td class="p-4 text-center"><span class="px-3 py-1 text-xs font-semibold rounded-full @@OPINION_BG_U9@@ @@OPINION_TEXT_U9@@">@@OPINION_CHANGE_U9@@</span></td><td class="p-4 text-right font-semibold">@@PRICE_TARGET_U9@@</td><td class="p-4 text-gray-600">@@COMMENT_U9@@</td></tr>
						<tr class="table-row"><td class="p-4 font-bold text-gray-500">10</td><td class="p-4 font-bold">@@TICKER_U10@@</td><td class="p-4 text-gray-600">@@BANK_U10@@</td><td class="p-4 text-gray-600">@@OPINION_DATE_U10@@</td><td class="p-4 text-center"><span class="px-3 py-1 text-xs font-semibold rounded-full @@OPINION_BG_U10@@ @@OPINION_TEXT_U10@@">@@OPINION_CHANGE_U10@@</span></td><td class="p-4 text-right font-semibold">@@PRICE_TARGET_U10@@</td><td class="p-4 text-gray-600">@@COMMENT_U10@@</td></tr>
					</tbody>
                </table>
            </div>
        </section>
		
		<section class="mt-20">
            <h2 class="section-title"><i class="fas fa-calendar-alt mr-3 text-purple-600"></i>다음 주 핵심 이벤트</h2>
            <p class="section-subtitle">시장의 단기 방향성에 영향을 미칠 수 있는 주요 경제 지표 발표, 기업 실적, 정책 이벤트를 미리 확인합니다.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div class="bg-white p-6 rounded-lg border-l-4 border-purple-500 shadow-sm hover:shadow-lg transition-shadow duration-300">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-sm font-semibold text-purple-700 bg-purple-100 px-3 py-1 rounded-full">@@EVENT_1_CATEGORY@@</span>
                        <span class="text-sm font-medium text-gray-500">@@EVENT_1_DATE@@</span>
                    </div>
                    <h3 class="text-lg font-bold text-gray-800 mb-3">@@EVENT_1_TITLE@@</h3>
                    <p class="text-sm text-gray-600">
                        <strong class="text-gray-700">예상 영향:</strong> @@EVENT_1_IMPACT@@
                    </p>
                </div>

                <div class="bg-white p-6 rounded-lg border-l-4 border-red-500 shadow-sm hover:shadow-lg transition-shadow duration-300">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-sm font-semibold text-red-700 bg-red-100 px-3 py-1 rounded-full">@@EVENT_2_CATEGORY@@</span>
                        <span class="text-sm font-medium text-gray-500">@@EVENT_2_DATE@@</span>
                    </div>
                    <h3 class="text-lg font-bold text-gray-800 mb-3">@@EVENT_2_TITLE@@</h3>
                    <p class="text-sm text-gray-600">
                        <strong class="text-gray-700">예상 영향:</strong> @@EVENT_2_IMPACT@@
                    </p>
                </div>

                <div class="bg-white p-6 rounded-lg border-l-4 border-sky-500 shadow-sm hover:shadow-lg transition-shadow duration-300">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-sm font-semibold text-sky-700 bg-sky-100 px-3 py-1 rounded-full">@@EVENT_3_CATEGORY@@</span>
                        <span class="text-sm font-medium text-gray-500">@@EVENT_3_DATE@@</span>
                    </div>
                    <h3 class="text-lg font-bold text-gray-800 mb-3">@@EVENT_3_TITLE@@</h3>
                    <p class="text-sm text-gray-600">
                        <strong class="text-gray-700">예상 영향:</strong> @@EVENT_3_IMPACT@@
                    </p>
                </div>

                <div class="bg-white p-6 rounded-lg border-l-4 border-amber-500 shadow-sm hover:shadow-lg transition-shadow duration-300">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-sm font-semibold text-amber-700 bg-amber-100 px-3 py-1 rounded-full">@@EVENT_4_CATEGORY@@</span>
                        <span class="text-sm font-medium text-gray-500">@@EVENT_4_DATE@@</span>
                    </div>
                    <h3 class="text-lg font-bold text-gray-800 mb-3">@@EVENT_4_TITLE@@</h3>
                    <p class="text-sm text-gray-600">
                        <strong class="text-gray-700">예상 영향:</strong> @@EVENT_4_IMPACT@@
                    </p>
                </div>

                <div class="bg-white p-6 rounded-lg border-l-4 border-gray-500 shadow-sm hover:shadow-lg transition-shadow duration-300">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-sm font-semibold text-gray-700 bg-gray-100 px-3 py-1 rounded-full">@@EVENT_5_CATEGORY@@</span>
                        <span class="text-sm font-medium text-gray-500">@@EVENT_5_DATE@@</span>
                    </div>
                    <h3 class="text-lg font-bold text-gray-800 mb-3">@@EVENT_5_TITLE@@</h3>
                    <p class="text-sm text-gray-600">
                        <strong class="text-gray-700">예상 영향:</strong> @@EVENT_5_IMPACT@@
                    </p>
                </div>
				
				<div class="bg-white p-6 rounded-lg border-l-4 border-gray-500 shadow-sm hover:shadow-lg transition-shadow duration-300">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-sm font-semibold text-gray-700 bg-gray-100 px-3 py-1 rounded-full">@@EVENT_6_CATEGORY@@</span>
                        <span class="text-sm font-medium text-gray-500">@@EVENT_6_DATE@@</span>
                    </div>
                    <h3 class="text-lg font-bold text-gray-800 mb-3">@@EVENT_6_TITLE@@</h3>
                    <p class="text-sm text-gray-600">
                        <strong class="text-gray-700">예상 영향:</strong> @@EVENT_6_IMPACT@@
                    </p>
                </div>
            </div>
        </section>		
    </main>
</body>
</html>