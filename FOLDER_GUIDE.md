# FOLDER\_GUIDE.md – 100xFenok 프로젝트 폴더 구조 가이드

본 문서는 **100xFenok** 시스템의 폴더 구조와 각 디렉토리의 역할을 문서화한 가이드입니다. 현재 공개 정본은 `100xfenok-next/`의 Next/OpenNext 앱이며, 과거 GitHub Pages iframe SPA 루트는 퇴역했습니다.

---

## 📁 루트 디렉토리 (`/`)

| 항목                              | 설명                                                      |
| ------------------------------- | ------------------------------------------------------- |
| `100xfenok-next/`               | 현재 공개 정본 Next/OpenNext 앱, Cloudflare Worker 배포 설정 |
| `initBaseHref.js`               | 보존 HTML 페이지의 상대경로 보정용 공용 헬퍼. 루트 SPA shell은 아님 |
| `README.md`                     | 프로젝트 개요, 실행 방법, agent 기준 안내 포함                          |
| `llm-guide.html`                | 현재 라우트/운영 사실을 담은 LLM용 공개 사이트 가이드                    |
| `robots.txt`                    | 크롤러 접근 정책의 소스 파일. Next public mirror와 함께 관리             |
| `100x-fenok-logo.png`           | 보존 HTML/Next public mirror가 공유하는 브랜드 이미지                    |
| `favicon.*`                     | 남은 정적/SEO용 자산 파일 모음                                      |
| `tests/run-tests.js`            | 보존 콘텐츠 폴더 정합성 검증용 Node 기반 테스트 스크립트                  |

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

보류/중단된 기능을 보관하는 폴더. 향후 재사용 가능성이 있는 항목만 보존.

| 항목           | 상태 | 설명                                              |
| ------------ | ---- | ------------------------------------------------- |
| *(none)* | 정리됨 | Legacy notification 잔여 파일은 canonical Worker 전환 후 삭제됨 |

---

## 📁 /tests/

* `run-tests.js`: HTML 유효성 검사 (nav, meta, 링크 등)
* LLM 작업 이후 검증 필수

---

## 📌 폴더 구조 운영 원칙 요약

1. 새 공개 shell, navigation, routing은 `100xfenok-next/`에서 구현한다.
2. `_agent-prompts/` 폴더는 폴더별 기능 단위로만 존재해야 함
3. 보존 HTML 폴더는 Next sync-static 입력으로 다루며, 루트 iframe SPA를 재생성하지 않는다.
4. `_legacy/` 폴더에는 중단된 기능만 보관 (README.md로 상태 명시)
5. favicon/og\:image는 현재 Next public 자산 기준으로 관리한다.

---

*Last Updated: 2026-07-07*
