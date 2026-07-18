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

console.log(JSON.stringify({ ok: true, suite: "shared number formatter (src/lib/format.ts) contract" }, null, 2));
