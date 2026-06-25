import type { Article, Issue } from "./types";

export const ISSUES: Issue[] = [
  {
    id: 142, slug: "2025-08-24_nvda-cycle",
    date: "2025-08-24", dateLabel: "2025년 8월 24일 (일)",
    monthKey: "2025-08", monthLabel: "2025년 8월", tag: "이번 호",
    kicker: "AI 사이클의 변곡",
    headline: "엔비디아 실적 전망과 반도체 사이클의 두 갈래길",
    dek: "Q2 가이드가 무엇이든 사이클은 이미 갈라졌다. 데이터센터·게이밍 두 곡선을 따로 읽어야 한다.",
    readMin: 8,
    tags: ["반도체", "IT", "실적 시즌", "엔비디아"],
    picks: [
      { kind: "institution", ticker: "NVDA", name: "엔비디아", note: "TP $210" },
      { kind: "value", ticker: "JPM", name: "JP모건", note: "P/E 12.8x" },
      { kind: "momentum", ticker: "GE", name: "GE", note: "YTD +62.5%" },
    ],
    cover: { tone: "navy", accent: "var(--fnk-brand-navy)", pattern: "data", spark: [8,11,9,14,12,17,15,22,20,28,26,34] },
  },
  {
    id: 141, slug: "2025-08-17_pltr", date: "2025-08-17", dateLabel: "2025-08-17",
    monthKey: "2025-08", monthLabel: "2025년 8월",
    kicker: "모멘텀 셋업", headline: "PLTR · AI 플랫폼 수요의 곡선",
    dek: "정부·기업 신규 계약이 분기마다 두 자릿수 증가. 헬스케어 디펜시브로 JNJ 페어링.",
    readMin: 7, tags: ["소프트웨어", "모멘텀", "AI 플랫폼"],
    picks: [
      { kind: "momentum", ticker: "PLTR", name: "팔란티어", note: "+18% MoM" },
      { kind: "value", ticker: "JNJ", name: "존슨앤존슨", note: "배당 3.2%" },
      { kind: "institution", ticker: "AAPL", name: "애플", note: "TP $230" },
    ],
    cover: { tone: "blue", accent: "var(--fnk-brand-interactive)", pattern: "gradient", spark: [12,13,11,15,18,17,21,24,23,26,28,30] },
  },
  {
    id: 140, slug: "2025-08-10_energy", date: "2025-08-10", dateLabel: "2025-08-10",
    monthKey: "2025-08", monthLabel: "2025년 8월",
    kicker: "섹터 회전", headline: "에너지 vs. 유틸리티 — 디스카운트의 끝",
    dek: "장기금리 안정 시 유틸리티 디스카운트가 좁혀진다. XOM/NEE 페어 트레이드 진입 시점.",
    readMin: 6, tags: ["에너지", "유틸리티", "섹터 회전"],
    picks: [
      { kind: "value", ticker: "XOM", name: "엑손모빌", note: "배당 3.6%" },
      { kind: "momentum", ticker: "NEE", name: "넥스트에라", note: "+9% YTD" },
      { kind: "institution", ticker: "CVX", name: "쉐브론", note: "TP $172" },
    ],
    cover: { tone: "gold", accent: "var(--fnk-brand-gold)", pattern: "minimal", spark: [20,18,17,19,22,21,18,15,16,18,20,22] },
  },
  {
    id: 139, slug: "2025-08-03_banks", date: "2025-08-03", dateLabel: "2025-08-03",
    monthKey: "2025-08", monthLabel: "2025년 8월",
    kicker: "금융 디펜시브", headline: "장기금리 안정 시나리오와 은행주",
    dek: "순이자마진 컴프레션 우려는 이미 가격에 반영. JPM·BAC 의 CET1 자본 비율이 안전마진.",
    readMin: 7, tags: ["금융", "은행", "금리"],
    picks: [
      { kind: "value", ticker: "JPM", name: "JP모건", note: "P/E 12.8x" },
      { kind: "momentum", ticker: "BAC", name: "뱅크오브아메리카", note: "+11% QoQ" },
      { kind: "institution", ticker: "GS", name: "골드만삭스", note: "TP $480" },
    ],
    cover: { tone: "navy", accent: "var(--fnk-brand-navy)", pattern: "data", spark: [10,11,12,12,13,15,14,16,17,18,18,19] },
  },
  {
    id: 138, slug: "2025-07-27_big-tech", date: "2025-07-27", dateLabel: "2025-07-27",
    monthKey: "2025-07", monthLabel: "2025년 7월",
    kicker: "실적 시즌", headline: "대형 IT 어닝 — 컨센서스의 변곡",
    dek: "구글 클라우드 가속과 메타 광고 회복. 다음 분기 가이드를 누가 끌어올릴까.",
    readMin: 8, tags: ["빅테크", "실적", "광고", "클라우드"],
    picks: [
      { kind: "value", ticker: "GOOGL", name: "알파벳", note: "P/E 22x" },
      { kind: "momentum", ticker: "NVDA", name: "엔비디아", note: "+24% MoM" },
      { kind: "institution", ticker: "META", name: "메타", note: "TP $640" },
    ],
    cover: { tone: "blue", accent: "var(--fnk-brand-interactive)", pattern: "data", spark: [14,15,17,16,19,22,21,24,26,28,27,30] },
  },
  {
    id: 137, slug: "2025-07-20_jnj", date: "2025-07-20", dateLabel: "2025-07-20",
    monthKey: "2025-07", monthLabel: "2025년 7월",
    kicker: "헬스 디펜시브", headline: "JNJ — 안정 배당의 테마",
    dek: "글로벌 헬스케어 사이클 후반. JNJ의 R&D 파이프라인이 다음 12개월을 정의한다.",
    readMin: 5, tags: ["헬스케어", "배당", "디펜시브"],
    picks: [
      { kind: "value", ticker: "JNJ", name: "존슨앤존슨", note: "배당 3.2%" },
      { kind: "momentum", ticker: "PLTR", name: "팔란티어", note: "+18% MoM" },
      { kind: "institution", ticker: "AAPL", name: "애플", note: "TP $230" },
    ],
    cover: { tone: "gold", accent: "var(--fnk-brand-gold)", pattern: "gradient", spark: [6,7,7,8,8,9,9,10,10,10,11,11] },
  },
  {
    id: 136, slug: "2025-07-14_semis", date: "2025-07-14", dateLabel: "2025-07-14",
    monthKey: "2025-07", monthLabel: "2025년 7월",
    kicker: "반도체 사이클", headline: "AI 반도체 시장의 변화 — 메모리, 패키징, 전력",
    dek: "데이터센터 전력 제약이 사이클의 다음 페이지를 연다. AMD·NVDA·AVGO의 3각.",
    readMin: 9, tags: ["반도체", "AI", "메모리"],
    picks: [
      { kind: "value", ticker: "AMD", name: "AMD", note: "EPS 회복" },
      { kind: "momentum", ticker: "NVDA", name: "엔비디아", note: "+24% MoM" },
      { kind: "institution", ticker: "AVGO", name: "브로드컴", note: "TP $1,950" },
    ],
    cover: { tone: "navy", accent: "var(--fnk-brand-navy)", pattern: "minimal", spark: [10,12,11,14,16,15,18,22,21,24,27,30] },
  },
  {
    id: 135, slug: "2025-07-07_fx", date: "2025-07-07", dateLabel: "2025-07-07",
    monthKey: "2025-07", monthLabel: "2025년 7월",
    kicker: "채권·통화", headline: "달러 인덱스와 신흥국 자금 흐름",
    dek: "DXY 105 지지의 의미. 한국·인도 시장으로의 자금 회귀 가능성.",
    readMin: 6, tags: ["채권", "통화", "신흥국"],
    picks: [
      { kind: "value", ticker: "BAC", name: "BoA", note: "+11% QoQ" },
      { kind: "momentum", ticker: "TLT", name: "장기채", note: "베타 0.8" },
      { kind: "institution", ticker: "EEM", name: "신흥국", note: "TP $48" },
    ],
    cover: { tone: "gold", accent: "var(--fnk-brand-gold)", pattern: "data", spark: [16,17,17,16,15,14,15,16,16,17,18,18] },
  },
];

