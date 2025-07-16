# 100x Daily Wrap 자동화 워크플로우 가이드 (v3.0)

## 1. 개요 (Overview)

이 문서는 새로운 `100x Daily Wrap` 리포트가 생성될 때, 관련 데이터 파일을 업데이트하고 **자동으로 사용자에게 푸시 알림을 발송**하는 LLM 에이전트를 위한 공식 가이드입니다.

에이전트의 임무는 신규 리포트 HTML 파일과 기존 인덱스 JSON 파일을 입력받아, 아래의 작업을 순차적으로 수행하는 것입니다.

1.  신규 리포트 정보 추출 → **개별 메타데이터 JSON 파일 생성**
2.  마스터 인덱스 JSON 파일에 새 리포트 정보 추가 → **인덱스 파일 업데이트**
3.  업데이트 완료 신호 전송 → **푸시 알림 자동 발송 트리거**

이 워크플로우를 통해 콘텐츠 발행부터 구독자 알림까지의 모든 과정이 자동화됩니다.

**[v3.0 주요 변경사항]**
- **자동 알림 워크플로우 추가**: 데이터 업데이트 완료 후, 구글 앱 스크립트로 구현된 API를 호출하여 OneSignal 푸시 알림을 자동으로 발송하는 단계를 추가했습니다.
- **산출물 변경**: 최종 결과물은 2개의 JSON 파일과 1개의 API 호출 성공 여부입니다.
- **보안 규칙 강화**: API 호출 시 반드시 비밀 키(Secret Key)를 포함하도록 명시했습니다.

## 2. 핵심 원칙 (Core Principles)

1.  **데이터 무결성 (Data Integrity):** 신규 리포트에서 추출하는 모든 정보는 정확해야 하며, JSON 형식 규칙을 완벽하게 준수해야 합니다.
2.  **파일 경로 일관성 (Path Consistency):** 생성되는 모든 파일 경로는 **'4. 파일 구조 및 산출물'** 섹션에 정의된 규칙을 따라야 합니다.
3.  **역순 정렬 (Reverse Chronological Order):** 마스터 인덱스 파일은 항상 가장 최신 리포트가 목록의 맨 위에 오도록 유지해야 합니다.
4.  **`100x-main.html` 불변성 (Immutability of `100x-main.html`):** 에이전트는 **절대 `100x-main.html` 파일을 수정하지 않습니다.**

## 3. 업데이트 워크플로우 (Update Workflow)

에이전트는 새로운 리포트가 도착할 때마다 아래 **5단계** 워크플로우를 엄격히 따라야 합니다.

#### **1단계: 신규 리포트 분석 (Parse New Report)**
-   제공된 최신 `100x Daily Wrap` HTML 파일(예: `2025-07-18_100x-daily-wrap.html`)의 내용을 분석합니다.
-   **'5. 메타데이터 추출 규칙'**에 따라 리포트의 날짜, 제목, 요약, 키워드, 파일 경로 정보를 정확히 추출합니다.

#### **2단계: 신규 메타데이터 JSON 파일 생성 (Create New Metadata JSON)**
-   1단계에서 추출한 정보를 사용하여 **새로운 개별 메타데이터 JSON 파일**을 생성합니다.
-   파일명은 `YYYY-MM-DD.json` 형식이어야 합니다. (예: `2025-07-18.json`)

#### **3단계: 마스터 인덱스 업데이트 (Update Master Index)**
-   기존 `data/reports-index.json` 파일을 읽습니다.
-   파일 내용(JSON 배열)의 **가장 맨 앞에** 2단계에서 생성한 새 메타데이터 파일의 이름(예: `"2025-07-18.json"`)을 추가합니다.
-   업데이트된 배열을 포함하는 `reports-index.json` 파일을 생성합니다.

