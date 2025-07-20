# 알파스카우트 리포트 업데이트 절차 (최종 버전)

**목표:** 신규 주간 리포트를 발행하고 `alpha-scout-main.html` 페이지에 자동으로 반영되도록 한다.

**아키텍처:** 클라이언트 사이드 렌더링 (CSR)
- `alpha-scout-main.html`은 빈 껍데기이며, 내장된 스크립트가 동적으로 데이터를 로드하여 콘텐츠를 렌더링한다.
- 빌드 과정은 필요 없다.

**절차:**

1.  **메타데이터 파일 생성:**
    *   `alpha-scout/data/metadata/` 폴더에 `YYYY-MM-DD_data.json` 형식으로 새 파일을 생성한다.
    *   아래의 **JSON 객체 템플릿**에 맞춰 리포트의 모든 상세 정보를 이 파일에 입력한다. 이 파일은 해당 리포트의 모든 데이터를 담는 **단일 소스(Single Source of Truth)**가 된다.

2.  **인덱스 파일 업데이트:**
    *   `alpha-scout/data/reports-index.json` 파일을 연다.
    *   이 파일은 단순한 파일명 배열이다. 방금 생성한 메타데이터 파일의 **파일명(예: `"2025-07-21_data.json"`)**을 배열의 **맨 앞**에 추가한다.

**끝. 브라우저에서 `alpha-scout-main.html`을 새로고침하면 변경사항이 자동으로 적용된다.**

---

### JSON 객체 템플릿 (`data/metadata/` 폴더용)

```json
{
  "reportDate": "YYYY-MM-DD",
  "marketSummary": {
    "headline": "",
    "summary": "",
    "sp500": { "price": "", "changePercent": "", "colorClass": "" },
    "nasdaq": { "price": "", "changePercent": "", "colorClass": "" },
    "tenYear": { "yield": "", "changeBp": "", "colorClass": "" },
    "vix": { "price": "", "changePercent": "", "colorClass": "" }
  },
  "sectors": [
    {
      "name": "",
      "weekly": { "perf": "", "colorClass": "" },
      "ytd": { "perf": "", "colorClass": "" },
      "valuation": {
        "label": "", "metricLabel": "", "metricValue": "",
        "bgClass": "", "textClass": ""
      }
    }
    // ... 다른 섹터들
  ],
  "valuePicks": [
    {
      "ticker": "", "name": "", "theme": "",
      "metrics": [
        { "label": "", "value": "" }
      ],
      "insights": [
        { "title": "", "description": "" }
      ]
    }
    // ... 다른 가치주 픽
  ],
  "momentumPicks": [
    {
      "ticker": "", "name": "", "performance": "",
      "metrics": [
        { "label": "", "value": "" }
      ],
      "insights": [
        { "title": "", "description": "" }
      ]
    }
    // ... 다른 모멘텀 픽
  ],
  "consensus": [
    {
      "ticker": "", "bank": "", "date": "",
      "change": "", "targetPrice": "", "comment": "",
      "bgClass": "", "textClass": ""
    }
    // ... 다른 컨센서스
  ],
  "keyEvents": [
    {
      "category": "", "date": "", "title": "", "impact": "",
      "borderColorClass": "", "categoryBgClass": "", "categoryTextClass": ""
    }
    // ... 다른 주요 이벤트
  ]
}
```