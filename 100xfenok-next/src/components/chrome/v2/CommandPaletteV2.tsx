"use client";

import { useEffect, useState } from "react";
import { v2cx } from "@/components/dashboard/v2/types";

type PaletteItem = {
  group: string;
  icon: string;
  ticker: string;
  name: string;
};

const PALETTE_ITEMS: PaletteItem[] = [
  { group: "티커", icon: "fa-chart-line", ticker: "SPY", name: "S&P 500 ETF" },
  { group: "티커", icon: "fa-chart-line", ticker: "QQQ", name: "Nasdaq 100 ETF" },
  { group: "티커", icon: "fa-chart-line", ticker: "VIX", name: "Volatility Index" },
  { group: "티커", icon: "fa-chart-line", ticker: "BTC", name: "Bitcoin" },
  { group: "리포트", icon: "fa-file-alt", ticker: "IB", name: "IB Helper · 무한매수" },
  { group: "리포트", icon: "fa-file-alt", ticker: "MKT", name: "Market Brief · 주간" },
  { group: "리포트", icon: "fa-file-alt", ticker: "ALPHA", name: "Alpha Scout · 종목 분석" },
  { group: "페이지", icon: "fa-compass", ticker: "RADAR", name: "Market Radar" },
  { group: "페이지", icon: "fa-compass", ticker: "VR", name: "Value Rebalancing" },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function CommandPaletteV2({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  const filtered = query.trim()
    ? PALETTE_ITEMS.filter((item) =>
        `${item.ticker} ${item.name}`.toLowerCase().includes(query.toLowerCase()),
      )
    : PALETTE_ITEMS;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIdx((idx) => Math.min(filtered.length - 1, idx + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIdx((idx) => Math.max(0, idx - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered.length, onClose]);

  if (!open) return null;

  const groups: Record<string, PaletteItem[]> = {};
  filtered.forEach((item) => {
    (groups[item.group] ||= []).push(item);
  });

  let runningIdx = -1;

  return (
    <div className="hp-cmd-backdrop" onClick={onClose} role="presentation">
      <div className="hp-cmd" onClick={(event) => event.stopPropagation()}>
        <div className="hp-cmd__input">
          <i className="fas fa-search" aria-hidden="true" />
          <input
            autoFocus
            placeholder="티커, 리포트, 메뉴를 검색…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIdx(0);
            }}
            aria-label="명령어 팔레트 검색"
          />
          <span className="hp-cmd__esc">ESC</span>
        </div>
        <div className="hp-cmd__list" role="listbox">
          {Object.entries(groups).map(([group, list]) => (
            <div key={group}>
              <div className="hp-cmd__group">{group}</div>
              {list.map((item) => {
                runningIdx += 1;
                const isActive = runningIdx === activeIdx;
                return (
                  <div
                    key={`${item.ticker}-${item.name}`}
                    className={v2cx("hp-cmd__item", isActive && "is-active")}
                    role="option"
                    aria-selected={isActive}
                  >
                    <i className={`fas ${item.icon}`} aria-hidden="true" />
                    <span className="hp-cmd__item-ticker">{item.ticker}</span>
                    <span className="hp-cmd__item-name">{item.name}</span>
                    {isActive ? (
                      <i
                        className="fas fa-arrow-right"
                        style={{ fontSize: 10 }}
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 ? (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                color: "var(--hp-ink-3)",
                fontSize: 12,
              }}
            >
              검색 결과 없음
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
