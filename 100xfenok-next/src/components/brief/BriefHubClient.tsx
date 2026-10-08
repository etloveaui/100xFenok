"use client";

import "@/styles/brief.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import TransitionLink from "@/components/TransitionLink";
import { EdgeBox, Spark } from "@/components/brief/BriefCharts";
import { useBriefScroll } from "@/components/brief/useBriefScroll";
import { fetchJsonOrNull } from "@/lib/client/data-fetch";
import {
  BRIEF_INDEX_URL,
  briefMorningDataUrl,
  dateline,
  dir,
  edgeLabelColor,
  latestEdition,
  monthDay,
  pct,
  sortedEditions,
  type BriefArticle,
  type BriefIndex,
  type BriefIndexEdition,
  type BriefProduct,
} from "@/lib/brief/brief";
import { ROUTES } from "@/lib/routes";

/* The mockup's product shelf, used when the index carries no products list. */
const DEFAULT_PRODUCTS: BriefProduct[] = [
  { id: "morning", name: "모닝 브리프", cadence: "매일 07:00", desc: "방금 끝난 미국장 리뷰", status: "live" },
  { id: "digest", name: "데일리 다이제스트", cadence: "매일 11:00", desc: "하루 시장 흐름 한 장 요약", status: "coming-soon" },
  { id: "premarket", name: "프리마켓 브리프", cadence: "매일 밤", desc: "미국 장 시작 전 점검", status: "coming-soon" },
  { id: "weekly-recap", name: "위클리 리캡", cadence: "매주", desc: "한 주 마감 정리", status: "coming-soon" },
  { id: "weekly-brief", name: "위클리 브리프", cadence: "매주", desc: "다음 주를 여는 주간 브리프", status: "coming-soon" },
];

function HubSection({ title, label, children }: { title: string; label: string; children: ReactNode }) {
  return (
    <section className="s">
      <div className="sh">
        <h3>{title}</h3>
        <span className="lbl">{label}</span>
      </div>
      {children}
    </section>
  );
}

