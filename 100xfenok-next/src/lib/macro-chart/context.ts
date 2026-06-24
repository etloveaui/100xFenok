export const MACRO_CONTEXT_IDS = ["risk-liquidity", "bank-credit", "activity", "crypto-liquidity"] as const;

export type MacroContextId = (typeof MACRO_CONTEXT_IDS)[number];

export interface MacroWorkbenchContext {
  id: MacroContextId;
  label: string;
  shortLabel: string;
  detail: string;
  chartHref: string;
  screenerHref: string;
  etfHref: string;
  stockHref: string;
  stockSymbol: string;
  stockLabel: string;
  screenerPreset: string;
  insightBullets: readonly string[];
}

export const DEFAULT_MACRO_CONTEXT_ID: MacroContextId = "risk-liquidity";

export const MACRO_CONTEXTS: Record<MacroContextId, MacroWorkbenchContext> = {
  "risk-liquidity": {
    id: "risk-liquidity",
    label: "리스크·유동성",
    shortLabel: "리스크",
    detail: "주가, 변동성, 금리, 신용, 유동성을 같은 시간축에서 본 뒤 방어/공격 후보로 이어갑니다.",
    chartHref: "/macro-chart?macro=risk-liquidity&series=sp500,vix,tga,DGS10,HY_spread,M2SL&transform=rebase100,raw,rebase100,raw,raw,yoy&range=10Y&hidden=vix&axis=vix:right,DGS10:right,HY_spread:right&formula=ratio:sp500:DGS10",
    screenerHref: "/screener?macro=risk-liquidity&preset=connected&connection=indexMembership",
    etfHref: "/etfs?macro=risk-liquidity&type=inverse",
    stockHref: "/stock/NVDA?macro=risk-liquidity",
    stockSymbol: "NVDA",
    stockLabel: "AI 대형주",
    screenerPreset: "연결 데이터",
    insightBullets: [
      "VIX·HY 스프레드가 튀면 지수 편입/13F 연결 종목을 먼저 좁힙니다.",
      "TGA·M2 방향이 주식 리스크와 엇갈릴 때 ETF 헤지 후보를 같이 봅니다.",
      "대표 종목은 상세 탭에서 공시·13F·단일종목 ETF 연결을 확인합니다.",
    ],
  },
  "bank-credit": {
    id: "bank-credit",
    label: "은행·신용",
    shortLabel: "신용",
    detail: "은행 신용, 예금, 자본비율, HY 스프레드를 묶어 금융·신용 민감 후보로 이어갑니다.",
    chartHref: "/macro-chart?macro=bank-credit&series=bank_credit,deposits,fdic_tier1,HY_spread,DGS10&transform=yoy,yoy,raw,raw,raw&range=10Y&axis=fdic_tier1:right,HY_spread:right,DGS10:right&formula=spread:bank_credit:deposits",
    screenerHref: "/screener?macro=bank-credit&preset=value&connection=filings",
    etfHref: "/etfs?macro=bank-credit&asset=Bond&fee=low",
    stockHref: "/stock/JPM?macro=bank-credit",
    stockSymbol: "JPM",
    stockLabel: "은행 대표주",
    screenerPreset: "가치",
    insightBullets: [
      "신용 스프레드가 벌어질수록 공시 연결 종목과 PER 밴드를 함께 봅니다.",
      "은행 신용과 예금의 차이는 금융주와 채권 ETF 점검으로 이어집니다.",
      "대표 종목은 이익률·자본·공시 변화를 상세에서 확인합니다.",
    ],
  },
  activity: {
    id: "activity",
    label: "경기활동",
    shortLabel: "경기",
    detail: "OECD CLI, PMI, ISM을 묶어 추정치와 실적 민감 종목으로 이어갑니다.",
    chartHref: "/macro-chart?macro=activity&preset=activity&range=MAX",
    screenerHref: "/screener?macro=activity&preset=estimate&action=value_momentum",
    etfHref: "/etfs?macro=activity&type=leveraged",
    stockHref: "/stock/AAPL?macro=activity",
    stockSymbol: "AAPL",
    stockLabel: "경기 민감 대형주",
    screenerPreset: "추정치",
    insightBullets: [
      "PMI/ISM 방향은 FY+1~3 매출·EPS 추정치 화면으로 바로 연결합니다.",
      "활동 지표가 개선될 때는 모멘텀·레버리지 ETF 후보를 함께 봅니다.",
      "대표 종목은 추정치 탭과 PER 밴드로 경기 민감도를 확인합니다.",
    ],
  },
  "crypto-liquidity": {
    id: "crypto-liquidity",
    label: "크립토 유동성",
    shortLabel: "크립토",
    detail: "스테이블코인 공급과 나스닥, S&P 500, 크립토 심리를 연결해 디지털자산 ETF와 성장주로 이어갑니다.",
    chartHref: "/macro-chart?macro=crypto-liquidity&series=stablecoins,nasdaq,sp500,crypto_fear_greed,vix&transform=rebase100,rebase100,rebase100,raw,raw&range=5Y&hidden=vix&axis=crypto_fear_greed:right,vix:right&formula=ratio:nasdaq:stablecoins",
    screenerHref: "/screener?macro=crypto-liquidity&preset=momentum&action=momentum",
    etfHref: "/etfs?macro=crypto-liquidity&digital=1",
    stockHref: "/stock/COIN?macro=crypto-liquidity",
    stockSymbol: "COIN",
    stockLabel: "크립토 민감주",
    screenerPreset: "모멘텀",
    insightBullets: [
      "스테이블코인 공급과 위험자산이 같이 움직이면 디지털자산 ETF를 우선 확인합니다.",
      "나스닥 대비 유동성 비율은 성장주 모멘텀 스크리너로 이어집니다.",
      "대표 종목은 가격·공시·기관 보유 연결로 변동성의 질을 봅니다.",
    ],
  },
};

export function isMacroContextId(value: string | null | undefined): value is MacroContextId {
  return MACRO_CONTEXT_IDS.includes(value as MacroContextId);
}

export function macroContextFromParam(value: string | string[] | null | undefined): MacroWorkbenchContext | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return isMacroContextId(raw) ? MACRO_CONTEXTS[raw] : null;
}

export function macroContextOrDefault(value: string | string[] | null | undefined): MacroWorkbenchContext {
  return macroContextFromParam(value) ?? MACRO_CONTEXTS[DEFAULT_MACRO_CONTEXT_ID];
}

export function macroContextIdForPreset(presetId: string | null | undefined): MacroContextId {
  if (presetId === "activity") return "activity";
  if (presetId === "liquidity") return "risk-liquidity";
  return DEFAULT_MACRO_CONTEXT_ID;
}
