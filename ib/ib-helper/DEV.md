# IB Helper (무한매수 도우미) - Development Specification

> **Version**: 4.49.3
> **Created**: 2026-02-02
> **Updated**: 2026-02-11
> **Status**: ✅ Phase 1-3 Complete + P4 SGOV + **#246 v4.49.3 TDZ fix + budgetRatio 20%(DEC-184) + Tomorrow Alert + SGOV Tomorrow Sell** + **Code.gs v2.7.0** (ExecutionLog + Orders Archive) | ❌ #220 REVERTED
> **Priority**: 🟡 E2E 실사용 모니터링 → #207 Telegram
>
> **📋 Price Data Flow** (DEC-172):
> - 실시간 가격: WebApp API → Yahoo Finance (직접 조회)
> - Prices 시트: 체결 확인 전용 (GOOGLEFINANCE A~D)
> - ❌ setupPricesUpdateTrigger: 미구현 & 불필요
> - ❌ Prices E~G 컬럼: 불필요
>
> **📁 Testing Docs**: [Data Flow](../../../../docs/testing/ib-helper-data-flow.md) | [Scenarios](../../../../docs/testing/ib-helper-scenarios.md) | [State Machine](../../../../docs/testing/ib-helper-state-machine.md)

---

## 🚨 IMPORTANT: Collaboration Protocol

```
┌─────────────────────────────────────────────────────────────────────────┐
│  📞 QUESTIONS / UNCLEAR POINTS → Ask Asset Allocator Claude            │
│  ─────────────────────────────────────────────────────────────────────  │
│  이 문서에서 이해 안 되거나 불명확한 부분이 있으면                      │
│  Asset Allocator 프로젝트의 Claude에게 질문하세요.                      │
│                                                                         │
│  Asset Allocator Claude는:                                              │
│  - Genie RPA 로직을 역공학하여 완전히 파악하고 있음                     │
│  - V2.2 방법론 vs 실제 RPA 구현 차이점을 알고 있음                     │
│  - 중간에 개입하여 틀린 부분을 수정해줄 수 있음                        │
│                                                                         │
│  📁 Reference: Asset_Allocator/docs/references/genie-rpa-infinitebuy-guide.md
│  📁 Reference: Asset_Allocator/docs/planning/03_investment_rules.md     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Project Overview

### 1.1 Background
- **Genie RPA 서비스 종료** → 대체 도구 필요
- 기존 `ib/ib-total-guide-calculator.html`은 로직 오류 + 기능 부족
- 사용자가 직접 매일 매수/매도 주문을 생성해야 함

### 1.2 Goals
1. **정확한 V2.2 로직** 구현 (Genie RPA와 동일)
2. **사용성 최우선** - 모바일/태블릿 가독성
3. **다중 사용자/종목 관리** - 1계정 → 5명 × 11종목
4. **예수금 관리** - 내일 매수 부족 알림
5. **데이터 저장** - Google Sheets + 히스토리

### 1.3 Target Users
| User | Example |
|------|---------|
| 사용자 1 | SOXL, TQQQ, BITU |
| 사용자 2 | SOXL, TQQQ |
| ... | ... |

> ✅ 사용자가 직접 프로필 추가 (기본 프로필 없음)

---

## 2. V2.2 Algorithm - CRITICAL LOGIC

> 🔴 **AUTHORITATIVE REFERENCE**: [`docs/references/v2.2-formula-spec.md`](../../../../docs/references/v2.2-formula-spec.md)
> All formulas below are derived from the spec. When in doubt, refer to the spec.

### 2.1 Core Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| 분할 수 | 40 (default) | 총 매수 횟수 |
| 기준% | 10% | 기본 수익률 기준 |
| 매도비율 (TQQQ) | 10% | AFTER 매도 목표 |
| 매도비율 (SOXL/BITU) | 12% | AFTER 매도 목표 |
| 분할매도비율 | 5% (TQQQ), 6% (SOXL) | 표시용 (실제 LOC는 자동계산) |

### 2.2 T값 (T-Value) Calculation

```javascript
// T값 = 총 매입금 / 1회 매수금
const oneTimeBuy = principal / divisions;  // 1회 매수금
const T = Math.ceil((totalInvested / oneTimeBuy) * 10) / 10;  // 소수점 첫째자리 올림

// Example:
// principal = $13,000
// divisions = 40
// oneTimeBuy = $325
// totalInvested = $1,631
// T = ceil((1631 / 325) * 10) / 10 = ceil(50.18) / 10 = 5.1
```

### 2.3 별% (Star Percent) Formula

```javascript
// 🔴 CRITICAL: sellPercent 연동 공식
const starPercent = sellPercent * (1 - T / 20);
// 또는: sellPercent - T * (sellPercent / 20)

// Examples:
// TQQQ (10%): T=2  → 10 × (1 - 0.1) = 9%
// SOXL (12%): T=2  → 12 × (1 - 0.1) = 10.8%
// T=20 → 별% = 0% (전후반전 기준)
// T=40 → TQQQ -10%, SOXL -12%
```

> ✅ **정답**: 별%는 sellPercent와 연동됨.
> TQQQ=10%, SOXL/BITU=12%로 시작값/감소율이 달라짐.

### 2.4 LOC Price Calculation - 🔴 MOST CRITICAL

> **v1.4.0 (#234)**: V2.2 원본 CAP 적용 범위 수정 + LOC% 연동

```javascript
// 🔴 V2.2 원본 (Genie RPA Page 5-6):
//   - LOC 매수: CAP 적용 (min(별%가, 현재가×1.15))
//   - LOC 매도: CAP 없음! (별%가 그대로)