export const FEATURED_ARTICLE: Article = {
  ...ISSUES[0],
  issueLabel: "ISSUE #142",
  chapters: [
    { id: "overview", kicker: "01 · 시장 요약", title: "연준 분열과 AI 사이클 — 시장이 두 개의 이야기를 동시에 읽다",
      paragraphs: [
        "이번 주 시장은 두 개의 분리된 이야기를 동시에 읽었다. 하나는 연준 위원들의 분열된 코멘트로 흔들린 금리 전망[[anchor:1]], 다른 하나는 엔비디아 실적을 앞두고 가속된 AI 사이클의 모멘텀이다.",
        "S&P 500은 주간 +0.4%[[anchor:2]] 상승했지만, 표면 밑에서는 섹터 간 격차가 컸다. 데이터센터 관련 반도체와 일부 금융주가 시장을 끌었고, 임의소비재·헬스케어는 약했다. VIX가 14.2까지 떨어진[[anchor:3]] 점은 위험 심리의 단순한 회복이라기보다, 다음 가이드를 기다리는 *유보의 평온*에 가깝다.",
      ]},
    { id: "sectors", kicker: "02 · 섹터 — IT와 에너지의 동시 상승", title: "두 갈래로 갈라진 사이클을 한 그림에서 본다",
      paragraphs: [
        "IT 섹터가 주간 +2.4%[[anchor:4]]로 11개 GICS 섹터 중 1위. 에너지가 +1.8%로 뒤를 잇고, 금융이 +0.9%로 3위. 반대로 임의소비재는 −1.3%로 가장 약했다. AI 사이클과 유가 안정이 동시에 작동했다는 점이 이번 주의 시그널이다.",
        "에너지의 강세는 단순 유가 반등이 아니다. 데이터센터 전력 수요와 유틸리티 캡엑스가 연결된, *AI 사이클의 두 번째 라운드*로 읽힌다.",
      ]},
    { id: "value-pick", kicker: "03 · 가치 — JPM", title: "JPM의 P/E 12.8x가 말하는 것",
      paragraphs: [
        "JPM은 이번 주 픽의 가치 축이다. 트레일링 P/E 12.8x[[anchor:5]], 배당 수익률 3.1%, CET1 자본비율 15.4%. 컨센서스 EPS가 향후 4개 분기 동안 0% 성장이라 가정해도, 현 PER은 역사적 평균보다 1 표준편차 낮다.",
      ]},
    { id: "momentum-pick", kicker: "04 · 모멘텀 — GE", title: "구조조정 이후의 GE — 수주 백로그와 YTD +62.5%",
      paragraphs: [
        "GE의 YTD +62.5%[[anchor:6]]는 단순 모멘텀이 아니다. GE Aerospace 분사 후 항공·에너지 수주 백로그가 분기마다 두 자릿수 증가. 자사주 매입과 부채 감축이 동시에 진행 중이며, FCF margin이 12% → 16%로 4%p 확대.",
      ]},
    { id: "institution-pick", kicker: "05 · 월스트리트 — NVDA", title: "엔비디아에 대한 IB 컨센서스 — 평균 TP $210",
      paragraphs: [
        "NVDA에 대한 주요 IB 12곳의 평균 12개월 TP는 $210, 현재가 대비 +18% 상단[[anchor:7]]. 가장 보수적인 골드만삭스 $185부터 가장 공격적인 웨드부시 $260까지 분포. 컨센서스 EPS는 FY26 $4.85 → FY27 $6.10 (+25%).",
      ]},
    { id: "catalysts", kicker: "06 · 다음 주 캐털리스트", title: "실적 + FOMC + 잭슨홀 — 한 주의 세 가지 변곡점",
      paragraphs: [
        "8/28 NVDA 실적 발표 (장 마감 후). 8/29 PCE 디플레이터 발표. 9/2 잭슨홀 심포지엄. 한 주에 세 가지 시그널이 겹친다.",
      ]},
  ],
  anchors: [
    { id: 1, kicker: "10Y 미국채", sym: "US10Y", value: "4.18%", delta: "+2bp", tone: "warn", meta: "주간 거의 보합 · 연준 코멘트 대기", spark: [8,7,8,9,9,8,9,10,10,9,10,11] },
    { id: 2, kicker: "S&P 500", sym: "SPX", value: "5,612", delta: "+0.42%", tone: "up", meta: "주간 변동률", spark: [10,11,10,12,11,13,14,13,15,14,16,18] },
    { id: 3, kicker: "변동성", sym: "VIX", value: "14.2", delta: "−3.1%", tone: "up", meta: "유보의 평온 · 옵션 IV 동시 하락", spark: [22,21,19,18,17,17,16,15,15,14,14,14] },
    { id: 4, kicker: "IT 섹터", sym: "XLK", value: "+2.4%", delta: "WEEK", tone: "up", meta: "11개 GICS 섹터 1위", spark: [6,7,8,9,11,12,14,16,18,21,24,26] },
    { id: 5, kicker: "JPM PER", sym: "JPM", value: "12.8x", delta: "P/E", tone: "flat", meta: "배당 3.1% · CET1 15.4%", spark: [13,13,13,12,12,13,13,13,12,13,12,13] },
    { id: 6, kicker: "GE YTD", sym: "GE", value: "+62.5%", delta: "YTD", tone: "up", meta: "분사 후 백로그 두 자릿수", spark: [8,10,12,14,18,22,28,34,40,48,56,62] },
    { id: 7, kicker: "NVDA TP", sym: "NVDA", value: "$210", delta: "+18%", tone: "up", meta: "IB 12곳 평균", spark: [14,16,17,19,22,24,27,30,32,34,36,38] },
  ],
  related: [142, 138, 136],
};
