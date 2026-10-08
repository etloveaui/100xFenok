"use client";

import "@/styles/brief.css";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import TransitionLink from "@/components/TransitionLink";
import { EdgeBox, SessionMap, Spark, SPX_COLOR, TNX_COLOR } from "@/components/brief/BriefCharts";
import { useBriefScroll } from "@/components/brief/useBriefScroll";
import { fetchJsonOrNull } from "@/lib/client/data-fetch";
import {
  BRIEF_DATE_RE,
  BRIEF_INDEX_URL,
  briefMorningDataUrl,
  dateline,
  dir,
  fmt,
  kst,
  kstLeadHours,
  latestEdition,
  monthDay,
  pct,
  sortedEditions,
  type BriefArticle,
  type BriefIndex,
  type BriefIntraday,
  type BriefQuote,
} from "@/lib/brief/brief";
import { ROUTES } from "@/lib/routes";

const SCORE_INDICES = ["S&P 500", "나스닥", "다우", "러셀2000", "SOX"];
const ETF_CHIPS: [string, string?][] = [["SPY"], ["QQQ"], ["IWM"], ["TQQQ", "레버리지"], ["SOXL", "레버리지"]];
const BIGTECH_COLORS: Record<string, string> = {
  AAPL: "#111827",
  MSFT: "#2563EB",
  NVDA: "#4D7C0F",
  GOOGL: "#EA4335",
  AMZN: "#F59E0B",
  META: "#1877F2",
  TSLA: "#DC2626",
  AVGO: "#B91C1C",
};

type SectionDef = { id: string; title: string; label: string; className?: string; body: ReactNode };

function scoreBadge(quote: BriefQuote, session: string): [string, string] {
  if (quote.record_date === session) return ["rec", "사상 최고 종가"];
  if (quote.record_date && quote.record_date === quote.prev_date) return ["rec", "전날 사상 최고"];
  if ((quote.streak ?? 0) >= 3) return ["rec", `${quote.streak}일 연속 상승`];
  if ((quote.streak ?? 0) <= -2) return ["dn", `${-(quote.streak ?? 0)}일 연속 하락`];
  return ["", `고점 대비 ${fmt(quote.from_record_pct, 1)}%`];
}

function readingMinutes(article: BriefArticle): number {
  const parts = [
    article.headline,
    article.thesis,
    article.story.title,
    ...article.story.paragraphs,
    ...(article.story.why ?? []),
    article.bigtech_take ?? "",
    article.scene.title,
    article.scene.take,
    ...(article.movers ?? []).map((m) => m.reason),
    ...(article.briefs ?? []).map((b) => `${b.title}${b.text}${b.why ?? ""}`),
    ...(article.yesterday_check ?? []).map((c) => `${c.was}${c.now}`),
    ...(article.tonight ?? []).map((t) => `${t.what}${t.why ?? ""}`),
  ];
  const chars = parts.reduce((sum, part) => sum + part.length, 0);
  return Math.max(1, Math.round(chars / 600));
}

function isArticle(value: unknown, date: string): value is BriefArticle {
  const doc = value as BriefArticle | null;
  return Boolean(doc && doc.edition_date === date && typeof doc.headline === "string" && doc.pack && doc.story);
}

