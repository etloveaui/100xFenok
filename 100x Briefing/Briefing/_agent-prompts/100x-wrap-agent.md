# 100x Daily Wrap 리포트 생성을 위한 LLM 에이전트 가이드 (AGENT.MD) V3.0

## 1. 개요 (Overview)

이 문서는 '100x Daily Wrap' HTML 리포트를 생성하는 LLM 에이전트를 위한 공식 가이드 V3.0입니다. 에이전트의 임무는 매일 제공되는, **계층적 구조의 RAW JSON 데이터**(Part1, Part2)를 이 가이드의 규칙에 따라 지능적으로 해석하여, 최종 목표인 **`100x-daily-wrap-template.html`** 파일에 완벽하게 채워 넣는 것입니다.

## 2. 핵심 원칙 (Core Principles)

1.  **데이터 무결성 및 완전성 (절대 원칙):** RAW JSON 데이터에 존재하는 모든 섹션, 하위 섹션, 테이블 행, 문단 등 모든 데이터 요소는 **반드시** 최종 산출물에 포함되어야 합니다. 처리 과정에서 단 하나의 항목도 임의로 생략하거나 누락하는 것은 **절대 허용되지 않습니다.**
2.  **템플릿 구조 준수 (Template Integrity):** `100x-daily-wrap-template.html`의 구조, 태그, ID, CSS 클래스는 절대 변경하지 않습니다. 오직 지정된 위치에 내용만 채워 넣습니다.
3.  **계층적 매핑 (Hierarchical Mapping):** RAW JSON의 `sections`와 `subsections` 구조를 기반으로, 각 `title`과 `subtitle`을 명확한 식별자로 사용하여 템플릿의 해당 HTML `id`에 정확히 매핑합니다.
4.  **유창한 한국어 (Fluent Korean Language):** 에이전트의 가장 중요한 임무 중 하나는 **단순 직역을 완전히 배제하고, 한국 금융 전문가가 사용하는 것처럼 자연스럽고 유창한 표현을 사용하는 것**입니다.
    **적극적 의역:** 'Core Correlation Matrix'를 '핵심 상관관계 매트릭스'로 번역하는 대신, **'주요 자산 간 상관관계'** 와 같이 의미를 완전히 풀어 설명하는 '의역'을 적극적으로 사용해야 합니다.
    **전문 용어 선택:** 'C-Suite Sentiment'와 같은 용어는 **'경영진 심리 지수'** 처럼 한국 시장에서 통용되는 가장 적절한 용어로 번역합니다.
    **문체:** 모든 서술형 콘텐츠는 원문을 복사하지 않고, 전문 애널리스트가 작성한 리포트 톤으로 재구성합니다.
5.  **스타일 가이드 준수 (Style Guide Adherence):** 아래 '콘텐츠 스타일링 및 생성 가이드'에 명시된 키워드 강조, 특수 텍스트 처리 규칙을 모든 섹션에 일관되게 적용합니다.

## 3. 리포트 생성 워크플로우 (Report Generation Workflow)

1.  **로드:** `2025xxxx Part1.json`, `2025xxxx Part2.json`, `100x-daily-wrap-template.html` 파일을 로드합니다.
2.  **데이터 통합:** Part1과 Part2 JSON의 `sections` 배열을 순서대로 합쳐 하나의 데이터 구조로 통합합니다.
3.  **순차적 매핑:** 통합된 JSON 데이터를 기반으로, 아래 '4. 섹션별 상세 매핑 규칙'에 따라 템플릿의 각 섹션(`id="s01-thesis"`부터)을 순서대로 채워나갑니다.
4.  **(중요) 자체 검증 단계 (Self-Verification Step):**
    * **A. 항목 수 계산:** 통합된 원본 RAW JSON의 `sections`와 그 안의 `subsections`의 총개수를 셉니다.
    * **B. 결과물 수 계산:** 최종 생성된 HTML에 제목(`<h2>`)으로 반영된 섹션 및 하위 섹션의 총개수를 셉니다.
    * **C. 비교 및 재작업:** A와 B의 수가 **완벽히 일치할 때만** 최종 결과물을 제출합니다. 일치하지 않으면, 3단계로 즉시 돌아가 누락된 부분을 찾아 반드시 모두 반영합니다.

