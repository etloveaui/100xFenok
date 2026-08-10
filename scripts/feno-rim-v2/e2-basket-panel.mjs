#!/usr/bin/env node

// FENO RIM v2 — E2: Dow-30 basket panel builder (point-in-time reconstruction).
//
// Builds the E2 basket panel from:
//   - EDGAR XBRL facts  data/edgar/rim-dow/{SYMBOL}.json
//       (StockholdersEquity, NetIncomeLoss, EntityCommonStockSharesOutstanding;
//       every record keeps its `filed` date)
//   - yfinance siblings data/yf/finance/{SYMBOL}.unadjusted.json
//       (full-history unadjusted closes + full dividend series)
//
// POINT-IN-TIME RULES (directive fh-20260806-134-cc-932a5122):
//   - At origin t use only facts with filed <= t.
//   - For a given fiscal period take the EARLIEST filed value, so a later
//     restatement never leaks backwards.
//   - book:  StockholdersEquity period with the latest end <= t (earliest
//            filed per period); periods whose earliest filing postdates t are
//            not usable.
//   - earn:  NetIncomeLoss annual (fp == "FY") period with the latest end <= t,
//            earliest filed per period. 10-Q YTD tags are intentionally not
//            used: the series is the latest annual earnings (a conservative
//            TTM proxy, stated in the artifact).
//   - shares: dei EntityCommonStockSharesOutstanding snapshot with the latest
//            snapshot date <= t and filed <= t (earliest filed per date).
//   - price:  latest unadjusted close <= t, fresh within 45 days (mirrors the
//            harness dividendAdjustment freshness cap).
//
// FUNDAMENTAL SET: a constituent is in the basket at a week only when book +
// annual earnings + shares + fresh price all exist. The basket aggregates
// (book, earnings, cap) are sums over the fundamental set, so numerator and
// denominator of V/P stay on the same universe. Constituents dropped at a
// week are recorded with their reason.
//
// Deterministic: identical input files produce an identical panel hash;
// generated_at is excluded from the hash.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOrigins, INDEX_CONFIG, loadTracker } from "./verify/h2-harness.mjs";
import { buildSpxInput } from "./adapters/spx-panel.mjs";
import { computeFamilyB } from "./engine.mjs";
import { E2_BASKET } from "./e2-criteria.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const E2_PANEL_SCHEMA_VERSION = "feno_rim_v2_e2_basket_panel.v1";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const parseMs = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// per-constituent raw facts, pre-sorted for binary search
// ---------------------------------------------------------------------------

function earliestFiledPerPeriod(records) {
  const byPeriod = new Map();
  for (const r of records) {
    if (!Number.isFinite(r.val)) continue;
    const key = `${r.start}|${r.end}`;
    const cur = byPeriod.get(key);
    if (!cur || r.filed < cur.filed) byPeriod.set(key, { start: r.start, end: r.end, val: r.val, filed: r.filed });
  }
  return [...byPeriod.values()];
}