const starPrice = avgPrice * (1 + starPercent / 100);

// 매수용 LOC (CAP 적용 + 0.01 차감)
const currentPriceCap = currentPrice * 1.15;
const buyLocPrice = Math.min(starPrice, currentPriceCap) - 0.01;

// 매도용 LOC (CAP 없음 + 0.005 가산)
const sellLocPrice = starPrice + (avgPrice * 0.005);  // ← CAP 없음!
```

**LOC% 연동 (v1.4.0)**:
```javascript
// 별% = V2.2공식 + (LOC% - 5%)
// LOC% = 5% (기본) → V2.2 그대로
// LOC% = 45% → 별% + 40% 상향
const locOffset = locPercent - 5;
const adjustedStarPercent = v22StarPercent + locOffset;
```

**실제 검증 사례 (2026-01-06)**:

| Ticker | T | 별% | 별%가 | 현재가×1.15 | **실제 LOC** | 선택 기준 |
|--------|---|-----|-------|------------|-------------|----------|
| TQQQ | 15.4 | 2.3% | $54.53 | $57.68 | $54.52 | 별%가 |
| SOXL | 1.0 | 11.4% | $54.83 | $54.83 | $54.83 | 현재가+15% |
| BITU | 21.9 | -1.14% | $21.94 | $21.24 | $21.24 | 현재가+15% |

> **패턴**: T값이 높을수록 별%가 낮아지고, sellPercent가 높을수록 별% 시작값이 높아짐.

---

## 3. Buy Logic (매수 로직)

### 3.1 First Half (전반전, T < 10)

```javascript
if (T < 10) {
  // 1회 매수금을 2개로 나눔
  const halfAmount = oneTimeBuy / 2;

  // 주문 1: 평단LOC 매수 (0% 기준)
  const order1 = {
    type: '평단LOC 매수',
    price: avgPrice,  // 평단가 그대로
    amount: halfAmount,
    quantity: Math.floor(halfAmount / avgPrice)
  };

  // 주문 2: 큰수LOC 매수 (별% 기준)
  const locPrice = Math.min(
    avgPrice * (1 + starPercent / 100),
    currentPrice * 1.15
  ) - 0.01;
  const order2 = {
    type: '큰수LOC 매수',
    price: locPrice,
    amount: halfAmount,
    quantity: Math.floor(halfAmount / locPrice)
  };
}
```

### 3.2 Second Half (후반전, T >= 10)

```javascript
if (T >= 10) {
  // 전체 1회 매수금을 큰수LOC로만
  const locPrice = Math.min(
    avgPrice * (1 + starPercent / 100),
    currentPrice * 1.15
  ) - 0.01;

  const order = {
    type: '큰수LOC 매수',
    price: locPrice,
    amount: oneTimeBuy,
    quantity: Math.floor(oneTimeBuy / locPrice)
  };
}
```

### 3.3 Additional Buy for Decline (하락대비 추가매수)

> **v4.49.1+**: budget_ratio mode (DEC-180~184)
> Default: `budget_ratio` 20% + `allowOneOver=true` | Fallback: `fixed` mode (orderCount 0~8)

```javascript
// Mode: budget_ratio (default, DEC-184)
// - 1회 매수금의 budgetRatio%(20%)를 하락대비 예산으로 할당
// - allowOneOver=true: 예산 경계에서 1개 추가 허용
// - 2% 복리 하락: price × 0.98^i (매수LOC - 0.01 기준)
const budget = oneTimeBuy * (budgetRatio / 100);  // e.g. $500 × 20% = $100
let spent = 0;
for (let i = 0; spent < budget || (allowOneOver && i === overIndex); i++) {
  const declinePrice = basePrice * Math.pow(0.98, i + 1);
  additionalOrders.push({ price: declinePrice, quantity: 1 });
  spent += declinePrice;
}

// Mode: fixed (legacy fallback)
// - explicit orderCount (0~8) from profile
const maxAdditionalOrders = orderCount;  // 0~8
```

---

## 4. Sell Logic (매도 로직)

### 4.1 Standard Sell (T <= 39)

```javascript
const totalQuantity = holdings;  // 총 보유 수량

// 주문 1: LOC 매도 (25% = 쿼터매도)
const locSellPrice = Math.min(
  avgPrice * (1 + starPercent / 100),
  currentPrice * 1.15
);
const order1 = {
  type: 'LOC 매도 (쿼터)',
  price: locSellPrice.toFixed(4),
  quantity: Math.floor(totalQuantity / 4)  // 25%
};

// 주문 2: AFTER 지정가 매도 (75%)
const sellPercent = ticker === 'TQQQ' ? 0.10 : 0.12;  // TQQQ 10%, SOXL/BITU 12%
const afterSellPrice = avgPrice * (1 + sellPercent);
const order2 = {
  type: `AFTER 매도 (+${sellPercent * 100}%)`,
  price: afterSellPrice.toFixed(4),
  quantity: totalQuantity - order1.quantity  // 75%
};
```

### 4.2 Quarter Stop-Loss (쿼터손절, T > 40)

```javascript
if (T > 40) {
  // Step 1: 1/4 MOC 매도
  const mocSell = {
    type: 'MOC 매도 (쿼터손절)',
    price: 'MOC (종가)',
    quantity: Math.floor(totalQuantity / 4)
  };

  // Step 2: 10분할 추가매수 준비
  // (현금 확보 후 -10%/-12% LOC로 10회 분할매수)
  // 이 부분은 별도 모드로 안내
}
```

---

## 5. Cash Management (예수금 관리) - 🔴 CRITICAL

### 5.1 Today's Buy Deduction

```javascript
// 오늘 매수 예정 금액 계산
const todayBuyAmount = calculateTodayBuyAmount(orders);