## 4. 섹션별 상세 매핑 규칙 (Section-by-Section Mapping Rules)
**※ 모든 섹션 제목 번역에 대한 총괄 지침:** RAW JSON의 `title`과 `subtitle`(예: `Executive Summary`, `Key Change Drivers`)을 HTML의 제목으로 옮길 때, **절대 직역하지 마십시오.** 템플릿에 예시로 제시된 '오늘의 논점', '주요 변화 요인'처럼, **의미와 목적이 가장 잘 드러나는 자연스러운 한국어 제목으로 의역하여 생성**해야 합니다.

### **Part 1: `2025xxxx Part1.json`**

#### **`sections[title="1. Executive Summary & Today's Thesis"]` → `id="s01-thesis"`**
-   `Today's Thesis`로 시작하는 문단을 찾아 헤더의 '오늘의 핵심 논점'에 채워 넣습니다.
-   나머지 4개의 `•` 항목(`Primary Market Driver`, `100x Liquidity Indicator`, `Key Correlation Shift`, `Actionable Signal`)을 '오늘의 논점' 섹션의 4개 카드에 각각 순서대로 매핑합니다.
-   각 항목의 제목(예: `Primary Market Driver`)을 카드의 `<h4>` 태그에 '시장 주도 요인'과 같이 자연스러운 한글로 번역하여 넣고, 내용은 `<p>` 태그에 채웁니다.

#### **`sections[title="2. Today's Market Pulse"]` → `id="s02-market-pulse"`**
-   **`subsections[subtitle="2.1 Key Change Drivers"]`:**
    -   5개의 `•` 항목을 '주요 변화 요인' 섹션의 5개 항목에 순서대로 매핑합니다.
    -   각 항목의 제목(예: `Tariff Escalation`)을 `<p class="font-semibold">`에, 내용을 바로 아래 `<p class="text-sm">`에 채웁니다.
-   **`subsections[subtitle="2.2 Primary Opportunities"]`:**
    -   3개의 `•` 항목을 '핵심 기회 포인트' 섹션의 `<li>` 태그에 순서대로 매핑합니다.
    -   `Policy-Linked:`, `Sector Rotation:`, `Macro-Driven:` 부분은 템플릿에 고정되어 있으므로, 그 뒤의 설명 부분만 채워 넣습니다.
-   **`subsections[subtitle="2.3 100x Liquidity Indicator"]`:**
    -   `100x Liquidity Indicator: 6.2 / 10 (Moderately Restrictive)`에서 점수(`6.2`), 최대 점수(`10`), 상태(`Moderately Restrictive` -> '중립적 긴축' 등으로 번역)를 추출하여 각각의 `<span>` 태그에 넣습니다.
    -   점수(6.2)를 기반으로 `style="width: 62%"`와 같이 프로그레스 바의 너비를 계산하여 적용합니다.
    -   `Commentary` 내용을 '유동성 환경에 대한 종합적인 설명' 부분에 넣습니다.
    -   `Fed Balance Sheet Contribution`, `TGA Contribution`, `RRP Contribution`의 금액과 상태 설명을 '상세 기여도' 카드에 각각 매핑합니다.
    -   `Key Driver` 내용을 해당 `<p>` 태그에 넣습니다.

#### **`sections[title="3. Multi-Asset Performance Dashboard"]` → `id="s03-multi-asset"`**
-   **`subsections[subtitle="3.1 Top 3 U.S. Gainers"]`:** 3개 항목을 '주요 상승 종목' 카드에 순서대로 채웁니다. 티커, 변동률, 이유를 각각 매핑합니다.
-   **`subsections[subtitle="3.2 Top 3 U.S. Losers"]`:** 3개 항목을 '주요 하락 종목' 카드에 순서대로 채웁니다.
-   **`subsections[subtitle="3.3 Multi-Asset Performance"]`:**
    -   4개의 테이블(`Major Indices`, `Fixed Income`, `Digital Assets`, `Commodities`) 데이터를 '자산별 성과 요약'의 4개 탭(`지수`, `채권·환율`, `원자재`, `디지털자산`) 내 아코디언 메뉴에 정확히 매핑합니다.
    -   **주의:** `Digital Assets`는 테이블이 아닌 `•` 항목으로 제공되므로, 각 항목을 파싱하여 아코디언 메뉴에 채워 넣습니다.
    -   값이 `N/A`이거나 존재하지 않을 경우, `<span class="na-value">-</span>`로 표시합니다.

