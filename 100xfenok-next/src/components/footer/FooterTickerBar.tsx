'use client';

import { useState, useEffect } from 'react';

type FooterMarketStatus = 'regular' | 'pre' | 'after' | 'overnight' | 'closed';
type FooterTickerItem = {
  symbol: string;
  price: number;
  changePercent: number;
  marketState: string;
  source: 'live' | 'fallback';
};

type FooterTickerQuotePayload = {
  price?: number;
  changePercent?: number;
  marketState?: string;
};

const FOOTER_TICKER_CATALOG = [
  { symbol: 'SPY', fallbackPrice: 672.38, fallbackChangePercent: -1.98 },
  { symbol: 'QQQ', fallbackPrice: 589.5, fallbackChangePercent: -2.11 },
  { symbol: 'IWM', fallbackPrice: 212.44, fallbackChangePercent: -1.37 },
  { symbol: 'DIA', fallbackPrice: 436.22, fallbackChangePercent: -1.12 },
] as const;

function getDefaultFooterTickerItems(): FooterTickerItem[] {
  return FOOTER_TICKER_CATALOG.map((item) => ({
    symbol: item.symbol,
    price: item.fallbackPrice,
    changePercent: item.fallbackChangePercent,
    marketState: 'BASE',
    source: 'fallback',
  }));
}

function formatTickerPrice(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatTickerChange(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function getTickerStateLabel(rawState: string, fallbackStatus: FooterMarketStatus): string {
  const normalized = rawState.trim().toUpperCase();
  if (normalized.includes('REGULAR')) return 'LIVE';
  if (normalized.includes('PRE')) return 'PRE';
  if (normalized.includes('POST') || normalized.includes('AFTER')) return 'POST';
  if (normalized.includes('CLOSED')) return 'CLOSED';

  if (fallbackStatus === 'regular') return 'LIVE';
  if (fallbackStatus === 'pre') return 'PRE';
  if (fallbackStatus === 'after') return 'POST';
  return 'CLOSED';
}

type FooterTickerBarProps = {
  marketStatus: FooterMarketStatus;
  tickerLabel: string;
  statusLabel: string;
  statusClassName: string;
  onMarketStatusClick: () => void;
};

export default function FooterTickerBar({ marketStatus, tickerLabel, statusLabel, statusClassName, onMarketStatusClick }: FooterTickerBarProps) {
  const [tickerItems, setTickerItems] = useState<FooterTickerItem[]>(() => getDefaultFooterTickerItems());

  useEffect(() => {
    let disposed = false;

    const loadTickerItems = async () => {
      const results = await Promise.allSettled(
        FOOTER_TICKER_CATALOG.map(async (item) => {
          const response = await fetch(`/api/ticker/${item.symbol}`, {
            method: 'GET',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const payload = (await response.json()) as FooterTickerQuotePayload;
          return {
            symbol: item.symbol,
            price: typeof payload.price === 'number' ? payload.price : item.fallbackPrice,
            changePercent:
              typeof payload.changePercent === 'number'
                ? payload.changePercent
                : item.fallbackChangePercent,
            marketState:
              typeof payload.marketState === 'string' && payload.marketState.trim()
                ? payload.marketState
                : 'LIVE',
            source: 'live' as const,
          };
        }),
      );

      if (disposed) return;

      setTickerItems(
        FOOTER_TICKER_CATALOG.map((item, index) => {
          const result = results[index];
          if (result?.status === 'fulfilled') {
            return result.value;
          }
          return {
            symbol: item.symbol,
            price: item.fallbackPrice,
            changePercent: item.fallbackChangePercent,
            marketState: 'BASE',
            source: 'fallback' as const,
          };
        }),
      );
    };

    void loadTickerItems();
    const intervalId = window.setInterval(() => {
      void loadTickerItems();
    }, 60 * 1000);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const tickerTape = tickerItems.map((item) => (
    <span key={item.symbol} className="footer-ticker-item">
      <span className="footer-ticker-symbol">{item.symbol}</span>
      <span className="footer-ticker-price">{formatTickerPrice(item.price)}</span>
      <span className={`footer-ticker-change ${item.changePercent >= 0 ? 'is-up' : 'is-down'}`}>
        {formatTickerChange(item.changePercent)}
      </span>
      <span className="footer-ticker-state">{getTickerStateLabel(item.marketState, marketStatus)}</span>
    </span>
  ));

  return (
    <div className="hidden md:block bg-gradient-to-r from-brand-navy via-brand-interactive to-brand-navy glow-bar overflow-hidden">
      <div className="h-6 flex items-center px-4">
        <div className="flex items-center gap-1.5 flex-shrink-0 mr-3">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[9px] font-bold text-white uppercase">LIVE</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="ticker-scroll">
            <div className="footer-ticker-track" aria-label="실시간 가격 바">
              <span className="footer-ticker-lead">{tickerLabel}</span>
              {tickerTape}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onMarketStatusClick}
          className={`px-2.5 py-1 rounded text-white text-[10px] font-bold tracking-wide shadow-sm transition-all duration-200 hover:scale-105 hover:brightness-110 ml-3 flex-shrink-0 ${statusClassName}`}
          aria-label="Market Status"
        >
          {statusLabel}
        </button>
      </div>
    </div>
  );
}