// 예수금에서 차감
const remainingCash = currentCash - todayBuyAmount;
```

### 5.2 Tomorrow's Buy Check - 🔴 MOST IMPORTANT (v4.49.3)

```javascript
// v4.49.3: Today + Tomorrow dual check
const remainingAfterToday = Math.max(0, currentCash - todayBuyAmount);
const tomorrowDiff = remainingAfterToday - dailyBuyAttempt;

// Today check
if (currentCash < todayBuyAmount) {
  alert({ message: `오늘 매수 부족! $${(todayBuyAmount - currentCash).toFixed(2)}` });
}
// Tomorrow check (only when today is OK)
else if (tomorrowDiff < 0) {
  alert({ message: `내일 매수 부족! $${Math.abs(tomorrowDiff).toFixed(2)}` });
}

// Displayed in: banner, results panel, status panel, copy message (4 locations)
// SGOV sell also triggers for tomorrow shortage (sellReason: 'tomorrow')
```

### 5.3 Display Format

```
┌─────────────────────────────────────────┐
│  💰 예수금 현황                          │
├─────────────────────────────────────────┤
│  현재 예수금:     $1,500.00             │
│  오늘 매수 예정:  -$650.00              │
│  ─────────────────────────────          │
│  남은 예수금:     $850.00               │
│  내일 매수 필요:  $650.00               │
│  ─────────────────────────────          │
│  상태: ✅ 충분 (여유 $200)              │
│  또는                                   │
│  상태: ❌ 부족! ($150 입금 필요)         │
└─────────────────────────────────────────┘
```

---

## 6. User Interface Requirements

### 6.1 Mobile-First Design - 🔴 CRITICAL

```
┌─────────────────────────────────────────┐
│  📱 모바일/태블릿 가독성 = 최우선        │
├─────────────────────────────────────────┤
│  - 큰 터치 영역 (최소 44px)             │
│  - 명확한 숫자 표시 (큰 폰트)           │
│  - 한 화면에 핵심 정보만                │
│  - 스크롤 최소화                        │
│  - 빠른 입력 (숫자 키패드)              │
└─────────────────────────────────────────┘
```

### 6.2 Input Fields (Per Ticker)

| Field | Type | Saved? | Description |
|-------|------|--------|-------------|
| 종목 (Ticker) | Select | ✅ | TQQQ, SOXL, BITU 등 |
| 세팅원금 (Principal) | Number | ✅ | 종목별 투자금 |
| 분할 수 (Divisions) | Number | ✅ | 기본 40 |
| 매도비율 (Sell %) | Number | ✅ | TQQQ 10%, SOXL 12% |
| 예수금 (Cash) | Number | ✅ | 프로필별 총 예수금 |
| --- Daily Input --- | --- | --- | --- |
| 평단가 (Avg Price) | Number | ⚡ | 매일 변경 |
| 총 매입금 (Invested) | Number | ⚡ | 매일 변경 |
| 보유수량 (Holdings) | Number | ⚡ | 매일 변경 |
| 현재가 (Current) | Number | 🔄 | API 자동 or 수동 |

> ⚡ = 매일 입력 필요, 전날 값 유지 옵션
> 🔄 = Yahoo Finance API 자동 조회 가능

### 6.3 Output Display

```
┌─────────────────────────────────────────┐
│  📊 [SOXL] ElFenomeno 오늘의 주문        │
├─────────────────────────────────────────┤
│  T값: 15.4  │  별%: 2.8%  │  1회매수: $325│
├─────────────────────────────────────────┤
│  📈 매수 주문                            │
│  ────────────────────────────────────── │
│  큰수LOC 매수    $54.52    5주           │
│  하락대비 #1     $53.70    1주           │
│  하락대비 #2     $52.89    1주           │
├─────────────────────────────────────────┤
│  📉 매도 주문                            │
│  ────────────────────────────────────── │
│  LOC 매도 (25%)  $54.52    3주           │
│  AFTER 매도      $59.97    9주           │
├─────────────────────────────────────────┤
│  💰 예수금: $850 → 내일 ✅ 충분          │
└─────────────────────────────────────────┘
```

---

## 7. Data Storage (Google Sheets)

### 7.1 Sheet Structure

**Sheet 1: Profiles**
| Column | Description |
|--------|-------------|
| profile_id | Unique ID |
| display_name | 별명 (예: "User1") |
| real_name | 실제 사용자명 |
| telegram_chat_id | 텔레그램 방 ID |
| created_at | 생성일 |

**Sheet 2: Tickers**
| Column | Description |
|--------|-------------|
| profile_id | FK |
| ticker | TQQQ, SOXL, etc. |
| principal | 세팅원금 |
| divisions | 분할 수 |
| sell_percent | 매도비율 |

**Sheet 3: Daily Data (History)**
| Column | Description |
|--------|-------------|
| profile_id | FK |
| ticker | FK |
| date | 날짜 |
| avg_price | 평단가 |
| total_invested | 총매입금 |
| holdings | 보유수량 |
| cash | 예수금 |
| t_value | 계산된 T값 |

### 7.2 Data Retention

- **전날 데이터 유지**: 입력 편의를 위해 전날 값 표시
- **히스토리 저장**: 날짜별 모든 데이터 보관
- **날짜 표시**: "오늘 날짜 확인" 배너로 혼동 방지

---

## 8. Telegram Integration

### 8.1 Message Format (Genie RPA Style)

```
📊 [ElFenomeno] 무한매수 리포트
━━━━━━━━━━━━━━━━━━━━━━━
📅 2026-02-02

