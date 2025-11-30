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
│  Layer 2: Fuel (유동성 흐름) ✅ 완료                      │
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
| 2 | Fuel (연료) | 돈이 풀리고 있나? | 주간~월간 | ✅ 완료 |
| 3 | Foundation (기초) | 펀더멘털 괜찮나? | 월간~분기 | 📋 계획 |

---

## Folder Structure

```
tools/macro-monitor/
├── DEV.md                    ← 이 파일
├── index.html                ← Command Center 대시보드
├── widgets/                  ← 카드형 위젯 (Command Center/main.html iframe용)
│   ├── liquidity-stress.html ← ⚡ Layer 1: 위기 감지 (SOFR-IORB)
│   ├── liquidity-flow.html   ← 💧 Layer 2: 유동성 흐름 (M2/TGA/RRP)
│   └── sofr-iorb.html        ← (백업)
├── details/                  ← 상세 페이지 (클릭 시 이동)
│   ├── liquidity-stress.html ← Layer 1 상세
│   ├── liquidity-flow.html   ← Layer 2 상세
│   └── ...
└── shared/                   ← 공통 모듈 (현재 인라인됨)
    ├── data-manager.js       ← 캐시 엔진 (현재 각 파일에 인라인)
    └── constants.js          ← 상수 정의
```

### 새 지표 추가 시
1. `details/[지표명].html` 생성 (API 호출 + 캐시 저장)
2. `widgets/[지표명].html` 생성 (캐시 읽기 전용)
3. `index.html` Command Center에 iframe 추가
4. 지표 3개 이상 시 `shared/` 공통 모듈화 검토

---

## Current Implementation

### Layer 1: Liquidity Stress ⚡
**Widget** (`widgets/liquidity-stress.html`)
- 신호등 스타일 (종합 상태 + Tier 1/2 카드)
- 캐시 기반 (Detail에서 저장한 localStorage 읽기)
- 클릭 → Detail 페이지 이동

**Detail** (`details/liquidity-stress.html`)
- SOFR-IORB 스프레드 분석
- 반응형 하이브리드 레이아웃
- 기간 옵션: 1M/3M/6M/1Y/3Y/MAX

### Layer 2: Liquidity Flow 💧
**Widget** (`widgets/liquidity-flow.html`)
- Net Flow Hero + 2x2 Indicator Grid
- 4개 지표 신호등 (M2, TGA, RRP, Stablecoin)
- 캐시 기반 + 백그라운드 Detail 로드

**Detail** (`details/liquidity-flow.html`)
- 5개 신호 매트릭스 (M2, TGA, RRP, Crypto, Policy Stance)
- 4탭 차트 (Net Flow / Credit Flow / Policy Flow / Details)
- API: FRED (M2SL, WTREGEN, RRPONTSYD) + DefiLlama

---

## Widget 표준화 가이드

### 레이아웃 규칙
| 항목 | 규격 |
|------|------|
| 최소 높이 | 280px |
| 패딩 | 16px |
| 헤더 | 아이콘 + 타이틀 + 상태 배지 |
| 폰트 | Orbitron (타이틀), Inter (본문) |

### 아이콘 규칙
- Layer 1 (Stress): ⚡
- Layer 2 (Flow): 💧
- Layer 3 (Foundation): 📊 (예정)

### 캐시 연동 패턴
```javascript
// Widget: 캐시 읽기만
const data = DataManager.getWidgetData('widget-id');
if (!data) await loadDetailInBackground();

// Detail: API 호출 + 캐시 저장
DataManager.saveWidgetData('widget-id', processedData);
```

### 상태 신호등
| 상태 | 이모지 | 색상 |
|------|--------|------|
| Positive/Normal | 🟢 | #16a34a |
| Neutral/Caution | 🟡 | #ca8a04 |
| Negative/Warning | 🟠 | #ea580c |
| Critical/Danger | 🔴 | #dc2626 |

---

## Data Flow

```
Detail 페이지 로드
    ↓
FRED API / DefiLlama API
    ↓ (CORS 우회: Cloudflare Worker / allorigins)
데이터 처리 + 차트 렌더링
    ↓
DataManager.saveWidgetData() → localStorage
    ↓
Widget 로드 시 → DataManager.getWidgetData() 읽기
    ↓
캐시 없으면? → hidden iframe으로 Detail 백그라운드 로드
```

---

## 🔧 위젯 개발 표준 가이드

> **새 위젯 개발 시 반드시 이 섹션을 참고**

### 인프라 현황

