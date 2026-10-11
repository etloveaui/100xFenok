"use client";

import "@/styles/brief.css";
import "@/styles/brief-broadsheet.css";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import TransitionLink from "@/components/TransitionLink";
import { EdgeBox, SessionMap, Spark } from "@/components/brief/BriefCharts";
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

const ETF_CHIPS: [string, string?][] = [["SPY"], ["QQQ"], ["IWM"], ["TQQQ", "레버리지"], ["SOXL", "레버리지"]];

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

/** Underline the first percentage of the headline, as the chosen broadsheet design does. */
function headlineMarkup(headline: string): ReactNode {
  const match = /[+-]?\d+(?:[.,]\d+)?%/.exec(headline);
  if (!match) return headline;
  return (
    <>
      {headline.slice(0, match.index)}
      <em>{match[0]}</em>
      {headline.slice(match.index + match[0].length)}
    </>
  );
}

/** Record close implied by the distance to the record (rounded data, so only used to place a level). */
function impliedRecord(quote: BriefQuote | undefined): number | null {
  if (!quote || quote.from_record_pct == null || quote.from_record_pct > 0) return null;
  return quote.close / (1 + quote.from_record_pct / 100);
}

const INDEX_ROWS = ["S&P 500", "나스닥", "나스닥100", "다우", "러셀2000", "SOX"];
const RATE_ROWS: [string, string, "us2y" | "us10y" | "us30y"][] = [
  ["US 2Y", "국채 2년", "us2y"],
  ["US 10Y", "국채 10년", "us10y"],
  ["US 30Y", "국채 30년", "us30y"],
];

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
  const sp = P.indices?.["S&P 500"];
  const record = impliedRecord(sp);
  const fx = A.fx ?? {};
  const fxp = fx.change_pct ?? 0;

  const sections: SectionDef[] = [];
  sections.push({
    id: "story",
    title: "장의 흐름",
    label: "Session",
    className: "story",
    body: (
      <div className="g12">
        <div className="main">
          <h2 className="st">{st.title}</h2>
          {st.paragraphs.map((p, i) => (
            <p key={`p-${i}`}>{p}</p>
          ))}
          {(st.why ?? []).length ? (
            <div className="why">
              <div className="k">왜 이렇게 움직였나</div>
              {(st.why ?? []).map((w, i) => (
                <p key={`w-${i}`}>{w}</p>
              ))}
            </div>
          ) : null}
        </div>
        {sp ? (
          <aside className="side num" aria-label="S&P 500 기록 맥락">
            <div className="k">기록 맥락 · S&amp;P 500</div>
            <dl>
              <div>
                <dt>종가 ({md})</dt>
                <dd>{fmt(sp.close, 2)}</dd>
              </div>
              <div>
                <dt>사상 최고 종가</dt>
                <dd>{sp.record_date ? monthDay(sp.record_date) : "–"}</dd>
              </div>
              <div>
                <dt>기록 대비</dt>
                <dd className={dir(sp.from_record_pct)}>{pct(sp.from_record_pct)}</dd>
              </div>
              <div>
                <dt>연초 대비</dt>
                <dd className={dir(sp.ytd_pct)}>{pct(sp.ytd_pct)}</dd>
              </div>
              {P.rates ? (
                <div>
                  <dt>미 10년물</dt>
                  <dd>{fmt(P.rates.us10y, 2)}%</dd>
                </div>
              ) : null}
            </dl>
          </aside>
        ) : null}
      </div>
    ),
  });

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
        <div className="bt" role="table" aria-label="빅테크 등락">
          <div className="row hd" role="row">
            <span role="columnheader">종목</span>
            <span className="sp" role="columnheader">20일</span>
            <span className="u" role="columnheader">달러</span>
            <span className="w" role="columnheader">원화</span>
          </div>
          {bigtech.map((t) => {
            const e = P.bigtech[t];
            const memo = notes[t] || ((e.from_52w_high_pct ?? -100) > -1 ? "52주 신고가 부근" : "");
            return (
              <div className="row num" role="row" key={t}>
                <div className="nm" role="cell">
                  <span className="t">{t}</span>
                  <span className="k">{e.name}</span>
                  {memo ? <div className="memo">{memo}</div> : null}
                </div>
                <span className="sp" role="cell">
                  <Spark values={e.spark20} width={70} height={24} direction={dir(e.chg_pct)} palette="broadsheet" />
                </span>
                <span className={`u ${dir(e.chg_pct)}`} role="cell">{pct(e.chg_pct)}</span>
                <span className={`w ${dir(krw(e.chg_pct))}`} role="cell">{pct(krw(e.chg_pct))}</span>
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
          {sectorKeys.map((k) => {
            const x = P.sectors[k];
            const v = x.chg_pct;
            const share = Math.min(1, Math.abs(v) / sectorMax);
            return (
              <div key={k} className={`ht ${dir(v)}`} style={{ "--share": share.toFixed(3) } as CSSProperties}>
                <div className="a">
                  {x.symbol} · {k}
                </div>
                <div className={`b ${dir(v)}`}>{pct(v)}</div>
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
            const facts: string[] = [];
            if (s.close != null) facts.push(`종가 ${fmt(s.close, 2)}`);
            if ((s.vol_vs_20d ?? 0) >= 1.5) facts.push(`거래량 평소 ${fmt(s.vol_vs_20d, 1)}배`);
            if ((s.streak ?? 0) >= 3) facts.push(`${s.streak}일 연속 상승`);
            if (s.ytd_pct != null) facts.push(`연초 대비 ${s.ytd_pct > 0 ? "+" : ""}${Math.round(s.ytd_pct)}%`);
            const high = s.from_52w_high_pct;
            return (
              <article className="mc" key={`${m.ticker ?? m.name}-${i}`}>
                <div className="r1">
                  <span className="n">{m.name}</span>
                  <span className="t">{m.ticker ?? ""}</span>
                  {s.chg_pct != null ? <span className={`c ${dir(s.chg_pct)}`}>{pct(s.chg_pct)}</span> : null}
                </div>
                <p className="why2">{m.reason}</p>
                {facts.length ? <p className="facts num">{facts.join(" · ")}</p> : null}
                {high != null ? (
                  <div className="hi num" aria-label={`52주 고점 대비 ${fmt(high, 1)}%`}>
                    <div className="trk">
                      <i style={{ width: `${Math.max(2, 100 + Math.max(-100, Math.min(0, high)))}%` }} />
                    </div>
                    <div className="lb">
                      <span>52주 고점 대비</span>
                      <b>{high > -1 ? "고점 부근" : `${fmt(high, 1)}%`}</b>
                    </div>
                  </div>
                ) : null}
              </article>
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
              <span className="w num">{w.kst}</span>
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

  const extras = (A.strip_extra ?? []).filter((t) => !(fx.usdkrw != null && t.label.toUpperCase().includes("USD/KRW")));
  const market = (
    <section id="market" className="s mk-sec" aria-label="마켓 스트립">
      <div className="ribbon">
        <h2>마켓 스트립</h2>
        <span className="s">지수 · 금리 · 환율 · 변동성 · 유가</span>
      </div>
      <div className="mk">
        <div className="tbl num" role="table" aria-label="지수">
          <div className="th" role="row">
            <span role="columnheader">지수</span>
            <span className="r" role="columnheader">종가</span>
            <span className="r" role="columnheader">등락</span>
            <span role="columnheader">20일</span>
            <span className="r" role="columnheader">기록·연초</span>
          </div>
          {INDEX_ROWS.map((name) => {
            const t = P.indices?.[name];
            if (!t) return null;
            const d = dir(t.chg_pct);
            return (
              <div className="tr" role="row" key={name}>
                <span className="lab" role="cell">
                  {name}
                  {t.symbol ? <small>{t.symbol}</small> : null}
                </span>
                <span className="v" role="cell">{fmt(t.close, 2)}</span>
                <span className={`d ${d}`} role="cell">{pct(t.chg_pct)}</span>
                <span className="spc" role="cell">
                  <Spark values={t.spark20} width={84} height={22} direction={d} palette="broadsheet" />
                </span>
                <span className="nt" role="cell">
                  <span>
                    기록 <b className={dir(t.from_record_pct)}>{pct(t.from_record_pct)}</b>
                  </span>
                  <span>
                    연초 <b className={dir(t.ytd_pct)}>{pct(t.ytd_pct)}</b>
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="tbl t2 num" role="table" aria-label="금리·환율·기타">
          <div className="th" role="row">
            <span role="columnheader">금리·환율·기타</span>
            <span className="r" role="columnheader">값</span>
            <span className="r" role="columnheader">등락</span>
            <span className="r" role="columnheader">비고</span>
          </div>
          {P.rates
            ? RATE_ROWS.map(([label, sub, key]) => {
                const v = P.rates?.[key];
                if (typeof v !== "number") return null;
                const isTen = key === "us10y";
                const bp = isTen && P.rates ? Math.round((P.rates.us10y - P.rates.us10y_prev) * 100) : null;
                const high = isTen ? (P.rates?.us10y_1y_high_close as number | undefined) : undefined;
                const highDate = isTen ? (P.rates?.us10y_1y_high_date as string | undefined) : undefined;
                return (
                  <div className="tr" role="row" key={key}>
                    <span className="lab" role="cell">
                      {label}
                      <small>{sub}</small>
                    </span>
                    <span className="v" role="cell">{fmt(v, 2)}</span>
                    <span className={`d ${bp == null ? "flat" : dir(bp)}`} role="cell">
                      {bp == null ? "—" : `${bp > 0 ? "+" : ""}${bp}bp`}
                    </span>
                    <span className="nt" role="cell">
                      {isTen ? <span>{`전일 ${fmt(P.rates?.us10y_prev, 2)}`}</span> : null}
                      {high != null ? <span>{`1년 고점 ${fmt(high, 2)}${highDate ? ` (${monthDay(highDate)})` : ""}`}</span> : null}
                    </span>
                  </div>
                );
              })
            : null}
          {fx.usdkrw != null ? (
            <div className="tr" role="row">
              <span className="lab" role="cell">
                USD/KRW
                <small>원·달러</small>
              </span>
              <span className="v" role="cell">{fmt(fx.usdkrw, 2)}</span>
              <span className={`d ${dir(fx.change_pct)}`} role="cell">{pct(fx.change_pct)}</span>
              <span className="nt" role="cell">
                <span>{`${(fx.change_won ?? 0) > 0 ? "+" : ""}${fmt(fx.change_won, 2)}원`}</span>
                {fx.basis ? <span>{fx.basis}</span> : null}
              </span>
            </div>
          ) : null}
          {extras.map((t) => {
            const change = t.change ? Number.parseFloat(t.change.replace(/[^0-9.+-]/g, "")) : null;
            return (
              <div className="tr" role="row" key={t.label}>
                <span className="lab" role="cell">{t.label}</span>
                <span className="v" role="cell">{t.value}</span>
                <span className={`d ${change == null || Number.isNaN(change) ? "flat" : dir(change)}`} role="cell">
                  {t.change ?? "—"}
                </span>
                <span className="nt" role="cell" />
              </div>
            );
          })}
        </div>
        <div className="mkfoot">
          {INDEX_ROWS.map((name) => {
            const t = P.indices?.[name];
            if (!t) return null;
            const [cls, text] = scoreBadge(t, P.session);
            return cls ? (
              <span key={name}>
                <b>{name}</b>
                {text}
              </span>
            ) : null;
          })}
        </div>
      </div>
    </section>
  );

  const head = (
    <>
      <header className="bs-mast">
        <div className="row">
          <div className="brand">
            100x 모닝 브리프<span>Morning Brief</span>
          </div>
          <div className="ed">
            {dateline(A.edition_date)} · 미국 {md} 장 마감 · {A.published_kst ?? "06:20"} KST
          </div>
        </div>
        <div className="row2">
          <div className="crumb">
            <TransitionLink href={ROUTES.brief}>브리핑</TransitionLink>
            <span>› 모닝 브리프</span>
          </div>
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
      </header>
    </>
  );

  const hero = (
    <div className="bs-hero">
      <div className="lead">
        <div className="kick">
          <i />
          미국장 마감 리뷰 · {readingMinutes(A)}분
        </div>
        <h1>{headlineMarkup(A.headline)}</h1>
        <p className="thesis">{A.thesis}</p>
        <div className="prov">
          {isLatest ? <span className="fresh">신선</span> : null}
          <span>AA 브리프·사실 카드 · Yahoo · 미 재무부 · Finviz · Nasdaq</span>
        </div>
      </div>
      {sp ? (
        <aside className="key num" aria-label="S&P 500 종가">
          <div className="top">
            <span>S&amp;P 500 종가 · {md}</span>
            <span>
              연초 대비 <b className={dir(sp.ytd_pct)}>{pct(sp.ytd_pct)}</b>
            </span>
          </div>
          <div className="big">{fmt(sp.close, 2)}</div>
          <div className="chg">
            <b className={dir(sp.chg_pct)}>{pct(sp.chg_pct)}</b>
            {spx ? <span>장중 저점 → 기록 구간</span> : null}
          </div>
          {spx && record ? (
            <div className="rg">
              <div className="trk" aria-hidden="true">
                <i className="fill" style={{ width: `${Math.max(2, Math.min(100, ((sp.close - spx.low) / (record - spx.low || 1)) * 100)).toFixed(1)}%` }} />
              </div>
              <div className="lb">
                <span>저점 {fmt(spx.low, 2)}</span>
                <span>기록 {sp.record_date ? `(${monthDay(sp.record_date)})` : ""}</span>
              </div>
              <div className="gap">
                <b>기록까지 {fmt(Math.abs(sp.from_record_pct ?? 0), 2)}%</b>
                <span>장중 고점 {fmt(spx.high, 2)}</span>
              </div>
            </div>
          ) : null}
          {A.tonight?.length ? (
            <div className="tn">
              <div className="k">오늘 밤 일정 · KST</div>
              <ul>
                {A.tonight.slice(0, 3).map((w, i) => (
                  <li key={`tn-${i}`}>
                    <span>{w.kst}</span>
                    {w.what}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      ) : null}
      {spx && tnx ? (
        <div className="hero-chart">
          <div className="cap">
            <h2>{st.chart_headline || "S&P 500과 10년물 금리의 장중 흐름"}</h2>
            <div className="lg">
              <span>
                <i className="spx" />
                S&amp;P 500
              </span>
              <span>
                <i className="tnx" />미 10년물
              </span>
              {record ? (
                <span>
                  <i className="rec" />
                  사상 최고 종가
                </span>
              ) : null}
            </div>
          </div>
          <SessionMap
            spx={spx.points}
            tnx={tnx.points}
            annotations={st.annotations ?? []}
            leadHours={lead}
            palette="broadsheet"
            recordClose={record}
            recordDate={sp?.record_date}
          />
          <SessionPath intraday={spx} close={P.indices["S&P 500"]?.close ?? spx.close} leadHours={lead} />
        </div>
      ) : null}
    </div>
  );

  const footer = (
    <footer>
      {`출처: AA 모닝 브리프와 사실 카드 · ${(P.sources ?? []).join(" · ")} · 장중 시각은 현지(ET) 데이터를 한국 시간으로 바꿔 표시했습니다.`}
      <p>AA 수집 자료와 시장 데이터를 AI가 기사로 재구성했습니다. 투자 권유가 아닙니다.</p>
    </footer>
  );
  return (
    <ArticleFrame
      sections={sections}
      editionDate={A.edition_date}
      head={head}
      hero={hero}
      market={market}
      footer={footer}
    />
  );
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
        <i className="up" style={{ width: `${(up / total) * 100}%` }} />
        <i className="down" style={{ width: `${(down / total) * 100}%` }} />
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
      <span className="pl">S&amp;P 500 장중 경로</span>
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
 * Broadsheet frame of the owner-chosen design (feno-canvas concept c4,
 * 2026-10-11): masthead, a sticky black section strip in place of the side
 * table of contents, the hero with the session chart, the market strip, the
 * numbered sections with their reveal-on-scroll motion and the progress bar.
 */
function ArticleFrame({
  sections,
  editionDate,
  head,
  hero,
  market,
  footer,
}: {
  sections: SectionDef[];
  editionDate: string;
  head: ReactNode;
  hero: ReactNode;
  market: ReactNode;
  footer: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const navItems = [{ id: "market", title: "마켓" }, ...sections.map((s, i) => ({ id: s.id, title: `${String(i + 1).padStart(2, "0")} ${s.title}` }))];
  const { progressRef, activeIndex, revealed } = useBriefScroll(rootRef, navItems.map((s) => s.id).join("|"), editionDate);
  return (
    <div className="fnk-brief bs" data-brief-article={editionDate} data-brief-state="ready" ref={rootRef}>
      <div className="progress" aria-hidden="true">
        <i ref={progressRef} />
      </div>
      <div className="bs-wrap">
        {head}
        <nav className="jump" aria-label="이 글의 순서">
          <span className="ed">100X · {monthDay(editionDate)}</span>
          <ol>
            {navItems.map((item, i) => (
              <li key={item.id}>
                <a href={`#${item.id}`} aria-current={i === activeIndex ? "true" : undefined}>
                  {item.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article>
          {hero}
          {market}
          {sections.map((section, i) => (
            <section key={section.id} id={section.id} className={`s${section.className ? ` ${section.className}` : ""}${revealed.has(section.id) ? "" : " pre"}`}>
              <div className="ribbon">
                <h2>
                  {String(i + 1).padStart(2, "0")} · {section.title}
                </h2>
                <span className="s">{section.label}</span>
              </div>
              {section.body}
            </section>
          ))}
          {footer}
        </article>
      </div>
    </div>
  );
}