✅ SOXL 매수 정상 | 매도 정상
   T: 15.4 | 별%: 2.8%
   매수: $54.52 × 5주
   매도: $59.97 × 9주 (AFTER)

✅ TQQQ 매수 정상 | 매도 정상
   T: 8.2 | 별%: 5.9%
   매수: $72.15 × 4주 + $73.50 × 4주
   매도: $79.37 × 12주 (AFTER)

💰 예수금: $850 → 내일 ✅ 충분
━━━━━━━━━━━━━━━━━━━━━━━
```

### 8.2 Profile-Specific Channels

```javascript
// 프로필별 텔레그램 방 분리
const telegramChannels = {
  fenomeno: 'CHAT_ID_1',
  kgs: 'CHAT_ID_2',
  sis: 'CHAT_ID_3',
  // ...
};
```

---

## 9. Existing Code Issues (기존 코드 문제점)

### 9.1 Location
`ib/ib-total-guide-calculator.html`

### 9.2 Critical Bugs

| # | Issue | Current | Correct |
|---|-------|---------|---------|
| 1 | SOXL 별% 공식 | `12 - (T * 0.6)` (SOXL 하드코딩) | `sellPercent * (1 - T / 20)` |
| 2 | LOC 캡 없음 | `avgPrice * (1 + star%)` | `min(star%가, 현재가×1.15)` |
| 3 | 예수금 관리 | ❌ 없음 | 필수 |
| 4 | 다중 프로필 | ❌ 없음 | 필수 |
| 5 | 데이터 저장 | ❌ 없음 | Google Sheets |

### 9.3 Recommendation
**기존 코드 폐기, 새로 작성 권장**

---

## 10. Technical Stack

### 10.1 Frontend
- HTML5 + TailwindCSS (기존 admin 스타일 통일)
- Vanilla JavaScript (프레임워크 없음)
- 모바일 우선 반응형

### 10.2 Backend
- Google Apps Script (API)
- Google Sheets (데이터 저장)

### 10.3 External APIs
- Yahoo Finance (현재가 조회)
- Telegram Bot API (알림)

### 10.4 Reusable Modules (from admin/shared/)
- `CacheManager` - 캐싱
- `DataManager` - 데이터 로드
- `StatusCard` - UI 컴포넌트

---

## 11. File Structure

```
admin/ib-helper/
├── index.html          ← 메인 UI
├── DEV.md              ← 이 문서
├── js/
│   ├── calculator.js   ← V2.2 계산 로직
│   ├── storage.js      ← Google Sheets 연동
│   ├── telegram.js     ← 텔레그램 알림
│   └── ui.js           ← UI 컴포넌트
└── styles/
    └── mobile.css      ← 모바일 최적화 스타일
```

---

## 12. Development Phases

### Phase 1: Core Calculator ⭐ - ✅ COMPLETE (02-02)
- [x] V2.2 계산 로직 구현 (별%, LOC 캡) - `js/calculator.js`
- [x] 단일 종목 계산기 UI - `index.html` (모바일 우선)
- [x] 현재가 API 연동 - Yahoo Finance (CORS 제한, 수동 입력 대체)
- [x] Asset Allocator Claude 로직 검증 ✅

**Implementation Notes (02-02)**:
- `IBCalculator` 모듈: T값, 별%, LOC 계산 + 매수/매도 주문 생성
- 별% = `sellPercent * (1 - T / 20)` 적용 (sellPercent 연동)
- LOC 캡 = `min(별%가, 현재가×1.15)` 적용
- 전반전(T<10): 평단LOC + 큰수LOC 분할
- 후반전(T>=10): 큰수LOC only
- 쿼터손절(T>40): 안내 모드
- **하락대비 추가매수**: 2% 복리 (`price × 0.98^i`, -15%까지) - DEC-148

**Verification Complete** (Asset Allocator Claude):
| 항목 | 공식 | 검증 |
|------|------|------|
| T값 | `ceil((invested/oneTimeBuy)*10)/10` | ✅ |
| 별% | `sellPercent * (1 - T / 20)` | ✅ |
| LOC 캡 | `min(별%가, 현재가×1.15)` | ✅ |
| 하락대비 | `price × 0.98^i` (2% 복리) | ✅ DEC-148 |

### Phase 2A: Multi-Profile (localStorage) - ✅ COMPLETE (02-02)
- [x] `js/profile-manager.js` - ProfileManager 모듈
- [x] 5명 가족 기본 프로필 (fenomeno, kgs, sis, kjp, mona)
- [x] 프로필 선택 드롭다운 + 설정 모달
- [x] 종목별 설정 저장 (세팅원금, 매도%)
- [x] 프로필 내보내기/가져오기 (JSON)
- [x] 일일 데이터 저장 (평단가, 총매입금, 보유량, 현재가)

**Implementation Notes (02-02)**:
- localStorage 기반 (오프라인 사용 가능)
- CRUD: create, update, delete, export, import
- 일일 데이터는 프로필×종목별 별도 저장
- 스펙: `_tmp/PHASE2_SPEC.md` (Asset Allocator 제공)

### Phase 2B: Google Sheets Sync - ✅ COMPLETE (02-02)
- [x] `js/sheets-sync.js` - SheetsSync 모듈
- [x] OAuth 2.0 인증 (Google Identity Services)
- [x] 프로필 모달에 연결/동기화 UI 추가
- [x] 동기화 기능 (push/pull/sync)
- [x] ✅ Google Cloud 자격 증명 설정 완료

**Implementation Notes (02-02)**:
- Google Sheets API + OAuth 2.0 기반
- CLIENT_ID/API_KEY 설정 완료 (xfenok-analytics 프로젝트)
- Spreadsheet URL 붙여넣기 → 자동 ID 추출
- Sync 전략: Cloud stocks 데이터 우선, Local settings 보존
- 스펙: `_tmp/PHASE2_SPEC.md` (Asset Allocator 제공)

### Phase 2C: Privacy + Migration + Polish - ✅ COMPLETE (02-02)
- [x] 개인정보 제거 (DEFAULT_PROFILES 비움, 계좌번호 제거)
- [x] BITU 제거 (sellPercent 기본값에서 제거, UI 버튼에서 제거)
- [x] DEFAULT sellPercent 변경 (12 → 10)
- [x] 다중 사용자 Google Sheets (프로필별 Sheet ID 저장)
- [x] 현재가 API 수정 (Yahoo → 100xFenok Ticker API)
- [x] **Genie RPA .dat 파일 Import 기능** 🆕

**Implementation Notes (02-02)**:
- ProfileManager: DEFAULT_PROFILES = {} (빈 상태 시작)
- SheetsSync: `ib_sheets_id_{profileId}` 패턴으로 프로필별 Sheet 연결
- Ticker API: `https://ticker-api.etloveaui.workers.dev/api/ticker/{symbol}`
- dat 파일 포맷: `0|SYMBOL|PRINCIPAL|STAR%|T%|VERSION|DIVISIONS|QTY|?|?`
- parseDatFile() 함수로 Genie RPA 데이터 자동 파싱
- 현재 프로필에 추가 또는 새 프로필로 생성 선택 가능

