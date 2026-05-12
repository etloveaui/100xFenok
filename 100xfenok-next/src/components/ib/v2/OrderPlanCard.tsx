"use client";

import { useState } from "react";
import { v2cx } from "@/components/dashboard/v2/types";
import Fresh from "./Fresh";
import type { OrderRowData, StrategyData } from "./mockData";

type RowProps = {
  r: OrderRowData;
  isNext: boolean;
  open: boolean;
  onToggle: () => void;
};

function OrderRow({ r, isNext, open, onToggle }: RowProps) {
  return (
    <div
      className={v2cx("ib-ord", isNext && "ib-ord--next")}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <div className={v2cx("ib-ord__bar", `ib-ord__bar--${r.side}`)} />
      <div className="ib-ord__n">#{r.n}</div>
      <div className="ib-ord__p">${r.price.toFixed(2)}</div>
      <div className="ib-ord__q">{r.qty.toFixed(2)}주</div>
      <div className="ib-ord__a">${r.amt.toLocaleString()}</div>
      <span className={v2cx("ib-ord__tag", `ib-ord__tag--${r.tag.toLowerCase()}`)}>
        {isNext ? "NEXT · " : ""}
        {r.tag}
      </span>
      <span className="ib-ord__chev" aria-hidden="true">
        <i className={`fas fa-chevron-${open ? "down" : "down"}`} style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </span>
      {open ? (
        <div className="ib-ord__detail">
          <div>
            <dt>주문시점</dt>
            <dd>{r.placedAt}</dd>
          </div>
          <div>
            <dt>체결여부</dt>
            <dd style={{ color: r.filled ? "#047857" : "#854d0e" }}>
              {r.filled ? "체결 완료" : "대기"}
            </dd>
          </div>
          <div>
            <dt>주문타입</dt>
            <dd>{r.type}</dd>
          </div>
          <div>
            <dt>예상 평단</dt>
            <dd>{r.avg}</dd>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Props = { t: StrategyData; compact?: boolean; skeleton?: boolean };

export default function OrderPlanCard({ t, compact, skeleton }: Props) {
  const initialIdx = t.orders.findIndex((o) => o.n === t.nextN);
  const [openIdx, setOpenIdx] = useState(initialIdx);

  if (skeleton) {
    return (
      <section className={v2cx("ib-card", "ib-card--plan")}>
        <span className="ib-card__stripe" />
        <div className="ib-card__head">
          <div className="ib-card__kicker">
            <span className="ib-sk ib-sk--line" style={{ width: 60 }} />
          </div>
          <span className="ib-fresh">
            <span className="ib-sk ib-sk--line" style={{ width: 50 }} />
          </span>
          <h3>
            <span className="ib-sk ib-sk--title" />
          </h3>
        </div>
        <div className="ib-card__body">
          <div className="ib-sk" style={{ height: 6, borderRadius: 999 }} />
          {[0, 1, 2].map((i) => (
            <div key={i} className="ib-sk" style={{ height: 36, marginTop: 4 }} />
          ))}
        </div>
      </section>
    );
  }

  const filledCount = t.orders.filter((o) => o.filled).length;
  const pct = Math.round((filledCount / t.plan.count) * 100);
  const rows = compact
    ? t.orders.filter((o) => !o.filled).slice(0, 1)
    : t.orders.slice(0, 4);

  return (
    <section className={v2cx("ib-card", "ib-card--plan")}>
      <span className="ib-card__stripe" />
      <div className="ib-card__head">
        <div className="ib-card__kicker">매수 계획 · {t.sym}</div>
        <Fresh />
        <h3>
          Order Plan · {filledCount} / {t.plan.count}
        </h3>
      </div>
      <div className="ib-card__body">
        <div className="ib-prog">
          <div className="ib-prog__row">
            <span>진행률</span>
            <span>{pct}%</span>
          </div>
          <div className="ib-prog__track">
            <div className="ib-prog__fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="ib-orders">
          {rows.map((r, i) => (
            <OrderRow
              key={r.n}
              r={r}
              isNext={r.n === t.nextN}
              open={openIdx === i}
              onToggle={() => setOpenIdx(openIdx === i ? -1 : i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
