# Macro Monitor - DEV.md

> 기능별 개발 메모. CLAUDE.md에서 이 기능 작업 시 참조.
> **설계 철학**: `docs/planning/macro-monitor-philosophy.md` 필독

## Purpose

유동성 및 펀더멘털 지표를 **조합**하여 **의미 있는 신호**로 시각화하는 위젯 시스템.

### 핵심 철학
- ❌ 어디서나 볼 수 있는 지표 단순 나열 (VIX 숫자만, M2 차트만)
- ✅ 개별 지표들을 조합 → 해석 가능한 신호로 변환

---

## 3-Layer 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Foundation (펀더멘털)                          │
│  "기초 체력은 괜찮나?"                                    │
│  예대율, 연체율, Tier1, ROE, 생산성, Fear&Greed, VIX      │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Fuel (유동성 흐름) ← 다음 개발                  │
│  "돈이 풀리고 있나? 어디서? 얼마나 빠르게?"                 │
│  M2 증가율, TGA 방출, RRP 소진, 정책 스탠스               │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Shield (위기 감지) ✅ 완료                      │
│  "지금 터지나?"                                          │
│  SOFR-IORB 스프레드 → Liquidity Stress                  │
└─────────────────────────────────────────────────────────┘
```

### Layer별 역할

| Layer | 이름 | 질문 | 시간 프레임 | 상태 |
|-------|------|------|------------|------|
| 1 | Shield (방패) | 지금 터지나? | 실시간~일간 | ✅ 완료 |
| 2 | Fuel (연료) | 돈이 풀리고 있나? | 주간~월간 | 🔄 설계 중 |
| 3 | Foundation (기초) | 펀더멘털 괜찮나? | 월간~분기 | 📋 계획 |

---

## Folder Structure

```
tools/macro-monitor/
├── DEV.md                    ← 이 파일
├── widgets/                  ← 카드형 위젯 (main.html iframe용)
│   ├── sofr-iorb.html        ← SOFR-IORB 스프레드
│   ├── treasury.html         ← [Phase 3] 10Y-2Y Treasury
│   ├── vix.html              ← [Phase 3] VIX
│   └── ...
├── details/                  ← 상세 페이지 (클릭 시 이동)
│   ├── sofr-iorb.html        ← SOFR-IORB 상세
│   ├── treasury.html         ← [Phase 3] Treasury 상세
│   └── ...
└── shared/                   ← [Phase 3+] 공통 모듈
    ├── chart-config.js       ← Chart.js 공통 설정
    ├── api-fetch.js          ← CORS 프록시/API 호출
    └── styles.css            ← 공통 스타일
```

### 새 지표 추가 시
1. `widgets/[지표명].html` 생성
2. `details/[지표명].html` 생성
3. `main.html`에 iframe 추가
4. 지표 3개 이상 시 `shared/` 공통 모듈화 검토

---

## Current Implementation

### Widget (widgets/sofr-iorb.html)
- **디자인**: 카드형 (1/3 그리드)
- **데이터**: FRED API (SOFR, IORB)
- **CORS 우회**: Cloudflare Worker → isomorphic-git → allorigins
- **차트**: Chart.js 미니 차트 (no axes, fill, tension: 0)
- **상태**: 스프레드에 따라 정상/주의/경계/위험
- **클릭**: details/sofr-iorb.html로 이동

### Detail (details/sofr-iorb4.html) ⭐ 최신 완성본
- **디자인**: 밝은 테마 풀 페이지, 반응형 하이브리드
- **반응형 레이아웃**:
  - PC (≥900px): 듀얼 축 차트
  - 태블릿 (600-899px): 탭 전환 + 버튼 기간
  - 모바일 (<600px): 탭 전환 + 스와이프 기간
- **차트 개선**:
  - Gradient Fill, Glow Effect, Enhanced Tooltip
  - Threshold Backgrounds, Point Hover
- **기간 옵션**: 1M/3M/6M/1Y/3Y/MAX (기본: 1Y)
- **임계선**: 좌측 배치, 반투명 배경
- **Info Grid**: 지표 설명 카드 (내용 정리 예정)

---

## File References

| 파일 | 경로 |
|------|------|
| main.html iframe | `./tools/macro-monitor/widgets/sofr-iorb.html` |
| widget → detail | `tools/macro-monitor/details/sofr-iorb.html` |

---

## Data Flow

```
FRED API
    ↓ (CORS 차단)
