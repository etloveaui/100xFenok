"use client";

import { v2cx } from "@/components/dashboard/v2/types";
import type { Profile } from "./mockData";

type Props = {
  open: boolean;
  profiles: Profile[];
  current: Profile;
  onPick: (next: Profile) => void;
  onClose: () => void;
};

export default function ProfileSheet({ open, profiles, current, onPick, onClose }: Props) {
  if (!open) return null;
  return (
    <>
      <div className="ib-psheet__backdrop" onClick={onClose} role="presentation" />
      <div className="ib-psheet" role="dialog" aria-label="계좌 프로파일 선택">
        <div className="ib-psheet__grip" aria-hidden="true" />
        <div className="ib-psheet__title">계좌 / 전략 프로파일</div>
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            className={v2cx("ib-psheet__row", current.id === p.id && "on")}
            onClick={() => {
              onPick(p);
              onClose();
            }}
          >
            <span className="ib-psheet__row__sym">{p.id}</span>
            <span className="ib-psheet__row__name">
              <b>{p.name}</b>
              <span>
                {p.broker} · {p.tickers.length ? p.tickers.join(" / ") : "종목 없음"}
              </span>
            </span>
            <span className="ib-psheet__row__num">{p.tickers.length}</span>
          </button>
        ))}
        <button type="button" className="ib-psheet__new">
          <i className="fas fa-arrow-right" style={{ marginRight: 6 }} aria-hidden="true" />
          V1에서 프로파일 관리
        </button>
      </div>
    </>
  );
}
