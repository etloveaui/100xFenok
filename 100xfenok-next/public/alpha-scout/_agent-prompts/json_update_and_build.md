
# 알파스카우트 리포트 업데이트 및 빌드 절차

**목표:** 신규 주간 리포트를 발행하고 `alpha-scout-main.html` 페이지에 반영한다.

**절차:**

1.  **리포트 파일 생성:**
    *   새로운 주간 리포트 `YYYY-MM-DD_100x-alpha-scout.html` 파일을 `alpha-scout/reports/` 디렉토리에 추가한다.

2.  **데이터 인덱스 업데이트 (`reports-index.json`):**
    *   `alpha-scout/data/reports-index.json` 파일을 연다.
    *   `reports` 배열의 **가장 앞(최상단)**에 새로 발행된 리포트에 해당하는 JSON 객체를 추가한다.
    *   이때, 새로 추가된 객체의 `isFeatured` 값은 `true`로 설정한다.
    *   기존에 `isFeatured: true`였던 바로 아래 객체의 `isFeatured` 값을 `false`로 변경한다.

3.  **메인 페이지 빌드:**
    *   터미널을 열고 다음 명령어를 실행하여 `alpha-scout-main.html` 페이지를 다시 빌드한다.
    ```bash
    python tools/build-alpha-scout-main.py
    ```

**JSON 객체 템플릿:**

```json
{
  "id": "YYYY-MM-DD",
  "isFeatured": true,
  "filePath": "alpha-scout/reports/YYYY-MM-DD_100x-alpha-scout.html",
  "displayDate": "YYYY년 MM월 DD일",
  "archiveTitle": "새 리포트의 제목",
  "featuredPicks": {
    "value": {
      "ticker": "", "name": "", "description": "",
      "metric": { "label": "", "value": "" }
    },
    "momentum": {
      "ticker": "", "name": "", "description": "",
      "metric": { "label": "", "value": "" }
    },
    "institution": {
      "ticker": "", "name": "", "description": "",
      "metric": { "label": "", "value": "" }
    }
  },
  "archivePicks": {
    "value": "",
    "momentum": "",
    "institution": ""
  }
}
```
