#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  articleSeenAt,
  cleanCompanyName,
  computeTone,
  cueCounts,
  queryForTicker,
} from "./fetch-fenok-news-tone-proxy.mjs";

assert.equal(cleanCompanyName("NVIDIA CORP Class A"), "NVIDIA A");
assert.equal(queryForTicker("NVDA", "NVIDIA CORP"), '"NVIDIA"');
assert.deepEqual(cueCounts("Analyst upgrades company after strong profit growth"), { positive: 3, negative: 0 });
assert.deepEqual(cueCounts("Company falls after weak warning and lawsuit"), { positive: 0, negative: 4 });
assert.equal(articleSeenAt("20260628T123456Z"), "2026-06-28T12:34:56.000Z");

const positive = computeTone({
  ticker: "TEST",
  company: "Test Inc",
  payload: {
    fetched_at: "2026-06-28T00:00:00Z",
    articles: [
      { title: "Test beats expectations with strong growth", seendate: "20260627T123456Z" },
      { title: "Analysts upgrade Test after record profit", seendate: "20260628T123456Z" },
    ],
  },
});
assert(positive.direct_news_tone_proxy.score_0_100 > 50);
assert.equal(positive.direct_news_tone_proxy.article_count, 2);
assert.equal(positive.as_of, "2026-06-28T12:34:56.000Z");
assert.equal(positive.as_of_reason, null);

const empty = computeTone({
  ticker: "EMPTY",
  company: "Empty Inc",
  payload: { fetched_at: null, articles: [] },
});
assert.equal(empty.direct_news_tone_proxy.score_0_100, null);
assert.equal(empty.confidence, "very_low");
assert.equal(empty.as_of, null);
assert.match(empty.as_of_reason, /seendate/);

console.log("test-fetch-fenok-news-tone-proxy: ok");
