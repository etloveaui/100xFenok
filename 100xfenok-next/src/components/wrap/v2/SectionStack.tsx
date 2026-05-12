"use client";

import { v2cx } from "@/components/dashboard/v2/types";
import type { WrapSection } from "./types";

type Props = {
  sections: WrapSection[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
};

const TONE_KPI_CLASS: Record<string, string> = {
  up: "mw-kpi-value-up",
  down: "mw-kpi-value-down",
  warn: "mw-kpi-value-warn",
  flat: "",
};

export default function SectionStack({ sections, expanded, onToggle }: Props) {
  return (
    <section className="mw-stack">
      <div className="mw-stack-head">
        <span className="kicker">11 섹션 · 더 깊이 보기</span>
        <h2 className="mw-stack-title">Section Stack</h2>
      </div>
      {sections.map((section) => {
        const isOpen = expanded.has(section.id);
        return (
          <article
            key={section.id}
            className={v2cx("mw-section", isOpen && "is-open")}
          >
            <button
              type="button"
              className="mw-section-head"
              onClick={() => onToggle(section.id)}
              aria-expanded={isOpen}
            >
              <span className="mw-section-id">{section.id}</span>
              <span className="mw-section-title-col">
                <span className="kicker">{section.kicker}</span>
                <span className="mw-section-title">{section.title}</span>
              </span>
              <span className="mw-section-kpis">
                {section.kpis.map((kpi) => (
                  <span key={kpi.k} className="mw-section-kpi">
                    <span className="mw-section-kpi-k">{kpi.k}</span>
                    <span
                      className={v2cx(
                        "mono mw-section-kpi-v",
                        kpi.tone && TONE_KPI_CLASS[kpi.tone],
                      )}
                    >
                      {kpi.v}
                    </span>
                  </span>
                ))}
              </span>
              <span className="mw-section-chev" aria-hidden="true">
                <i
                  className="fas fa-chevron-down"
                  style={{ transform: isOpen ? "rotate(180deg)" : "none" }}
                />
              </span>
            </button>
            {isOpen ? (
              <div className="mw-section-body">
                <p className="mw-section-summary">{section.summary}</p>
                <div className="mw-section-links">
                  <a href="#" className="mw-section-link">차트 보기 →</a>
                  <a href="#" className="mw-section-link">원본 데이터 →</a>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