| 항목 | 값 | 비고 |
|------|-----|------|
| Cloudflare Worker | `https://fed-proxy.etloveaui.workers.dev/` | 프로덕션 CORS 프록시 |
| 로컬 개발 프록시 | `node scripts/dev/fred-proxy.js` | 포트 8787 |
| Fallback | `https://cors.isomorphic-git.org/` | 신뢰도 낮음, 마지막 수단 |
| FRED API Key | `6dda7dc3956a2c1d6ac939133de115f1` | 공개 키 |
| 캐시 TTL | 30분 | localStorage 기반 |

### Widget-Detail 데이터 흐름

```
┌─────────────────────────────────────────────────────┐
│ Detail 페이지 (API 호출 담당)                        │
│ 1. FRED API 호출 (3단계 Fallback)                   │
│ 2. 데이터 계산 (스프레드, 비율 등)                   │
│ 3. DataManager.saveWidgetData() 호출               │
│ 4. localStorage에 저장 (TTL: 30분)                  │
└──────────────────────┬──────────────────────────────┘
                       ↓
       ┌─────────────────────────────┐
       │ localStorage (캐시)          │
       │ Key: macro_[widget-id]       │
       │ TTL: 30분                    │
       └─────────────────────────────┘
                       ↑
┌──────────────────────┴──────────────────────────────┐
│ Widget (API 호출 금지!)                              │
│ 1. DataManager.getWidgetData() 호출                 │
│ 2. 캐시 있으면 → 즉시 렌더링                         │
│ 3. 캐시 없으면 → hidden iframe으로 Detail 로드       │
└─────────────────────────────────────────────────────┘
```

### 스타일 일관성 규칙

| 요소 | 표준 | 예시 |
|------|------|------|
| **헤더** | `card-header` + `card-title` | liquidity-stress.html 참고 |
| **타이틀 폰트** | Orbitron, 13px, 700 | 모든 위젯 동일 |
| **타이틀 이모지** | 없음 (텍스트만) | `LIQUIDITY STRESS` |
| **신호등** | 4가지 상태 | 🟢🟡🟠🔴 |
| **배경** | 그래디언트 | `#f8fafc → #f1f5f9` |
| **최소 높이** | 260px (위젯), 280px (iframe) | |
| **hover 효과** | translateY(-4px) + shadow | |

### ⚠️ 절대 하지 말 것

1. **Widget에서 API 직접 호출 금지** - localStorage만 읽기
2. **의미 없는 데모 데이터 금지** - API 미연결 시 "데이터 없음" 또는 "Loading" 표시
3. **스타일 임의 변경 금지** - 기존 liquidity-stress.html 패턴 따르기
4. **타이틀에 아이콘 추가 금지** - 기존 위젯과 일관성 유지

### 새 위젯 추가 체크리스트

**Step 1: Detail 페이지** (`details/[name].html`)
- [ ] FRED API 호출 로직 (3단계 Fallback 포함)
- [ ] 계산 로직 (지표별 공식)
- [ ] DataManager.saveWidgetData() 호출
- [ ] 상세 UI (그래프, 설명, 기간 선택기)

**Step 2: Widget 카드** (`widgets/[name].html`)
- [ ] API 호출 없음 (localStorage만 읽기)
- [ ] `card-header` + `card-title` 구조
- [ ] 신호등 상태 표시
- [ ] 타이틀 이모지 없음 (텍스트만)
- [ ] 260px 이상 높이

**Step 3: 페이지 등록**
- [ ] `index.html` (Command Center)에 카드 추가
- [ ] `main.html`에 iframe 추가 (필요 시)

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

### Phase 3: Layer 2 - Liquidity Flow Monitor ✅ 완료 (2025-12-01)
> **컨셉**: 여러 유동성 채널의 흐름/방향성/속도를 종합

#### API 검증 완료 (2025-11-30)
| 지표 | API | 코드/엔드포인트 | 최신 데이터 | 상태 |
|------|-----|----------------|------------|------|
| M2 통화량 | FRED | `M2SL` | $22,298B (2025-10) | ✅ |
| TGA 잔고 | FRED | `WTREGEN` | $903B (2025-11-26) | ✅ |
| RRP 잔고 | FRED | `RRPONTSYD` | $7.5B (2025-11-28) | ✅ |
| 스테이블코인 | DefiLlama | `stablecoins.llama.fi` | ~$200B | ✅ |

#### 핵심 인사이트 (현재 데이터 기준)
1. **RRP 거의 소진**: $7.5B → 더 이상 유동성 공급원 아님
2. **M2 증가 추세**: $22,298B (월간 데이터)
3. **TGA 감소 중**: $903B → 유동성 방출 중
4. **Stablecoin/M2**: ~$200B / $22,298B ≈ 0.9%

#### 4개 지표 확정 (Policy 제거)
| 지표 | 표시 형식 | 계산 방식 |
|------|----------|----------|
| M2 Growth | +X.X% YoY | 현재 vs 12개월 전 |
| TGA Balance | $XXXB | 절대값 + 변화 방향 |
| RRP Balance | $XXXB | 절대값 + 변화 방향 |
| Stablecoin/M2 | X.X% | 스테이블코인 총량 / M2 |