#### **`sections[title="4. Correlation & Volatility Matrix"]` → `id="s04-correlation"`**
-   **`subsections[subtitle="4.1 Core Correlation Matrix (30-Day Rolling)"]`:** 테이블의 3개 행을 'Core Correlation Matrix' 카드 3개에 각각 매핑합니다. `Asset Pair`를 제목으로, `Correlation`을 수치로, `Interpretation`을 설명으로 넣습니다.
-   **`subsections[subtitle="4.2 Anomaly Spotlight"]`:** 3개의 `•` 항목을 'Anomaly Spotlight' 섹션의 3개 `<li>` 태그에 매핑합니다. `[추세 이탈]`과 같은 태그는 `<b>`로 강조된 자연스러운 한국어로 번역합니다.

#### **`sections[title="5. Fresh Wall Street Intelligence"]` → `id="s05-wall"`**
-   **`subsections[subtitle="5.1 Major IB Updates"]`:** 테이블의 모든 행을 '주요 투자은행 업데이트' 타임라인에 하나도 빠짐없이 생성합니다. `Action` 값에 따라 아이콘과 배경색을 동적으로 변경합니다. (Raised Target -> 상향, Downgrade -> 하향, Initiated -> 신규)
-   **`subsections[subtitle="5.2 Analyst's View"]`:** 3개의 `View` 항목을 '애널리스트 시각' 섹션의 3개 `div`에 순서대로 매핑합니다.
-   **`subsections[subtitle="5.3 100x Market vs Street"]`:** `Reality Score`, `Action`, `Biggest Disconnect`, `Market Says` 데이터를 '100x Market vs Street' 섹션에 정확히 매핑합니다.

#### **`sections[title="6. Institutional Money Flows"]` → `id="s06-flows"`**
-   **`subsections[subtitle="6.1 Large Options Trades"]`:** 4개 항목을 '대규모 옵션 거래' 섹션에 매핑합니다. 키워드 강조 규칙(`text-purple-600`)을 적용합니다.
-   **`subsections[subtitle="6.2 ETF Flows"]`:** 4개 항목을 'ETF 자금 흐름' 섹션에 매핑합니다. 키워드 강조 규칙(`text-green-600`)을 적용합니다.
-   **`subsections[subtitle="6.3 Dark Pool & Political Donation Flows"]`:** `Dark Pool` 2개 항목과 `Political Donation` 1개 항목을 '다크 풀 및 정치 자금' 섹션에 각각 매핑합니다.

### **Part 2: `2025xxxx Part2.json`**

#### **`sections[title="7. Sector & Rotation Pulse"]` → `id="s07-sector-pulse"`**
-   **`subsections[subtitle="7.1 11 GICS Sector Table"]`:** 테이블의 11개 섹터 데이터를 `<script>` 태그 내의 `sectorData` 자바스크립트 배열에 다음 형식으로 재구성하여 채워 넣습니다: `{ name: 'Sector', etf: 'ETF', day: Day (%), ytd: YTD (%) }`
-   **`subsections[subtitle="7.2 Sector Rotation Views"]`:** 3개의 `View`를 '섹터 로테이션' 섹션의 3개 `div`에 매핑합니다.
-   **`subsections[subtitle="7.3 100x Sector Signal"]`:** `Rotation Signal`, `Signal`, `Strongest Mover`, `Rotation Pattern`, `Trade Signal` 데이터를 '100x Sector Signal' 섹션에 정확히 매핑합니다.

#### **`sections[title="8. Tech Leadership Pulse"]` → `id="s08-tech-radar"`**
-   **`subsections[subtitle="8.1 12 Key Tickers Table"]`:**
    -   12개 종목 데이터를 모두 추출한 후, **YTD(%)를 기준으로 내림차순 정렬**하여 12개의 뒤집히는 카드에 순서대로 채워 넣습니다.
    -   티커, 등락률, YTD, 뉴스 요약(카드 뒷면)을 각각 매핑합니다.
-   **`subsections[subtitle="8.2 AI Ecosystem Pulse"]`:** 6개의 `•` 항목(`Startup Spotlight` 등)을 'AI 생태계 동향' 섹션의 6개 카드에 각각 매핑합니다.
-   **`subsections[subtitle="8.3 AI Investment Lens"]`:** 3개의 `•` 항목(`Best Opportunity` 등)을 'AI 투자 관점' 섹션의 3개 카드에 각각 매핑합니다.
-   **`subsections[subtitle="8.4 100x AI Edge"]`:** `100x Take`, `Hidden Connection`, `Overlooked Implication`을 '100x AI Edge' 섹션에 매핑합니다.

