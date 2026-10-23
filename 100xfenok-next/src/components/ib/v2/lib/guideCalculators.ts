// Preserve the formulas of ib/ib-total-guide-calculator.html and
// vr/vr-total-guide-calculator.html; these are manual guide calculators.
export type GuideTicker = "TQQQ" | "SOXL";
export type GuideOrder = { type: string; price: number; quantity: number };
export const starPercent = (ticker: GuideTicker, t: number) => ticker === "TQQQ" ? 10 - t / 2 : 12 - t * 0.6;

export function calculateIbGuide(ticker: GuideTicker, seed: number, invested: number, average: number, quantity: number) {
  if (![seed, invested, average, quantity].every(Number.isFinite) || seed <= 0 || average <= 0 || invested < 0 || quantity < 0) {
    throw new Error("투자금과 평단가는 0보다 커야 하고, 누적매수금과 수량은 0 이상이어야 합니다.");
  }
  const oneTimeBuy = seed / 40;
  const t = Math.ceil(invested / oneTimeBuy * 10) / 10;
  const star = starPercent(ticker, t);
  const starPrice = average * (1 + star / 100);
  const target = ticker === "TQQQ" ? 10 : 12;
  const buy: GuideOrder[] = [];
  let spent = 0;
  if (t < 20) {
    const count = Math.floor(oneTimeBuy / 2 / average);
    buy.push({ type: "평단LOC 매수", price: average, quantity: count });
    spent += count * average;
  }
  if (starPrice - 0.01 > 0) {
    const price = starPrice - 0.01;
    const count = Math.floor(oneTimeBuy / (t < 20 ? 2 : 1) / price);
    buy.push({ type: "큰수LOC 매수", price, quantity: count });
    spent += count * price;
  }
  let remaining = oneTimeBuy - spent;
  // The legacy guide bases all five extra prices on the last rounded LOC price.
  const last = buy.length ? Number(buy[buy.length - 1].price.toFixed(4)) : average;
  for (let i = 0; i < 5; i++) {
    const price = last * (1 - (i + 1) * 0.015);
    if (remaining <= price || price <= 0) break;
    buy.push({ type: `하락대비 추가매수 ${i + 1}`, price, quantity: 1 });
    remaining -= price;
  }
  const quarter = Math.floor(quantity / 4);
  const sell: GuideOrder[] = [
    { type: "LOC 매도", price: starPrice, quantity: quarter },
    { type: `지정가 매도 (+${target}%)`, price: average * (1 + target / 100), quantity: quantity - quarter },
  ];
  return { t, oneTimeBuy, star, starPrice, buy, sell };
}

export type VrKind = "deposit" | "lump-sum" | "withdrawal";
export type VrInputs = { v1: number; pool: number; g: number; shares: number; poolLimit: number; orderQuantity: number; evaluation: number; movement: number };
export function calculateVrGuide(kind: VrKind, advanced: boolean, input: VrInputs) {
  const { v1, pool, g, shares, poolLimit, orderQuantity, evaluation, movement } = input;
  if (!Object.values(input).every(Number.isFinite) || g <= 0 || shares <= 0 || poolLimit < 0 || orderQuantity < 1) {
    throw new Error("입력값을 확인하세요. G·보유 수량·주문 수량은 0보다 커야 하고 Pool 사용한도는 0 이상이어야 합니다.");
  }
  const newV = v1 + pool / g + (advanced ? (evaluation - v1) / (2 * Math.sqrt(g)) : 0)
    + (kind === "deposit" ? movement : kind === "withdrawal" ? -movement : 0);
  const minBand = newV * 0.85, maxBand = newV * 1.15;
  const buy: { price: number; pool: number }[] = [], sell: { price: number; pool: number }[] = [];
  let used = 0, gained = 0;
  for (let i = 1; i <= 30; i++) {
    const price = minBand / (shares + i * orderQuantity), cost = price * orderQuantity;
    if (used + cost > pool * poolLimit / 100) break;
    used += cost;
    buy.push({ price, pool: used });
  }
  for (let i = 1; i <= 30; i++) {
    const before = shares - (i - 1) * orderQuantity;
    if (before <= 0) break;
    const price = maxBand / before;
    gained += price * orderQuantity;
    sell.push({ price, pool: pool + gained });
  }
  return { newV, minBand, maxBand, buy, sell, orderQuantity };
}

export type GuideQuote = { price: number; basis: string };
export async function fetchGuideQuote(ticker: GuideTicker, signal?: AbortSignal): Promise<GuideQuote> {
  const response = await fetch(`/api/ticker/${ticker}/`, { headers: { Accept: "application/json" }, cache: "no-store", signal });
  if (!response.ok) throw new Error("시세를 불러오지 못했습니다.");
  const data = await response.json();
  const price = Number(data?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("시세를 불러오지 못했습니다.");
  const asOf = data.state?.asOf ? new Date(data.state.asOf) : null;
  const label = data.marketState === "PRE" && data.preMarket === data.price ? "장전 거래가 · 직전 정규장"
    : data.marketState === "POST" && data.postMarket === data.price ? "장후 거래가 · 직전 정규장" : "시세 기준";
  const basis = asOf && Number.isFinite(asOf.getTime())
    ? `${label} ${asOf.toLocaleString("sv-SE", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} 미 동부시간`
    : "시세 기준시각 없음";
  return { price, basis: basis + (data.state?.quoteStatus === "live" ? "" : " · 지연 시세") };
}
