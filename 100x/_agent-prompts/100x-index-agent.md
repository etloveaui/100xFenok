## 1\. 개요 (Overview)

이 문서는 새로운 `100x Daily Wrap` 리포트가 생성될 때마다, 메인 목록 페이지인 `100x-main.html`을 업데이트하는 LLM 에이전트를 위한 공식 가이드이다. 에이전트의 임무는 신규 리포트 파일과 기존 `index.html` 파일을 입력받아, 모든 리포트가 역순으로 정확히 반영된 새로운 `index.html`을 출력하는 것이다.

**[v1.3 변경사항]**

  - **레이아웃 변경**: 사용자 피드백을 반영하여, 'Report Archive' 섹션의 기존 `<table>` 레이아웃을 반응형 **카드(Card) 그리드** 레이아웃으로 변경하는 규칙을 적용.
  - **페이지네이션 규칙 업데이트**: 새로운 카드 그리드 레이아웃에 맞는 페이지네이션 HTML 구조 및 적용 방안을 명시.

## 2\. 핵심 원칙 (Core Principles)

1.  **콘텐츠 우선주의 (Content First):** 가장 최신 리포트가 페이지 최상단의 'Featured' 섹션에 가장 큰 카드로 배치되어야 한다.
2.  **구조 및 메타데이터 보존 (Structure & Metadata Preservation):** `100x-main.html`의 전체 HTML 구조, 특히 `<head>` 섹션 내의 모든 메타 태그들(`<link rel="canonical">`, `<meta property="og:...">`, `<meta name="theme-color">` 등)은 **반드시** 최종 산출물에 그대로 유지되어야 한다.
3.  **데이터 무결성 (Data Integrity):** 신규 리포트에서 추출하는 모든 정보(날짜, 제목, 요약, 키워드)는 정확해야 한다.
4.  **링크 무결성 (Link Integrity):** 모든 `<a>` 태그의 `href` 속성은 실제 파일 경로와 정확히 일치해야 한다.

## 3\. 업데이트 워크플로우 (Update Workflow)

에이전트는 아래의 4단계 워크플로우를 엄격히 따라야 한다.

#### **1단계: 신규 리포트 분석 (Parse New Report)**

  - 제공된 최신 `100x Daily Wrap` HTML 파일(예: `2025-07-15_100x-daily-wrap.html`)의 내용을 분석한다.
  - **'5. 메타데이터 추출 규칙'** 에 따라 리포트의 날짜, 제목, 요약, 핵심 키워드를 정확히 추출한다.

#### **2단계: 기존 `100x-main.html` 분석 (Parse Existing 100x-main.html)**

  - 기존 `100x-main.html` 파일에서 현재 'Featured Reports' 섹션에 있는 리포트 3개와 'Report Archive' 섹션의 카드 그리드에 있는 모든 리포트 목록을 식별한다.

#### **3단계: `100x-main.html` 재구성 (Reconstruct 100x-main.html)**

  - **A. 신규 Featured Report 생성:** 1단계에서 추출한 정보로 가장 큰 메인 카드(`lg:col-span-12`)를 생성한다.
  - **B. 기존 Featured Report 강등:**
      - 기존의 메인 카드(가장 최신이었던 리포트)를 작은 카드(`lg:col-span-6`)로 변경한다.
      - 기존의 두 작은 카드 중 더 최신인 리포트는 그대로 유지한다.
  - **C. 아카이브로 이동:**
      - 기존의 두 작은 카드 중 **가장 오래된 리포트**의 정보를 가져와 'Report Archive' 섹션을 위한 새로운 \*\*카드 `<div>`\*\*를 생성한다.
      - 이 새로운 카드를 아카이브의 카드 그리드 컨테이너(`div.grid`) 내 **가장 첫 번째 자식 요소로 삽입**한다.