#### **`sections[title="9. Today's Actionable Trade Signals"]` → `id="s09-trade-signals"`**
-   **`subsections[subtitle="9.1 Live Trade Signals"]`:** `Signal #1, #2, #3` 데이터를 '실시간 트레이드' 섹션의 3개 카드에 각각 매핑합니다. 카드별로 모든 세부 정보(진입, 목표, 손절, 촉매 등)를 정확히 채웁니다.
-   **`subsections[subtitle="9.2 Live Broker Alpha Scanner"]`:** `Hottest Consensus Build`, `Fresh Upgrade Alert`, `Hidden Gem Discovery` 정보를 '기관 트레이드' 섹션의 3개 카드에 각각 매핑합니다.
-   **`subsections[subtitle="9.3 100x Signal Rank"]`:** `Highest Conviction` 이하 모든 항목을 '100x Signal Rank' 섹션에 매핑합니다.

#### **`sections[title="10. Tomorrow's Catalyst & Economic Calendar"]` → `id="s10-catalysts"`**
-   **`subsections[subtitle="10.1 Economic Calendar"]`:** 테이블 데이터를 '경제지표 캘린더' 섹션에 매핑합니다. 템플릿에는 해설(Interpretation) 필드가 있으나 JSON에는 없으므로, 해당 부분은 비워둡니다.
-   **`subsections[subtitle="10.2 Earnings Calendar"]`:** 테이블 데이터를 '실적 캘린더' 섹션에 매핑합니다.
-   **`subsections[subtitle="10.3 Corporate & Policy Events"]`:** 테이블 데이터를 '기업 & 정책 이벤트' 섹션에 매핑합니다.

#### **`sections[title="11. Appendix"]` → `id="s11-appendix"`**
-   **`subsections[subtitle="11.1 Appendix A: Overnight Futures Movements"]`:** 테이블 데이터를 '야간 선물 움직임' 카드에 매핑합니다.
-   **`subsections[subtitle="11.2 Appendix B: Key Chart Summaries"]`:** 2개의 `•` 항목을 '주요 차트 요약' 섹션의 2개 카드에 각각 매핑합니다. `Report Metadata` 부분은 최종 산출물에 포함하지 않습니다.

## 5. 콘텐츠 스타일링 및 생성 가이드

### 5.1. 키워드 강조 규칙
-   **일반 분석/인사이트:** 핵심 키워드는 `<b class='text-blue-600'>`로 강조합니다.
-   **대규모 옵션 거래:** 종목명, 행사가, 거래량 등 핵심 정보는 `<b class='text-purple-600'>`으로 강조합니다.
-   **ETF 자금 흐름:** 유입액, ETF명 등 핵심 정보는 `<b class='text-green-600'>`으로 강조합니다.
-   **AI/테크 동향:** 문맥에 따라 긍정(`text-green-600`), 부정(`text-red-600`), 중립(`text-blue-600`)을 동적으로 판단하여 `<b>` 태그에 적용합니다.

### 5.2. 특수 텍스트 처리 규칙
-   **인용 부호 제거 (매우 중요):** 텍스트 처리 시, `[1]`, `[15]`, `[47]`과 같이 대괄호 안에 숫자가 있는 형식의 인용 부호는 **최종 결과물에서 반드시 모두 제거**합니다.
-   **어색한 표현의 적극적 수정:** `[붕괴]`, `[급등]`과 같은 특정 태그뿐만 아니라, **문장 전체에서 기계 번역투나 어색한 표현이 발견되면, 의미를 해치지 않는 선에서 가장 자연스러운 문장으로 과감하게 재작성**해야 합니다. (예: '양의 영역으로 전환' -> **'동조화 현상을 보이며 함께 상승'**)

## 6. 일반 규칙 및 예외 처리

-   **N/A 값 처리:** JSON의 값이 `"N/A"`이거나 존재하지 않을 경우, HTML에는 `<span class="na-value">-</span>`로 표시합니다.
-   **데이터 공백 처리:** 만약 특정 `section` 또는 `subsection`이 RAW JSON에 없다면, 정보의 공백을 보여주는 대신 HTML 템플릿에서 해당 섹션 전체(제목 포함)를 렌더링하지 않습니다.