Cloudflare Worker (1차 프록시)
    ↓ (실패 시)
isomorphic-git proxy (2차)
    ↓ (실패 시)
allorigins (3차)
    ↓
Chart.js 렌더링
```

---

## Technical Decisions

| 결정 | 이유 |
|------|------|
| Chart.js | 가볍고 빠름, 복잡한 시각화 불필요 |
| tension: 0 | 직선 스타일로 데이터 변화 명확히 표시 |
| widgets/details 분리 | 확장성: 지표 추가 시 패턴 명확 |
| 밝은 테마 | 사이트 전체 톤과 통일 |
| shared/ 지연 생성 | 지표 3개 이상 시 공통화 (YAGNI) |

---

## Phase Checklist

### Phase 1: Widget Card UI ✅
- [x] 위젯 카드형 재설계 (1/3 크기)
- [x] 직선 그래프 스타일 (tension: 0)
- [x] 상태 표시 (정상/주의/경계/위험)
- [x] iframe 높이 (280px)
- [x] 폴더 구조 정리 (widgets/, details/)
- [x] detail 밝은 테마 적용

### Phase 2: Graph Enhancement ✅ (2025-11-29)
- [x] Chart.js 설정 최적화 (5가지 개선)
- [x] 기간별 데이터 표시 (1M/3M/6M/1Y/3Y/MAX)
- [x] 스프레드 시각화 개선 (Gradient, Glow, Tooltip)
- [x] 반응형 하이브리드 레이아웃
- [x] 임계선 라벨 좌측 + 반투명
- [x] 하단 설명 카드 3개 (현재 상태/지표 설명/중요성)

### Phase 2.5: Widget System Architecture ✅ (2025-11-29)
- [x] 공통 캐싱/API 레이어 설계
- [x] 확장 가능한 위젯 구조 (10~30개 대응)
- [x] 매크로 모니터 메인 페이지 구조
- [x] 위젯-디테일 데이터 공유 패턴
- [x] **설계 문서**: `CookBook/docs/ARCHITECTURE.md`

### Phase 2.6: Command Center ✅ (2025-11-29)
- [x] `index.html` Command Center 대시보드 생성
- [x] Bento Box 레이아웃 (PC 3열, 태블릿 2열, 모바일 1열)
- [x] 카테고리 탭 필터링 (All/Liquidity/Rates/Sentiment)
- [x] 6개 위젯 카드 (1 라이브 + 5 Coming Soon)
- [x] `nav.html` 메뉴 연결

### Phase 2.7: Main Page Compact Hero Banner ✅ (2025-11-29)
- [x] Coming Soon 카드 2개 제거
- [x] Liquidity Stress 위젯 1개 중앙 정렬
- [x] max-width: 600px (모바일/태블릿), 500px (PC)
- [x] CTA 버튼: "More Macro Indicators (+5 Coming Soon)"

### Phase 3: Layer 2 - Liquidity Flow Monitor 🔄 진행 중
> **컨셉**: 여러 유동성 채널의 흐름/방향성/속도를 종합

#### 유동성 채널 분석
| 채널 | 지표 | FRED 코드 | 관찰 포인트 | 현재 상태 |
|------|------|-----------|-------------|----------|
| 신용 창출 | M2 증가율 (YoY) | M2SL | 속도 상승? | ✅ 바닥 찍고 상승 |
| 정부 지출 | TGA 잔고 변화 | WTREGEN | 줄어드는가? | ✅ 방출 시작 |
| 유동성 흡수 | RRP 잔고 | RRPONTSYD | 줄어드는가? | ⚠️ 거의 소진 |
| 은행 유동성 | 지급준비금 | WRESBAL | 늘어나는가? | 관찰 필요 |
| 정책 스탠스 | QT/금리 | - | 전환됐는가? | 🔄 전환 중 |

#### 핵심 인사이트
1. **RRP 소진**: 2조 → 2천억, 더 이상 공급원 아님
2. **M2가 메인 드라이버**: 금리 인하 시 가속화 예상
3. **TGA 방출**: 단기 유동성 공급 채널
4. **스테이블코인**: 신규 구조적 채널 (2000억→2조 목표)

#### 위젯 컨셉
```
┌─────────────────────────────────────────┐
│  💧 Liquidity Flow Monitor              │
├─────────────────────────────────────────┤
│  [M2 Growth]     ████████░░  +4.2% ↑   │
│  [TGA]           ████░░░░░░  $720B ↓   │
│  [RRP]           █░░░░░░░░░  $200B     │
│  [Policy]        🟢 QT 종료 예상         │
├─────────────────────────────────────────┤
│  종합: 🟢 유동성 확장 국면               │
└─────────────────────────────────────────┘
```

#### 체크리스트
- [x] 3-0: 설계 철학 및 아키텍처 정의
- [ ] 3-1: 상세 설계 (데이터 주기, 조합 방식)
- [ ] 3-2: 위젯 구현
- [ ] 3-3: 상세 페이지 구현

### Phase 4: Layer 3 - Foundation (펀더멘털)

#### 4-A: Banking Health (금융 건전성)
| 지표 | 의미 | 현재 | 위기 시 |
|------|------|------|--------|
| 예대율 (LDR) | 대출 여력 | 71% | 87%+ |
| 여신 증가율 | 경기 모멘텀 | 5.1% ↑ | 마이너스 |
| Tier 1 자본비율 | 은행 건전성 | 14.17% 역대 최고 | 10% 미만 |
| 연체율 | 여신 건전성 | 1.47% | 5%+ |

#### 4-B: Corporate Health (기업 건전성)
| 지표 | 의미 | 현재 |
|------|------|------|
| 순이익 마진율 | 수익성 | 13.1% 역대 최고 |
| ROE | 자본이익률 | S&P 20%+, M7 44% |
| 생산성 | AI 사이클 검증 | 급상승 (인터넷의 3배) |

#### 4-C: Market Sentiment (시장 심리)
| 지표 | 의미 | 관찰 포인트 |
|------|------|-------------|
| Fear & Greed | 과열 여부 | Extreme Fear = 버블 아님 |
| VIX | 변동성 | 27+ 급등 후 급락 = 단기 변동 |

### Phase 5: Infrastructure
- [ ] Google Sheets 구조 설계
- [ ] Apps Script 배포
- [ ] CORS 우회 지표 연동

---

## Known Issues

- [ ] 로컬 환경 CORS 문제 (배포 후 정상)
- [ ] 로딩 속도 개선 (캐싱 미구현)
- [ ] Google Sheets 인프라 미구축

---

## Future Work (논의 필요)

### 위젯 크기 축소
- **문제**: main.html 위젯 카드 1개가 너무 큼
- **방안 A**: 카드 표시 방식 원천 변경
- **방안 B**: 카드 하나에 여러 인디케이터 표시
- **시점**: Phase 3 진행 중 적절한 시기에 논의

---

## Change Log

| Date | Change |
|------|--------|
| 2025-11-30 | **방향성 재정립**: 3-Layer 아키텍처, 설계 철학 정의, Phase 3 재구성 |
| 2025-11-29 | **main.html Compact Hero Banner** (1위젯 + CTA) |
| 2025-11-29 | **Command Center** index.html 대시보드 생성 |
| 2025-11-29 | **위젯 시스템 아키텍처 설계** (docs/ARCHITECTURE.md) |
| 2025-11-29 | 설명 카드 PC 특화 (기본 펼침/버튼 숨김/글씨 +2px) |
| 2025-11-29 | 하단 설명 카드 3개 구현 (동적 상태/FRED 링크/인라인 확장) |
| 2025-11-29 | 반응형 하이브리드 레이아웃 (PC/태블릿/모바일) |
| 2025-11-29 | 차트 개선 5가지 (Gradient, Glow, Tooltip, Background, Hover) |
| 2025-11-29 | 기간 옵션 확장 (1Y 기본, 3Y/MAX 추가) |
| 2025-11-29 | 임계선 라벨 좌측 + 반투명 |
| 2025-11-28 | 폴더 구조 정리 (widgets/, details/), fed/ 삭제 |
| 2025-11-28 | detail 밝은 테마 적용 |
| 2025-11-27 | 위젯 카드형 재설계, 문서 정리 |
| 2025-11-26 | fed → macro-monitor 폴더 이름 변경 |
| 2025-11-25 | 위젯/상세 페이지 기본 구현 |
