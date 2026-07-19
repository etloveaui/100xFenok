#!/usr/bin/env node
// Deterministic contract test for the shared number formatter (src/lib/format.ts),
// the SSOT for cp-design-system-spec.md §H rule 4 ("one number language per metric",
// currency-origin: USD -> $..B, KRW -> ..조원). First test coverage for this module.
//
// Every assertion pins an EXACT output string. Because format.ts hard-codes its
// locale arguments ("ko-KR"/"en-US"), these exact-string checks double as the
// no-locale-drift pin: if a hard-coded locale is ever swapped for an env-dependent
// one (e.g. toLocaleString(undefined, ...)), a non-ko_KR CI would break these.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  finiteNumber,
  formatBasisPoints,
  formatCompactMoney,
  formatCompactNumber,
  formatCurrency,
  formatCurrencyCompact,
  formatDecimal,
  formatInteger,
  formatMoney,
  formatMultiple,
  formatPercent,
  formatShares,
  formatSignedDecimal,
  formatSignedPercent,
  normalizeCurrency,
} from "../src/lib/format";
import {
  formatCompactMarketCap,
  formatNumber as formatCpScreenerNumber,
  formatPercent as formatCpScreenerPercent,
  formatScore as formatCpScreenerScore,
} from "../src/components/canvas-plus/CpScreenerLabModel";
import {
  etfClassificationLabels,
  formatNumber as formatEtfUniverseNumber,
  formatTypeHint,
} from "../src/app/explore/etfUniverseUtils";
import {
  fmtCompactNumber,
  fmtPriceUsd,
  fmtSignedPct,
  fmtVolumeCompact,
} from "../src/app/etfs/etfSurfaceData";

const eq = (actual: string, expected: string, label: string) => assert.equal(actual, expected, label);

// --- finiteNumber: honest parsing, no NaN/Infinity leakage ---
assert.equal(finiteNumber(12), 12);
assert.equal(finiteNumber("12.5"), 12.5);
assert.equal(finiteNumber(""), null);
assert.equal(finiteNumber("abc"), null);
assert.equal(finiteNumber(null), null);
assert.equal(finiteNumber(undefined), null);
assert.equal(finiteNumber(NaN), null);
assert.equal(finiteNumber(Infinity), null);
assert.equal(finiteNumber(0), 0); // zero is a real value, never treated as missing

// --- percent ---
eq(formatPercent(0.1234), "12.3%", "percent default 1-digit fraction");
eq(formatPercent(0.1234, { digits: 2 }), "12.34%", "percent 2 digits");
eq(formatPercent(12.3, { fraction: false }), "12.3%", "percent already-scaled");
eq(formatSignedPercent(0.05), "+5.0%", "signed percent positive gets +");
eq(formatSignedPercent(-0.05), "-5.0%", "signed percent negative (existing ASCII minus)");
eq(formatSignedPercent(0), "0.0%", "signed percent exact zero has no sign");
eq(formatSignedPercent(-0), "0.0%", "signed percent negative zero has no sign");
eq(formatPercent(null), "—", "percent null -> em dash, never 0");
eq(formatPercent("abc"), "—", "percent non-numeric -> em dash");
eq(formatPercent(0), "0.0%", "percent zero is a real value");

// --- currency (full) ---
eq(formatCurrency(1234.5, "USD"), "$1,234.50", "USD currency 2 digits");
eq(formatCurrency(1234.5, "KRW"), "₩1,234.50", "KRW currency symbol");
eq(formatCurrency(null, "USD"), "—", "currency null -> em dash");

// --- currency-origin compact (§H rule 4 core: USD B/T vs KRW 조/억/만원) ---
eq(formatCurrencyCompact(1_500_000_000, "USD"), "$1.5B", "USD billions");
eq(formatCurrencyCompact(2_500_000_000_000, "USD"), "$2.5T", "USD trillions");
eq(formatCurrencyCompact(2_500_000, "USD"), "$2.5M", "USD millions");
eq(formatCurrencyCompact(999, "USD"), "$999.00", "USD sub-thousand keeps cents");
eq(formatCurrencyCompact(150_000_000_000, "KRW"), "1,500억원", "KRW 억원");
eq(formatCurrencyCompact(3_000_000_000_000, "KRW"), "3.0조원", "KRW 조원");
eq(formatCurrencyCompact(50_000, "KRW"), "5.0만원", "KRW 만원");
eq(formatCurrencyCompact(null, "USD"), "—", "currency compact null -> em dash");
// The metric never mixes number languages: a USD value never renders 조/억, a KRW value never renders $.
assert.ok(!formatCurrencyCompact(3_000_000_000_000, "USD").includes("조"), "USD must not render 조");
assert.ok(!formatCurrencyCompact(3_000_000_000_000, "KRW").includes("$"), "KRW must not render $");