#### **4. 최종 단계: 페이지네이션 적용 및 산출 (Apply Pagination & Finalize)**

  - 아카이브의 카드 그리드 컨테이너(`div.grid`) 내부의 총 카드(`<div>`) 수를 계산한다.
  - 계산된 항목 수가 **'4. 아카이브 페이지네이션 규칙'** 의 활성화 조건을 충족하는지 확인한다.
  - 조건 충족 시, 페이지네이션 HTML 구조를 생성하여 카드 그리드 컨테이너 하단에 추가한다.
  - 위 변경사항이 모두 적용된 완전한 `100x-main.html` 코드를 최종 결과물로 제출한다.

## 4\. 아카이브 페이지네이션 규칙 (Archive Pagination Rules)

#### **4.1. 활성화 조건 (Activation Condition)**

  - 'Report Archive' 섹션의 총 리포트 카드 수가 **10개를 초과**할 경우 페이지네이션을 활성화한다.

#### **4.2. 페이지당 항목 수 (Items Per Page)**

  - 한 페이지에는 최대 **10개**의 리포트 카드만 표시한다. (예: 11번째 리포트부터는 2페이지에 표시됨)

#### **4.3. HTML 구조 및 스타일링**

  - 리포트 카드들이 담긴 `div.grid` 컨테이너 바로 아래에 `<nav>` 요소를 사용하여 페이지네이션 컨트롤을 추가한다.
  - 컨트롤은 '이전', 페이지 번호, '다음' 버튼을 포함하며, Tailwind CSS를 사용하여 반응형으로 디자인한다.
  - **모바일 가독성:** 작은 화면(`sm:` 이하)에서는 페이지 번호가 길게 나열되지 않도록, 현재 페이지 주변의 번호(예: 2개)와 처음/마지막 페이지만을 표시하는 축약형 UI(예: `이전 ... 4 5 6 ... 다음`)를 적용한다. 버튼의 크기와 간격은 모바일 터치에 용이해야 한다.

**예시 HTML 구조:**

```html
</div>

<nav aria-label="Page navigation" class="flex justify-center mt-12">
    <ul class="inline-flex items-center -space-x-px">
        <li>
            <a href="#" class="px-3 py-2 ml-0 leading-tight text-slate-500 bg-white border border-slate-300 rounded-l-lg hover:bg-slate-100 hover:text-slate-700">이전</a>
        </li>
        <li>
            <a href="#" class="px-3 py-2 leading-tight text-slate-500 bg-white border border-slate-300 hover:bg-slate-100 hover:text-slate-700">1</a>
        </li>
        <li>
            <a href="#" aria-current="page" class="z-10 px-3 py-2 leading-tight text-blue-600 border border-blue-300 bg-blue-50 hover:bg-blue-100 hover:text-blue-700">2</a>
        </li>
        <li>
            <a href="#" class="px-3 py-2 leading-tight text-slate-500 bg-white border border-slate-300 rounded-r-lg hover:bg-slate-100 hover:text-slate-700">다음</a>
        </li>
    </ul>
</nav>
```

## 5\. 메타데이터 추출 규칙 (Metadata Extraction Rules)

신규 리포트 파일에서 아래 규칙에 따라 정보를 추출한다. (이 규칙은 변경되지 않음)

  - **날짜 (Date):** `<header>` 안의 `<p class="text-lg text-slate-500 ...">` 태그에서 "YYYY년 MM월 DD일 (요일)" 형식의 텍스트를 추출한다.
  - **제목 (Headline):** 리포트 본문의 첫 번째 `<h2>` 태그 내용(예: '요약 및 오늘의 논점'의 헤드라인)을 추출하여 `100x-main.html`의 카드 제목으로 사용한다.
  - **요약 (Summary):** 리포트 본문의 첫 번째 서술형 문단(보통 '요약' 섹션의 첫 문단)을 50\~100자 내외로 자연스럽게 요약한다.
  - **키워드 (Keywords):** 요약된 내용을 바탕으로 가장 핵심적인 주제(예: `JOLTS 서프라이즈`, `정책 불확실성`) 3\~4개를 추출하여 태그로 만든다.