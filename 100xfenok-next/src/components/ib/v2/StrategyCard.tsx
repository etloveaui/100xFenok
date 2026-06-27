"use client";

import { v2cx } from "@/components/dashboard/v2/types";
import Fresh from "./Fresh";
import type { StrategyData } from "./mockData";

type Props = { t: StrategyData; compact?: boolean; skeleton?: boolean };

const PHASE_LABELS = ["1단계 진행중", "2단계", "손절"] as const;

export default function StrategyCard({ t, compact, skeleton }: Props) {
  const variantCls = t.sym === "TQQQ" ? "ib-card--tqqq" : "ib-card--soxl";

  if (skeleton) {
    return (
      <section className={v2cx("ib-card", variantCls)}>
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
          <div className="ib-tk" style={{ minHeight: 64 }}>
            <div style={{ flex: 1 }}>
              <div className="ib-sk" style={{ width: 80, height: 28 }} />
              <div className="ib-sk ib-sk--line" style={{ marginTop: 6, width: 140 }} />
            </div>
          </div>
          <div className="ib-inputs">
            {[0, 1, 2].map((i) => (
              <div key={i} className="ib-in">
                <div className="ib-sk ib-sk--line" style={{ width: 40, height: 7 }} />
                <div className="ib-sk ib-sk--num" />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={v2cx("ib-card", variantCls)}>
      <span className="ib-card__stripe" />
      <div className="ib-card__head">
        <div className="ib-card__kicker">Strategy · {t.phase}단계</div>
        <Fresh />
        <h3>{t.sym} · DCA Active</h3>
      </div>
      <div className="ib-card__body">
        <div className="ib-tk">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ib-tk__sym">{t.sym}</div>
            <div className="ib-tk__meta">
              {t.name} · {t.exch}
              {t.priceSource ? <span className="ib-source-badge">{t.priceSource}</span> : null}
            </div>
            <span className={v2cx("ib-tk__state", t.state === "closed" && "ib-tk__state--closed")}>
              MARKET {t.state.toUpperCase()}
            </span>
          </div>
          <div className="ib-tk__price">
            <div className="ib-tk__price__big">${t.pos.price.toFixed(2)}</div>
            <div className={v2cx("ib-tk__price__chg", t.pos.pl >= 0 ? "up" : "dn")}>
              {t.pos.pl >= 0 ? "+" : ""}
              {t.pos.pl}% · {t.pos.pl >= 0 ? "+" : ""}${Math.abs(t.pos.plAbs).toFixed(0)}
            </div>
          </div>
        </div>

        {t.error ? (
          <div className="ib-inline-alert">
            <i className="fas fa-exclamation-triangle" aria-hidden="true" />
            <span>{t.error}</span>
          </div>
        ) : null}

        <div className={v2cx("ib-inputs", compact && "fold")}>
          <div className="ib-in">
            <div className="ib-in__l">매수횟수</div>
            <div className="ib-in__v">
              {t.plan.count} <span className="ib-in__u">회</span>
            </div>
          </div>
          <div className="ib-in">
            <div className="ib-in__l">1회 금액</div>
            <div className="ib-in__v">${t.plan.per}</div>
          </div>
          {!compact ? (
            <div className="ib-in">
              <div className="ib-in__l">총 예산</div>
              <div className="ib-in__v">${t.plan.budget.toLocaleString()}</div>
            </div>
          ) : null}
        </div>

        <div className="ib-phases">
          {[1, 2, 3].map((p) => {
            const isCurrent = t.phase === p;
            return (
              <span key={p} className={v2cx("ib-phase", `ib-phase--${p}`, !isCurrent && "dim")}>
                {isCurrent ? PHASE_LABELS[p - 1] : PHASE_LABELS[p - 1].replace(" 진행중", "")}
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}
