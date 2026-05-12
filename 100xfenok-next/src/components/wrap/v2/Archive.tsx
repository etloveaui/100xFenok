"use client";

import { useMemo, useState } from "react";
import { v2cx } from "@/components/dashboard/v2/types";
import { AVAILABLE_TAGS, ARCHIVE_DATA } from "./mockData";

export default function Archive() {
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return ARCHIVE_DATA.filter((entry) => {
      if (activeTags.size > 0) {
        const has = entry.tags.some((t) => activeTags.has(t));
        if (!has) return false;
      }
      if (query.trim()) {
        const q = query.toLowerCase();
        const hay = `${entry.title} ${entry.date} ${entry.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [query, activeTags]);

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  return (
    <section className="mw-archive">
      <div className="mw-archive-head">
        <span className="kicker">아카이브</span>
        <h2 className="mw-archive-title">지난 wrap 다시 보기</h2>
      </div>
      <div className="mw-archive-toolbar">
        <div className="mw-archive-search">
          <i className="fas fa-search" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="제목 · 날짜 · 태그 검색"
            aria-label="아카이브 검색"
          />
          {query ? (
            <button
              type="button"
              className="mw-archive-clear"
              onClick={() => setQuery("")}
              aria-label="검색어 지우기"
            >
              <i className="fas fa-times" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="mw-archive-tags">
        {AVAILABLE_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            className={v2cx("mw-tag", activeTags.has(tag) && "is-on")}
            onClick={() => toggleTag(tag)}
            aria-pressed={activeTags.has(tag)}
          >
            {tag}
          </button>
        ))}
        {activeTags.size > 0 ? (
          <button
            type="button"
            className="mw-tag-clear"
            onClick={() => setActiveTags(new Set())}
          >
            전체 해제 ×
          </button>
        ) : null}
      </div>
      {filtered.length === 0 ? (
        <div className="mw-archive-empty">검색 조건에 맞는 wrap이 없습니다.</div>
      ) : (
        <div className="mw-archive-grid">
          {filtered.map((entry) => {
            const isUp = entry.dayDelta >= 0;
            return (
              <article key={entry.date} className="mw-archive-card">
                <span className="kicker">{entry.date}</span>
                <h3 className="mw-archive-card-title">{entry.title}</h3>
                <div className="mw-archive-card-tags">
                  {entry.tags.map((tag) => (
                    <span key={tag} className="mw-archive-card-tag">{tag}</span>
                  ))}
                </div>
                <div className="mw-archive-card-foot">
                  <span
                    className={v2cx(
                      "mono",
                      isUp ? "mw-archive-card-delta-up" : "mw-archive-card-delta-down",
                    )}
                  >
                    {isUp ? "+" : ""}
                    {entry.dayDelta.toFixed(2)}%
                  </span>
                  <span className="mw-archive-card-link">→</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
