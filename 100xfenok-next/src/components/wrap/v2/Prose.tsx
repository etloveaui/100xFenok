"use client";

import { Fragment, type ReactNode } from "react";
import type { WrapChapter } from "./types";

const ANCHOR_RE = /(\[\[anchor:\d+\]\])/g;

function renderParagraph(
  paragraph: string,
  onAnchorClick: (id: number) => void,
): ReactNode {
  const parts = paragraph.split(ANCHOR_RE);
  return parts.map((part, idx) => {
    const match = /^\[\[anchor:(\d+)\]\]$/.exec(part);
    if (match) {
      const id = Number(match[1]);
      return (
        <button
          key={idx}
          type="button"
          className="mw-anchor-sup"
          onClick={() => onAnchorClick(id)}
          aria-label={`앵커 ${id}로 이동`}
        >
          {id}
        </button>
      );
    }
    return <Fragment key={idx}>{part}</Fragment>;
  });
}

export default function Prose({
  chapters,
  onAnchorClick,
}: {
  chapters: WrapChapter[];
  onAnchorClick: (id: number) => void;
}) {
  return (
    <div className="mw-prose">
      {chapters.map((chapter) => (
        <article key={chapter.kicker} className="mw-chapter">
          <span className="kicker">{chapter.kicker}</span>
          <h2 className="mw-chapter-title">{chapter.title}</h2>
          {chapter.paragraphs.map((para, idx) => (
            <p key={idx} className="mw-chapter-body">
              {renderParagraph(para, onAnchorClick)}
            </p>
          ))}
        </article>
      ))}
      <p className="mw-disclaimer">
        본 wrap의 정보는 투자 참고 목적으로 제공되며, 매수/매도 권유가 아닙니다.
        포지셔닝은 본인 판단으로 진행하세요.
      </p>
    </div>
  );
}