### Phase 3: Cash Management - ✅ COMPLETE (02-02)
- [x] `js/balance-manager.js` - BalanceManager 모듈
- [x] 예수금 입력 (프로필별 USD)
- [x] 일매수시도금액 계산 (1회매수 + 하락대비)
- [x] 주문가능상태 표시 (여유/부족)
- [x] 종목별 매수시도금액 분석 테이블
- [x] 부족 알림 배너 (🚨 내일 매수 부족!)

**Implementation Notes (02-02)**:
- BalanceManager 모듈: calcDailyBuyAttempt, calcOrderStatus, checkAlert
- 일매수시도금액 = Σ(종목별 1회매수 + 하락대비 추가매수)
- 하락대비 스텝: 2% 복리 (`price × 0.98^i`, 최대 -15%)
- 주문상태 = 예수금 - 일매수시도금액
- UI: 실시간 계산 + 종목별 breakdown + 상단 알림 배너
- 스펙: `_tmp/PHASE3_SPEC.md` (Asset Allocator 제공)

### v4.24.0: Calculator V2.2 Spec Compliance (02-03) - Ralph Loop
- [x] **Bug Fix**: 평단LOC 가격캡 누락
  - 명세서: `avgLocPrice = Math.min(avgCost, currentPrice × 1.15)`
  - 수정 전: `avgPriceBuy = avgPrice` (캡 없음)
  - 수정 후: `avgPriceBuy = Math.min(avgPrice, priceCap)` (캡 적용)
- [x] **calculator.js v1.2.0**: 평단LOC 가격캡 구현
- [x] **명세서 검증 결과**:
  - ✅ 별%: `sellPercent * (1 - T / 20)` 정확 (Genie RPA 역공학 결과)
  - ✅ 전반전/후반전: `T < 20` == `progress < 50%` 동등
  - ✅ 큰수LOC: `min(별%가, priceCap)` 정확
  - ✅ AFTER 매도: `avgPrice × (1 + sellPercent%)` 정확
  - ⚠️ T값: 소수점 1자리 vs 정수 (미세 차이, 기능 영향 없음)

### v4.23.0: Formula Details + UX Fixes (02-03) - Ralph Loop
- [x] **Feature**: 계산 공식 상세 표시
  - 요약 카드 하단에 "공식 상세" 토글 버튼 추가
  - 클릭 시 T값/별%/LOC 매도가/지정가 매도 공식 표시
  - 실제 계산값으로 공식 렌더링 (사용자 검증 가능)
- [x] **Functions Added**:
  - `toggleFormulaDetails()` - 공식 패널 토글
  - `updateFormulaDetails(result)` - 실제 값으로 공식 업데이트
- [x] **CSS Added**:
  - `.formula-details` - 공식 패널 스타일
  - `.formula-toggle` - 토글 버튼 스타일
- [x] **profile-manager.js v1.1.0 UX Fixes**:
  - 한글 프로필명 ID 생성 개선 (`encodeURIComponent` 사용)
  - `saveDailyData()` 날짜 생성 IIFE 간소화

### v4.22.0: UX Improvements + Balance Sync (02-03) - Ralph Loop
- [x] **New Profile UX**:
  - 팝업 없이 자동 생성 (사용자1, 사용자2...)
  - 새 프로필 버튼 → 프로필 이름 우측으로 이동
  - 생성 후 모달 유지
