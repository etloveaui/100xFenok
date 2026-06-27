const PRICE_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 1000;

export const IB_PRICE_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbz2oCTIJyMFyAKUqoaZfcHMDz46rUEcSNFXnq2VDnXIKsdJcUl4oQQT6_FHRoeDyQAA/exec";

export type IbPriceQuote = {
  ticker: string;
  price: number;
  source: string;
  rawSource: string;
  cached: boolean;
  fetchedAt: string;
};

type CacheEntry = {
  quote: IbPriceQuote;
  time: number;
};

type JsonpWindow = Window &
  typeof globalThis & {
    [key: string]: ((data: unknown) => void) | unknown;
  };

const cache = new Map<string, CacheEntry>();

function normalizeTicker(ticker: string): string {
  return String(ticker || "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9._-]/g, "")
    .slice(0, 16);
}

function readPrice(payload: unknown): { price: number; rawSource: string } {
  const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const rawPrice = data.current ?? data.price;
  const price = typeof rawPrice === "number" ? rawPrice : parseFloat(String(rawPrice ?? ""));
  const rawSource = typeof data.priceSource === "string" ? data.priceSource : "REGULAR";

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("invalid price payload");
  }

  return { price, rawSource };
}

function fetchJsonp(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("JSONP unavailable outside browser"));
  }

  return new Promise((resolve, reject) => {
    const callbackName = `jsonp_cb_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const runtimeWindow = window as JsonpWindow;
    let script: HTMLScriptElement | null = null;
    let settled = false;

    const cleanup = () => {
      if (script?.parentNode) {
        script.parentNode.removeChild(script);
      }
      delete runtimeWindow[callbackName];
    };

    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("JSONP request timeout"));
    }, timeoutMs);

    runtimeWindow[callbackName] = (data: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();
      resolve(data);
    };

    script = document.createElement("script");
    script.src = `${url}${url.includes("?") ? "&" : "?"}callback=${callbackName}`;
    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();
      reject(new Error("JSONP script load error"));
    };

    document.body.appendChild(script);
  });
}

export async function getIbLivePrice(ticker: string): Promise<IbPriceQuote> {
  const symbol = normalizeTicker(ticker);
  if (!symbol) throw new Error("invalid ticker");

  const now = Date.now();
  const cached = cache.get(symbol);
  if (cached && now - cached.time < PRICE_CACHE_TTL_MS) {
    return {
      ...cached.quote,
      cached: true,
      source: `CACHE:${cached.quote.rawSource}`,
    };
  }

  const payload = await fetchJsonp(`${IB_PRICE_WEBAPP_URL}?ticker=${encodeURIComponent(symbol)}`);
  const { price, rawSource } = readPrice(payload);
  const quote: IbPriceQuote = {
    ticker: symbol,
    price,
    rawSource,
    source: `WEBAPP:${rawSource}`,
    cached: false,
    fetchedAt: new Date().toISOString(),
  };

  cache.set(symbol, { quote, time: now });
  return quote;
}

export async function getIbLivePrices(tickers: string[]): Promise<Record<string, IbPriceQuote | null>> {
  const unique = Array.from(new Set(tickers.map(normalizeTicker).filter(Boolean)));
  const entries = await Promise.all(
    unique.map(async (ticker) => {
      try {
        return [ticker, await getIbLivePrice(ticker)] as const;
      } catch {
        return [ticker, null] as const;
      }
    }),
  );

  return Object.fromEntries(entries);
}