#### **4단계: [신규] 자동 알림 발송 트리거 (Trigger Push Notification)**
-   데이터 업데이트가 완료되면, 아래 명시된 **구글 앱 스크립트 웹 앱 URL**로 `HTTP POST` 요청을 보냅니다.
-   이 요청은 OneSignal을 통해 모든 구독자에게 알림을 발송하는 역할을 합니다.
-   **API 호출 규칙:**
    -   **URL:** `https://script.google.com/macros/s/AKfycbzG4qY6YzY4ihgCFwqdfwzHK0assKctg27W6a7EAvrKzbjInH2ttl0Y6wfImUXKf8ZiGw/exec`
    -   **Method:** `POST`
    -   **Headers:** `Content-Type: application/json`
    -   **Body (Payload):** 아래 **'6. 알림 페이로드 생성 규칙'**을 참조하여 JSON 형식으로 구성합니다.

#### **5단계: 최종 산출물 제출 (Submit Final Deliverables)**
-   아래 항목들을 최종 결과물로 제출합니다.
    1.  새로 생성된 **개별 메타데이터 JSON 파일** (예: `2025-07-18.json`)
    2.  업데이트된 **마스터 인덱스 JSON 파일** (`reports-index.json`)
    3.  4단계 API 호출의 **성공 또는 실패 여부** 로그

## 4. 파일 구조 및 산출물 (File Structure & Deliverables)

-   **개별 메타데이터 파일 경로:** `data/metadata/YYYY-MM-DD.json`
-   **마스터 인덱스 파일 경로:** `data/reports-index.json`

## 5. 메타데이터 추출 규칙

-   **`date`**: `<p class="text-lg text-slate-500 ...">` 태그에서 "YYYY년 MM월 DD일 (요일)" 또는 "Month DD, YYYY" 형식의 전체 텍스트를 추출합니다.
-   **`title`**: 리포트 `<header>` 내부의 핵심 논점 `<p>` 태그 내용을 기반으로 자연스러운 제목을 생성합니다.
-   **`summary`**: `title`과 동일한 `<p>` 태그 내용을 100~150자 내외로 자연스럽게 요약합니다. 비어있어도 무방합니다.
-   **`keywords`**: 요약된 내용을 바탕으로 가장 핵심적인 주제 3~4개를 추출하여 배열로 만듭니다. 각 키워드는 `name`과 `color` 속성을 가집니다. 색상은 내용에 따라 `red`, `green`, `blue`, `yellow`, `purple` 중에서 선택합니다.
-   **`path`**: `index.html?path=100x/daily-wrap/YYYY-MM-DD_100x-daily-wrap.html` 형식으로 리포트의 전체 경로를 생성합니다.

## 6. 알림 페이로드 생성 규칙

4단계에서 API를 호출할 때, `Body`에 포함될 JSON 페이로드는 아래 규칙에 따라 동적으로 생성해야 합니다.

-   **`secret`**: **`mySuperSecretKey1028`** 라는 고정된 문자열을 사용합니다. (보안 키)
-   **`title`**: 1단계에서 추출한 리포트의 `title` 값을 사용합니다.
-   **`message`**: 1단계에서 추출한 리포트의 `summary` 값을 사용합니다. 요약이 길 경우, 가장 핵심적인 첫 문장만 사용합니다.
-   **`url`**: 1단계에서 생성한 리포트의 `path` 값을 `https://etloveaui.github.io/100x/` 와 조합하여 완전한 URL을 생성합니다.

**API Body 생성 예시:**
```json
{
  "secret": "mySuperSecretKey1028",
  "title": "새로운 관세 정책이 시장에 미치는 영향 분석",
  "message": "새로운 관세 정책 발표 이후, 시장은 단기적인 변동성을 보였으나 장기적인 펀더멘털은 여전히 견고합니다.",
  "url": "[https://etloveaui.github.io/100x/index.html?path=100x/daily-wrap/2025-07-17_100x-daily-wrap.html](https://fenok.github.io/100x/index.html?path=100x/daily-wrap/2025-07-17_100x-daily-wrap.html)"
}