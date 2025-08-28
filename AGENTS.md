# Repository Guidelines

## Project Structure & Module Organization
- Source code: `src/` (feature modules under `src/<feature>/`).
- Tests: `tests/` (unit tests mirror `src/` paths).
- Scripts and tooling: `scripts/` (one-task-per-script; keep idempotent).
- Static assets: `assets/` or `public/`.
- Configuration: root dotfiles (e.g., `.editorconfig`, linters) and environment in `.env.example`.

## Build, Test, and Development Commands
- Install: `npm ci` (Node) or `pip install -r requirements.txt` (Python). Prefer lockfiles.
- Build: `npm run build` or `make build` if a Makefile exists. Outputs to `dist/` or `build/`.
- Test: `npm test` or `pytest -q` for Python projects. Use `--max-workers=50%`/`-n auto` for parallel runs when configured.
- Dev server: `npm run dev` or `make dev` for local hot-reload.
- Lint/format: `npm run lint && npm run format` or `ruff check && ruff format` for Python.

## Coding Style & Naming Conventions
- Indentation: 2 spaces for JS/TS/JSON; 4 spaces for Python.
- Filenames: `kebab-case` for scripts/config, `PascalCase` for components/classes, `snake_case` for Python modules.
- Exports/APIs: prefer explicit named exports; avoid default unless conventional.
- Formatting: keep code formatter-driven (Prettier or Ruff/Black). Do not commit unformatted code.

## Testing Guidelines
- Frameworks: Jest/Vitest for JS/TS; Pytest for Python.
- Test names: mirror source path and name (e.g., `src/auth/login.ts` → `tests/auth/login.spec.ts`; `src/auth/login.py` → `tests/auth/test_login.py`).
- Coverage: aim ≥ 80% lines; include edge cases and error paths. Add tests for new behavior and bug fixes.
- Run locally before pushing; ensure tests are deterministic and isolated (no network by default).

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`). Keep messages imperative and scoped.
- PRs: one focused change per PR. Include a concise description, linked issue (e.g., `Closes #123`), screenshots for UI, and notes on testing/rollout.
- CI: ensure build, lint, and tests pass. Address review feedback with follow-up commits (avoid force-push unless requested).

## Security & Configuration Tips
- Secrets: never commit secrets. Use environment variables; update `.env.example` when adding new keys.
- Dependencies: prefer pinned versions; remove unused packages. Run audits (`npm audit` or `pip audit`) and address high severity issues.
- Input handling: validate at boundaries; avoid dynamic `eval` or shelling out without sanitization.

## 100x FenoK 프로젝트 노트 (중요)
- 시작 문서: `agent/START_HERE.md` (반드시 먼저 읽기)
- SPA 구조: `index.html` + `loadPage.js`가 `?path=` 파라미터로 콘텐츠를 `#content-frame`(iframe)에 로드합니다. `initBaseHref.js`가 로컬/프리뷰/운영에 따라 `window.baseHref`와 `<base href>`를 세팅합니다. 네비는 `nav.html`을 `loadNav.js`로 주입합니다.
- FED Monitor 파일:
  - 위젯: `tools/fed/fed-monitor-widget.html`
  - 상세: `tools/fed/fed-rates-detail.html`
  - 페이즈 계획: `tools/fed/phases/PHASE1.md`, `tools/fed/phases/PHASE2.md` (메타: `tools/fed/PHASES.md`)
  - 자료/노트: `tools/fed/notes/rrp-overview.md`, `tools/fed/archive/20250828_task.md`
- FRED API 사용 규칙:
  - 시리즈: IORB, DFF(EFFR), SOFR, RRPONTSYD, WDTGAL(TGA), WRBWFRBL(지급준비금) 등
  - 결측 처리: 최신 1년 관측에서 뒤에서부터 숫자 2개를 선택(“.” 스킵)
  - 스프레드(bp): `Δ×100` 정수 표기. 월말/월초 완충 라벨로 오탐 완화
- 로컬 CORS 프록시(개발): `node scripts/dev/fred-proxy.js` → `http://127.0.0.1:8787/fred/...`
  - 코드에서 로컬(hostname이 127.0.0.1/localhost)일 때 자동 프록시 사용
- 메뉴/문서 계획:
  - 상단 메뉴 “Insights”(기존 “분석” 대체) — Phase 3에 반영 예정
  - 문서 경로는 `posts/insights/...` 후보(최종 확정 단계에서 조정)
- 에이전트 워크로그: `agent/` 폴더에 `<agent>-WORKLOG-YYYYMMDD.md` 규칙으로 저장
- 공통 규칙: `agent/CONVENTIONS.md`
