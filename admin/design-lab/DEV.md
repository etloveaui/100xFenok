# Design Lab Developer Guide

> **목적**: 100xFenok의 시각적/구조적 실험을 위한 샌드박스 가이드
> **위치**: `source/100xFenok/admin/design-lab/`
> **SSOT**: `docs/planning/design-lab-master.md`

## 1. 기본 원칙

1.  **샌드박스 격리**: 모든 실험은 이 폴더 안에서 이루어집니다. `main`이나 `tools` 폴더를 직접 수정하지 않습니다.
2.  **버전 관리**: 시안은 `v1.html`, `v2.html` 등으로 버전을 명시하여 저장합니다.
3.  **승인 후 이식**: 사용자가 승인한 시안만 실제 운영 파일로 덮어씁니다.
4.  **의존성 주의**: 상위 폴더의 `global.css`나 `tailwind.config.js`를 참조할 때는 경로(`../../`)에 유의합니다.

## 2. 작업 프로세스

1.  **복제**: 수정하려는 원본 파일(예: `index.html`)을 `admin/design-lab/main/v1.html`로 복사합니다.
2.  **수정**: `v1.html`에서 레이아웃, 스타일, 색상을 자유롭게 변경합니다.
3.  **검증**: 브라우저에서 `v1.html`을 열어 디자인을 확인합니다.
4.  **승인**: 사용자가 "이거 좋다"고 하면, 그 내용을 원본 `index.html`에 반영합니다.

## 3. 폴더 구조

- `index.html`: Design Lab 대시보드 (작업 목록, 링크)
- `main/`: 메인 페이지(`source/100xFenok/index.html`) 실험실
- `widgets/`: 위젯들 실험실
- `components/`: 버튼, 헤더 등 공통 요소 실험실
- `screenshots/`: 벤치마킹하거나 현재 상태를 캡처한 이미지들

## 4. 스타일 가이드 (임시)

*   **Primary**: `#010079` (Navy Blue)
*   **Accent**: `#D5AD36` (Gold)
*   **Framework**: Tailwind CSS (CDN) + Custom CSS (`global.css`)

---

## 5. 확정 컴포넌트 (2025-12-27)

| 컴포넌트 | 버전 | 높이 | 특징 |
|----------|------|------|------|
| **Nav** | 1-Tier EDGY | 60px | Glassmorphism + Dropdown + Gold Accent |
| **Main** | v17.8 | Responsive | Hero Zone + Bento + Heatmap + 접근성 |
| **Footer** | v21 | 48px | Broadcast HUD Pro, 장 상태 실시간 동기화 |

**통합 데모**: `integrated-demo.html`

### Step 6: Production Integration Status (2026-01-11)

| Component | Status | BACKLOG | Files Modified |
|-----------|--------|---------|----------------|
| Nav 1-Tier EDGY | ✅ Applied | #159 | nav.html, nav.css, navScript.js, loadNav.js |
| Footer v21 | ✅ Applied | #159 | index.html (footer + admin + market status) |
| Main v17.8 | ⏸️ Hold | - | PNG quality issue blocking |

**Changes**: English menus, Insights added, admin ⚙️ explicit, password changed, US market status

---

## 6. Reports 리디자인 (Gemini 작업)

> **위치**: `reports/`
> **갤러리**: `reports/index.html`
> **목적**: Market Wrap, Alpha Scout 등 콘텐츠 중심 페이지 리디자인

### 시안 현황

| 버전 | 파일명 | 컨셉 | 상태 |
|------|--------|------|------|
| v1 | `v1-classic-premium.html` | 정통 경제지 (Navy & Gold) | 검토 대기 |
| v2 | `v2-modern-bold.html` | 트렌디 매거진 레이아웃 | 검토 대기 |
| v3 | `v3-minimal-elite.html` | 프라이빗 리포트 스타일 | 보류 |
| v3.1 | `v3-1-enhanced-elite.html` | Financial Times 스타일 | 강력 추천 |
| v4 | `v4-intelligent-briefing.html` | Bento Grid 대시보드형 | 실험적 |
| **v5** | `v5-unified-premium.html` | **v3.1 + 브랜드 통일 + Nav/Footer 통합** | ⭐ **NEW** |

### 디자인 방향

1. **v3.1 (Enhanced Elite)**: 고대비 타이포 + 명확한 섹션 구분 → 가독성/주목도 극대화
2. **v4 (Intelligent Briefing)**: 핀테크 앱 스타일 대시보드형 리포트

### 다음 단계

- [ ] 사용자 시안 검토 및 확정
- [ ] 확정 시안 → 실제 Market Wrap 페이지 적용
