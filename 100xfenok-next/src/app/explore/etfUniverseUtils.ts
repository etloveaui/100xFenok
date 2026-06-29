export interface EtfUniverseRecord {
  ticker?: string;
  name?: string;
  category?: string;
  assetClass?: string;
  issuer?: string;
  aum_raw?: string;
  aum?: number;
  expenseRatio?: string | number | null;
  expense_ratio?: number | null;
  dividendYield?: string | number | null;
  dividend_yield?: number | null;
  performance?: {
    tr1m?: number | null;
    trYTD?: number | null;
    tr1y?: number | null;
    cagr5y?: number | null;
    cagr10y?: number | null;
    cagrMAX?: number | null;
  } | null;
  inceptionDate?: string;
  price?: number;
  change?: number;
  volume?: number;
  holdings?: number;
  is_new?: boolean;
  classification?: EtfClassification;
  is_leveraged?: boolean;
  leverage_factor?: number | null;
  is_inverse?: boolean;
  is_single_stock?: boolean;
  underlying?: string | null;
}

export interface EtfClassification {
  is_leveraged?: boolean;
  leverage_factor?: number | null;
  is_inverse?: boolean;
  is_single_stock?: boolean;
  underlying?: string | null;
  source?: string;
  confidence?: string;
}

export type EtfTypeFilter = "전체" | "레버리지" | "단일종목 레버리지" | "인버스";

export const ETF_TYPE_PARAM: Record<EtfTypeFilter, string | null> = {
  "전체": null,
  "레버리지": "leveraged",
  "단일종목 레버리지": "single-stock",
  "인버스": "inverse",
};

export function cleanCategory(value: string | null | undefined): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text !== "-" ? text : "미분류";
}

export function issuerNameFromEtfName(value: string | null | undefined): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "-") return "미분류";
  const knownIssuers = [
    ["state street spdr", "State Street"],
    ["spdr", "State Street"],
    ["ishares", "iShares"],
    ["vanguard", "Vanguard"],
    ["invesco", "Invesco"],
    ["proshares", "ProShares"],
    ["direxion", "Direxion"],
    ["global x", "Global X"],
    ["jpmorgan", "JPMorgan"],
    ["fidelity", "Fidelity"],
    ["schwab", "Schwab"],
    ["goldman sachs", "Goldman Sachs"],
    ["first trust", "First Trust"],
    ["dimensional", "Dimensional"],
    ["vaneck", "VanEck"],
    ["ark", "ARK"],
    ["pimco", "PIMCO"],
  ] as const;
  const lower = text.toLowerCase();
  const known = knownIssuers.find(([prefix]) => lower.startsWith(prefix));
  if (known) return known[1];
  const dash = text.indexOf(" - ");
  if (dash > 0) return text.slice(0, dash).trim();
  const trust = text.match(/^(.+?\b(?:Trust|Funds?|Shares|ETF Trust|Exchange-Traded Funds Inc\.?))\b/i);
  if (trust?.[1]) return trust[1].trim();
  return text.split(/\s+/).slice(0, 2).join(" ").trim() || "미분류";
}

export function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ko-KR") : "—";
}

export function formatAum(row: EtfUniverseRecord): string {
  if (typeof row.aum_raw === "string" && row.aum_raw.trim() && row.aum_raw.trim() !== "-") return row.aum_raw.trim();
  const value = typeof row.aum === "number" && Number.isFinite(row.aum) ? row.aum : null;
  if (value === null) return "—";
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return value.toLocaleString("en-US");
}

export function asOfDate(value: string | null | undefined): string {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "—";
}

function formatPrice(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value >= 100 ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`;
}

function formatSignedPercent(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function percentPointsValue(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function expenseRatioValue(row: EtfUniverseRecord): number | null {
  return percentPointsValue(row.expense_ratio ?? row.expenseRatio);
}

export function formatPercentPointsValue(value: number | null | undefined, digits = 2): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value.toFixed(digits)}%`;
}

function formatCompactVolume(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("ko-KR");
}

function etfSearchText(row: EtfUniverseRecord): string {
  return [row.ticker, row.name, row.category, row.assetClass, row.issuer, row.inceptionDate, row.underlying, row.classification?.underlying].filter(Boolean).join(" ").toLowerCase();
}

function hasClassificationSignal(classification: EtfClassification): boolean {
  return (
    classification.is_leveraged === true ||
    classification.is_inverse === true ||
    classification.is_single_stock === true ||
    typeof classification.leverage_factor === "number" ||
    Boolean(classification.underlying?.trim())
  );
}

function classificationConfidence(classification: EtfClassification): string {
  return typeof classification.confidence === "string" ? classification.confidence.trim().toLowerCase() : "";
}

function shouldUseStoredClassification(classification: EtfClassification): boolean {
  if (hasClassificationSignal(classification)) return true;
  return classificationConfidence(classification) !== "low";
}

function flatRowClassification(row: EtfUniverseRecord): EtfClassification | null {
  if (
    typeof row.is_leveraged === "boolean" ||
    typeof row.is_inverse === "boolean" ||
    typeof row.is_single_stock === "boolean" ||
    typeof row.leverage_factor === "number" ||
    typeof row.underlying === "string"
  ) {
    return {
      is_leveraged: row.is_leveraged,
      leverage_factor: row.leverage_factor,
      is_inverse: row.is_inverse,
      is_single_stock: row.is_single_stock,
      underlying: row.underlying,
    };
  }
  return null;
}

