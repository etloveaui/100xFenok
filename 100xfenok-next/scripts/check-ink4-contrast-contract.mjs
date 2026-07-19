import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const occurrences = (source, needle) => source.split(needle).length - 1;

const tokenPlan = [
  ["src/styles/app-shell.css", 5, 5],
  ["src/app/screener/StockDetailPanel.tsx", 31, 31],
  ["src/app/screener/ScreenerClient.tsx", 6, 2],
  ["src/app/market-valuation/MarketValuationClient.tsx", 10, 10],
  ["src/app/market-valuation/structure/MarketStructureDetailClient.tsx", 5, 5],
  ["src/app/market-valuation/YardeniCard.tsx", 4, 4],
  ["src/components/dashboard/v4/TraceableNumber.tsx", 3, 2],
  ["src/components/dashboard/v4/RegimeSparkline.tsx", 3, 2],
  ["src/app/screener/ScreenerTanstackTable.tsx", 1, 1],
  ["src/app/screener/ScreenerDesktopTable.tsx", 1, 1],
  ["src/app/superinvestors/SuperinvestorsClient.tsx", 1, 1],
  ["src/app/superinvestors/InsightsTab.tsx", 1, 1],
  ["src/app/etfs/[ticker]/EtfDetailClient.tsx", 2, 2],
  ["src/app/etfs/compare/EtfCompareClient.tsx", 1, 1],
  ["src/components/screener/FenokSignalRadar.tsx", 1, 1],
  ["src/components/screener/FenokSignalHelpPopover.tsx", 1, 1],
  ["src/components/screener/PerBandBar.tsx", 2, 2],
  ["src/components/screener/FenokSignalRadarHexagon.tsx", 1, 1],
  ["src/components/screener/FenokSignalRadarHexagonChart.tsx", 1, 1],
];

const rawTextMigrations = 3;
assert.equal(
  tokenPlan.reduce((sum, [, , migrations]) => sum + migrations, 0) + rawTextMigrations,
  77,
  "the approved contrast slice must remain exactly 77 text migrations",
);

for (const [relativePath, baseline, migrations] of tokenPlan) {
  const source = read(relativePath);
  const remaining = occurrences(source, "var(--c-ink-4)") + occurrences(source, 'theme.token("ink4")');
  assert.equal(remaining, baseline - migrations, `${relativePath} has an unexpected ink-4 survivor count`);
}

const shell = read("src/styles/app-shell.css");
assert.match(shell, /--shell-foreground-faint:#767f8c;/, "light faint token must use the approved contrast bump");
assert.match(shell, /--shell-foreground-faint:var\(--fnk-neutral-500\)/, "dark theme faint token must remain unchanged");
assert.match(shell, /--c-ink-4:var\(--shell-foreground-faint\)/, "ink-4 token wiring must remain intact");
assert.match(read("src/app/globals.css"), /--fnk-neutral-400: #94a3b8;/, "global neutral-400 must not be widened");

const screener = read("src/app/screener/ScreenerClient.tsx");
assert.equal(occurrences(screener, "hover:border-[var(--c-ink-4)]"), 4, "only four screener hover borders may retain ink-4");

const traceable = read("src/components/dashboard/v4/TraceableNumber.tsx");
assert.match(traceable, /offline: \{ dot: "var\(--c-ink-4\)"/, "offline dot must retain ink-4");
assert.match(
  traceable,
  /data\.tone === "offline" \? "var\(--c-ink-3\)" : tone\.dot/,
  "offline status text must use ink-3 without changing semantic dot colors",
);

const sparkline = read("src/components/dashboard/v4/RegimeSparkline.tsx");
assert.match(sparkline, /var\(--c-ink-4\) 10%/, "neutral chart band must retain ink-4");

assert.match(
  read("src/lib/market-valuation/charts/MarketChartEngineClient.tsx"),
  /ctx\.strokeStyle = theme\.token\("ink4"\)/,
  "chart crosshair must retain ink-4",
);
assert.match(
  read("src/lib/market-valuation/charts/chartTheme.ts"),
  /ink4: "--c-ink-4"/,
  "chart token bridge must retain ink-4",
);

const legacyScreener = read("src/styles/cp-w4-screener.css");
assert.equal(occurrences(legacyScreener, "#94a3b8"), 2, "only the search icon may retain raw ink-4");
assert.equal(occurrences(legacyScreener, "#64748b"), 4, "three legacy text sites must move to ink-3");
assert.equal(occurrences(read("src/styles/route-embed.css"), "#94a3b8"), 1, "embed border must retain raw ink-4");

console.log("ink-4 contrast contract: PASS (77 text migrations; non-text survivors preserved)");