// --- ratio / x-multiple / basis points ---
eq(formatMultiple(12.34), "12.3배", "x-multiple");
eq(formatMultiple(null), "—", "multiple null");
eq(formatBasisPoints(25), "25.0bp", "basis points");

// --- decimals / integers ---
eq(formatDecimal(1234.567, { digits: 2 }), "1,234.57", "decimal grouped 2 digits");
eq(formatInteger(1234567), "1,234,567", "integer grouped");
eq(formatSignedDecimal(-3.2), "−3.2", "signed decimal uses U+2212 minus (existing)");
eq(formatSignedDecimal(3.2), "+3.2", "signed decimal positive");

// --- compact number (currency-agnostic) ---
eq(formatCompactNumber(1_500_000), "1.5M", "compact millions");
eq(formatCompactNumber(2_500_000_000_000), "2.5T", "compact trillions");
eq(formatCompactNumber(999), "999", "compact sub-thousand");

// --- share counts (new) ---
eq(formatShares(1234567), "1,234,567주", "shares full");
eq(formatShares(150_000_000, { compact: true }), "1.5억주", "shares compact 억");
eq(formatShares(50_000, { compact: true }), "5.0만주", "shares compact 만");
eq(formatShares(500, { compact: true }), "500주", "shares compact sub-만 stays plain");
eq(formatShares(null), "—", "shares null -> em dash");

// --- multi-currency money (folded from the per-route helper) ---
// USD/KRW keep currency-origin; other ISO codes go through Intl currency style.
eq(normalizeCurrency("jpy"), "JPY", "normalizeCurrency upcases valid ISO code");
eq(normalizeCurrency("12"), "USD", "normalizeCurrency falls back to USD on non-ISO");
eq(formatMoney(1234.5, "USD"), "$1,234.5", "money USD");
eq(formatMoney(1234567, "KRW"), "₩1,234,567", "money KRW (zero-decimal)");
eq(formatMoney(1234.5, "JPY"), "¥1,235", "money JPY (zero-decimal rounds)");
eq(formatMoney(1234.5, "HKD"), "HK$1,234.5", "money HKD");
eq(formatMoney(null, "USD"), "—", "money null -> em dash");
// (Invalid-code output is intentionally NOT pinned: whether Intl throws for a
// non-ISO code is ICU/runtime-dependent. The fallback path pins its OWN locale
// to en-US for no-drift, but the throw-vs-render decision is not our contract.)
eq(formatCompactMoney(2_500_000_000, "USD"), "$2.5B", "compact money USD delegates to currency-origin");
eq(formatCompactMoney(3_000_000_000_000, "KRW"), "3.0조원", "compact money KRW delegates to currency-origin");
eq(formatCompactMoney(1_500_000_000, "JPY"), "¥2B", "compact money JPY via Intl compact");
eq(formatCompactMoney(2_500_000, "HKD"), "HK$2.5M", "compact money HKD via Intl compact");
eq(formatCompactMoney(null, "EUR"), "—", "compact money null -> em dash");

// --- custom empty label passthrough (honest missing, not 0) ---
eq(formatPercent(null, { empty: "N/A" }), "N/A", "custom empty label honored");
eq(formatCurrencyCompact(null, "USD", "미제공"), "미제공", "currency compact custom empty");

// --- Approved visible-delta adoption wave (2026-07-19 owner gate) ---
// CpScreener marketCap values are expressed in USD millions before formatting.
eq(formatCompactMarketCap(1_234_500), "$1.2T", "CpScreener market cap reconciles million-unit scale");
eq(formatCompactMarketCap(null), "—", "CpScreener market cap empty -> em dash");
eq(formatCpScreenerNumber(1234.5, 2), "1,234.50", "CpScreener decimal grouping");
eq(formatCpScreenerScore(1234.5), "1,235", "CpScreener integer grouping");
eq(formatCpScreenerPercent(0), "0.0%", "CpScreener zero-sign behavior remains unchanged");

eq(formatEtfUniverseNumber(1234567), "1,234,567", "ETF universe integer uses shared locale pin");
eq(
  formatTypeHint({ ticker: "ZERO", category: "테스트", change: 0, performance: { tr1y: 0 } }),
  "ZERO · 테스트 · 변동률 0.00% · 1년 0.00%",
  "ETF universe local signed percent exact zero has no sign",
);
assert.match(
  formatTypeHint({
    ticker: "TST",
    name: "Test 2x ETF",
    classification: { is_leveraged: true, leverage_factor: 2 },
  }),
  /2배/,
  "ETF type hint renders Korean multiple unit",
);
assert.deepEqual(
  etfClassificationLabels({ classification: { is_leveraged: true, leverage_factor: 2 } }),
  ["2배 레버리지"],
  "ETF classification label renders Korean multiple unit",
);

