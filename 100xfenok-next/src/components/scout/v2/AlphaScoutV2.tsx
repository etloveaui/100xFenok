"use client";

import { useState } from "react";
import ListView from "./ListView";
import ArticleView from "./ArticleView";
import { FEATURED_ARTICLE } from "./mockData";
import type { Article, Issue } from "./types";

function toArticle(issue: Issue): Article {
  if (issue.id === FEATURED_ARTICLE.id) return FEATURED_ARTICLE;
  return {
    ...issue,
    issueLabel: `ISSUE #${issue.id}`,
    chapters: [],
    anchors: [],
    related: [],
  };
}

export default function AlphaScoutV2() {
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);

  return (
    <div className="as-stage">
      {activeIssue ? (
        <ArticleView article={toArticle(activeIssue)} onBack={() => setActiveIssue(null)} />
      ) : (
        <ListView onOpenArticle={(issue) => setActiveIssue(issue)} />
      )}
    </div>
  );
}
