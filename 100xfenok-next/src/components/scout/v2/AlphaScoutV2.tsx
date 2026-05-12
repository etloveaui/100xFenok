"use client";

import { useState } from "react";
import ListView from "./ListView";
import ArticleView from "./ArticleView";
import type { Issue } from "./types";

export default function AlphaScoutV2() {
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);

  return (
    <div className="as-stage">
      {activeIssue ? (
        <ArticleView onBack={() => setActiveIssue(null)} />
      ) : (
        <ListView onOpenArticle={(issue) => setActiveIssue(issue)} />
      )}
    </div>
  );
}