- [x] **Profile Pull**:
  - 모든 시트 프로필 순차적으로 가져오기
  - 기존 로컬 데이터 덮어쓰기
  - `pullAllProfiles()` 함수 추가
- [x] **Balance Sync (v3.2)**:
  - 예수금 시트 저장 (K열)
  - 프로필의 첫 번째 종목 row에 예수금 저장
  - `CONFIG.RANGE` → 'A2:K10000' (11컬럼)
- [x] **Days Remaining**:
  - 예수금 ÷ 일매수시도금액 = 투자 가능 일수 표시
  - "📅 약 N일 투자 가능" 형식
- [x] **UI Compact (추가 수정)**:
  - 주문창 두 개 뜨는 버그 수정 (results-section 항상 hidden)
  - 주문 카드 축소 (한 줄 형식)
  - 하락대비 위치 → 매수 바로 뒤 (매도 전)
  - 복사 버튼 → 가격만 (달러 표시 제거)
- [x] **User Action Required**:
  - Portfolio 시트에 K열 "예수금" 헤더 추가

### v4.21.2: Calculator sellPercent Bug Fix (02-03) - Ralph Loop
- [x] **Bug Found by Ralph Loop**:
  - `calculateOrders()`에서 사용자 입력 sellPercent가 calculator에 전달되지 않음
  - `calculator.js`가 하드코딩된 DEFAULT_CONFIG만 사용
- [x] **Fixes**:
  - `index.html`: `calculateOrders()`에 sellPercent 파라미터 추가
  - `calculator.js`: `calculate()`, `generateSellOrders()`에 inputSellPercent 지원
  - `profile-manager.js`: JSDoc에 locSellPercent 추가
- [x] **Note**: locSellPercent는 표시용 - LOC 가격은 별%가로 자동 계산됨

### v4.21.1: Portfolio Sheet Structure Expansion (02-03)
- [x] **Sheet Structure v3.1**: 8컬럼 → 10컬럼
  - H열: **AFTER%** (지정가 매도 75%) - 기본 TQQQ=10, SOXL/BITU=12
  - I열: **LOC%** (분할매도 25%) - 기본 TQQQ=5, SOXL/BITU=6
  - J열: 날짜 (기존 H열에서 이동)
- [x] **JS Changes**:
  - `sheets-sync.js`: parseRows(), push(), pull(), pullFromSheetProfile() 업데이트
  - `getMyProfilesFromSheet()`: 새 컬럼 반영
- [x] **HTML Changes**:
  - 설정 섹션에 LOC% 입력 필드 추가 (`input-locSellPercent`)
  - `saveCurrentInputs()`: locSellPercent 저장
  - `selectTicker()`: locSellPercent 로드
  - 종목 추가/dat import 시 locSellPercent 포함
- [x] **User Action Required**:
  - Portfolio 시트에 H열 "AFTER%", I열 "LOC%" 헤더 추가
  - 기존 H열 "날짜" → J열로 이동

### v4.27.0: UX Improvements (02-03) - #216 + #219
- [x] **#219 전체 복사 버튼**:
  - 결과 영역 상단에 "📋 전체 복사" 버튼 추가
  - `copyAllOrdersTotal()` - 매수+하락대비+매도 전부 복사
  - 기존 섹션별 복사 버튼 유지
- [x] **#216 쿼터손절 체크박스**:
  - T>40 시 체크박스 표시 (기본 체크 해제)
  - 체크하면 MOC 주문 안내 표시
  - `handleQuarterStopChange()` - 체크박스 핸들러
  - `copyMocOrder()` - MOC 주문 복사
  - 사용자가 명시적으로 체크해야 MOC 안내 표시
- [x] **#218 종목 제외 체크박스**: ⏸️ 다중 종목 계산(#217)과 함께 구현 예정

### v4.35.2: WebApp Price API + Codex Review Round 3 (#221) (02-04)
- [x] **Problem**: `getCurrentPrice()` → Cloudflare Worker `/api/ticker/:symbol` 호출 → 404/0 + CORS 차단
- [x] **Solution**: Apps Script WebApp + JSONP 양방향 지원 (서버 + 클라이언트)
- [x] **yahoo-quotes.gs**: `doGet()` 함수 추가
  - Prices 시트 A2:G100 읽어서 JSON 반환
  - `?ticker=TQQQ` 파라미터로 단일 종목 조회 가능
  - **JSONP 지원**: `?callback=fn` → `fn({data})` 형식 반환
- [x] **sheets-sync.js v3.7.3**: `getCurrentPrice()` 수정 + **Codex Review R1+R2+R3 반영**
  - 1차: 1분 TTL in-memory 캐시 확인
  - 🆕 2차: **JSONP로 WebApp 호출** (script 삽입 - CORS 완전 우회)
  - 3차: `fetchCurrentPrices()` fallback (로그인 시)
  - **R1**: `CONFIG.WEBAPP_URL`로 통합, ticker null/undefined 검증 추가
  - **R2**: 티커별 캐시 TTL 분리 (전역 `_priceCacheTime` → `{ TQQQ: { price, time } }`)
  - 🆕 **R3**: `fetchJSONP()` 헬퍼 함수 추가 (CORS 완전 우회)
- [x] **User Action Required**:
  1. `yahoo-quotes.gs`에 `doGet()` 코드 추가 (`_tmp/doGet_for_yahoo-quotes.gs` 참조)
  2. "새 배포" → "웹 앱" → "모든 사용자" 접근 허용
  3. 배포 URL을 `sheets-sync.js` CONFIG.WEBAPP_URL에 입력

