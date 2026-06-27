import type { Profile } from "../mockData";

const PROFILE_STORAGE_KEY = "ib_profiles";
const DAILY_STORAGE_KEY = "ib_daily_data";

export type IbV1AdditionalBuySettings = {
  enabled?: boolean;
  mode?: "budget_ratio" | "fixed" | string;
  budgetRatio?: number | string;
  allowOneOver?: boolean;
  deadZoneGuardEnabled?: boolean;
  maxDecline?: number | string;
  quantity?: number | string;
  orderCount?: number | string;
};

export type IbV1Stock = {
  symbol?: string;
  principal?: number | string;
  divisions?: number | string;
  sellPercent?: number | string;
  locSellPercent?: number | string;
  enabled?: boolean;
};

export type IbV1Profile = {
  id?: string;
  name?: string;
  accountNumber?: string;
  settings?: {
    method?: string;
    splits?: number | string;
    sellRatio?: number | string;
    partialSellRatio?: number | string;
    additionalBuy?: IbV1AdditionalBuySettings;
    balance?: {
      available?: number | string;
      currency?: string;
      commissionRate?: number | string;
    };
  };
  stocks?: IbV1Stock[];
};

export type IbV1ProfileStore = {
  version?: string;
  activeProfileId?: string | null;
  profiles?: Record<string, IbV1Profile>;
};

export type IbV1DailyData = {
  totalInvested: number;
  holdings: number;
  currentPrice?: number;
  date?: string;
  timestamp?: string;
};

export type IbV1ProfileReadResult = {
  store: IbV1ProfileStore | null;
  profiles: IbV1Profile[];
  activeProfile: IbV1Profile | null;
  activeProfileId: string | null;
  error: string | null;
};

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function sanitizeSymbol(symbol: unknown): string {
  return String(symbol ?? "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9._-]/g, "")
    .slice(0, 16);
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeProfileEntries(store: IbV1ProfileStore | null): IbV1Profile[] {
  if (!store?.profiles || typeof store.profiles !== "object") return [];

  return Object.entries(store.profiles)
    .map(([id, profile]) => ({ ...profile, id: profile?.id || id }))
    .filter((profile) => Boolean(profile.id));
}

export function readIbV1Profiles(): IbV1ProfileReadResult {
  if (!canUseLocalStorage()) {
    return {
      store: null,
      profiles: [],
      activeProfile: null,
      activeProfileId: null,
      error: "localStorage unavailable",
    };
  }

  const store = safeJsonParse<IbV1ProfileStore>(window.localStorage.getItem(PROFILE_STORAGE_KEY));
  if (!store || !store.profiles || typeof store.profiles !== "object") {
    return {
      store: null,
      profiles: [],
      activeProfile: null,
      activeProfileId: null,
      error: "ib_profiles missing or invalid",
    };
  }

  const profiles = normalizeProfileEntries(store);
  const activeProfileId = store.activeProfileId || profiles[0]?.id || null;
  const activeProfile = activeProfileId
    ? profiles.find((profile) => profile.id === activeProfileId) || null
    : null;

  return {
    store,
    profiles,
    activeProfile,
    activeProfileId,
    error: null,
  };
}

export function readIbDailyData(profileId: string, symbol: string): IbV1DailyData | null {
  if (!canUseLocalStorage()) return null;

  const safeProfileId = String(profileId || "").trim();
  const safeSymbol = sanitizeSymbol(symbol);
  if (!safeProfileId || !safeSymbol) return null;

  const key = `${DAILY_STORAGE_KEY}_${safeProfileId}_${safeSymbol}`;
  const raw = safeJsonParse<Record<string, unknown>>(window.localStorage.getItem(key));
  if (!raw) return null;

  return {
    totalInvested: toFiniteNumber(raw.totalInvested),
    holdings: parseInt(String(raw.holdings ?? ""), 10) || 0,
    currentPrice: toFiniteNumber(raw.currentPrice),
    date: typeof raw.date === "string" ? raw.date : undefined,
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : undefined,
  };
}

export function toIbV2Profile(profile: IbV1Profile): Profile {
  const stocks = Array.isArray(profile.stocks) ? profile.stocks : [];
  const tickers = stocks
    .filter((stock) => stock.enabled !== false)
    .map((stock) => sanitizeSymbol(stock.symbol))
    .filter(Boolean);

  const accountNumber = String(profile.accountNumber || "").trim();

  return {
    id: String(profile.id || "profile"),
    name: String(profile.name || profile.id || "IB Profile"),
    broker: accountNumber ? `IBKR ${accountNumber}` : "IBKR",
    tickers,
  };
}

export function getEnabledIbStocks(profile: IbV1Profile | null): IbV1Stock[] {
  const stocks = Array.isArray(profile?.stocks) ? profile.stocks : [];
  return stocks.filter((stock) => {
    const symbol = sanitizeSymbol(stock.symbol);
    const principal = toFiniteNumber(stock.principal);
    return Boolean(symbol) && stock.enabled !== false && principal > 0;
  });
}

export function normalizeIbNumber(value: unknown, fallback = 0): number {
  return toFiniteNumber(value, fallback);
}

export function normalizeIbSymbol(value: unknown): string {
  return sanitizeSymbol(value);
}
