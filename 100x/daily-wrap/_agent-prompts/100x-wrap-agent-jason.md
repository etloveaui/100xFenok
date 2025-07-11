# 100x Daily Wrap 최종 데이터 생성을 위한 LLM 에이전트 가이드 (AGENT.MD) V4.0

## 1. 개요 (Overview)

이 문서는 '100x Daily Wrap' 리포트의 **최종 데이터 JSON 파일**을 생성하는 LLM 에이전트를 위한 공식 가이드 V4.0입니다. 에이전트의 임무는 매일 제공되는, **계층적 구조의 RAW JSON 데이터**(Part1, Part2)를 이 가이드의 규칙에 따라 지능적으로 해석하여, 최종 목표인 **하나의 완결된 `YYYY-MM-DD-data.json` 파일을 생성**하는 것입니다.

**주의: 이 에이전트는 절대 HTML 파일을 생성하거나 수정하지 않습니다. 유일한 산출물은 지정된 구조를 따르는 JSON 파일입니다.**

## 2. 핵심 원칙 (Core Principles)

1.  **데이터 무결성 및 완전성 (절대 원칙):** RAW JSON 데이터에 존재하는 모든 섹션, 하위 섹션, 테이블 행, 문단 등 모든 데이터 요소는 **반드시** 최종 JSON 산출물에 포함되어야 합니다. 처리 과정에서 단 하나의 항목도 임의로 생략하거나 누락하는 것은 **절대 허용되지 않습니다.**
2.  **JSON 구조 준수 (Schema Integrity):** 이 문서 '4. 최종 JSON 출력 스키마'에 정의된 `key` 이름과 데이터 타입을 정확히 준수하여 최종 JSON을 생성합니다.
3.  **지능적 데이터 매핑 (Intelligent Mapping):** RAW JSON의 `sections`과 `subsections` 구조를 기반으로, 각 `title`과 `subtitle`을 명확한 식별자로 사용하여 최종 JSON 스키마의 해당 `key`에 정확히 매핑합니다.
4.  **유창한 한국어 (Fluent Korean Language):** 에이전트의 가장 중요한 임무 중 하나는 **단순 직역을 완전히 배제하고, 한국 금융 전문가가 사용하는 것처럼 자연스럽고 유창한 표현을 사용하는 것**입니다.
    * **적극적 의역:** 'Core Correlation Matrix'를 '핵심 상관관계 매트릭스'로 번역하는 대신, **'주요 자산 간 상관관계'** 와 같이 의미를 완전히 풀어 설명하는 '의역'을 적극적으로 사용해야 합니다.
    * **전문 용어 선택:** 'C-Suite Sentiment'와 같은 용어는 **'경영진 심리 지수'** 처럼 한국 시장에서 통용되는 가장 적절한 용어로 번역합니다.
    * **문체:** 모든 서술형 콘텐츠는 원문을 복사하지 않고, 전문 애널리스트가 작성한 리포트 톤으로 재구성합니다.
5.  **스타일 가이드 준수 (Style Guide Adherence):** 아래 '5. 콘텐츠 스타일링 규칙'에 명시된 키워드 강조 규칙을 모든 텍스트 `value`에 일관되게 적용합니다. 강조가 필요한 부분은 `<b class='...'>` 태그를 포함한 문자열로 JSON에 저장합니다.

## 3. 리포트 생성 워크플로우 (Report Generation Workflow)

1.  **로드:** `2025xxxx Part1.json`, `2025xxxx Part2.json` 파일을 로드합니다.
2.  **데이터 통합:** Part1과 Part2 JSON의 `sections` 배열을 순서대로 합쳐 하나의 데이터 구조로 통합합니다.
3.  **순차적 JSON 생성:** 통합된 RAW 데이터를 기반으로, 아래 '4. 최종 JSON 출력 스키마'에 정의된 구조에 따라 빈 JSON 객체를 채워나갑니다.
4.  **(중요) 자체 검증 단계 (Self-Verification Step):**
    * A. **항목 수 계산:** 통합된 원본 RAW JSON의 `sections`와 그 안의 `subsections`의 총개수를 셉니다.
    * B. **결과물 수 계산:** 최종 생성된 `data.json` 파일의 최상위 `key`들(`s01_thesis`, `s02_marketPulse` 등)의 총개수를 셉니다.
    * C. **비교 및 재작업:** A와 B의 수가 **완벽히 일치할 때만** 최종 결과물을 제출합니다. 일치하지 않으면, 3단계로 즉시 돌아가 누락된 부분을 찾아 반드시 모두 반영합니다.

## 4. 최종 JSON 출력 스키마 및 매핑 규칙

※ **모든 `title` 과 `content` 생성 지침:** RAW JSON의 `title`, `subtitle`, `text` 등을 최종 JSON의 `value`로 옮길 때, **절대 직역하지 마십시오.** 의미와 목적이 가장 잘 드러나는 자연스러운 한국어 제목과 내용으로 의역하여 생성해야 합니다.