### v4.34.0: Google OAuth Reset (02-04)
- [x] Removed email/password UI와 Apps Script WebApp 설정 UI
- [x] `sheets-sync.js`: WebApp/토큰 관련 함수 제거 (Google OAuth만 유지)
- [x] `Code.gs.template`: WebApp `doPost()/register/login` 및 Users 시트 로직 삭제
- [x] 문서/로그 기준 Google 로그인 단일 플로우로 회귀

### ❌ v4.33.x: Email Auth (REVERTED 02-04)
- **Reverted**: 이메일 인증 기능이 Google OAuth 현재가 조회를 망가뜨림
- **Rollback**: sheets-sync.js v3.6.0, index.html 원복
- **Status**: #220 취소됨

### ~~v4.33.0: Dual-Track Authentication (02-03) - DEC-154 #220~~
- [x] **Feature**: Google OAuth + Email/Password 병행 인증
  - Google OAuth: 기존 (1시간 세션, 경고 있음)
  - Email Auth: 신규 (7일 세션, 경고 없음)
- [x] **Backend (`Code.gs.template` v2.0.0)**:
  - `doPost()`: register, login, verify, getData, saveData actions
  - `registerUser()`: 이메일 중복 체크, SHA-256 비밀번호 해시, 7일 토큰
  - `loginUser()`: 비밀번호 검증, 토큰 재생성
  - `verifyToken()`: 토큰 유효성 + 만료 체크
  - `createUsersSheet()`: Users 시트 자동 생성
- [x] **Frontend (`sheets-sync.js` v3.6.0)**:
  - `registerEmail()`, `loginEmail()`, `signOutEmail()`
  - `tryRestoreEmailSession()`: 7일 세션 자동 복원
  - `isEmailAuth()`, `getEmailToken()`: 인증 상태 헬퍼
  - WebApp URL 하드코딩 (public endpoint)
- [x] **UI (`index.html`)**:
  - "또는" 구분선 (Google ↔ Email 사이)
  - 이메일/비밀번호 입력 필드
  - 로그인/가입하기 버튼
  - "🔒 7일 세션 유지 · 경고 없음" 안내
- [x] **Sheet4 "Users" Structure**:
  - A: 이메일, B: 비밀번호해시, C: 토큰, D: 토큰만료, E: 가입일

### v4.26.0: Pre-market Price Priority (02-03) - #211-P3
- [x] **Feature**: 프리마켓/애프터장 가격 우선 사용
- [x] **yahoo-quotes.gs v1.2.0**:
  - `getBestPrice(quote)` - MarketState 기반 최적 가격 선택
    - PRE + preMarket 있음 → preMarket 가격
    - POST + afterHours 있음 → afterHours 가격
    - 그 외 → 정규장 가격
  - `updatePricesSheet()` - Prices 시트 자동 업데이트
  - `setupPricesUpdateTrigger()` - 5분 간격 자동 업데이트 트리거
- [x] **sheets-sync.js v3.3.0**:
  - `fetchCurrentPrices()` - MarketState 열 추가 (A2:G100)
  - 반환값에 marketState, updatedAt 포함
- [x] **Prices Sheet Structure v1.2**:
  - A: Ticker, B: Current (= bestPrice), C: Close, D: High, E: Low
  - F: MarketState (PRE/REGULAR/POST/CLOSED), G: UpdatedAt
- [x] **Korean Time Reference**:
  - 프리장: 18:00-23:30 KST (EST 04:00-09:30)
  - 정규장: 23:30-06:00 KST (EST 09:30-16:00)
  - 애프터: 06:00-09:00 KST (EST 16:00-20:00)
- [x] **User Action**:
  - Prices 시트에 F열 "MarketState", G열 "UpdatedAt" 헤더 추가
  - Apps Script에서 `setupPricesUpdateTrigger()` 실행하여 자동 업데이트 설정

### v4.21.0: Order Execution Tracking (02-03) - DEC-153
- [x] **Feature**: 주문 히스토리 저장 + 체결 확인 기능
- [x] **JS Changes**:
  - `sheets-sync.js`: `saveOrders()` - Sheet3 "Orders"에 주문 저장
  - `sheets-sync.js`: `readPendingOrders()` - 미체결 주문 조회
  - `sheets-sync.js`: `createOrdersSheet()` - 자동 시트 생성
  - `index.html`: `saveOrdersToSheet()` - 계산 후 자동 저장
- [x] **Apps Script**: `Code.gs.template` - 체결 확인 스크립트
  - `processOrderExecutions()` - 매일 09:00 자동 실행
  - `checkExecutions()` - 체결 판정 로직
  - `updatePortfolio()` - 포트폴리오 자동 업데이트
- [x] **UI Changes** (Phase 0):
  - Header simplified for mobile (IB only, "Helper" hidden on small screens)
  - Footer hidden on mobile, visible on desktop only
- [x] **Sheet3 "Orders" Structure**:
  - A: 날짜, B: 구글ID, C: 프로필ID, D: 종목
  - E: 주문타입, F: 매수매도, G: 가격, H: 수량, I: 총액
  - J: 체결기준, K: 체결, L: 체결일, M: 실제가격
- [x] **Execution Rules**:
  - 매수 LOC: 종가 ≤ 주문가 → 체결
  - 매도 LOC (25%): 종가 ≥ 주문가 → 체결
  - 매도 지정가 (75%): 고가 ≥ 주문가 → 체결

