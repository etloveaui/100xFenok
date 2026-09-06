import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  EarningsDocument,
  EarningsIncome,
  EarningsPeriod,
} from "../src/lib/earnings/types";

const componentUrl = new URL(
  "../src/components/earnings/EarningsOverviewPanel.tsx",
  import.meta.url,
);
assert.ok(
  existsSync(componentUrl),
  "the shared earnings panel must exist before renderer behavior is evaluated",
);

function installCssModuleLoader(): () => void {
  const testRequire = createRequire(import.meta.url);
  const previousLoader = testRequire.extensions[".css"];
  testRequire.extensions[".css"] = (module, filename) => {
    const source = readFileSync(filename, "utf8");
    const classNames = new Set<string>();
    for (const match of source.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
      classNames.add(match[1]);
    }
    module.exports = Object.fromEntries(
      Array.from(classNames, (className) => [className, className]),
    );
  };
  return () => {
    if (previousLoader) {
      testRequire.extensions[".css"] = previousLoader;
    } else {
      delete testRequire.extensions[".css"];
    }
  };
}

async function main(): Promise<void> {
  const restoreCssModuleLoader = installCssModuleLoader();
  try {
    const { EarningsOverviewPanel } = await import(componentUrl.href);

    function assertIncludes(html: string, needle: string, message: string): void {
      assert.ok(html.includes(needle), `${message}: expected ${JSON.stringify(needle)}`);
    }

    function assertNotIncludes(html: string, needle: string, message: string): void {
      assert.ok(!html.includes(needle), `${message}: did not expect ${JSON.stringify(needle)}`);
    }

const actualIncome: EarningsIncome = {
  revenue: 125_000_000_000,
  costOfRevenue: 70_000_000_000,
  grossProfit: 55_000_000_000,
  operatingExpenses: 30_000_000_000,
  operatingIncome: 25_000_000_000,
  pretaxIncome: 25_800_000_000,
  incomeTax: 4_800_000_000,
  netIncome: 21_000_000_000,
  dilutedEps: 1.4,
};

const priorIncome: EarningsIncome = {
  revenue: 120_000_000_000,
  costOfRevenue: 68_000_000_000,
  grossProfit: 52_000_000_000,
  operatingExpenses: 29_000_000_000,
  operatingIncome: 23_000_000_000,
  pretaxIncome: 23_600_000_000,
  incomeTax: 4_400_000_000,
  netIncome: 19_200_000_000,
  dilutedEps: 1.2,
};

function makePeriod(
  income: EarningsIncome,
  overrides: Partial<EarningsPeriod> = {},
): EarningsPeriod {
  return {
    end: "2026-06-30",
    label: "2026년 2분기",
    income,
    source: {
      name: "Apple 10-Q",
      url: "https://example.com/aapl-10q?period=2026-06-30&source=sec",
      filedAt: "2026-07-31",
    },
    segments: [
      { name: "제품", revenue: 70_000_000_000 },
      { name: "서비스", revenue: 55_000_000_000 },
    ],
    segmentBasis: "reported revenue segments",
    notes: ["Actual reported results"],
    ...overrides,
  };
}

const document: EarningsDocument = {
  schemaVersion: 1,
  ticker: "AAPL",
  companyName: "Apple Inc.",
  currency: "USD",
  updatedAt: "2026-08-01T00:00:00Z",
  status: "current",
  notice: null,
  periods: [
    makePeriod(actualIncome),
    makePeriod(priorIncome, {
      end: "2026-03-31",
      label: "2026년 1분기",
      source: {
        name: "Apple 10-Q",
        url: "https://example.com/aapl-10q-q1",
        filedAt: "2026-05-01",
      },
      segments: [],
      segmentBasis: null,
    }),
  ],
};

const expanded = renderToStaticMarkup(
  createElement(EarningsOverviewPanel, { document }),
);

assertIncludes(expanded, 'data-earnings-overview="AAPL"', "the panel identifies the ticker");
assertIncludes(expanded, "Apple Inc.", "the panel identifies the company");
assertIncludes(expanded, "USD", "the panel states the currency");
assertIncludes(expanded, "2026년 2분기", "the panel states the selected period label");
assertIncludes(expanded, "2026-06-30", "the panel states the actual quarter end");
assertIncludes(expanded, "Apple 10-Q", "the panel states the source identity");
assertIncludes(
  expanded,
  'href="https://example.com/aapl-10q?period=2026-06-30&amp;source=sec"',
  "the panel keeps a source link with an escaped query string",
);
assertIncludes(expanded, "매출", "the panel labels revenue in Korean");
assertIncludes(expanded, "EPS", "the panel labels per-share earnings");
assertIncludes(expanded, "영업이익률", "the panel labels operating margin");
assertIncludes(expanded, "순이익", "the panel labels net income");
assertIncludes(expanded, "최근 분기", "the panel provides recent-quarter comparison context");
assertIncludes(expanded, "제품", "valid supplied revenue segments are visible");
assertIncludes(expanded, "서비스", "valid supplied revenue segments are visible");
assertNotIncludes(expanded, "예상치", "the actual-only panel does not invent estimates");
assertNotIncludes(expanded, "컨센서스", "the actual-only panel does not invent consensus data");

assert.match(
  expanded,
  /<select\b[^>]*aria-label="[^"]*기간[^"]*"[^>]*>/,
  "the period selector is a keyboard-accessible native select",
);
assert.match(
  expanded,
  /<option\b[^>]*value="2026-06-30"[^>]*>[\s\S]*?2026년 2분기[\s\S]*?<\/option>/,
  "the selected option carries the actual quarter end value",
);

assertIncludes(expanded, 'data-earnings-flow="sankey"', "positive income data uses a Sankey flow");
for (const node of [
  "revenue",
  "costOfRevenue",
  "grossProfit",
  "operatingExpenses",
  "operatingIncome",
  "pretaxIncome",
  "incomeTax",
  "netIncome",
] as const) {
  assertIncludes(
    expanded,
    `data-earnings-flow-node="${node}"`,
    `positive income flow exposes the ${node} stage`,
  );
}
assertNotIncludes(expanded, "width:-", "positive flow never emits a negative width");
assertNotIncludes(expanded, "width: -", "positive flow never emits a negative width");

const compact = renderToStaticMarkup(
  createElement(EarningsOverviewPanel, { document, compact: true }),
);
assertIncludes(compact, 'data-earnings-compact="true"', "compact rendering declares its mode");
assertIncludes(compact, "매출", "compact rendering keeps the revenue summary");
assertIncludes(compact, "EPS", "compact rendering keeps the EPS summary");
assertNotIncludes(compact, 'data-earnings-flow="sankey"', "compact rendering omits the wide flow visual");
assert.match(compact, /<details\b[\s\S]*?<summary[\s\S]*?>/, "details remain explicitly expandable");

const missingNumbers = {
  ...document,
  periods: [
    makePeriod({
      ...actualIncome,
      operatingIncome: null,
      netIncome: null,
      dilutedEps: null,
    }),
  ],
};
const missingHtml = renderToStaticMarkup(
  createElement(EarningsOverviewPanel, { document: missingNumbers }),
);
assertIncludes(missingHtml, "—", "missing numbers render a clear placeholder");
assert.match(
  missingHtml,
  /data-earnings-metric="dilutedEps"[\s\S]*?—/,
  "missing EPS renders a placeholder within the EPS metric",
);
assert.match(
  missingHtml,
  /data-earnings-metric="netIncome"[\s\S]*?—/,
  "missing net income renders a placeholder within the net-income metric",
);
assertNotIncludes(missingHtml, "$0", "missing numbers are not silently converted to zero");

const lossPeriod = makePeriod(
  {
    ...actualIncome,
    operatingExpenses: 60_000_000_000,
    operatingIncome: -5_000_000_000,
    pretaxIncome: -5_500_000_000,
    incomeTax: -500_000_000,
    netIncome: -5_000_000_000,
    dilutedEps: -0.2,
  },
  { segments: [] },
);
const lossHtml = renderToStaticMarkup(
  createElement(EarningsOverviewPanel, {
    document: { ...document, periods: [lossPeriod] },
  }),
);
assertIncludes(lossHtml, 'data-earnings-flow="bridge"', "losses use a signed bridge fallback");
assert.match(lossHtml, /[−-]\s*5/, "the loss fallback shows a signed negative value");
assertNotIncludes(lossHtml, "width:-", "loss fallback never asks SVG for a negative width");
assertNotIncludes(lossHtml, "width: -", "loss fallback never asks SVG for a negative width");

const invalidSegments = makePeriod(actualIncome, {
  segments: [
    { name: "잘못된 제품", revenue: 80_000_000_000 },
    { name: "잘못된 서비스", revenue: 80_000_000_000 },
  ],
});
const invalidSegmentHtml = renderToStaticMarkup(
  createElement(EarningsOverviewPanel, {
    document: { ...document, periods: [invalidSegments] },
  }),
);
assertNotIncludes(
  invalidSegmentHtml,
  "잘못된 제품",
  "revenue segments whose sum fails validation stay absent",
);
assertNotIncludes(
  invalidSegmentHtml,
  "잘못된 서비스",
  "revenue segments whose sum fails validation stay absent",
);

const unsafeTextDocument: EarningsDocument = {
  ...document,
  companyName: '<strong data-x="1">AAPL</strong>',
  periods: [
    makePeriod(actualIncome, {
      source: {
        name: '<img src=x onerror="alert(1)">',
        url: "https://example.com/safe-filing",
        filedAt: "2026-07-31",
      },
      segments: [{ name: '<svg onload="alert(1)">', revenue: 125_000_000_000 }],
      notes: ['</p><script>alert("x")</script>'],
    }),
  ],
};
const unsafeHtml = renderToStaticMarkup(
  createElement(EarningsOverviewPanel, { document: unsafeTextDocument }),
);
assertNotIncludes(unsafeHtml, "<img src=x", "source names remain text, never executable markup");
assertNotIncludes(unsafeHtml, "<svg onload", "segment names remain text, never executable markup");
assertNotIncludes(unsafeHtml, "<script>", "notes remain text, never executable markup");
assertIncludes(unsafeHtml, "&lt;strong", "company names are HTML-escaped");
assertIncludes(unsafeHtml, "&lt;img", "source names are HTML-escaped");

const retainedDocument: EarningsDocument = {
  ...document,
  status: "retained",
  notice: "새 관측을 확인하지 못해 이전 분기를 유지합니다.",
};
const retainedHtml = renderToStaticMarkup(
  createElement(EarningsOverviewPanel, { document: retainedDocument }),
);
assertIncludes(retainedHtml, "새 관측을 확인하지 못해 이전 분기를 유지합니다.", "retained data explains why it is shown");
assertIncludes(retainedHtml, "2026-06-30", "retained data keeps the period date visible");

    console.log("[test-earnings-ui] RED contract ready");
  } finally {
    restoreCssModuleLoader();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
