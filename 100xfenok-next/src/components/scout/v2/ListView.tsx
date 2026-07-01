"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { v2cx } from "@/components/dashboard/v2/types";
import { ROUTES, withQuery } from "@/lib/routes";
import CoverCard from "./CoverCard";
import { ISSUES } from "./mockData";
import type { Issue } from "./types";

export default function ListView({
  onOpenArticle,
}: {
  onOpenArticle: (issue: Issue) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    ISSUES.forEach((issue) => issue.tags.forEach((t) => set.add(t)));
    return Array.from(set);
  }, []);

  const filtered = useMemo(() => {
    return ISSUES.filter((issue) => {
      if (activeTag && !issue.tags.includes(activeTag)) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const hay = `${issue.headline} ${issue.dek} ${issue.kicker} ${issue.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [query, activeTag]);

  const [featured, ...rest] = filtered.length > 0 ? filtered : ISSUES;

  const byMonth = useMemo(() => {
    const map = new Map<string, Issue[]>();
    rest.forEach((issue) => {
      const arr = map.get(issue.monthLabel) ?? [];
      arr.push(issue);
      map.set(issue.monthLabel, arr);
    });
    return Array.from(map.entries());
  }, [rest]);

  return (
    <div className="as-list" data-alpha-scout-surface>
      <header className="as-list__head">
        <span className="kicker">100x Alpha Scout · 주간 딥다이브</span>
        <h1 className="as-list__title">알파 스카우트 · 이번 주 리포트</h1>
        <div className="as-preview-strip" data-alpha-scout-preview-strip>
          <span className="as-preview-strip__badge">미리보기</span>
          <span>정적 샘플 리포트 기반</span>
          <span>{ISSUES.length}개 리포트</span>
        </div>
        <div className="as-route-owner" data-alpha-scout-route-owner="v2-report-archive">
          <span>아카이브 기준</span>
          <strong>V2 리포트 아카이브</strong>
        </div>
        <nav className="as-route-actions" aria-label="Alpha Scout 연결" data-alpha-scout-action-rail>
          <Link href={ROUTES.posts} data-alpha-scout-owner-link="posts">
            분석 아카이브
          </Link>
          <Link href={ROUTES.dailyWrap} data-alpha-scout-owner-link="daily-wrap">
            Daily Wrap
          </Link>
          <Link
            href={withQuery(ROUTES.alphaScout, { report: "2025-08-24_100x-alpha-scout.html" })}
            data-alpha-scout-owner-link="legacy-report"
          >
            레거시 리포트
          </Link>
        </nav>
      </header>
      <div className="as-filter" data-alpha-scout-filter>
        <div className="as-filter__search" data-alpha-scout-search>
          <i className="fas fa-search" aria-hidden="true" />
          <input
            type="search"
            placeholder="제목 · 섹터 · 티커 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="아카이브 검색"
          />
        </div>
        <div className="as-filter__tags">
          {allTags.slice(0, 8).map((tag) => (
            <button
              key={tag}
              type="button"
              className={v2cx("as-tag", activeTag === tag && "is-on")}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              aria-pressed={activeTag === tag}
              data-alpha-scout-tag={tag}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
      {featured ? (
        <section className="as-hero-section" data-alpha-scout-featured>
          <CoverCard issue={featured} variant="hero" onClick={onOpenArticle} />
        </section>
      ) : null}
      {byMonth.map(([month, issues]) => (
        <section key={month} className="as-month" data-alpha-scout-month={month}>
          <h2 className="as-month__label">{month}</h2>
          <div className="as-month__grid">
            {issues.map((issue) => (
              <CoverCard
                key={issue.id}
                issue={issue}
                variant="row"
                onClick={onOpenArticle}
              />
            ))}
          </div>
        </section>
      ))}
      {filtered.length === 0 ? (
        <div className="as-empty">검색 조건에 맞는 리포트가 없습니다.</div>
      ) : null}
    </div>
  );
}
