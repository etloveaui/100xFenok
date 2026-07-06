export const METRIC_GLOSSARY = {
  fy1: {
    label: "내년(FY+1)",
    description: "다음 회계연도에 시장이 예상하는 수치입니다. 지금 실적이 아니라 1년 뒤 전망치를 뜻합니다.",
  },
  fy2: {
    label: "2년 후(FY+2)",
    description: "2년 뒤 회계연도에 시장이 예상하는 수치입니다.",
  },
  fy3: {
    label: "3년 후(FY+3)",
    description: "3년 뒤 회계연도에 시장이 예상하는 수치입니다.",
  },
  per: {
    label: "PER",
    description: "주가가 주당순이익의 몇 배인지 보여 주는 주가수익비율입니다. 값이 높을수록 이익 대비 비싸게 거래된다는 뜻입니다.",
  },
  pbr: {
    label: "PBR",
    description: "주가가 주당순자산(자기자본)의 몇 배인지 보여 주는 주가순자산비율입니다. 1배보다 낮으면 장부상 순자산보다 싸게 거래되는 상태입니다.",
  },
  eps: {
    label: "EPS",
    description: "1주가 벌어들인 순이익을 뜻하는 주당순이익입니다. 순이익을 발행 주식 수로 나눠 계산합니다.",
  },
  perBand: {
    label: "PER 밴드",
    description: "과거 PER이 오르내린 범위를 띠 형태로 보여 주는 그래프입니다. 현재 PER이 그 범위의 위쪽인지 아래쪽인지로 비싼지 싼지를 가늠합니다.",
  },
  opm: {
    label: "OPM",
    description: "매출에서 영업이익이 얼마나 남는지 보는 영업이익률입니다.",
  },
  gpm: {
    label: "GPM",
    description: "매출에서 매출원가를 뺀 뒤 남는 매출총이익 비율입니다.",
  },
  roe: {
    label: "ROE",
    description: "자기자본 대비 순이익률로, 자본을 얼마나 효율적으로 쓰는지 봅니다.",
  },
  evEbitda: {
    label: "EV/EBITDA",
    description: "기업가치가 EBITDA의 몇 배인지 보는 인수 관점 밸류에이션입니다.",
  },
  peg: {
    label: "PEG",
    description: "PER을 이익 성장률로 나눠 성장 대비 가격 부담을 보는 지표입니다.",
  },
  fwdPer: {
    label: "Fwd PER",
    description: "향후 12개월 또는 다음 회계연도 예상 이익 기준 PER입니다.",
  },
  dividendYield: {
    label: "배당수익률",
    description: "현재 주가 대비 연간 배당이 어느 정도인지 보는 비율입니다.",
  },
  consensus: {
    label: "컨센서스",
    description: "여러 증권사 애널리스트가 내놓은 실적 전망치의 평균입니다. 시장이 기대하는 눈높이로 볼 수 있습니다.",
  },
  revision: {
    label: "추정치 조정",
    description: "애널리스트들이 실적 전망치를 최근에 올렸는지 내렸는지를 나타냅니다. 상향이 이어지면 기대가 좋아지는 신호로 봅니다.",
  },
  guidance: {
    label: "가이던스",
    description: "회사가 직접 제시하는 향후 실적 전망입니다. 애널리스트 추정치와 비교하는 기준이 됩니다.",
  },
  conviction: {
    label: "컨빅션",
    description: "여러 신호를 종합했을 때 판단의 확신이 얼마나 강한지를 나타내는 정도입니다. 높을수록 근거가 서로 일치한다는 뜻입니다.",
  },
  coverage: {
    label: "커버리지",
    description: "종목을 판단하는 데 필요한 데이터가 얼마나 갖춰졌는지를 보여 주는 비율입니다. 낮으면 근거가 부족해 신뢰도가 떨어집니다.",
  },
  durability: {
    label: "내구 수익성",
    description: "지금의 수익성이 앞으로도 얼마나 오래 유지될 수 있는지를 보는 관점입니다. 재무 체력과 이익의 안정성을 함께 반영합니다.",
  },
  upsidePotential: {
    label: "상승 잠재력",
    description: "현재 가격 대비 앞으로 오를 여지가 상대적으로 얼마나 있는지를 나타냅니다. 확정된 예측이 아니라 종목 간 상대 비교값입니다.",
  },
  downsidePotential: {
    label: "하락 위험",
    description: "현재 가격에서 앞으로 떨어질 위험이 상대적으로 얼마나 큰지를 나타냅니다. 확정된 예측이 아니라 종목 간 상대 비교값입니다.",
  },
  marketSimilarity: {
    label: "동종군 유사도",
    description: "같은 업종의 대표 종목들과 주가가 얼마나 비슷하게 움직였는지를 나타냅니다. 높을수록 개별 재료보다 업종 흐름을 따라간다는 뜻입니다.",
  },
  momentum: {
    label: "모멘텀",
    description: "최근 주가가 오르는 힘 또는 내리는 힘이 얼마나 강한지를 나타냅니다. 추세의 방향과 세기를 함께 봅니다.",
  },
  factorTilt: {
    label: "팩터 틸트",
    description: "가치·성장·규모 같은 투자 성향 중 어느 쪽으로 기울어 있는지를 보여 줍니다. 종목의 성격을 분류하는 데 씁니다.",
  },
  occ: {
    label: "OCC 옵션 거래량",
    description: "미국 옵션청산회사(OCC)가 공개하는 옵션 거래량 데이터입니다. 콜·풋이 얼마나 거래됐는지를 집계한 수치입니다.",
  },
  finra: {
    label: "FINRA 데이터",
    description: "미국 금융산업규제청(FINRA)이 공개하는 장외·공매도 관련 데이터입니다. 거래소 밖에서 이뤄진 거래를 파악하는 데 씁니다.",
  },
  regSho: {
    label: "Reg SHO",
    description: "미국 증권거래위원회의 공매도 규제(Reg SHO)에 따라 집계·공개되는 공매도 데이터입니다. 결제 실패 종목 등을 확인할 수 있습니다.",
  },
  ohlcv: {
    label: "시가·고가·저가·종가·거래량",
    description: "하루 주가의 시가·고가·저가·종가와 거래량을 묶은 기본 시세 데이터(OHLCV)입니다. 대부분의 차트와 지표 계산의 바탕이 됩니다.",
  },
  thirteenF: {
    label: "13F 보유 공시",
    description: "운용 규모가 큰 기관투자자가 분기마다 제출하는 주식 보유 내역 공시(13F)입니다. 기관이 무엇을 사고팔았는지 엿볼 수 있습니다.",
  },
  gics: {
    label: "GICS 업종 분류",
    description: "종목을 산업별로 나누는 국제 표준 분류 체계(GICS)입니다. 같은 업종끼리 비교할 때 기준이 됩니다.",
  },
  shortInterest: {
    label: "공매도 잔고",
    description: "아직 되갚지 않고 남아 있는 공매도 물량입니다. 많을수록 주가 하락에 베팅한 자금이 크다는 뜻입니다.",
  },
  offExchange: {
    label: "장외 거래",
    description: "정규 거래소가 아닌 곳에서 체결된 거래입니다. 다크풀 등 거래소 밖 물량의 크기를 가늠하는 데 씁니다.",
  },
  putCallRatio: {
    label: "풋/콜 비율",
    description: "풋옵션 거래량을 콜옵션 거래량으로 나눈 값입니다. 높을수록 하락에 대비하는 심리가 강하다고 해석합니다.",
  },
  aum: {
    label: "운용자산(AUM)",
    description: "펀드나 ETF가 굴리는 전체 자산 규모입니다. 클수록 거래가 활발하고 상장폐지 위험이 낮은 편입니다.",
  },
  expenseRatio: {
    label: "총보수",
    description: "ETF나 펀드를 1년 보유할 때 부담하는 운용 비용 비율입니다. 낮을수록 장기 수익에 유리합니다.",
  },
  nav: {
    label: "순자산가치(NAV)",
    description: "ETF가 담고 있는 자산의 실제 가치를 1주 기준으로 계산한 값입니다. 시장 가격이 이 값과 크게 벌어지면 고평가·저평가로 봅니다.",
  },
  inceptionDate: {
    label: "설정일",
    description: "ETF나 펀드가 처음 만들어져 운용을 시작한 날짜입니다. 얼마나 오래 운용됐는지 확인하는 기준입니다.",
  },
  leveraged: {
    label: "레버리지",
    description: "기초 지수 하루 수익률의 배수(예: 2배)를 목표로 하는 상품입니다. 변동성이 크고 장기 보유에는 불리할 수 있습니다.",
  },
  inverse: {
    label: "인버스",
    description: "기초 지수가 내릴 때 이익이 나도록 반대로 설계된 상품입니다. 하락에 베팅하는 용도이며 장기 보유에는 불리할 수 있습니다.",
  },
  asOf: {
    label: "기준일",
    description: "표시된 수치가 어느 시점을 기준으로 집계됐는지를 뜻합니다. 데이터가 최신인지 판단하는 근거가 됩니다.",
  },
  drawdown: {
    label: "최대 낙폭",
    description: "고점 대비 주가가 가장 크게 떨어졌던 하락 폭입니다. 투자 중 감내해야 하는 손실 크기를 가늠하는 데 씁니다.",
  },
  marketCap: {
    label: "시가총액",
    description: "주가에 발행 주식 수를 곱한 회사 전체의 시장 가치입니다. 기업 규모를 비교하는 기본 잣대입니다.",
  },
  rsi: {
    label: "RSI",
    description: "최근 주가가 과하게 올랐는지 내렸는지를 0~100으로 나타내는 상대강도지수입니다. 통상 70 이상은 과열, 30 이하는 과매도로 봅니다.",
  },
  shortVolume: {
    label: "숏 볼륨",
    description: "하루 거래 중 공매도로 체결된 거래량입니다. 남아 있는 공매도 잔고와 달리 그날의 매도 압력을 봅니다.",
  },
  relativeStrength: {
    label: "상대 강도",
    description: "시장 지수(예: S&P500)와 비교해 개별 종목이 더 강하게 움직였는지를 나타냅니다. 높을수록 시장을 앞선다는 뜻입니다.",
  },
} as const;