### v4.19.0: Bug 14 Fix - Sheet Pull Profile Mismatch (02-03)
- [x] **Problem**: "시트에서 불러오기" 실패 (0 rows) - 프로필 ID 불일치
  - 로컬 프로필 ID: `name_1770054353112` (새로 생성)
  - 시트 프로필 ID: `name_1770053026012` (기존 저장)
  - 프로필 ID가 타임스탬프 기반이라 재생성 시 매칭 불가
- [x] **Solution**: 프로필 선택 UI 추가
  - `sheets-sync.js`: `getMyProfilesFromSheet()` - 내 구글ID의 모든 프로필 목록 조회
  - `sheets-sync.js`: `pullFromSheetProfile(sheetProfileId)` - 특정 시트 프로필에서 불러오기
  - `index.html`: `showSheetProfileSelection()` - 프로필 선택 다이얼로그
  - `index.html`: `pullFromSheetProfile()` - 선택된 프로필 데이터 불러오기
- [x] **Flow**:
  1. "시트에서 불러오기" 클릭
  2. 내 구글ID의 모든 프로필 조회
  3. 프로필 1개 → 바로 불러오기
  4. 프로필 여러 개 → 선택 UI 표시
  5. 사용자가 선택 → 해당 프로필 데이터를 현재 로컬 프로필에 병합
- [x] **Side Effects**: None (기존 `pull()` 함수 유지, 하위 호환성 보장)

### v4.47.2 / Code.gs v2.3.3: totalInvested Commission Fix (#245) (02-08)
- [x] **Bug**: `totalInvested` calculated WITHOUT commission, while `balance` includes commission
  - Code.gs L516: `actualPrice * qty` → `actualPrice * qty * (1 + commRate)`
  - index.html L2525: `o.price * o.quantity` → `o.price * o.quantity * (1 + commRate)`
- [x] **Impact**: avgPrice consistently lower than actual, balance drift ~$0.37/trade (~$15/day cumulative)
- [x] **Verification**: 3/3 agents independently CONFIRMED (model-x, model-y, model-3)
- [x] **Code.gs v2.3.3**: `commissionByProfile[profileKey] ?? defaultCommissionRate` applied to totalInvested
- [x] **Frontend v4.47.2**: `BalanceManager.getCommissionRate()` / fallback 0.07% applied in `applyTodayBuy()`

### Phase 4: Telegram
- [ ] 프로필별 알림 발송
- [ ] Genie 스타일 메시지 포맷

### Phase 5: Polish
- [ ] 모바일 UX 최적화
- [ ] 에러 핸들링
- [ ] 테스트

---

## 13. Testing Checklist

### 13.1 Calculation Accuracy
- [ ] T값 계산 (소수점 올림 확인)
- [ ] 별% = sellPercent * (1 - T / 20)
- [ ] LOC = min(별%가, 현재가×1.15)
- [ ] 전반전: 0.5회치 × 2
- [ ] 후반전: 1회치 × 1
- [ ] 하락대비 추가매수 (5회)
- [ ] 쿼터매도 25% + AFTER 75%

### 13.2 Real Data Validation
| Ticker | T | Expected 별% | Expected LOC Logic |
|--------|---|--------------|-------------------|
| TQQQ | 15.4 | 2.3% | 별%가 선택 |
| SOXL | 1.0 | 11.4% | 현재가+15% 선택 |
| BITU | 21.9 | -1.14% | 현재가+15% 선택 |

---

## 14. FAQ for Developer

### Q1: SOXL 별% 공식이 다른 문서에서 다르게 나와요
**A**: V2.2 방법론 원본은 **sellPercent 연동 공식**을 사용합니다.
`starPercent = sellPercent * (1 - T / 20)`이며, TQQQ는 10%, SOXL/BITU는 12% 기준으로 기울기가 달라집니다.
기존 `ib-total-guide-calculator.html`은 **하드코딩 방식**이라 일반화가 필요합니다.

### Q2: LOC 캡이 왜 필요해요?
**A**: Genie RPA는 LOC 가격이 현재가보다 너무 높아지는 것을 방지하기 위해
`min(별%가, 현재가×1.15)` 캡을 적용. 이것이 없으면 체결이 안 될 수 있음.

### Q3: 분할매도가 비율 설정은 어떻게 동작해요?
**A**: Genie RPA에서 분할매도가 비율(5%, 6% 등)은 **표시용**일 뿐,
실제 LOC 매도가는 `min(별%가, 현재가×1.15)`로 자동 계산됨.
AFTER 매도% (10%, 12%)만 사용자 설정대로 적용.

### Q4: 쿼터손절은 어떻게 구현해요?
**A**: T > 40 진입 시 별도 모드로 안내.
1) 1/4 MOC 매도 안내
2) 남은 현금으로 10분할 추가매수 안내
자동화보다는 **가이드** 형태로 제공 권장.

---

## 15. Contact

**로직 질문, 불명확한 점**:
→ Asset Allocator 프로젝트의 Claude에게 문의

**참고 문서**:
- `Asset_Allocator/docs/references/genie-rpa-infinitebuy-guide.md`
- `Asset_Allocator/docs/planning/03_investment_rules.md`
- `Asset_Allocator/docs/research/phase1_v22_reverse_engineering.md`

---

*Last Updated: 2026-02-11*
*Author: Asset Allocator Claude (Supervisor/Coach Role)*