export default function BriefArticleClient({ date }: { date: string }) {
  const router = useRouter();
  const validDate = BRIEF_DATE_RE.test(date);
  const [index, setIndex] = useState<BriefIndex | null>(null);
  const [loaded, setLoaded] = useState<{ date: string; doc: BriefArticle | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJsonOrNull<BriefIndex>(BRIEF_INDEX_URL).then((doc) => {
      if (!cancelled) setIndex(doc);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!validDate) return;
    let cancelled = false;
    fetchJsonOrNull<unknown>(briefMorningDataUrl(date)).then((doc) => {
      if (!cancelled) setLoaded({ date, doc: isArticle(doc, date) ? doc : null });
    });
    return () => {
      cancelled = true;
    };
  }, [date, validDate]);

  const article = !validDate ? null : loaded?.date === date ? loaded.doc : undefined;
  const editions = useMemo(() => sortedEditions(index), [index]);
  const latest = latestEdition(index);

  if (article === undefined) {
    return (
      <div className="fnk-brief" data-brief-article={date} data-brief-state="loading">
        <div className="wrap">
          <article aria-busy="true">
            <p className="sr-only" role="status">브리핑을 불러오는 중입니다.</p>
            <span className="skel" style={{ width: "40%", height: 14, marginTop: 6 }} />
            <span className="skel" style={{ width: "90%", height: 34, marginTop: 18 }} />
            <span className="skel" style={{ width: "75%", height: 20, marginTop: 14 }} />
            <span className="skel" style={{ width: "100%", height: 300, marginTop: 22, borderRadius: 14 }} />
          </article>
        </div>
      </div>
    );
  }

  if (article === null) {
    return (
      <div className="fnk-brief" data-brief-article={date} data-brief-state="not-found">
        <div className="wrap">
          <article>
            <div className="prov crumb">
              <TransitionLink href={ROUTES.brief}>브리핑</TransitionLink>
              <span>› 모닝 브리프</span>
            </div>
            <div className="state" role="status">
              <b>이 날짜의 모닝 브리프가 없습니다</b>
              {validDate ? `${dateline(date)}에는 발행된 브리핑이 없습니다.` : "날짜 형식이 올바르지 않습니다."} 미국 증시가
              쉬는 날의 다음 날에는 모닝 브리프를 발행하지 않습니다.
              <br />
              {latest ? (
                <TransitionLink href={ROUTES.briefMorning(latest.edition_date)}>
                  최신 브리핑 읽기 ({monthDay(latest.edition_date)}) →
                </TransitionLink>
              ) : (
                <TransitionLink href={ROUTES.brief}>브리핑 홈으로 →</TransitionLink>
              )}
            </div>
          </article>
        </div>
      </div>
    );
  }

  return (
    <ArticleView
      article={article}
      editions={editions.map((e) => ({ date: e.edition_date, headline: e.headline }))}
      isLatest={latest?.edition_date === article.edition_date}
      onNavigate={(next) => router.push(ROUTES.briefMorning(next))}
    />
  );
}