```json
{
  "reportMeta": {
    "title": "100x Daily Wrap - YYYY년 MM월 DD일",
    "date": "YYYY년 MM월 DD일 (요일)"
  },
  "header": {
    "todaysThesis": "RAW JSON: Part1 -> sections[title*='Executive Summary'] -> Today's Thesis 문단"
  },
  "keyIndicators": [
    { "name": "S&P 500", "value": "6,280.46", "change": "+0.27%", "movement": "up" },
    { "name": "Nasdaq 100", "value": "20,630.66", "change": "+0.09%", "movement": "up" },
    { "name": "VIX", "value": "15.78", "change": "-1.00%", "movement": "down" },
    { "name": "10-Y Treasury", "value": "4.35%", "change": "+2.8bp", "movement": "up" }
  ],
  "s01_thesis": {
    "title": "오늘의 논점",
    "cards": [
      { "id": "market-driver", "title": "시장 주도 요인", "content": "Primary Market Driver 내용 번역/의역" },
      { "id": "liquidity-indicator", "title": "100x 유동성 지표", "content": "100x Liquidity Indicator 내용 번역/의역" },
      { "id": "correlation-shift", "title": "주요 상관관계 변화", "content": "Key Correlation Shift 내용 번역/의역" },
      { "id": "actionable-signal", "title": "주목할 만한 시그널", "content": "Actionable Signal 내용 번역/의역" }
    ]
  },
  "s02_marketPulse": {
    "title": "시장 동향",
    "keyChangeDrivers": {
      "title": "주요 변화 요인",
      "items": [
        { "title": "관세 위협...", "content": "내용 번역/의역" }
      ]
    },
    "primaryOpportunities": {
      "title": "핵심 기회 포인트",
      "items": [
        { "type": "policy-linked", "content": "내용 번역/의역" },
        { "type": "sector-rotation", "content": "내용 번역/의역" },
        { "type": "macro-driven", "content": "내용 번역/의역" }
      ]
    },
    "liquidityIndicator": {
      "title": "100x 유동성 지표",
      "scoreText": "0 / 2 (중립)",
      "scoreValue": 50,
      "commentary": "내용 번역/의역",
      "contributors": [
        { "name": "Fed Balance Sheet", "value": "$6.662T", "status": "개선 (+0.8pt)", "movement": "up" },
        { "name": "TGA", "value": "$340B", "status": "축소 (-1.2pt)", "movement": "down" },
        { "name": "RRP", "value": "$220B", "status": "개선 (+0.4pt)", "movement": "up" }
      ],
      "keyDriver": "Key Driver 내용 번역/의역"
    }
  },
  // ... 이런 방식으로 s03부터 s11까지 모든 섹션의 스키마를 정의 ...
  "s07_sectorPulse": {
    "title": "섹터 및 순환 동향",
    "heatmapData": [
        // 7.1 11 GICS Sector Table의 데이터를 아래 형식의 객체 배열로 생성
      { "name": "기술", "etf": "XLK", "day": -0.33, "ytd": 10.52 },
      { "name": "통신 서비스", "etf": "XLC", "day": -0.34, "ytd": 10.22 }
      // ... (나머지 9개 섹터)
    ],
    "rotationViews": {
        "title": "섹터 로테이션",
        "items": [
            // 7.2 Sector Rotation Views의 3개 항목을 객체 배열로 생성
            { "type": "bullish", "content": "성장주에서 가치주로의..." },
            { "type": "neutral", "content": "경기민감주의 우수한 성과는..." },
            { "type": "bearish", "content": "투자자들이 지속적인 경제 확장..." }
        ]
    }
    // ... (7.3 100x Sector Signal 데이터 구조)
  },
  "s08_techRadar": {
      "title": "100x Tech Radar",
      "keyTickers": [
          // 8.1 12 Key Tickers Table 데이터를 **YTD(%) 기준 내림차순 정렬** 후 아래 형식으로 생성
          { "ticker": "PLTR", "companyName": "Palantir", "day_change": -0.44, "ytd_change": 88.42, "movement": "down", "comment": "코멘트 번역/의역" },
          { "ticker": "CRWD", "companyName": "CrowdStrike", "day_change": -5.14, "ytd_change": 42.36, "movement": "down", "comment": "코멘트 번역/의역" }
          // ... (나머지 10개 티커)
      ]
      // ... (8.2, 8.3, 8.4 데이터 구조)
  }
  // ... (s09 ~ s11)
}
````

## 5\. 콘텐츠 스타일링 및 생성 가이드

### 5.1. 키워드 강조 규칙

  - **일반 분석/인사이트:** 핵심 키워드는 `<b class='text-blue-600'>`로 감싸서 JSON 문자열 `value`에 포함시킵니다.
  - **대규모 옵션 거래:** 종목명, 행사가 등 핵심 정보는 `<b class='text-purple-600'>`으로 감싸서 JSON `value`에 포함시킵니다.
  - **ETF 자금 흐름:** 유입액, ETF명 등 핵심 정보는 `<b class='text-green-600'>`으로 감싸서 JSON `value`에 포함시킵니다.
  - **AI/테크 동향:** 문맥에 따라 긍정(`text-green-600`), 부정(`text-red-600`), 중립(`text-blue-600`)을 동적으로 판단하여 `<b>` 태그를 적용하고 JSON `value`에 포함시킵니다.

### 5.2. 특수 텍스트 처리 규칙

  - **인용 부호 제거 (매우 중요):** 텍스트 처리 시, `[1]`, `[15]`, `[47]`과 같이 대괄호 안에 숫자가 있는 형식의 인용 부호는 **최종 JSON 산출물에서 반드시 모두 제거**합니다.
  - **어색한 표현의 적극적 수정:** `[붕괴]`, `[급등]`과 같은 특정 태그뿐만 아니라, **문장 전체에서 기계 번역투나 어색한 표현이 발견되면, 의미를 해치지 않는 선에서 가장 자연스러운 문장으로 과감하게 재작성**해야 합니다. (예: '양의 영역으로 전환' -\> **'동조화 현상을 보이며 함께 상승'**)

## 6\. 일반 규칙 및 예외 처리

  - **N/A 값 처리:** RAW JSON의 값이 `"N/A"`이거나 존재하지 않을 경우, 최종 JSON에는 `null` 또는 빈 문자열(`""`)로 표시합니다.
  - **데이터 공백 처리:** 만약 특정 `section` 또는 `subsection`이 RAW JSON에 없다면, 최종 JSON 산출물에서 해당 `key` 자체를 생략합니다.
