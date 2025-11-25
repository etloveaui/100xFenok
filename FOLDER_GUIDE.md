# FOLDER\_GUIDE.md – 100xFenok 프로젝트 폴더 구조 가이드

본 문서는 GitHub Pages 기반 정적 SPA인 **100xFenok** 시스템의 폴더 구조와 각 디렉토리의 역할을 문서화한 가이드입니다. Codex 및 기타 AI 에이전트가 작업을 수행할 때 이 문서를 반드시 참고해야 하며, 사람이 구조를 이해하고 유지보수할 때도 이 문서를 기준으로 정리해야 합니다.

---

## 📁 루트 디렉토리 (`/`)

| 항목                              | 설명                                                      |
| ------------------------------- | ------------------------------------------------------- |
| `index.html`                    | SPA 진입점 – `iframe#content-frame`으로 전체 구조 형성 |
| `main.html`                     | 홈 콘텐츠 – What's New 카드/버튼 등 표시                           |
| `loadPage.js`, `loadNav.js`     | SPA 페이지 로딩 로직, nav은 index/404에서만 사용 |
| `initBaseHref.js`               | GitHub Pages/preview/로컬 경로를 자동 판단하여 `<base href>` 설정    |
| `version.js`                    | `siteVersion` 값을 통해 캐시 무효화를 제어함                         |
| `AGENTS.md`                     | 전체 시스템 유지보수용 Codex 작업 기준 규칙 문서                          |
| `README.md`                     | 프로젝트 개요, 실행 방법, agent 기준 안내 포함                          |
| `favicon.*`, `site.webmanifest` | PWA 및 SEO용 자산 파일 모음 (SVG, ICO, PNG 등)                   |
| `404.html`                      | 모든 잘못된 URL을 `index.html?path=` 로 돌려보내는 리다이렉터 |
| `tests/run-tests.js`            | HTML 구조 정합성 검증용 Node 기반 테스트 스크립트                        |

---

## 📁 /100x/

| 항목                              | 설명                                                |
| ------------------------------- | ------------------------------------------------- |
| `index.html`                    | Daily Wrap 리포트들의 목차 페이지                           |
| `100x-daily-wrap-template.html` | 리포트 자동 생성을 위한 HTML 템플릿                            |
| `*_100x-daily-wrap.html`        | 날짜별 리포트 파일 (예: `2025-07-02_100x-daily-wrap.html`) |
| `_agent-prompts/`               | index.html 업데이트용 agent 문서 + 실행 프롬프트 보관            |
| `daily-wrap/`                   | 리포트 본문 HTML 및 해당 기능 전용 agent 디렉토리 포함              |

### 📁 /100x/daily-wrap/\_agent-prompts/

* `100x-wrap-agent.md`: JSON → 리포트 자동 생성 규칙
* `wrap-generate-prompt.txt`: 위 agent 실행용 Codex 프롬프트

---

## 📁 /100x Briefing/

| 항목           | 설명                         |
| ------------ | -------------------------- |
| `Briefing/`  | Strategic Briefing 리포트 폴더 |

---

## 📁 /alpha-scout/

| 항목                 | 설명                                    |
| ------------------ | ------------------------------------- |
| `alpha-scout-main.html` | Alpha Scout 메인 페이지                |
| `_agent-prompts/`  | 에이전트 프롬프트                         |
| `data/`            | 리포트 인덱스 및 요약 메타데이터              |
| `reports/`         | 개별 리포트 HTML 및 상세 데이터             |

---

## 📁 /posts/

| 항목           | 설명                         |
| ------------ | -------------------------- |
| `index.html` | 분석글 TOC 페이지                |
| `*.html`     | 개별 분석글: 투자 해설, macro 시리즈 등 |

---

## 📁 /ib/

| 항목                               | 설명                           |
| -------------------------------- | ---------------------------- |
| `ib-total-guide-calculator.html` | Infinite Buying 전략 계산기 단일 파일 |
| `index.html` *(선택)*              | 향후 존재 시 TOC 가능성 고려           |

---

## 📁 /vr/

| 항목                               | 설명                             |
| -------------------------------- | ------------------------------ |
| `vr-total-guide-calculator.html` | Value Rebalancing 전략 계산기 단일 파일 |
| `vr-complete-system.html`        | 전략 설계 문서                       |
| `index.html`                     | 전체 VR 시스템 목차                   |

---

## 📁 /tools/

| 항목                | 설명                      |
| ----------------- | ----------------------- |
| `fed/`            | Fed Monitor 위젯 및 상세 페이지 |
| `asset/`          | Multichart 도구           |
| `stock_analyzer/` | Stock Analyzer 도구       |
| `index.html`      | 도구 목록 페이지               |

---

## 📁 /_legacy/

보류/중단된 기능을 보관하는 폴더. 향후 재사용 가능성이 있어 삭제하지 않고 보존.

| 항목           | 상태 | 설명                                              |
| ------------ | ---- | ------------------------------------------------- |
| `onesignal/` | 중단 | 정적 페이지에서 푸시 알림 불가. 서버 이전 시 재사용 예정 |

---

## 📁 /_verification_screenshots/

UI 검증용 스크린샷 보관 폴더. 반응형 테스트(Mobile/Tablet/Desktop) 결과 저장.

---

## 📁 /tests/

* `run-tests.js`: HTML 유효성 검사 (nav, meta, 링크 등)
* LLM 작업 이후 검증 필수

---

## 📌 폴더 구조 운영 원칙 요약

1. 모든 콘텐츠 페이지는 `<script type="module" src="../initBaseHref.js"></script>`를 포함하고 `<body>` 시작부에 `<div id="nav"></div>`를 배치한다 (nav와 footer는 index.html/404.html에만 존재)
2. `_agent-prompts/` 폴더는 폴더별 기능 단위로만 존재해야 함
3. `version.js`는 HTML/JS/CSS 수정 시 반드시 갱신
4. `_legacy/` 폴더에는 중단된 기능만 보관 (README.md로 상태 명시)
5. favicon/og\:image는 모든 페이지에서 동일한 root 상대경로로 표시돼야 함

---

*Last Updated: 2025-11-25*