function isoDay(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Archive calendar: Monday-first weeks from the first to the latest edition. */
function ArchiveCalendar({ editions, latestDate }: { editions: BriefIndexEdition[]; latestDate: string }) {
  const byDate = new Map(editions.map((edition) => [edition.edition_date, edition]));
  const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const start = parse(editions[0].edition_date);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = parse(latestDate);
  end.setUTCDate(end.getUTCDate() + (6 - ((end.getUTCDay() + 6) % 7)));
  const maxMove = Math.max(...editions.map((edition) => Math.abs(edition.sp500_chg_pct ?? 0)), 0) || 1;
  const cells: ReactNode[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = isoDay(d);
    const edition = byDate.get(key);
    const dayLabel = `${d.getUTCDate() === 1 ? `${d.getUTCMonth() + 1}/` : ""}${d.getUTCDate()}`;
    const today = key === latestDate ? " today" : "";
    if (edition) {
      const v = edition.sp500_chg_pct ?? 0;
      const alpha = 0.18 + 0.55 * Math.min(1, Math.abs(v) / maxMove);
      cells.push(
        <TransitionLink
          key={key}
          href={ROUTES.briefMorning(key)}
          className={`d e${today}`}
          title={edition.headline}
          style={{ background: `${v >= 0 ? "rgba(15,138,95," : "rgba(209,52,76,"}${alpha.toFixed(3)})` }}
        >
          <span>{dayLabel}</span>
          <span className="p">{pct(edition.sp500_chg_pct)}</span>
        </TransitionLink>,
      );
    } else {
      cells.push(
        <div key={key} className={`d${today}`}>
          <span>{dayLabel}</span>
        </div>,
      );
    }
  }
  return (
    <div className="cal num">
      {["월", "화", "수", "목", "금", "토", "일"].map((day) => (
        <div className="dh" key={day}>
          {day}
        </div>
      ))}
      {cells}
    </div>
  );
}

export default function BriefHubClient() {
  const [index, setIndex] = useState<BriefIndex | null | undefined>(undefined);
  const [latestDoc, setLatestDoc] = useState<{ date: string; doc: BriefArticle | null } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { progressRef } = useBriefScroll(rootRef, "", "hub");

  useEffect(() => {
    let cancelled = false;
    fetchJsonOrNull<BriefIndex>(BRIEF_INDEX_URL).then((doc) => {
      if (!cancelled) setIndex(doc && Array.isArray(doc.editions) ? doc : null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const latest = latestEdition(index ?? null);
  const latestDate = latest?.edition_date ?? null;

  useEffect(() => {
    if (!latestDate) return;
    let cancelled = false;
    fetchJsonOrNull<BriefArticle>(briefMorningDataUrl(latestDate)).then((doc) => {
      if (!cancelled) setLatestDoc({ date: latestDate, doc: doc && doc.edition_date === latestDate ? doc : null });
    });
    return () => {
      cancelled = true;
    };
  }, [latestDate]);

  const editions = sortedEditions(index ?? null);
  const LA = latestDoc && latestDoc.date === latestDate ? latestDoc.doc : null;
  const LP = LA?.pack ?? null;
  const products = index?.products?.length ? index.products : DEFAULT_PRODUCTS;
  const published = LA?.published_kst ?? "06:22";
  const edgeChip = LP?.edge ?? latest?.edge ?? null;

  return (
    <div className="fnk-brief is-hub" data-brief-hub="" data-brief-state={index === undefined ? "loading" : latest ? "ready" : "empty"} ref={rootRef}>
      <div className="progress" aria-hidden="true">
        <i ref={progressRef} />
      </div>
      <div className="wrap">
        <article>
          <div className="mast">
            <span className="brandk">BRIEFING</span>
            <span>100x 데일리 브리핑</span>
          </div>
          <h1 className="hub-h1">브리핑</h1>
          <p className="hub-sub">방금 끝난 미국장부터 오늘 밤 일정까지, 투자자의 하루를 여는 100x 브리핑입니다.</p>

          {index === undefined ? (
            <div aria-busy="true">
              <p className="sr-only" role="status">브리핑을 불러오는 중입니다.</p>
              <span className="skel" style={{ height: 190, marginTop: 20, borderRadius: 16 }} />
            </div>
          ) : !latest ? (
            <div className="state" role="status">
              <b>브리핑을 불러오지 못했습니다</b>
              잠시 뒤 다시 열어 주세요.
            </div>
          ) : (
            <>
              <TransitionLink className="lead" href={ROUTES.briefMorning(latest.edition_date)} data-brief-lead={latest.edition_date}>
                <div className="k">
                  {`MORNING BRIEF · ${dateline(latest.edition_date)} ${published} 발행 · 미국 ${monthDay(latest.market_date)} 장`}
                </div>
                <h2>{latest.headline}</h2>
                <p>{latest.thesis}</p>
                <div className="row num">
                  {(
                    [
                      ["S&P 500", LP?.indices?.["S&P 500"]?.chg_pct ?? latest.sp500_chg_pct],
                      ["나스닥", LP?.indices?.["나스닥"]?.chg_pct ?? latest.nasdaq_chg_pct],
                      ["러셀2000", LP?.indices?.["러셀2000"]?.chg_pct ?? latest.russell_chg_pct],
                    ] as [string, number | null][]
                  ).map(([name, value]) =>
                    value == null ? null : (
                      <span className="chip2" key={name}>
                        {`${name} `}
                        <b className={dir(value)}>{pct(value)}</b>
                      </span>
                    ),
                  )}
                  {edgeChip ? (
                    <span className="chip2">
                      {"시장 체력 "}
                      <b style={{ color: edgeLabelColor(edgeChip.label) }}>{`${edgeChip.score} ${edgeChip.label}`}</b>
                    </span>
                  ) : null}
                  {LP?.intraday?.["S&P 500"] ? (
                    <span>
                      <Spark
                        values={LP.intraday["S&P 500"].points.filter((q) => q[0] >= "09:30").map((q) => q[1])}
                        width={120}
                        height={32}
                        direction={dir(LP.indices?.["S&P 500"]?.chg_pct)}
                      />
                    </span>
                  ) : null}
                  <span className="go">기사 읽기 →</span>
                </div>
              </TransitionLink>

              <HubSection title="오늘의 브리핑" label="Today · KST">
                <div className="tline">
                  <TransitionLink className="slot done" href={ROUTES.briefMorning(latest.edition_date)}>
                    <div className="c">
                      <div className="tm">07:00</div>
                      <div className="nm">모닝 브리프</div>
                      <div className="st">{`${published} 발행 · 직전 미국장 리뷰`}</div>
                    </div>
                  </TransitionLink>
                  {[
                    ["11:00", "데일리 다이제스트", "준비 중 · 하루 시장 흐름 한 장 요약"],
                    ["22:00", "프리마켓 브리프", "준비 중 · 미국 장 시작 전 점검"],
                    ["05:00", "미국장 마감", "다음 모닝 브리프의 재료"],
                  ].map(([time, name, note]) => (
                    <div className="slot" key={time}>
                      <div className="c">
                        <div className="tm">{time}</div>
                        <div className="nm">{name}</div>
                        <div className="st">{note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </HubSection>

              {LP?.edge ? (
                <HubSection title="시장 체력, 이번 주" label="Market Health">
                  <EdgeBox edge={LP.edge} week={LP.edge_week} />
                </HubSection>
              ) : null}

              <HubSection title="지난 브리핑" label="Archive">
                <ArchiveCalendar editions={editions} latestDate={latest.edition_date} />
                <p className="fxnote">칸 색은 그 브리핑이 다룬 미국장의 S&amp;P 500 등락입니다. 누르면 그날 기사로 이동합니다.</p>
              </HubSection>

              <HubSection title="모든 브리핑" label="Products">
                <div className="shelf">
                  {products.map((product) => {
                    const live = product.status === "live";
                    const body = (
                      <>
                        <div className="nm">{product.name}</div>
                        <div className="ds">{`${product.cadence} · ${product.desc}`}</div>
                        <span className={`pill${live ? " on" : ""}`}>{live ? "● 제공 중" : "● 준비 중"}</span>
                      </>
                    );
                    return live && product.id === "morning" ? (
                      <TransitionLink key={product.id} className="prod" href={ROUTES.briefMorning(latest.edition_date)}>
                        {body}
                      </TransitionLink>
                    ) : (
                      <div key={product.id} className="prod">
                        {body}
                      </div>
                    );
                  })}
                </div>
              </HubSection>
            </>
          )}

          <footer>브리핑은 AA 수집 자료와 미국장 데이터를 바탕으로 AI가 작성합니다. 투자 권유가 아닙니다.</footer>
        </article>
      </div>
    </div>
  );
}
