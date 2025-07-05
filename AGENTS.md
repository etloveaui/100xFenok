# AGENTS.md – FenoK Static SPA System Guide

> 본 문서는 GitHub Pages 기반 정적 SPA인 `100xFenok` 프로젝트를 LLM 기반으로 안정적으로 유지보수하기 위한 **시스템 규칙서**입니다.  
> Codex, Gemini, GPT, Claude 등 모든 에이전트는 이 문서를 기반으로 행동해야 합니다.

---

## 🏗️ 프로젝트 구조 개요

- **형태**: Static SPA (Single Page Application)
- **호스팅**: GitHub Pages (`https://etloveaui.github.io/100xFenok/`)
- **프레임 구조**:
  - `index.html`: SPA 진입점, `#nav` + `iframe#content-frame`
  - `nav.html`: 모든 메뉴 정의, 동적 삽입됨
  - `main.html`, `/100x/*.html`, `/posts/*.html` 등은 모두 개별 콘텐츠 페이지

---

## 📌 핵심 규칙

### 1. 📁 경로 및 파일 규칙

| 항목              | 규칙 설명 |
|------------------|-----------|
| 모든 링크         | `data-path` 포함 필수<br>상대경로 통일 (`href="./..."`) |
| favicon 및 og:image | 절대경로 권장: `https://etloveaui.github.io/100xFenok/favicon-96x96.png` |
| preview/ 경로     | 루트 구조와 동기화 유지. 수정 시 preview에도 복사 필요 |
| base 경로 처리     | 모든 페이지는 `initBaseHref.js` 포함 → `window.baseHref` 사용 |

---

### 2. 🧭 Navigation 처리

모든 `.html` 페이지는 다음을 포함해야 함:

#### [head 내부]
    <script type="module" src="initBaseHref.js"></script>

#### [body 최상단]
    <div id="nav"></div>

#### [body 하단 스크립트]
    <script type="module">
      const { siteVersion } = await import(`${window.baseHref}version.js`);
      const { loadNav } = await import(`${window.baseHref}loadNav.js`);
      if (window.top === window.self) {
          await loadNav(siteVersion);
      }
    </script>

> ❗ nav.html 내용을 복붙하지 말고 반드시 `loadNav()`로 동적 로딩해야 함.

---

### 3. 🧪 버전 관리 및 캐시 무효화

- `version.js`의 `siteVersion` 값을 반드시 증가시켜 캐시 갱신
- 수정 시 `version.js` 누락 없이 함께 갱신할 것
- 새 기능, 새 링크 추가 시에도 동일 규칙 적용

---

### 4. 🧬 preview/ 사용 규칙

| 목적        | GitHub Pages 미반영 방지 및 실시간 디버깅 |
|-------------|-----------------------------------------|
| 포함 파일    | `index.html`, `main.html`, `nav.html`, `version.js`, `favicon.*` 등 |
| 경로 보정    | preview 내부 파일은 `../` 기반 상대경로 사용 |
| 에이전트 규칙 | 모든 변경 파일은 preview에도 동기화 (수동/자동 가능) |

---

## 🚫 금지 사항

- 잘못된 상대경로 (`../../`, `//`, `\`) 사용 금지
- nav.html 내용을 콘텐츠 페이지에 직접 삽입 금지
- `version.js` 캐시 무효화 누락 금지
- preview 디렉토리 동기화 누락 금지
- og:image, favicon 등을 `${window.baseHref}`로 처리 금지 → 크롤러 비호환

---

## 📘 작업 절차 요약 (Codex 전용)

1. `AGENTS.md` 읽고 구조 파악
2. 수정 대상 HTML에 `nav`/`loadNav()` 삽입 여부 확인
3. 수정 시 `version.js` 갱신 포함
4. preview 폴더에 동일 내용 복사
5. `node tests/run-tests.js` 수행하여 유효성 검증
6. 커밋 메시지: 변경 범위 + 캐시 갱신 여부 명시

---

## ✅ 예시 커밋 메시지

    feat: nav 구조 통일 및 preview 반영 / version +1
    
    - main.html에 loadNav 구조 삽입
    - nav.html 링크 경로 수정 (posts/index.html → 정확히 정비)
    - preview 디렉토리에 동일 파일 복사 완료
    - siteVersion 17 → 18 증가

---

이 문서는 LLM 및 모든 기여자에게 통합 기준을 제공합니다.  
위 규칙을 위반하면 구조 무결성이 손상될 수 있으며, 해당 커밋은 리뷰 거부 대상이 됩니다.
