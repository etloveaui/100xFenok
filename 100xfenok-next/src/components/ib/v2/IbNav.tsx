"use client";

import type { Profile } from "./mockData";

type Props = {
  profile: Profile;
  onOpenPicker: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
};

export default function IbNav({ profile, onOpenPicker, onRefresh, isRefreshing }: Props) {
  return (
    <div className="ib-nav">
      <button className="ib-nav__back" aria-label="뒤로">
        <i className="fas fa-chevron-down" style={{ transform: "rotate(90deg)" }} aria-hidden="true" />
      </button>
      <div className="ib-nav__title">
        <div className="ib-nav__kicker">IB Helper</div>
        <button className="ib-nav__profile" onClick={onOpenPicker}>
          <span>
            {profile.name} · {profile.tickers.length}종목
          </span>
          <i className="fas fa-chevron-down" aria-hidden="true" />
        </button>
      </div>
      <div className="ib-nav__actions">
        <button className="ib-nav__icn" aria-label="새로고침" onClick={onRefresh} disabled={isRefreshing}>
          <i className={`fas fa-sync-alt${isRefreshing ? " fa-spin" : ""}`} aria-hidden="true" />
        </button>
        <button className="ib-nav__icn" aria-label="추가 메뉴">
          <i className="fas fa-bars" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