function loadConstituent(symbol) {
  const edgar = readJson(`data/edgar/rim-dow/${symbol}.json`);
  const concepts = edgar.concepts ?? {};
  // Book = union of us-gaap:StockholdersEquity and the Including-...-NCI
  // fallback (fetched from the same cached companyfacts). Many filers tag one
  // concept for part of the history and switch tag mid-stream (V, JNJ, TRV,
  // SHW, CAT, PG); taking the union with earliest-filed-per-period across
  // both keeps a single continuous point-in-time book series. The concepts
  // used are recorded per symbol in the panel so the choice is never silent.
  const bookRaw = [...(concepts.StockholdersEquity ?? []), ...(concepts.StockholdersEquityFallback ?? [])];
  const bookConcept = concepts.StockholdersEquity?.length
    ? (concepts.StockholdersEquityFallback?.length ? "StockholdersEquity+Fallback" : "StockholdersEquity")
    : "StockholdersEquityFallback";
  const book = earliestFiledPerPeriod(bookRaw)
    .map((r) => ({ ms: parseMs(r.end), startMs: parseMs(r.start), val: r.val, filed: parseMs(r.filed) }))
    .sort((a, b) => a.ms - b.ms || a.startMs - b.startMs);
  // Annual earnings = 12-month-span periods (>= 360 days) from the union of
  // NetIncomeLoss and ProfitLoss, earliest filed per period across both.
  // The fp=="FY" tag alone is unusable: many filers tag the 10-K comparatives
  // with fp="FY" only in later restated filings (their first tagged filing
  // postdates the period), and pre-2011 filers tagged differently. The period
  // span is the robust annual discriminator: 10-Q YTD records span < 360 days
  // and never qualify. Concept used is recorded per symbol.
  const earnRaw = [...(concepts.NetIncomeLoss ?? []), ...(concepts.ProfitLoss ?? [])];
  const earnConcept = (() => {
    const n = (concepts.NetIncomeLoss ?? []).length;
    const p = (concepts.ProfitLoss ?? []).length;
    return n && p ? "NetIncomeLoss+ProfitLoss" : n ? "NetIncomeLoss" : p ? "ProfitLoss" : "none";
  })();
  const earn = earliestFiledPerPeriod(earnRaw)
    .filter((r) => r.start && r.end && parseMs(r.end) - parseMs(r.start) >= 360 * DAY_MS)
    .map((r) => ({ ms: parseMs(r.end), startMs: parseMs(r.start), val: r.val, filed: parseMs(r.filed) }))
    .sort((a, b) => a.ms - b.ms);
  // Shares = union of dei:EntityCommonStockSharesOutstanding and
  // us-gaap:CommonStockSharesOutstanding (same earliest-filed-per-date rule).
  const sharesRaw = [...(concepts.EntityCommonStockSharesOutstanding ?? []), ...(concepts.SharesFallback ?? [])]
    .filter((r) => Number.isFinite(r.val))
    .sort((a, b) => (a.start ?? a.end) < (b.start ?? b.end) ? -1 : 1);
  const byDate = new Map();
  for (const r of sharesRaw) {
    const date = r.start ?? r.end;
    if (!date) continue;
    const cur = byDate.get(date);
    if (!cur || r.filed < cur.filed) byDate.set(date, { date, val: r.val, filed: r.filed });
  }
  const shares = [...byDate.values()]
    .map((r) => ({ ms: parseMs(r.date), val: r.val, filed: parseMs(r.filed) }))
    .sort((a, b) => a.ms - b.ms);

  let prices = [];
  let dividends = [];
  const yfFile = `data/yf/finance/${symbol}.unadjusted.json`;
  if (fs.existsSync(path.join(ROOT, yfFile))) {
    const yf = readJson(yfFile);
    prices = (yf.data?.history_unadjusted ?? [])
      .filter((r) => r.date && Number.isFinite(r.Close))
      .map((r) => ({ ms: parseMs(r.date), close: r.Close }))
      .sort((a, b) => a.ms - b.ms);
    dividends = Object.entries(yf.data?.dividends ?? {})
      .filter(([, v]) => Number.isFinite(v))
      .map(([d, v]) => ({ ms: parseMs(d), amount: v }))
      .sort((a, b) => a.ms - b.ms);
  }
  return { symbol, bookConcept, earnConcept, book, earn, shares, prices, dividends };
}

// Latest entry with ms <= t (binary search; array sorted by ms).
function lastAtOrBefore(rows, t) {
  let lo = 0;
  let hi = rows.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].ms <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans === -1 ? null : rows[ans];
}

// ---------------------------------------------------------------------------
// point-in-time sampling at one date t
// ---------------------------------------------------------------------------

function pitAt(constituent, t) {
  const out = { book: null, bookMs: null, earnings: null, earnMs: null, shares: null, sharesMs: null, price: null, priceMs: null };
  // Latest period whose EARLIEST filing is <= t. A period whose first tagged
  // filing postdates t (e.g. interim periods that only appear with fp="FY" in
  // a later 10-K) is unusable; fall back to the previous period. This is the
  // directive's rule: at origin t use only facts with filed <= t.
  const latestUsable = (rows) => {
    let i = lastAtOrBefore(rows, t);
    while (i !== null && i.filed > t) i = lastAtOrBefore(rows, i.ms - 1);
    return i;
  };
  const b = latestUsable(constituent.book);
  if (b !== null) { out.book = b.val; out.bookMs = b.ms; }
  const e = latestUsable(constituent.earn);
  if (e !== null) { out.earnings = e.val; out.earnMs = e.ms; }
  const s = latestUsable(constituent.shares);
  if (s !== null) { out.shares = s.val; out.sharesMs = s.ms; }
  const p = lastAtOrBefore(constituent.prices, t);
  if (p !== null && t - p.ms <= 45 * DAY_MS) { out.price = p.close; out.priceMs = p.ms; }
  return out;
}

