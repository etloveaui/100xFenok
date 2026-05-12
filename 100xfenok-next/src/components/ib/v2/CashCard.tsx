"use client";

import { v2cx } from "@/components/dashboard/v2/types";
import Fresh from "./Fresh";
import { CASH_BASE, type AlertState, type Profile } from "./mockData";

type Props = {
  alertState: AlertState;
  skeleton?: boolean;
  profile: Profile;
};

export default function CashCard({ alertState, skeleton, profile }: Props) {
  const isWarn = alertState === "warn";
  const isBad = alertState === "margin-call";
  const cardCls = isBad ? "ib-card--bad" : isWarn ? "ib-card--warn" : "";
  const tone: "ok" | "warn" | "bad" = isBad ? "bad" : isWarn ? "warn" : "ok";

  const deficit = isBad ? 680 : isWarn ? 420 : 0;
  const headerLabel = isBad
    ? "Cash · MARGIN CALL"
    : isWarn
      ? "Cash · MARGIN WARN"
      : "Cash · STABLE";
  const headerCls = isBad ? "ib-card__kicker--bad" : isWarn ? "ib-card__kicker--warn" : "";

  if (skeleton) {
    return (
      <section className={v2cx("ib-card", "ib-card--cash")}>
        <span className="ib-card__stripe" />
        <div className="ib-card__head">
          <div className="ib-card__kicker">
            <span className="ib-sk ib-sk--line" style={{ width: 80 }} />
          </div>
          <span className="ib-fresh">
            <span className="ib-sk ib-sk--line" style={{ width: 50 }} />
          </span>
          <h3>
            <span className="ib-sk ib-sk--title" />
          </h3>
        </div>
        <div className="ib-card__body">
          <div className="ib-cashfield" style={{ minHeight: 48 }}>
            <span className="ib-sk ib-sk--num" />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="ib-sk ib-sk--line" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={v2cx("ib-card", "ib-card--cash", cardCls)}>
      <span className="ib-card__stripe" />
      <div className="ib-card__head">
        <div className={v2cx("ib-card__kicker", headerCls)}>
          {isBad ? <i className="fas fa-times" aria-hidden="true" /> : null}
          {isWarn ? <i className="fas fa-balance-scale" aria-hidden="true" /> : null}
          {headerLabel}
        </div>
        <Fresh tone={tone} />
        <h3>Cash Reserve · {profile.name}</h3>
      </div>
      <div className="ib-card__body">
        {isWarn || isBad ? (
          <div className={v2cx("ib-inset-alert", isWarn && "ib-inset-alert--warn")}>
            <i
              className={`fas ${isBad ? "fa-times" : "fa-balance-scale"}`}
              aria-hidden="true"
            />
            <div>
              {isBad ? (
                <>
                  다음 매수 전 <b>${deficit} 입금 필요</b> · SGOV $700 즉시 정리.
                </>
              ) : (
                <>
                  2회 매수 후 <b>${deficit} 부족</b> · SGOV $500 정리 권장.
                </>
              )}
            </div>
          </div>
        ) : null}

        <div className="ib-cashfield">
          <span className="ib-cashfield__unit">$</span>
          <input defaultValue="1,080.00" aria-label="현금 잔고" />
          <span className="ib-cashfield__unit">USD</span>
        </div>

        <div className="ib-cashrows">
          <div className="ib-cashrow">
            <span>다음 매수 (TQQQ+SOXL)</span>
            <b>${CASH_BASE.nextBuy.toFixed(2)}</b>
          </div>
          <div className="ib-cashrow">
            <span>향후 5회 필요금액</span>
            <b>${CASH_BASE.needed5.toLocaleString()}.00</b>
          </div>
          <div className="ib-cashrow">
            <span>현재 보유</span>
            <b>${CASH_BASE.bal.toLocaleString()}.00</b>
          </div>
          {isWarn || isBad ? (
            <div className={v2cx("ib-cashrow", "delta")}>
              <span>부족액</span>
              <b>−${deficit}.00</b>
            </div>
          ) : null}
        </div>

        {isWarn || isBad ? (
          <div className="ib-cash-actions">
            <button type="button" className="primary">
              SGOV 정리
            </button>
            <button type="button" className="ghost">
              입금
            </button>
          </div>
        ) : null}

        <div className="ib-sgov">
          <div className="ib-sgov__l">
            <b>SGOV 예치</b>
            <span>미사용 현금은 단기국채 ETF로 자동 운용</span>
          </div>
          <div className="ib-sgov__y">5.23%</div>
        </div>
      </div>
    </section>
  );
}