function ArticleView({
  article: A,
  editions,
  isLatest,
  onNavigate,
}: {
  article: BriefArticle;
  editions: { date: string; headline: string }[];
  isLatest: boolean;
  onNavigate: (date: string) => void;
}) {
  const P = A.pack;
  const lead = kstLeadHours(A.market_date);
  const md = monthDay(A.market_date);
  const nav = editions.some((e) => e.date === A.edition_date)
    ? editions
    : [...editions, { date: A.edition_date, headline: A.headline }].sort((x, y) => (x.date < y.date ? -1 : 1));
  const idx = nav.findIndex((e) => e.date === A.edition_date);
  const st = A.story;
  const spx = P.intraday?.["S&P 500"];
  const tnx = P.intraday?.["미 10년물"];

  const sections: SectionDef[] = [];
  sections.push({
    id: "story",
    title: "장의 흐름",
    label: "Session",
    className: "story",
    body: (
      <>
        <h2 className="st">{st.title}</h2>
        {st.paragraphs.map((p, i) => (
          <p key={`p-${i}`}>{p}</p>
        ))}
        <div className="why">
          <div className="k">왜 이렇게 움직였나</div>
          {(st.why ?? []).map((w, i) => (
            <p key={`w-${i}`}>{w}</p>
          ))}
        </div>
      </>
    ),
  });

  const fx = A.fx ?? {};
  const fxp = fx.change_pct ?? 0;
  const notes = Object.fromEntries((A.bigtech_notes ?? []).map((n) => [n.ticker, n.note]));
  const krw = (c: number) => Math.round(((1 + c / 100) * (1 + fxp / 100) - 1) * 10000) / 100;
  const bigtech = Object.keys(P.bigtech ?? {}).sort((x, y) => P.bigtech[y].chg_pct - P.bigtech[x].chg_pct);
  sections.push({
    id: "bigtech",
    title: "빅테크·대표 ETF",
    label: "Big Tech",
    body: (
      <>
        {A.bigtech_take ? <p className="take">{A.bigtech_take}</p> : null}
        <div className="bt">
          <div className="row hd">
            <span />
            <span>종목</span>
            <span className="sp">20일</span>
            <span className="u">달러</span>
            <span className="w">원화</span>
          </div>
          {bigtech.map((t) => {
            const e = P.bigtech[t];
            const memo = notes[t] || ((e.from_52w_high_pct ?? -100) > -1 ? "52주 신고가 부근" : "");
            return (
              <div className="row num" key={t}>
                <span className="mono-c" style={{ background: BIGTECH_COLORS[t] ?? "#334155" }}>
                  {t.slice(0, 2)}
                </span>
                <div className="nm">
                  <span className="t">{t}</span>
                  <span className="k">{e.name}</span>
                  {memo ? <div className="memo">{memo}</div> : null}
                </div>
                <span className="sp">
                  <Spark values={e.spark20} width={70} height={24} direction={dir(e.chg_pct)} />
                </span>
                <span className={`u ${dir(e.chg_pct)}`}>{pct(e.chg_pct)}</span>
                <span className="w">{pct(krw(e.chg_pct))}</span>
              </div>
            );
          })}
        </div>
        <div className="chips">
          {ETF_CHIPS.map(([ticker, prefix]) => {
            const e = P.etfs?.[ticker];
            if (!e) return null;
            return (
              <span className="chip2" key={ticker}>
                {`${prefix ? `${prefix} ` : ""}${ticker} `}
                <b className={dir(e.chg_pct)}>{pct(e.chg_pct)}</b>
              </span>
            );
          })}
        </div>
        <p className="fxnote">
          {`원화 열은 원/달러 ${fmt(fx.usdkrw, 2)}원(${(fx.change_won ?? 0) > 0 ? "+" : ""}${fx.change_won ?? "–"}원, ${fx.basis ?? "전일 대비"})을 반영한 값입니다. 세금·환전 비용은 빠져 있습니다.`}
        </p>
      </>
    ),
  });

  const sectorKeys = Object.keys(P.sectors ?? {});
  const sectorMax = Math.max(...sectorKeys.map((k) => Math.abs(P.sectors[k].chg_pct)), 0) || 1;
  const breadth = P.breadth;
  const showBreadth = Boolean(breadth && breadth.advancing);
  sections.push({
    id: "scene",
    title: "시장 체력과 섹터",
    label: "Market Health",
    body: (
      <>
        <h2 className="st">{A.scene.title}</h2>
        {P.edge ? <EdgeBox edge={P.edge} week={P.edge_week} /> : null}
        <p className="take">{A.scene.take}</p>
        <div className="heat num">
          {sectorKeys.map((k, i) => {
            const x = P.sectors[k];
            const v = x.chg_pct;
            const alpha = 0.1 + 0.5 * Math.min(1, Math.abs(v) / sectorMax);
            return (
              <div
                key={k}
                className={`ht${i === 0 || i === sectorKeys.length - 1 ? " top" : ""}`}
                style={{ background: `${v >= 0 ? "rgba(15,138,95," : "rgba(209,52,76,"}${alpha.toFixed(3)})` }}
              >
                <div className="a">
                  {x.symbol} · {k}
                </div>
                <div className="b">{pct(v)}</div>
                <div className="c">{(x.vol_vs_20d ?? 0) >= 1.5 ? `거래량 ${fmt(x.vol_vs_20d, 1)}배` : " "}</div>
              </div>
            );
          })}
        </div>
        {showBreadth && breadth ? (
          <>
            <div className="br2">
              <BreadthBox title="시장 폭 · 오른 종목 대 내린 종목" up={breadth.advancing ?? 0} down={breadth.declining ?? 0} upLabel="상승" downLabel="하락" />
              <BreadthBox title="52주 신고가 대 신저가" up={breadth.new_high ?? 0} down={breadth.new_low ?? 0} upLabel="신고가" downLabel="신저가" />
            </div>
            <p className="fxnote">NYSE·나스닥·AMEX 합산 (Finviz)</p>
          </>
        ) : null}
      </>
    ),
  });

  if (A.movers?.length) {
    sections.push({
      id: "movers",
      title: "오늘의 종목",
      label: "Movers",
      body: (
        <div className="mvs">
          {A.movers.map((m, i) => {
            const s = m.stats ?? {};
            const badges: ReactNode[] = [];
            if ((s.vol_vs_20d ?? 0) >= 1.5) {
              badges.push(
                <span className="badge hot" key="vol">
                  거래량 평소 {fmt(s.vol_vs_20d, 1)}배
                </span>,
              );
            }
            if (s.from_52w_high_pct != null) {
              badges.push(
                <span className="badge" key="high">
                  {s.from_52w_high_pct > -1 ? "52주 신고가 부근" : `52주 고점 대비 ${fmt(s.from_52w_high_pct, 0)}%`}
                </span>,
              );
            }
            if (s.ytd_pct != null) {
              badges.push(
                <span className="badge" key="ytd">
                  연초 대비 {s.ytd_pct > 0 ? "+" : ""}
                  {Math.round(s.ytd_pct)}%
                </span>,
              );
            }
            return (
              <div className="mc" key={`${m.ticker ?? m.name}-${i}`}>
                <div className="r1">
                  <span className="t">{m.ticker || "—"}</span>
                  <span className="n">{m.name}</span>
                  {s.chg_pct != null ? <span className={`c ${dir(s.chg_pct)}`}>{pct(s.chg_pct)}</span> : null}
                </div>
                <div className="why2">{m.reason}</div>
                {badges.length ? <div className="bd">{badges}</div> : null}
              </div>
            );
          })}
        </div>
      ),
    });
  }

  if (A.tonight?.length) {
    sections.push({
      id: "tonight",
      title: "오늘 밤 미국장",
      label: "Tonight · KST",
      body: (
        <ul className="tl">
          {A.tonight.map((w, i) => (
            <li key={`t-${i}`}>
              <span className="w">{w.kst}</span>
              <div className="x">
                <div className="t">{w.what}</div>
                {w.why ? <div className="y">{w.why}</div> : null}
              </div>
            </li>
          ))}
        </ul>
      ),
    });
  }

  if (A.yesterday_check?.length) {
    sections.push({
      id: "check",
      title: "어제 짚은 것, 오늘 결과",
      label: "Check",
      body: (
        <div className="ck">
          {A.yesterday_check.map((f, i) => (
            <div className="i" key={`c-${i}`}>
              <div className="a">
                <span className="k">어제 브리프</span>
                {f.was}
              </div>
              <div className="b">
                <span className="k">오늘</span>
                {f.now}
              </div>
            </div>
          ))}
        </div>
      ),
    });
  }

  if (A.briefs?.length) {
    sections.push({
      id: "briefs",
      title: "짧은 소식",
      label: "In Brief",
      body: (
        <ol className="brf">
          {A.briefs.map((b, i) => (
            <li key={`b-${i}`}>
              <div>
                <div className="t">{b.title}</div>
                <div className="x">{b.text}</div>
                {b.why ? <div className="y">{b.why}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      ),
    });
  }

  const head = (
    <>
      <div className="prov crumb">
        <TransitionLink href={ROUTES.brief}>브리핑</TransitionLink>
        <span>› 모닝 브리프</span>
      </div>
      <div className="mast">
        <span className="brandk">MORNING BRIEF</span>
        <span>{dateline(A.edition_date)}</span>
        <span className="dot">·</span>
        <span>미국 {md} 장 마감</span>
        <div className="nav">
          <button type="button" disabled={idx <= 0} onClick={() => idx > 0 && onNavigate(nav[idx - 1].date)}>
            ‹ 이전
          </button>
          <select className="dsel" aria-label="브리핑 날짜 선택" value={A.edition_date} onChange={(event) => onNavigate(event.target.value)}>
            {nav.map((e) => (
              <option key={e.date} value={e.date}>
                {`${monthDay(e.date)} · ${e.headline.slice(0, 18)}${e.headline.length > 18 ? "…" : ""}`}
              </option>
            ))}
          </select>
          <button type="button" disabled={idx < 0 || idx >= nav.length - 1} onClick={() => idx < nav.length - 1 && onNavigate(nav[idx + 1].date)}>
            다음 ›
          </button>
        </div>
      </div>
      <h1>{A.headline}</h1>
      <p className="thesis">{A.thesis}</p>
      <div className="prov">
        {isLatest ? <span className="fresh">신선</span> : null}
        <span>{A.published_kst ?? "06:20"} KST 생성</span>
        <span>AA 브리프·사실 카드 · Yahoo · 미 재무부 · Finviz · Nasdaq</span>
        <span>{readingMinutes(A)}분 읽기</span>
      </div>

      {spx && tnx ? (
        <div className="hero">
          <div className="top2">
            <div>
              <div className="k">SESSION MAP · 한국 시간</div>
              <div className="h">{st.chart_headline || "S&P 500과 10년물 금리의 장중 흐름"}</div>
            </div>
            <div className="lg">
              {[
                ["S&P 500", SPX_COLOR],
                ["미 10년물", TNX_COLOR],
              ].map(([name, color]) => (
                <span key={name}>
                  <i style={{ background: color }} />
                  {name}
                </span>
              ))}
            </div>
          </div>
          <SessionMap spx={spx.points} tnx={tnx.points} annotations={st.annotations ?? []} leadHours={lead} />
          <SessionPath intraday={spx} close={P.indices["S&P 500"]?.close ?? spx.close} leadHours={lead} />
        </div>
      ) : null}

      <div className="scores num">
        {SCORE_INDICES.map((name) => {
          const t = P.indices?.[name];
          if (!t) return null;
          const d = dir(t.chg_pct);
          const [badgeClass, badgeText] = scoreBadge(t, P.session);
          return (
            <div className="sc" key={name}>
              <div className="l">{name}</div>
              <div className="v">{fmt(t.close, 2)}</div>
              <span className={`c ${d}`}>{pct(t.chg_pct)}</span>
              <Spark values={t.spark20} width={120} height={24} direction={d} />
              <div className={`bd ${badgeClass}`}>{badgeText}</div>
            </div>
          );
        })}
      </div>
      <div className="chips">
        {P.rates ? (
          <span className="chip2">
            미 10년물 <b>{fmt(P.rates.us10y, 2)}%</b>
            {` ${P.rates.us10y - P.rates.us10y_prev >= 0 ? "+" : ""}${Math.round((P.rates.us10y - P.rates.us10y_prev) * 100)}bp`}
          </span>
        ) : null}
        {(A.strip_extra ?? []).map((t) => (
          <span className="chip2" key={t.label}>
            {t.label} <b>{t.value}</b>
            {t.change ? ` ${t.change}` : ""}
          </span>
        ))}
      </div>
    </>
  );
  const footer = (
    <footer>
      {`출처: AA 모닝 브리프와 사실 카드 · ${(P.sources ?? []).join(" · ")} · 장중 시각은 현지(ET) 데이터를 한국 시간으로 바꿔 표시했습니다.`}
      <p>AA 수집 자료와 시장 데이터를 AI가 기사로 재구성했습니다. 투자 권유가 아닙니다.</p>
    </footer>
  );
  return <ArticleFrame sections={sections} editionDate={A.edition_date} head={head} footer={footer} />;
}

function BreadthBox({ title, up, down, upLabel, downLabel }: { title: string; up: number; down: number; upLabel: string; downLabel: string }) {
  const total = up + down || 1;
  return (
    <div className="bx">
      <div className="k">{title}</div>
      <div className="nums">
        <b className="up">{fmt(up)}</b>
        <span>{upLabel}</span>
        <b className="down">{fmt(down)}</b>
        <span>{downLabel}</span>
      </div>
      <div className="bar">
        <i style={{ width: `${(up / total) * 100}%`, background: "#0F8A5F" }} />
        <i style={{ width: `${(down / total) * 100}%`, background: "#D1344C" }} />
      </div>
    </div>
  );
}

function SessionPath({ intraday, close, leadHours }: { intraday: BriefIntraday; close: number; leadHours: number }) {
  const lowFirst = intraday.low_time < intraday.high_time;
  const steps: [string, number, string][] = [
    ["시가", intraday.open, "09:30"],
    [lowFirst ? "저점" : "고점", lowFirst ? intraday.low : intraday.high, lowFirst ? intraday.low_time : intraday.high_time],
    [lowFirst ? "고점" : "저점", lowFirst ? intraday.high : intraday.low, lowFirst ? intraday.high_time : intraday.low_time],
    ["종가", close, "16:00"],
  ];
  return (
    <div className="path num">
      <span style={{ marginRight: 4 }}>S&amp;P 500 장중 경로</span>
      {steps.map(([label, value, time], i) => (
        <Fragment key={label}>
          {i ? <span className="ar">→</span> : null}
          <span className="st">
            {label} <b>{fmt(value, 2)}</b> {kst(time, leadHours)}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Article body: the numbered sections with the reveal-on-scroll motion, the
 * sticky table of contents and the reading-progress bar of the mockup.
 */
function ArticleFrame({
  sections,
  editionDate,
  head,
  footer,
}: {
  sections: SectionDef[];
  editionDate: string;
  head: ReactNode;
  footer: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { progressRef, activeIndex, revealed } = useBriefScroll(rootRef, sections.map((s) => s.id).join("|"), editionDate);
  return (
    <div className="fnk-brief" data-brief-article={editionDate} data-brief-state="ready" ref={rootRef}>
      <div className="progress" aria-hidden="true">
        <i ref={progressRef} />
      </div>
      <div className="wrap">
        <article>
          {head}
          {sections.map((section, i) => (
            <section key={section.id} id={section.id} className={`s${section.className ? ` ${section.className}` : ""}${revealed.has(section.id) ? "" : " pre"}`}>
              <div className="sh">
                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                <h3>{section.title}</h3>
                <span className="lbl">{section.label}</span>
              </div>
              {section.body}
            </section>
          ))}
          {footer}
        </article>
        <nav className="toc" aria-label="목차">
          <div className="in">
            <div className="h">이 글의 순서</div>
            {sections.map((section, i) => (
              <a key={section.id} href={`#${section.id}`} className={i === activeIndex ? "on" : undefined}>
                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                <span>{section.title}</span>
              </a>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