// ---------------------------------------------------------------------------
// E1 sp500 origin set (the 34) — recomputed deterministically, identical path
// ---------------------------------------------------------------------------

export function e1Sp500Origins() {
  const cfg = INDEX_CONFIG.sp500;
  const panelRows = readJson(cfg.panel_file).sections[cfg.panel_section].data;
  const tracker = loadTracker(cfg.tracker);
  const origins = buildOrigins(panelRows, { horizonMonths: 36, stepWeeks: 13, tracker });
  const scored = origins.filter((o) => o.scored && Number.isFinite(o.realized.price_return_36m));
  const kept = [];
  for (const o of scored) {
    try {
      const input = buildSpxInput(o.as_of);
      const hull = computeFamilyB(input).value_hull;
      if (Number.isFinite(hull.low) && Number.isFinite(hull.high)) kept.push(o.as_of);
    } catch {
      // adapter/hull refusal — same selection as E1's walk-forward
    }
  }
  return kept;
}

// ---------------------------------------------------------------------------
// weekly basket construction
// ---------------------------------------------------------------------------

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function cagrOverWeeks(weekly, t, years) {
  // book at t and at t - years (nearest weekly row at or before each date).
  const end = lastAtOrBefore(weekly, t);
  const start = lastAtOrBefore(weekly, t - Math.round(years * 365.25 * DAY_MS));
  if (!end || !start || end.book <= 0 || start.book <= 0 || end === start) return null;
  return (end.book / start.book) ** (1 / years) - 1;
}