#### Detail 설계 확정 (2025-11-30) ✅

**패턴**: Signal-First Hybrid (Option 2+3 결합)
**구조**: 신호등 매트릭스 + 4탭 차트 시스템

```
┌─────────────────────────────────────────────────────────┐
│  🚦 Liquidity Flow Status                               │
│  Net Flow: +$850B/mo  🟢 Strong Inflow                 │
│  Policy Stance: 🟢 Accommodative                        │
│  Crypto Rotation: 🟡 Moderate (15% of new M2)          │ ← 신규!
├─────────────────────────────────────────────────────────┤
│  📊 Signal Matrix (4개 지표 신호등)                      │
├─────────────────────────────────────────────────────────┤
│  📈 [Net Flow] [Credit Flow] [Policy Flow] [Details]   │
│  → 탭별 차트 전환                                        │
├─────────────────────────────────────────────────────────┤
│  💡 Insight Cards (3개)                                 │
└─────────────────────────────────────────────────────────┘
```

**탭별 차트 구성**:
| 탭 | 목적 | 차트 |
|-----|------|------|
| Net Flow (기본) | 결론 먼저 | 순유동성 막대 (양/음) + 4주 MA |
| Credit Flow | M2+Stablecoin | M2 YoY% 선 + SC YoY% 점선 + SC/M2 면적 배경 |
| Policy Flow | TGA+RRP | TGA/RRP 선 + Combined Delta 막대 |
| Details | 개별 확인 | 2x2 그리드 (4개 지표) |

**핵심 계산식**:
```javascript
Net_Flow = M2_delta_weekly + TGA_delta + RRP_delta
Crypto_Rotation = (Stablecoin_delta / M2_delta) * 100
```

**데이터 주기**: 모두 Weekly로 통일
- M2: Monthly → Weekly (forward-fill)
- TGA: Weekly (그대로)
- RRP: Daily → Weekly (평균)
- Stablecoin: Real-time → Weekly (마지막 값)

#### 체크리스트
- [x] 3-0: 설계 철학 및 아키텍처 정의
- [x] 3-1: API 검증 완료
- [x] 3-2: Detail 페이지 레이아웃/차트 설계 ✅ 완료
- [x] 3-3: Detail 페이지 구현 (Phase A/B/C) ✅ 완료 (2025-12-01)
  - [x] Phase A: Signal Matrix + Net Flow
  - [x] Phase B: Credit Flow 차트
  - [x] Phase C: Policy Flow + Details 탭
  - [x] Policy Stance 신호 추가 (5개 지표 완성)
- [ ] 3-4: Widget 연동 (캐시 기반)

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

### 관리자 모드 (아주 나중)
> **상태**: 📋 계획만 (상세는 추후 논의)

| 항목 | 내용 | 비고 |
|------|------|------|
| **진입 방식** | footer "alive" 텍스트 클릭 | 위치 추후 논의 가능 |
| **인증** | 비밀번호 입력 필요 | 방식 추후 논의 |
| **인트로 화면** | 메뉴 목록 표시 | |
| **메뉴 항목** | 추후 사용자와 협의 | |
| **폴더/파일명** | 추후 논의 | |

**예상 구조** (확정 아님):
```
관리자 모드 진입
├─ 비밀번호 입력
├─ 인트로 화면 (메뉴 목록)
│   ├─ 메뉴 1: ???
│   ├─ 메뉴 2: ???
│   └─ ...
└─ 각 메뉴별 기능 페이지
```

---

## Change Log

| Date | Change |
|------|--------|
| 2025-12-01 | **Liquidity Flow Widget 완성**: Detail 캐시 연동, 2x2 그리드 레이아웃 (NetFlow Hero + 4지표), Command Center 라이브 위젯 연결 |
| 2025-12-01 | **6-Sense Model 설계**: 매크로 스코어링 시스템 (-6~+6), 6가지 지표 데이터 매핑 (philosophy.md에 상세) |
| 2025-12-01 | **위젯 로드맵 추가**: 2-Tier 시스템 (Compact/Standard), Liquidity Flow Widget 설계, main.html 방향 |
| 2025-12-01 | **Layer 2 구현 완료**: Detail 페이지 (~1000줄), 5개 신호 (M2, TGA, RRP, Crypto, Policy Stance), 4탭 차트 |
| 2025-11-30 | **Detail 설계 확정**: Signal-First Hybrid (4탭), Crypto Rotation 신호, Weekly 주기 통일 |
| 2025-11-30 | **관리자 모드 계획 추가**: footer "alive" 진입 (상세 추후 논의) |
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
