# FOLDER\_GUIDE.md – 100xFenok 프로젝트 폴더 구조 가이드

본 문서는 GitHub Pages 기반 정적 SPA인 **100xFenok** 시스템의 폴더 구조와 각 디렉토리의 역할을 문서화한 가이드입니다. Codex 및 기타 AI 에이전트가 작업을 수행할 때 이 문서를 반드시 참고해야 하며, 사람이 구조를 이해하고 유지보수할 때도 이 문서를 기준으로 정리해야 합니다.

---

## 📁 루트 디렉토리 (`/`)

| 항목                              | 설명                                                      |
| ------------------------------- | ------------------------------------------------------- |
| `index.html`                    | SPA 진입점 – `iframe#content-frame`으로 전체 구조 형성 |
| `main.html`                     | 홈 콘텐츠 – What's New 카드/버튼 등 표시                           |
| `loadPage.js`, `loadNav.js`     | SPA 방식 페이지 전환 및 동적 nav 삽입 스크립트                          |
| `initBaseHref.js`               | GitHub Pages/preview/로컬 경로를 자동 판단하여 `<base href>` 설정    |
| `version.js`                    | `siteVersion` 값을 통해 캐시 무효화를 제어함                         |
| `AGENTS.md`                     | 전체 시스템 유지보수용 Codex 작업 기준 규칙 문서                          |
| `README.md`                     | 프로젝트 개요, 실행 방법, agent 기준 안내 포함                          |
| `favicon.*`, `site.webmanifest` | PWA 및 SEO용 자산 파일 모음 (SVG, ICO, PNG 등)                   |
| `404.html`                      | GitHub Pages용 커스텀 404 처리                                |
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
| `multichart.html` | 기술 지표 멀티 차트 도구 (단일 파일)  |
| `index.html`      | 도구 목록 페이지 (향후 자동 생성 가능) |

---

## 📁 /preview/

* 루트 구조 전체를 복제한 디버깅용 디렉토리
* 상대 경로만 다르고 파일 구조는 루트와 1:1로 일치해야 함
* 모든 수정 사항은 preview/에도 동기화 필요

---

## 📁 /tests/

* `run-tests.js`: HTML 유효성 검사 (nav, meta, 링크 등)
* LLM 작업 이후 검증 필수

---

## 📌 폴더 구조 운영 원칙 요약

1. 모든 index.html은 반드시 `<div id="nav"></div>` 및 `initBaseHref.js` 포함
2. `_agent-prompts/` 폴더는 폴더별 기능 단위로만 존재해야 함
3. `version.js`는 HTML/JS/CSS 수정 시 반드시 갱신
4. preview 디렉토리는 항상 루트와 경로만 다르게 복사되어야 함
5. favicon/og\:image는 모든 페이지에서 동일한 root 상대경로로 표시돼야 함