function rowClassification(row: EtfUniverseRecord): EtfClassification | null {
  if (row.classification && typeof row.classification === "object") {
    return shouldUseStoredClassification(row.classification) ? row.classification : null;
  }
  return flatRowClassification(row);
}

export function isLeveragedEtf(row: EtfUniverseRecord): boolean {
  const classification = rowClassification(row);
  if (typeof classification?.is_leveraged === "boolean") return classification.is_leveraged;
  const text = etfSearchText(row);
  return (
    /\b(?:1\.25x|1\.5x|2x|3x|4x)\b/i.test(text) ||
    /\bleveraged\b/i.test(text) ||
    /\bultrapro\b/i.test(text) ||
    /\bmicrosectors\b.*\b3x\b/i.test(text) ||
    /\bdaily\b.*\b(?:bull|bear|target|long|short)\b/i.test(text) ||
    /\b(?:bull|bear|long|short)\b.*\b(?:2x|3x|daily)\b/i.test(text)
  );
}

export function isSingleStockLeveragedEtf(row: EtfUniverseRecord): boolean {
  const classification = rowClassification(row);
  if (typeof classification?.is_single_stock === "boolean") return classification.is_single_stock;
  if (!isLeveragedEtf(row)) return false;
  const text = etfSearchText(row);
  return (
    /\bsingle[- ]stock\b/i.test(text) ||
    /\b(?:long|short)\s+[A-Z]{1,6}\s+daily\s+ETF\b/i.test(text) ||
    /\b[1-9](?:\.\d+)?x\s+(?:long|short)\s+[A-Z]{1,6}\b/i.test(text) ||
    /\b(?:aapl|apple|nvda|nvidia|tsla|tesla|amd|amzn|amazon|msft|microsoft|meta|googl?|google|coin|coinbase|mstr|microstrategy|pltr|palantir|smci|super micro|avgo|broadcom|mu|nflx|netflix|hood|arm|intc|baba|aal|aaoi|abnb)\b/i.test(text)
  );
}

export function isInverseEtf(row: EtfUniverseRecord): boolean {
  const classification = rowClassification(row);
  if (typeof classification?.is_inverse === "boolean") return classification.is_inverse;
  const text = etfSearchText(row);
  return /\b(?:inverse|bear)\b/i.test(text) || /\bproshares\s+ultrashort\b/i.test(text);
}

export function formatTypeHint(
  row: EtfUniverseRecord,
  { includeTicker = true }: { includeTicker?: boolean } = {},
): string {
  const classification = rowClassification(row);
  const category = row.category ?? row.assetClass;
  const parts = includeTicker ? [row.ticker, category] : [category];
  if (row.issuer && row.issuer !== "미분류") {
    parts.push(row.issuer);
  }
  const factor = classification?.leverage_factor;
  if (typeof factor === "number" && Number.isFinite(factor)) {
    parts.push(`${factor.toFixed(factor % 1 === 0 ? 0 : 2)}x`);
  } else if (isLeveragedEtf(row)) {
    parts.push("레버리지");
  }
  const singleStock = classification?.is_single_stock || isSingleStockLeveragedEtf(row);
  if (singleStock) {
    parts.push(classification?.underlying ? `단일종목 레버리지 ${classification.underlying}` : "단일종목 레버리지");
  }
  if (classification?.is_inverse || isInverseEtf(row)) {
    parts.push("인버스");
  }
  if (row.is_new) {
    parts.push(row.inceptionDate ? `신규 상장 ${row.inceptionDate}` : "신규 상장");
  }
  const price = formatPrice(row.price);
  const change = formatSignedPercent(row.change);
  const volume = formatCompactVolume(row.volume);
  if (price) parts.push(`가격 ${price}`);
  if (change) parts.push(`변동률 ${change}`);
  if (volume) parts.push(`거래량 ${volume}`);
  const expenseRatio = formatPercentPointsValue(expenseRatioValue(row));
  if (expenseRatio) parts.push(`보수 ${expenseRatio}`);
  const oneYearReturn = formatSignedPercent(row.performance?.tr1y ?? null);
  if (oneYearReturn) parts.push(`1년 ${oneYearReturn}`);
  if (typeof row.holdings === "number" && Number.isFinite(row.holdings)) {
    parts.push(`보유 ${formatNumber(row.holdings)}`);
  }
  return parts.filter(Boolean).join(" · ");
}

export function etfClassificationLabels(row: EtfUniverseRecord): string[] {
  const classification = rowClassification(row);
  if (!classification) return [];
  const labels: string[] = [];
  if (classification.is_leveraged) {
    labels.push(
      typeof classification.leverage_factor === "number" && Number.isFinite(classification.leverage_factor)
        ? `${classification.leverage_factor}x 레버리지`
        : "레버리지",
    );
  }
  if (classification.is_inverse) labels.push("인버스");
  if (classification.is_single_stock) {
    labels.push(classification.underlying ? `단일종목 레버리지 ${classification.underlying}` : "단일종목 레버리지");
  } else if (classification.underlying) {
    labels.push(`기초 ${classification.underlying}`);
  }
  return labels;
}
