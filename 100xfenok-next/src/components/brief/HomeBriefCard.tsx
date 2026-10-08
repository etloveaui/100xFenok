"use client";

import "@/styles/brief.css";
import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { fetchJsonOrNull } from "@/lib/client/data-fetch";
import {
  BRIEF_INDEX_URL,
  dateline,
  dir,
  edgeLabelColor,
  latestEdition,
  monthDay,
  pct,
  type BriefIndex,
} from "@/lib/brief/brief";
import { ROUTES } from "@/lib/routes";

/**
 * Home entry to the latest morning brief: headline, thesis, the three index
 * moves and the market-health score, linking to the edition. Reads only the
 * briefing index; renders nothing when the index cannot be read.
 */
export default function HomeBriefCard() {
  const [index, setIndex] = useState<BriefIndex | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchJsonOrNull<BriefIndex>(BRIEF_INDEX_URL).then((doc) => {
      if (!cancelled) setIndex(doc && Array.isArray(doc.editions) ? doc : null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (index === undefined) {
    return <div className="fnk-brief home-card" aria-hidden="true"><span className="skel home-skel" /></div>;
  }
  const latest = latestEdition(index);
  if (!latest) return null;

  const moves: [string, number | null][] = [
    ["S&P 500", latest.sp500_chg_pct],
    ["나스닥", latest.nasdaq_chg_pct],
    ["러셀2000", latest.russell_chg_pct],
  ];
  return (
    <section className="fnk-brief home-card" aria-label="오늘의 브리핑" data-home-brief={latest.edition_date}>
      <TransitionLink className="lead" href={ROUTES.briefMorning(latest.edition_date)}>
        <div className="k">{`MORNING BRIEF · 오늘의 브리핑 · ${dateline(latest.edition_date)} · 미국 ${monthDay(latest.market_date)} 장`}</div>
        <h2>{latest.headline}</h2>
        <p>{latest.thesis}</p>
        <div className="row num">
          {moves.map(([name, value]) =>
            value == null ? null : (
              <span className="chip2" key={name}>
                {`${name} `}
                <b className={dir(value)}>{pct(value)}</b>
              </span>
            ),
          )}
          {latest.edge ? (
            <span className="chip2">
              {"시장 체력 "}
              <b style={{ color: edgeLabelColor(latest.edge.label) }}>{`${latest.edge.score} ${latest.edge.label}`}</b>
            </span>
          ) : null}
          <span className="go">기사 읽기 →</span>
        </div>
      </TransitionLink>
    </section>
  );
}
