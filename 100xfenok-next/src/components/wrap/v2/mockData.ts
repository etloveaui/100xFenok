import type { ArchiveEntry, DailyWrap } from "./types";

export const WRAP_DATA: DailyWrap = {
  todayLabel: "2026-05-12 (화)",
  yesterdayLabel: "2026-05-11 (월)",
  regime: { label: "RISK-ON · 확산 안정", tone: "up", confidence: 72 },
  thesis: {
    headline:
      "지수는 횡보, 그러나 표면 아래에서는 섹터 로테이션이 다시 시작됐다",
    sub: "어제 SPY는 보합권에서 마감했지만, 반도체·은행·산업재가 동시에 5일 이평선 위로 올라오면서 폭(breadth)이 살아났다. VIX는 14p 밑에서 안정.",
    tags: ["BREADTH↑", "VIX 14p", "FED-WATCH", "EARNINGS-WK"],
  },
  yesterdayLine:
    "S&P 5,967 (-0.22%) · NASDAQ -0.43% · Russell +0.61% · 폭 확대 · VIX 14.2",
  todayLine:
    "PPI 08:30 ET · Powell speech 14:00 ET · NVDA·CSCO 실적 · 10Y 입찰",
  microAxes: [
    { label: "RISK-ON", value: 0.72, tone: "up", meta: "5일 평균 +6pt · 확산 중" },
    { label: "DAY Δ", value: -0.22, tone: "down", meta: "S&P 종가 기준" },
    { label: "VOL", value: 14.2, tone: "up", meta: "VIX · 30D 저점 근접" },
  ],
  chapters: [
    {
      kicker: "01 · OVERVIEW",
      title: "표면은 잠잠, 아래는 시끄럽다",
      paragraphs: [
        "어제 미국 증시는 지수 기준으로 보합권에 머물렀다. S&P 500은 -0.22%[[anchor:1]], 나스닥은 -0.43%로 사흘 만에 소폭 후퇴했지만, 같은 시간 Russell 2000은 +0.61% 마감하며 소형주가 대형주를 다시 한 번 앞질렀다. 표면 지수만 보면 별일 없는 하루였지만, 내부 구성은 명확히 바뀌고 있다.",
        "변동성 지표는 그 변화를 가장 빨리 반영했다. VIX는 14.20[[anchor:4]]까지 내려와 30일 저점 근처에 닿았고, MOVE 지수(채권 변동성)도 86으로 4월 평균 대비 12% 낮다. 다시 말해, 시장은 이번 주 인플레이션 지표(PPI·CPI)와 파월 발언을 앞두고 \"별일 안 일어난다\"에 베팅하고 있다.",
      ],
    },
    {
      kicker: "02 · BREADTH",
      title: "폭(Breadth)이 다시 살아났다",
      paragraphs: [
        "어제의 핵심 변화는 폭이다. S&P 500 종목 중 5일 이평 위에서 거래된 종목 비율이 62% → 71%[[anchor:2]]로 하루 만에 9%p 상승했다. 특히 반도체(81%)·은행(74%)·산업재(70%)가 동시에 70%선을 회복한 건 4월 이후 처음이다.",
        "이 신호가 의미 있는 이유는, 지난 3월부터 5월 초까지 상승의 70% 이상을 빅테크 7종목(\"Mag 7\")이 책임졌기 때문이다. 빅테크가 쉬는 동안 다른 섹터가 받쳐주는 그림 — 즉 로테이션이 작동하는 시장 — 이 4월 중순 이후 처음 관측됐다. 강세장의 건강함을 측정하는 가장 단순한 척도가 \"오를 때 같이 오르냐\"인데, 어제는 그 답이 \"그렇다\"였다.",
      ],
    },
    {
      kicker: "03 · RATES · CRYPTO",
      title: "10년물 4.38%, BTC는 다시 10만달러 위",
      paragraphs: [
        "채권은 차분했다. 10년물 금리는 4.38%[[anchor:3]]로 -0.5bp 마감, 이번 주 PPI(수요일)와 10년물 입찰(목요일)을 앞두고 시장은 포지션을 정리하는 중이다. 2-10 스프레드는 +18bp로 \"역전 해소\" 상태가 한 달째 이어진다.",
        "암호자산 쪽에서는 BTC가 $103,592[[anchor:5]]까지 회복하며 다시 10만달러 위에 자리 잡았다. ETF 누적 순유입은 5월 들어서만 $4.2B — 4월 전체(약 $1.9B)의 두 배를 한 주 만에 채웠다. 다만 펀딩비가 0.018%로 따뜻해지고 있어 단기적으로는 과열 구간에 진입 중이라는 점은 메모해 둘 만하다.",
      ],
    },
    {
      kicker: "04 · TODAY",
      title: "오늘 무엇을 볼 것인가",
      paragraphs: [
        "오늘 KST 21:30에 발표되는 4월 PPI는 컨센서스 +0.2% MoM, 코어 +0.3%이다. 만약 0.4% 이상으로 윗쪽 서프라이즈가 나오면 \"인플레이션 둔화 시나리오\"가 다시 흔들린다. 같은 날 KST 03:00에는 파월 의장이 \"노동시장과 금리\" 주제로 발언한다 — 9월 인하 확률(현재 68%)이 가장 민감하게 움직일 시간대다.",
        "기업 이벤트 쪽에서는 NVDA·CSCO 실적이 시간외에 나온다. NVDA는 5월 분기 가이던스가 핵심이며, 시장은 데이터센터 매출 +18% QoQ를 기본값으로 잡고 있다. 그 아래로 빠지면 반도체 섹터 로테이션이 어제 하루로 끝날 수도 있다. 폭이 살아난 첫날인 만큼, 오늘 NVDA 가이던스 한 줄에 이번 주 분위기가 갈린다.",
      ],
    },
  ],
  anchors: [
    { id: 1, kicker: "S&P 500", sym: "SPX", value: "5,967.84", delta: "-0.22%", tone: "down", meta: "5일선 +1.2% 상회 · 거래량 -8%", spark: [5980, 5975, 5972, 5985, 5990, 5978, 5980, 5967] },
    { id: 2, kicker: "BREADTH", sym: "5DMA>%", value: "71%", delta: "+9pp", tone: "up", meta: "반도체 81 · 은행 74 · 산업재 70", spark: [55, 58, 60, 59, 62, 62, 65, 71] },
    { id: 3, kicker: "10Y", sym: "US10Y", value: "4.38%", delta: "-0.5bp", tone: "up", meta: "2-10 스프레드 +18bp · 입찰 D-1", spark: [4.46, 4.44, 4.43, 4.42, 4.40, 4.39, 4.38, 4.38] },
    { id: 4, kicker: "VIX", sym: "VIX", value: "14.20", delta: "-1.07pt", tone: "up", meta: "30D 저점 · MOVE 86", spark: [16.8, 15.9, 15.4, 15.1, 14.9, 14.7, 14.5, 14.20] },
    { id: 5, kicker: "BTC", sym: "BTC", value: "$103,592", delta: "+0.27%", tone: "up", meta: "ETF 5월 유입 $4.2B · 펀딩 0.018%", spark: [98000, 99200, 100100, 101300, 102000, 102800, 103200, 103592] },
    { id: 6, kicker: "EARNINGS", sym: "NVDA", value: "$926", delta: "+1.1%", tone: "up", meta: "After-hours 가이던스 대기", spark: [890, 895, 900, 910, 915, 920, 922, 926] },
    { id: 7, kicker: "F&G", sym: "F&G", value: "56", delta: "+3", tone: "flat", meta: "NEUTRAL · 5일 이동평균 51", spark: [48, 49, 51, 52, 53, 54, 55, 56] },
  ],
  sections: [
    { id: "01", kicker: "EXEC SUMMARY", title: "Executive Summary", kpis: [{ k: "REGIME", v: "RISK-ON", tone: "up" }, { k: "CONF", v: "72%" }, { k: "SCORE", v: "+6" }], summary: "지수 보합에도 폭 확대 + VIX 안정으로 RISK-ON 판정. 5/8 신호가 양호 방향." },
    { id: "02", kicker: "MARKET PULSE", title: "Market Pulse", kpis: [{ k: "SPY", v: "-0.22%", tone: "down" }, { k: "QQQ", v: "-0.43%", tone: "down" }, { k: "IWM", v: "+0.61%", tone: "up" }], summary: "대형 보합·소형 강세. 로테이션 첫 날 — 5일선 위 비율 71%." },
    { id: "03", kicker: "MULTI-ASSET", title: "Multi-Asset Performance", kpis: [{ k: "DXY", v: "104.2", tone: "flat" }, { k: "OIL", v: "$78.1", tone: "down" }, { k: "GOLD", v: "$2,394", tone: "up" }], summary: "달러 보합, 유가 -1.4%, 금 +0.5%. 위험자산-안전자산 동반 상승의 의미." },
    { id: "04", kicker: "CORR · VOL", title: "Correlation & Volatility", kpis: [{ k: "VIX", v: "14.2", tone: "up" }, { k: "MOVE", v: "86", tone: "up" }, { k: "SKEW", v: "129" }], summary: "주식·채권 변동성 동반 하락. SKEW 129로 꼬리 리스크는 평년 수준." },
    { id: "05", kicker: "WALL STREET", title: "Wall Street Intelligence", kpis: [{ k: "GS", v: "6,200", tone: "up" }, { k: "MS", v: "5,950" }, { k: "BAC", v: "6,000" }], summary: "IB 연말 목표 컨센 5,950–6,200 유지. 어제 상향 4건 · 하향 1건." },
    { id: "06", kicker: "FLOWS", title: "Money Flows", kpis: [{ k: "ETF (5D)", v: "+$12B", tone: "up" }, { k: "BOND", v: "+$4.1B", tone: "up" }, { k: "BTC", v: "+$4.2B", tone: "up" }], summary: "주식·채권·BTC ETF 전 영역 순유입. 5월 누적 4월 전체 초과." },
    { id: "07", kicker: "SECTORS", title: "Sector Pulse", kpis: [{ k: "SEMI", v: "+1.2%", tone: "up" }, { k: "BANK", v: "+0.9%", tone: "up" }, { k: "ENERGY", v: "-1.6%", tone: "down" }], summary: "반도체·은행·산업재 동반 +. 에너지·유틸리티만 하락." },
    { id: "08", kicker: "TECH", title: "Tech Pulse", kpis: [{ k: "NVDA", v: "$926", tone: "up" }, { k: "AAPL", v: "$229", tone: "down" }, { k: "AMZN", v: "$203", tone: "up" }], summary: "NVDA 실적 대기 · AAPL -0.6% 약세 지속 · MSFT 신고가." },
    { id: "09", kicker: "CATALYSTS", title: "Today's Catalysts", kpis: [{ k: "PPI", v: "08:30 ET" }, { k: "POWELL", v: "14:00 ET" }, { k: "NVDA", v: "AH" }], summary: "오늘 3대 이벤트. PPI 컨센 +0.2% / 파월 노동·금리 / NVDA 데이터센터 가이던스." },
    { id: "10", kicker: "SIGNALS", title: "Signals · Watchlist", kpis: [{ k: "BUY", v: "3", tone: "up" }, { k: "WATCH", v: "5" }, { k: "AVOID", v: "2", tone: "down" }], summary: "신규 BUY 3건 (SMH, XLF, IWM), AVOID 2건 (XLE, USO). 상세는 Alpha Scout." },
    { id: "11", kicker: "APPENDIX", title: "Levels · S/R · 부록", kpis: [{ k: "SPX S", v: "5,920" }, { k: "SPX R", v: "6,010" }, { k: "BTC R", v: "$105k" }], summary: "S&P 지지 5,920 / 저항 6,010. BTC 저항 $105k. 일일 레벨 차트는 부록 참조." },
  ],
};

