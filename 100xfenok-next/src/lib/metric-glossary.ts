export const METRIC_GLOSSARY = {
  fy1: {
    label: "FY+1",
    description: "다음 회계연도에 시장이 예상하는 수치입니다.",
  },
  fy2: {
    label: "FY+2",
    description: "2년 뒤 회계연도에 시장이 예상하는 수치입니다.",
  },
  fy3: {
    label: "FY+3",
    description: "3년 뒤 회계연도에 시장이 예상하는 수치입니다.",
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
