"use client";

import { Fragment, useCallback, useState, type ReactNode } from "react";
import { v2cx } from "@/components/dashboard/v2/types";
import Sparkline from "./Sparkline";
import PickChip from "./PickChip";
import { FEATURED_ARTICLE } from "./mockData";
import type { ScoutChapter } from "./types";

const ANCHOR_RE = /(\[\[anchor:\d+\]\])/g;

function renderParagraph(text: string, onAnchor: (id: number) => void): ReactNode {
  return text.split(ANCHOR_RE).map((part, idx) => {
    const match = /^\[\[anchor:(\d+)\]\]$/.exec(part);
    if (match) {
      const id = Number(match[1]);
      return (
        <button
          key={idx}
          type="button"
          className="as-sup"
          onClick={() => onAnchor(id)}
          aria-label={`앵커 ${id}로 이동`}
        >
          {id}
        </button>
      );
    }
    const emRe = /<em>(.*?)<\/em>/g;
    const subParts: ReactNode[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = emRe.exec(part)) !== null) {
      if (m.index > lastIdx) subParts.push(part.slice(lastIdx, m.index));
      subParts.push(<em key={`em-${idx}-${m.index}`}>{m[1]}</em>);
      lastIdx = emRe.lastIndex;
    }
    if (lastIdx < part.length) subParts.push(part.slice(lastIdx));
    return <Fragment key={idx}>{subParts.length > 0 ? subParts : part}</Fragment>;
  });
}

export default function ArticleView({ onBack }: { onBack: () => void }) {
  const article = FEATURED_ARTICLE;
  const [activeAnchor, setActiveAnchor] = useState<number | null>(null);

  const handleAnchor = useCallback((id: number) => {
    if (typeof document !== "undefined") {
      const node = document.querySelector<HTMLElement>(`[data-anchor-id="${id}"]`);
      if (node && typeof node.scrollIntoView === "function") {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    setActiveAnchor(id);
    window.setTimeout(() => setActiveAnchor((cur) => (cur === id ? null : cur)), 1200);
  }, []);

  return (
    <div className="as-article">
      <div className="as-article__breadcrumb">
        <button type="button" className="as-back" onClick={onBack}>
          ← 아카이브로
        </button>
        <span className="as-breadcrumb__sep">/</span>
        <span>{article.issueLabel}</span>
      </div>
      <header className="as-art-hero">
        <span className="kicker as-art-hero__kicker">{article.kicker}</span>
        <h1 className="as-art-hero__headline">{article.headline}</h1>
        <p className="as-art-hero__dek">{article.dek}</p>
        <div className="as-art-hero__meta">
          <span className="as-art-hero__issue">{article.issueLabel}</span>
          <span className="as-art-hero__date">{article.dateLabel}</span>
          <span className="as-art-hero__read">{article.readMin}분 읽기</span>
        </div>
        <div className="as-art-hero__picks">
          {article.picks.map((pick) => (
            <PickChip key={pick.ticker} pick={pick} />
          ))}
        </div>
      </header>
      <div className="as-art-body">
        <aside className="as-toc" aria-label="목차">
          <span className="kicker">목차</span>
          <ol>
            {article.chapters.map((chapter: ScoutChapter, idx) => (
              <li key={chapter.id}>
                <a href={`#${chapter.id}`}>
                  <span className="as-toc__num">{String(idx + 1).padStart(2, "0")}</span>
                  <span>{chapter.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </aside>
        <div className="as-prose">
          {article.chapters.map((chapter) => (
            <article key={chapter.id} id={chapter.id} className="as-chapter">
              <span className="kicker">{chapter.kicker}</span>
              <h2>{chapter.title}</h2>
              {chapter.paragraphs.map((para, idx) => (
                <p key={idx}>{renderParagraph(para, handleAnchor)}</p>
              ))}
            </article>
          ))}
          <p className="as-disclaimer">
            본 리포트는 투자 참고용입니다. 매수/매도 권유가 아니며, 포지셔닝은 본인 판단으로 진행하세요.
          </p>
        </div>
        <aside className="as-rail" aria-label="앵커 데이터 레일">
          <div className="as-rail__head">
            <span className="kicker">앵커 데이터</span>
            <span className="mono">{article.anchors.length} 개</span>
          </div>
          <div className="as-rail__list">
            {article.anchors.map((anchor) => (
              <div
                key={anchor.id}
                data-anchor-id={anchor.id}
                className={v2cx("as-anchor", activeAnchor === anchor.id && "is-flash")}
              >
                <div className="as-anchor__head">
                  <span className="as-anchor__id">{String(anchor.id).padStart(2, "0")}</span>
                  <span className="as-anchor__kicker">{anchor.kicker}</span>
                  <span className="mono as-anchor__sym">{anchor.sym}</span>
                </div>
                <div className="as-anchor__value-row">
                  <span className="as-anchor__value">{anchor.value}</span>
                  <Sparkline points={anchor.spark} tone={anchor.tone} width={80} height={26} />
                </div>
                <span className={v2cx("as-anchor__delta", `as-anchor__delta--${anchor.tone}`)}>
                  {anchor.delta}
                </span>
                <p className="as-anchor__meta">{anchor.meta}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