export const AVAILABLE_TAGS = [
  "BREADTH", "VIX", "FED", "EARNINGS", "CRYPTO", "RATES", "FLOWS", "SECTORS",
];

export const ARCHIVE_DATA: ArchiveEntry[] = [
  { date: "2026-05-12", title: "표면은 잠잠, 아래는 시끄럽다 — 폭 확대 첫 날", tags: ["BREADTH", "VIX", "EARNINGS"], dayDelta: -0.22 },
  { date: "2026-05-09", title: "Powell 청문회 — 9월 인하 확률 68% 안착", tags: ["FED", "RATES"], dayDelta: 0.41 },
  { date: "2026-05-08", title: "BTC 10만달러 재돌파 — ETF 일주일 $1.8B", tags: ["CRYPTO", "FLOWS"], dayDelta: 0.65 },
  { date: "2026-05-07", title: "반도체 약세 · 빅테크만 받친 하루", tags: ["SECTORS", "EARNINGS"], dayDelta: -0.31 },
  { date: "2026-05-06", title: "CPI 둔화 확인 — 채권 + 주식 동반 강세", tags: ["RATES", "FED"], dayDelta: 0.93 },
  { date: "2026-05-05", title: "월요일 슬립 — 매크로 이벤트 부재", tags: ["FLOWS"], dayDelta: 0.07 },
  { date: "2026-05-02", title: "고용 보고서 — 비농업 +175k 컨센 부합", tags: ["FED", "RATES"], dayDelta: 0.55 },
  { date: "2026-05-01", title: "FOMC — 동결, dot plot 변경 없음", tags: ["FED", "VIX"], dayDelta: 0.21 },
  { date: "2026-04-30", title: "월말 리밸런싱 매도세 · 폭 좁음", tags: ["FLOWS", "BREADTH"], dayDelta: -0.78 },
  { date: "2026-04-29", title: "META · GOOGL 실적 — AI 자본지출 가속", tags: ["EARNINGS", "SECTORS"], dayDelta: 0.34 },
  { date: "2026-04-28", title: "주간 시작 — VIX 16p 회귀", tags: ["VIX"], dayDelta: -0.12 },
  { date: "2026-04-25", title: "BTC $99k 저항 — ETF 자금 정체", tags: ["CRYPTO", "FLOWS"], dayDelta: 0.18 },
];