export type MetricGlossaryKey = keyof typeof METRIC_GLOSSARY;

const KEY_HINTS: Array<[RegExp, MetricGlossaryKey]> = [
  [/fy1|fy\+1/i, "fy1"],
  [/fy2|fy\+2/i, "fy2"],
  [/fy3|fy\+3/i, "fy3"],
  [/operatingmargin|opm|영업이익률/i, "opm"],
  [/grossmargin|gpm|매출총이익률/i, "gpm"],
  [/returnonequity|roe/i, "roe"],
  [/enterprisetoebitda|ev\/ebitda/i, "evEbitda"],
  [/pegratio|peg/i, "peg"],
  [/forwardpe|peforward|fwd\s*per|forward\s*p\/?e|fy\+\d\s*per|선행\s*per/i, "fwdPer"],
  [/dividendyield|배당수익률|배당률|^배당$/i, "dividendYield"],
  [/\bper\b|주가수익비율/i, "per"],
  [/\bpbr\b|주가순자산/i, "pbr"],
  [/\beps\b|주당순이익/i, "eps"],
  [/perband|per\s*밴드|밸류에이션\s*밴드/i, "perBand"],
  [/consensus|컨센서스|시장\s*예상치/i, "consensus"],
  [/revision|리비전|추정치\s*조정|추정\s*변경/i, "revision"],
  [/guidance|가이던스|실적\s*가이드/i, "guidance"],
  [/conviction|컨빅션|확신도/i, "conviction"],
  [/coverage|커버리지|분석\s*범위/i, "coverage"],
  [/durability|내구\s*수익성|수익\s*지속/i, "durability"],
  [/upsidepotential|상승\s*잠재력|상방\s*잠재/i, "upsidePotential"],
  [/downsidepotential|하락\s*잠재력|하방\s*잠재|하락\s*위험/i, "downsidePotential"],
  [/marketsimilarity|동종군\s*유사|유사도/i, "marketSimilarity"],
  [/momentum|모멘텀/i, "momentum"],
  [/factortilt|팩터\s*틸트|팩터\s*기울/i, "factorTilt"],
  [/\bocc\b|옵션청산회사/i, "occ"],
  [/finra|금융산업규제청/i, "finra"],
  [/regsho|reg\s*sho|공매도\s*규정/i, "regSho"],
  [/ohlcv|시고저종/i, "ohlcv"],
  [/13f|13-f|기관\s*보유\s*공시/i, "thirteenF"],
  [/gics|업종\s*분류|산업\s*분류/i, "gics"],
  [/shortinterest|공매도\s*잔고/i, "shortInterest"],
  [/offexchange|off-exchange|장외\s*거래|장외거래/i, "offExchange"],
  [/put\/?call|putcall|풋콜|풋\/콜/i, "putCallRatio"],
  [/\baum\b|운용\s*자산|순자산\s*총액/i, "aum"],
  [/expenseratio|expense\s*ratio|보수율|총보수|운용보수/i, "expenseRatio"],
  [/\bnav\b|순자산\s*가치|기준가/i, "nav"],
  [/inception|설정일|상장일/i, "inceptionDate"],
  [/leverage|레버리지|배수형/i, "leveraged"],
  [/inverse|인버스|곱버스/i, "inverse"],
  [/as-?of|기준일|기준\s*시점|기준시각/i, "asOf"],
  [/drawdown|드로다운|최대\s*낙폭|낙폭/i, "drawdown"],
  [/marketcap|market\s*cap|시가총액|시총/i, "marketCap"],
  [/\brsi\b|상대강도지수/i, "rsi"],
  [/shortvolume|숏\s*볼륨|공매도\s*거래량/i, "shortVolume"],
  [/relativestrength|상대\s*강도/i, "relativeStrength"],
];

function glossaryKeysFor(value: string): MetricGlossaryKey[] {
  const normalized = value.replace(/[\s_-]+/g, "");
  const keys: MetricGlossaryKey[] = [];
  for (const [pattern, key] of KEY_HINTS) {
    if (pattern.test(value) || pattern.test(normalized)) keys.push(key);
  }
  return keys;
}

export function metricGlossaryEntries(label: string, metricKey?: string): Array<(typeof METRIC_GLOSSARY)[MetricGlossaryKey]> {
  const keys = [...glossaryKeysFor(metricKey ?? ""), ...glossaryKeysFor(label)];
  return [...new Set(keys)].map((key) => METRIC_GLOSSARY[key]);
}

export function metricGlossaryText(label: string, metricKey?: string): string | null {
  const entries = metricGlossaryEntries(label, metricKey);
  if (entries.length === 0) return null;
  return entries.map((entry) => `${entry.label}: ${entry.description}`).join(" ");
}
