"use client";

import { toggleWatch, useWatchlist } from "@/lib/watchlist";

/** Star toggle for a ticker — watchlist add/remove (device-local). */
export default function WatchStar({ ticker, className = "" }: { ticker: string; className?: string }) {
  const list = useWatchlist();
  const on = list.includes(ticker.toUpperCase());

  return (
    <button
      type="button"
      onClick={() => toggleWatch(ticker)}
      aria-pressed={on}
      aria-label={on ? `${ticker} 관심종목 해제` : `${ticker} 관심종목 추가`}
      title={on ? "관심종목 해제" : "관심종목 추가"}
      className={`inline-flex min-h-9 min-w-9 items-center justify-center rounded-full border text-sm transition ${
        on
          ? "border-amber-300 bg-amber-50 text-amber-500"
          : "border-slate-200 bg-white text-slate-300 hover:border-amber-300 hover:text-amber-400"
      } ${className}`}
    >
      <i className={`${on ? "fas" : "far"} fa-star`} aria-hidden="true" />
    </button>
  );
}