eq(fmtCompactNumber(null), "—", "ETF surface integer empty -> em dash");
eq(fmtPriceUsd(1234.5), "$1,234.50", "ETF surface USD price grouped with fixed cents");
eq(fmtPriceUsd(100), "$100.00", "ETF surface USD price keeps fixed cents across the old tier boundary");
eq(fmtSignedPct(0), "+0.00%", "ETF surface zero-sign behavior remains unchanged");
eq(fmtVolumeCompact(1234), "1.2K", "ETF surface volume uses shared compact language");

// Private route helpers stay pinned through source-level adoption checks until
// they are exported. This also prevents a route from silently reintroducing a
// bespoke formatter while the shared output contract still passes.
const adoptionContracts: Array<[string, string[]]> = [
  ["src/styles/app-shell.css", ["--c-warn-ink:#a3560d"]],
  ["src/components/canvas-plus/CpScreenerLabModel.ts", ["formatCurrencyCompact(value === null ? null : value * 1_000_000", "formatDecimal(value, { digits })"]],
  ["src/components/canvas-plus/charts/CpPriceChartImpl.client.tsx", ["return formatSharedCurrency(value, \"USD\");", "maximumFractionDigits: 2", "return formatCompactNumber(value);"]],
  ["src/app/etfs/etfSurfaceData.ts", ["return formatCurrency(value, \"USD\");", "return formatCompactNumber(value);"]],
  ["src/app/etfs/new/NewEtfsList.tsx", ["return formatCurrency(value, \"USD\");", "return \"—\";"]],
  ["src/app/explore/etfUniverseUtils.ts", ["return formatInteger(value);", "formatMultiple(factor"]],
  ["src/app/explore/SlickchartsDiscoveryCard.tsx", ["return formatCurrency(value, \"USD\");"]],
  ["src/app/explore/StockWorkbenchCard.tsx", ["return formatCurrency(value, \"USD\");", "return formatInteger(value);"]],
  ["src/app/explore/ExploreHotTopics.tsx", ["return formatCurrencyCompact(value, \"USD\");"]],
  ["src/app/sectors/SectorsClient.tsx", ["formatDecimal(value, { digits: 1 })"]],
  ["src/app/etfs/[ticker]/EtfDetailClient.tsx", ["formatMultiple(classification.leverage_factor", "formatDecimal(beta, { digits: 2 })"]],
  ["src/app/market-valuation/YardeniCard.tsx", ["formatMultiple(active.bond_per", "return formatDecimal(value, { digits });"]],
  ["src/app/market-valuation/structure/MarketStructureDetailClient.tsx", ["value * 1_000_000_000", "formatDecimal(value, { digits })"]],
  ["src/app/superinvestors/PortfolioCharts.tsx", ["formatInteger(score)", "formatDecimal(beta, { digits: 2 })"]],
  ["src/lib/market-valuation/charts/ledgerChartPanels.tsx", ["return formatInteger(value);"]],
  ["src/app/etfs/EtfUnifiedTable.tsx", ["?? \"—\""]],
  ["src/app/etfs/EtfHeroPanel.tsx", ["?? \"—\""]],
  ["src/app/sectors/IndustryMapPanel.tsx", ["fallback = \"—\""]],
  ["src/components/canvas-plus/CpScreenerNativeLab.tsx", [": \"—\""]],
  ["src/components/canvas-plus/CpScreenerTanstackLab.tsx", [": \"—\""]],
];

for (const [path, snippets] of adoptionContracts) {
  const source = readFileSync(resolve(process.cwd(), path), "utf8");
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `${path} must retain approved formatter adoption: ${snippet}`);
  }
}

const heldEtfUniverseSource = readFileSync(resolve(process.cwd(), "src/app/explore/etfUniverseUtils.ts"), "utf8");
assert.ok(heldEtfUniverseSource.includes("function formatPrice(value: number | null | undefined): string | null"), "c-1 price null-return contract stays HOLD");
assert.ok(heldEtfUniverseSource.includes("function formatCompactVolume(value: number | null | undefined): string | null"), "c-1 volume null-return contract stays HOLD");

console.log(JSON.stringify({ ok: true, suite: "shared number formatter (src/lib/format.ts) contract" }, null, 2));