export function buildE2Panel({ generatedAt = new Date().toISOString() } = {}) {
  const symbols = E2_BASKET.symbols;
  const constituents = new Map(symbols.map((s) => [s, loadConstituent(s)]));

  const origins = e1Sp500Origins();
  // Origin count is data-derived (benchmark panel rows); refreshed 34 -> 35 by
  // the 2026-08-07 benchmark update (58fffc8c32). Keep in sync with the data.
  if (origins.length !== 35) {
    throw new Error(`e2-basket-panel: expected the 35 E1 sp500 origins, got ${origins.length}`);
  }
  const firstOriginMs = parseMs(origins[0]);
  const lastOriginMs = parseMs(origins[origins.length - 1]);
  const panelStart = firstOriginMs - Math.round(15.5 * 365.25 * DAY_MS);
  const panelEnd = lastOriginMs + Math.round(36 * 30.4 * DAY_MS) + 60 * DAY_MS;

  // Weekly sampling over the whole needed span.
  const weeks = [];
  for (let t = panelStart; t <= panelEnd; t += WEEK_MS) weeks.push(t);

  const constituentWeekly = {}; // symbol -> [{date, book, earnings, price, shares, mc}]
  const droppedWhy = {}; // reason -> count
  const recordDrop = (reason) => {
    droppedWhy[reason] = (droppedWhy[reason] ?? 0) + 1;
  };

  for (const symbol of symbols) {
    const c = constituents.get(symbol);
    const rows = [];
    for (const t of weeks) {
      const pit = pitAt(c, t);
      // Staleness guards (data-quality, stated): book balance-sheet period
      // older than ~15 months, FY earnings period older than ~24 months, or a
      // shares snapshot older than ~15 months means the series stopped being
      // reported — using the stale value would silently age the basket.
      const reason = pit.book === null ? "book_unavailable"
        : pit.bookMs !== null && t - pit.bookMs > 15.5 * 30.4 * DAY_MS ? "book_stale"
        : pit.earnings === null ? "earnings_unavailable"
        : pit.earnMs !== null && t - pit.earnMs > 24.5 * 30.4 * DAY_MS ? "earnings_stale"
        : pit.shares === null ? "shares_unavailable"
        : pit.sharesMs !== null && t - pit.sharesMs > 15.5 * 30.4 * DAY_MS ? "shares_stale"
        : pit.price === null ? "price_unavailable"
        : null;
      if (reason) {
        recordDrop(reason);
        continue;
      }
      rows.push({
        ms: t,
        date: isoDate(t),
        book: pit.book,
        book_end: isoDate(pit.bookMs),
        earnings: pit.earnings,
        earn_end: isoDate(pit.earnMs),
        price: pit.price,
        shares: pit.shares,
        shares_asof: isoDate(pit.sharesMs),
        mc: pit.price * pit.shares,
        roe: pit.earnings / pit.book,
      });
    }
    constituentWeekly[symbol] = rows;
  }

  // Book-only weekly series per constituent: rows where the point-in-time
  // BOOK exists, independent of the earnings/shares/price gates. Growth
  // windows (w5/w10/w15) read THIS series, so a constituent whose earnings
  // facts start later than its book facts still gets its book CAGR (the same
  // semantics the spx adapter's bookCagr uses: book series only).
  const bookOnlyWeekly = {};
  for (const symbol of symbols) {
    const c = constituents.get(symbol);
    const rows = [];
    for (const t of weeks) {
      const pit = pitAt(c, t);
      if (pit.book !== null) rows.push({ ms: t, book: pit.book });
    }
    bookOnlyWeekly[symbol] = rows;
  }
  // Basket book-only series: sum of constituent books over constituents whose
  // book is present that week (no other gates) — the growth denominator.
  const basketBookOnly = [];
  for (const t of weeks) {
    let book = 0;
    let n = 0;
    for (const symbol of symbols) {
      const rows = bookOnlyWeekly[symbol];
      const row = lastAtOrBefore(rows, t);
      if (row !== null && row.ms === t) {
        book += row.book;
        n += 1;
      }
    }
    if (n > 0 && book > 0) basketBookOnly.push({ ms: t, book, n });
  }

  // Basket weekly rows over the fundamental set (constituents present that week).
  const basketWeekly = [];
  for (const t of weeks) {
    let cap = 0;
    let book = 0;
    let earnings = 0;
    let n = 0;
    const dropped = {};
    for (const symbol of symbols) {
      const rows = constituentWeekly[symbol];
      const row = lastAtOrBefore(rows, t);
      if (row === null || row.ms !== t) {
        dropped[symbol] = "no_row_this_week";
        continue;
      }
      cap += row.mc;
      book += row.book;
      earnings += row.earnings;
      n += 1;
    }
    if (n === 0 || book <= 0 || earnings <= 0) continue; // degenerate week: no basket row
    basketWeekly.push({
      ms: t,
      date: isoDate(t),
      cap,
      book,
      earnings,
      roe: earnings / book,
      px_last: cap,
      px_to_book_ratio: cap / book,
      n_constituents: n,
      dropped_constituents: dropped,
    });
  }

  // ROE band helper over a weekly series: P25/P75 of the trailing 260 finite rows.
  const roeBand = (rows, t) => {
    const window = [];
    for (let i = rows.length - 1; i >= 0 && window.length < 260; i -= 1) {
      if (rows[i].ms <= t && Number.isFinite(rows[i].roe)) window.push(rows[i].roe);
      if (rows[i].ms <= t && window.length === 260) break;
    }
    if (window.length === 0) return null;
    return { low: quantile(window, 0.25), high: quantile(window, 0.75), n: window.length };
  };

  // Per-origin rows: the basket and each constituent, everything the scorer needs.
  // Origin dates come from the sp500 panel; the basket weekly grid is sampled
  // independently, so membership is the nearest basket week AT OR BEFORE the
  // origin, fresh within 45 days (mirrors the harness freshness cap).
  const originRows = [];
  const originGaps = [];
  for (const asOf of origins) {
    const t = parseMs(asOf);
    const basketRow = lastAtOrBefore(basketWeekly, t);
    if (basketRow === null || t - basketRow.ms > 45 * DAY_MS) {
      originGaps.push({ as_of: asOf, reason: "basket_row_missing_at_origin" });
      continue;
    }
    const basketBand = roeBand(basketWeekly, t);
    const basketGrowth = {
      w5: cagrOverWeeks(basketBookOnly, t, 5),
      w10: cagrOverWeeks(basketBookOnly, t, 10),
      w15: cagrOverWeeks(basketBookOnly, t, 15),
    };
    if (!basketBand || !basketGrowth.w5) {
      originGaps.push({ as_of: asOf, reason: `basket_roe_band=${basketBand ? "ok" : "missing"}_g5=${basketGrowth.w5 === null ? "missing" : "ok"}` });
      continue;
    }
    const members = [];
    for (const symbol of symbols) {
      const rows = constituentWeekly[symbol];
      const row = lastAtOrBefore(rows, t);
      if (row === null || t - row.ms > 45 * DAY_MS) {
        members.push({ symbol, ok: false, reason: "no_row_at_origin" });
        continue;
      }
      const band = roeBand(rows, t);
      const bookRows = bookOnlyWeekly[symbol];
      const growth = {
        w5: cagrOverWeeks(bookRows, t, 5),
        w10: cagrOverWeeks(bookRows, t, 10),
        w15: cagrOverWeeks(bookRows, t, 15),
      };
      if (!band || !growth.w5) {
        members.push({ symbol, ok: false, reason: band ? `growth_w5_missing(g10=${growth.w10 === null ? "n" : "y"},g15=${growth.w15 === null ? "n" : "y"})` : "roe_band_missing" });
        continue;
      }
      members.push({ symbol, ok: true, mc: row.mc, book: row.book, earnings: row.earnings, roe: row.roe, price: row.price, shares: row.shares, roe_band: band, growth });
    }
    const okMembers = members.filter((m) => m.ok);
    originRows.push({
      as_of: asOf,
      basket: {
        cap: basketRow.cap,
        book: basketRow.book,
        earnings: basketRow.earnings,
        roe: basketRow.roe,
        roe_band: basketBand,
        growth: basketGrowth,
        n_constituents: basketRow.n_constituents,
      },
      members,
      n_ok_members: okMembers.length,
    });
  }

  const body = {
    schema_version: E2_PANEL_SCHEMA_VERSION,
    basket: {
      name: E2_BASKET.name,
      source: E2_BASKET.source,
      symbols,
      fixed_list: E2_BASKET.fixed_list,
      survivorship_caveat: E2_BASKET.survivorship_caveat,
    },
    point_in_time: {
      rules: "facts with filed <= origin; earliest filed per fiscal period; book = latest period end <= t; earnings = latest 12-month-span (>= 360d) period of NetIncomeLoss union ProfitLoss; shares = latest snapshot (dei EntityCommonStockSharesOutstanding union us-gaap CommonStockSharesOutstanding); price = latest unadjusted close fresh within 45 days",
      earnings_basis: "latest 12-month-span NetIncomeLoss/ProfitLoss period (earliest filed per period); 10-Q YTD (< 360d) tags excluded; fp==FY tag alone not used (restated-comparative tagging makes it unusable point-in-time)",
      book_concept_per_symbol: Object.fromEntries([...constituents.entries()].map(([s, c]) => [s, c.bookConcept])),
      earn_concept_per_symbol: Object.fromEntries([...constituents.entries()].map(([s, c]) => [s, c.earnConcept])),
    },
    origins,
    origins_scored: originRows.length,
    origin_gaps: originGaps,
    weekly_start: originRows.length ? isoDate(basketWeekly[0].ms) : null,
    weekly_end: originRows.length ? isoDate(basketWeekly[basketWeekly.length - 1].ms) : null,
    basket_weekly_rows: basketWeekly.map((r) => ({ date: r.date, cap: r.cap, book: r.book, earnings: r.earnings, roe: r.roe, px_last: r.px_last, px_to_book_ratio: r.px_to_book_ratio, n_constituents: r.n_constituents })),
    origin_rows: originRows,
    dropped_reasons: droppedWhy,
  };
  const panelSha = sha256(JSON.stringify(body));
  return { ...body, generated_at: generatedAt, panel_sha256: panelSha };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const panel = buildE2Panel();
  const outDir = path.join(ROOT, "data/computed/feno-rim-v2");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "e2-basket-panel.json"), `${JSON.stringify(panel, null, 2)}\n`);
  console.log(`E2 basket panel: origins=${panel.origins.length} scored=${panel.origins_scored} gaps=${panel.origin_gaps.length}`);
  console.log(`weekly rows=${panel.basket_weekly_rows.length} (${panel.weekly_start} .. ${panel.weekly_end})`);
  console.log(`dropped reasons: ${JSON.stringify(panel.dropped_reasons)}`);
  console.log(`panel sha256: ${panel.panel_sha256.slice(0, 16)}… written: ${path.join(outDir, "e2-basket-panel.json")}`);
}
