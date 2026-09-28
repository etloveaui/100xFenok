#!/usr/bin/env node
/**
 * Build script: slim ticker -> unique guru holder count index.
 * Source: sec-13f consensus holders_list (entries repeat per quarter — dedupe).
 * Consumer: screener "구루픽 밸류" preset (joined client-side by ticker).
 *
 * Run: node scripts/build-guru-holders-index.mjs
 * Output: data/sec-13f/analytics/guru_holders_index.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadJsonGuarded,
  requireKeys,
  requireObject,
} from "./lib/guarded-json.mjs";
import { PRIVATE_PUBLIC_PATH_VALUES } from "../100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-routing-authority.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "data/sec-13f/analytics/consensus.json");
const SUMMARY = path.join(ROOT, "data/sec-13f/summary.json");
const OUT = path.join(ROOT, "data/sec-13f/analytics/guru_holders_index.json");
const INVESTORS_DIR = path.join(ROOT, "data/sec-13f/investors");
const PRIVATE_INVESTOR_FILES = new Set(
  PRIVATE_PUBLIC_PATH_VALUES
    .filter((value) => value.startsWith("/data/sec-13f/investors/"))
    .map((value) => path.basename(value)),
);
const RATIO_PRECISION = 1e12;
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;
const CUSIP_PATTERN = /^[A-Z0-9]{9}$/;
const INVESTOR_ID_PATTERN = /^[a-z0-9_-]+$/u;

function guardConsensus(data, filePath) {
  requireKeys(data, filePath, ["metadata", "consensus"]);
  requireObject(data.metadata, filePath, "metadata");
  requireObject(data.consensus, filePath, "consensus");
  if (quarterOrdinal(data.metadata.quarter) === null) {
    throw new Error("metadata.quarter must be YYYY-QN");
  }
}

function guardSummary(data, filePath) {
  requireKeys(data, filePath, ["investors"]);
  requireObject(data.investors, filePath, "investors");
}

function validateSummaryRows(summaryData, currentQuarter, expectedCurrentCount) {
  let currentCount = 0;
  for (const [investorId, investor] of Object.entries(summaryData.investors)) {
    if (!investor || typeof investor !== "object" || Array.isArray(investor)) {
      throw new Error(`summary investor row is not an object: ${investorId}`);
    }
    requireKeys(investor, SUMMARY, ["quarter", "latest_quarter", "is_stale"], `investors.${investorId}`);
    if (quarterOrdinal(investor.quarter) === null || quarterOrdinal(investor.latest_quarter) === null) {
      throw new Error(`summary investor quarter is invalid: ${investorId}`);
    }
    if (typeof investor.is_stale !== "boolean") {
      throw new Error(`summary investor is_stale must be boolean: ${investorId}`);
    }
    if (investor.quarter !== investor.latest_quarter) {
      throw new Error(`summary investor quarter/latest_quarter mismatch: ${investorId}`);
    }
    const shouldBeStale = investor.latest_quarter !== currentQuarter;
    if (investor.is_stale !== shouldBeStale) {
      throw new Error(`summary investor stale flag is incoherent: ${investorId}`);
    }
    if (!investor.is_stale && investor.latest_quarter === currentQuarter) currentCount += 1;
  }
  if (currentCount !== expectedCurrentCount) {
    throw new Error(`summary current cohort ${currentCount} does not match consensus ${expectedCurrentCount}`);
  }
}

const consensus = loadJsonGuarded(SRC, guardConsensus);
const summary = loadJsonGuarded(SUMMARY, guardSummary);
const currentQuarter = consensus.metadata.quarter;
validateSummaryRows(summary, currentQuarter, consensus.metadata.current_cohort_investors);
const holders = {};
for (const [ticker, row] of Object.entries(consensus.consensus ?? {})) {
  const unique = new Set(row.holders_list ?? []);
  if (unique.size > 0) holders[ticker] = unique.size;
}

function quarterOrdinal(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-Q([1-4])$/u);
  return match ? Number(match[1]) * 4 + Number(match[2]) : null;
}

function previousQuarter(value) {
  const ordinal = quarterOrdinal(value);
  if (ordinal === null) return null;
  const previous = ordinal - 1;
  const year = Math.floor((previous - 1) / 4);
  const quarter = ((previous - 1) % 4) + 1;
  return `${year}-Q${quarter}`;
}

function normalizeTicker(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase();
  return TICKER_PATTERN.test(normalized) ? normalized : "";
}

function normalizeCusip(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase();
  return CUSIP_PATTERN.test(normalized) ? normalized : "";
}

function finiteWeight(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function roundRatio(value) {
  return Math.round(value * RATIO_PRECISION) / RATIO_PRECISION;
}

function aggregateHoldings(filing) {
  const bySecurity = new Map();
  for (const holding of Array.isArray(filing?.holdings) ? filing.holdings : []) {
    const ticker = normalizeTicker(holding?.ticker);
    const cusip = normalizeCusip(holding?.cusip);
    const key = ticker ? `ticker:${ticker}` : cusip ? `cusip:${cusip}` : null;
    if (!key) continue;
    const current = bySecurity.get(key) ?? {
      ticker: ticker || null,
      cusips: new Set(),
      valid: true,
      total: 0,
    };
    if (cusip) current.cusips.add(cusip);
    if (finiteWeight(holding?.weight)) {
      current.total = roundRatio(current.total + holding.weight);
    } else {
      current.valid = false;
    }
    bySecurity.set(key, current);
  }
  return bySecurity;
}

function requireSelectedHoldings(filing, label) {
  if (!Array.isArray(filing?.holdings)) {
    throw new Error(`${label}.holdings must be an array`);
  }
}

function resolveHoldingSides(currentHoldings, priorHoldings) {
  const cusipTickers = new Map();
  for (const entry of [...currentHoldings.values(), ...priorHoldings.values()]) {
    if (!entry.ticker) continue;
    for (const cusip of entry.cusips) {
      const tickers = cusipTickers.get(cusip) ?? new Set();
      tickers.add(entry.ticker);
      cusipTickers.set(cusip, tickers);
    }
  }
  const ambiguousCusips = new Set(
    [...cusipTickers.entries()]
      .filter(([, tickers]) => tickers.size > 1)
      .map(([cusip]) => cusip),
  );

  let unresolvedMappingCount = 0;
  const resolveSide = (holdings) => {
    const resolved = new Map();
    for (const entry of holdings.values()) {
      let ticker = entry.ticker;
      const entryAmbiguous = [...entry.cusips].some((cusip) => ambiguousCusips.has(cusip));
      if (entryAmbiguous) unresolvedMappingCount += 1;
      if (!ticker && entry.cusips.size === 1) {
        const [cusip] = entry.cusips;
        const tickers = cusipTickers.get(cusip);
        if (tickers?.size === 1 && !entryAmbiguous) ticker = [...tickers][0];
      }
      if (!ticker) {
        if (!entryAmbiguous) unresolvedMappingCount += 1;
        continue;
      }
      const current = resolved.get(ticker) ?? {
        ticker,
        valid: true,
        total: 0,
        ambiguous: false,
      };
      current.valid = current.valid && entry.valid;
      current.total += entry.total;
      current.ambiguous = current.ambiguous || entryAmbiguous;
      resolved.set(ticker, current);
    }
    return resolved;
  };
  return {
    current: resolveSide(currentHoldings),
    prior: resolveSide(priorHoldings),
    ambiguousCusips,
    unresolvedMappingCount,
  };
}

function readInvestor(fileName) {
  const filePath = path.join(INVESTORS_DIR, fileName);
  const payload = loadJsonGuarded(filePath, (data, sourcePath) => {
    requireKeys(data, sourcePath, ["investor"]);
    requireObject(data.investor, sourcePath, "investor");
    if (!Array.isArray(data.investor.filings)) {
      throw new Error("investor.filings must be an array");
    }
  });
  return payload.investor;
}

function buildHoldingChanges(currentQuarter) {
  const priorQuarter = previousQuarter(currentQuarter);
  const rows = new Map();
  let eligible = 0;
  let comparableFilers = 0;
  let missingPrevious = 0;
  let unresolvedMappingCount = 0;

  for (const investorId of Object.keys(summary.investors)) {
    if (!INVESTOR_ID_PATTERN.test(investorId)) {
      throw new Error(`summary investor id is not a safe filename stem: ${investorId}`);
    }
  }
  const expectedPublicIds = Object.entries(summary.investors)
    .filter(([investorId, investor]) => (
      investor?.is_stale === false
      && investor?.quarter === currentQuarter
      && investor?.latest_quarter === currentQuarter
      && !PRIVATE_INVESTOR_FILES.has(`${investorId}.json`)
    ))
    .map(([investorId]) => investorId)
    .sort();
  const investorFiles = fs.readdirSync(INVESTORS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const publicInvestorFiles = investorFiles.filter((fileName) => !PRIVATE_INVESTOR_FILES.has(fileName));
  const publicFileSet = new Set(publicInvestorFiles);

  for (const investorId of expectedPublicIds) {
    const fileName = `${investorId}.json`;
    if (!publicFileSet.has(fileName)) {
      throw new Error(`expected public current investor file is missing: ${fileName}`);
    }
    const investor = readInvestor(fileName);
    const filings = [...investor.filings].sort((left, right) => (
      (quarterOrdinal(left?.quarter) ?? -1) - (quarterOrdinal(right?.quarter) ?? -1)
    ));
    const currentFiling = filings.find((filing) => filing?.quarter === currentQuarter);
    if (!currentFiling) {
      throw new Error(`expected public investor lacks current filing: ${fileName}`);
    }
    requireSelectedHoldings(currentFiling, `${fileName}:${currentQuarter}`);
    eligible += 1;

    const currentHoldings = aggregateHoldings(currentFiling);
    const priorFiling = filings.find((filing) => filing?.quarter === priorQuarter);
    if (!priorFiling) {
      missingPrevious += 1;
    } else {
      comparableFilers += 1;
    }
    if (priorFiling) requireSelectedHoldings(priorFiling, `${fileName}:${priorQuarter}`);
    const priorHoldings = priorFiling ? aggregateHoldings(priorFiling) : new Map();
    const resolved = resolveHoldingSides(currentHoldings, priorHoldings);
    unresolvedMappingCount += resolved.unresolvedMappingCount;
    const resolvedCurrentHoldings = resolved.current;
    const resolvedPriorHoldings = resolved.prior;

    for (const [ticker, current] of resolvedCurrentHoldings) {
      const row = rows.get(ticker) ?? {
        held_count: 0,
        new_count: 0,
        increased_count: 0,
        decreased_count: 0,
        unchanged_count: 0,
        sold_count: 0,
        comparable_count: 0,
        weight_delta_sum: 0,
      };
      row.held_count += 1;

      if (priorFiling) {
        const prior = resolvedPriorHoldings.get(ticker);
        if (!prior && !current.ambiguous) {
          row.new_count += 1;
        } else if (prior && !current.ambiguous && !prior.ambiguous && current.valid && prior.valid) {
          const delta = roundRatio(current.total - prior.total);
          row.comparable_count += 1;
          row.weight_delta_sum = roundRatio(row.weight_delta_sum + delta);
          if (delta > 0) row.increased_count += 1;
          else if (delta < 0) row.decreased_count += 1;
          else row.unchanged_count += 1;
        }
      }
      rows.set(ticker, row);
    }

    if (priorFiling) {
      for (const [ticker, prior] of resolvedPriorHoldings) {
        if (resolvedCurrentHoldings.has(ticker) || prior.ambiguous) continue;
        const row = rows.get(ticker) ?? {
          held_count: 0,
          new_count: 0,
          increased_count: 0,
          decreased_count: 0,
          unchanged_count: 0,
          sold_count: 0,
          comparable_count: 0,
          weight_delta_sum: 0,
        };
        row.sold_count += 1;
        rows.set(ticker, row);
      }
    }
  }

  const holdingChanges = {};
  for (const ticker of [...rows.keys()].sort()) {
    const row = rows.get(ticker);
    holdingChanges[ticker] = {
      held_count: row.held_count,
      new_count: row.new_count,
      increased_count: row.increased_count,
      decreased_count: row.decreased_count,
      unchanged_count: row.unchanged_count,
      sold_count: row.sold_count,
      comparable_count: row.comparable_count,
      mean_weight_delta: row.comparable_count > 0
        ? roundRatio(row.weight_delta_sum / row.comparable_count)
        : null,
      current_quarter: currentQuarter,
      previous_quarter: priorQuarter,
    };
  }

  return {
    holdingChanges,
    changeCoverage: {
      eligible,
      comparable: comparableFilers,
      missing_previous: missingPrevious,
      public_excluded: investorFiles.length - publicInvestorFiles.length,
      comparison_basis: "public_retained_holdings",
      unresolved_mapping_count: unresolvedMappingCount,
      current_quarter: currentQuarter,
      previous_quarter: priorQuarter,
    },
  };
}

const { holdingChanges, changeCoverage } = buildHoldingChanges(currentQuarter);

const output = {
  metadata: {
    quarter: consensus.metadata?.quarter ?? null,
    tickers: Object.keys(holders).length,
    generated_at: new Date().toISOString(),
    change_coverage: changeCoverage,
  },
  holders,
  holding_changes: holdingChanges,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(output));
console.log(
  `guru_holders_index: quarter=${output.metadata.quarter} tickers=${output.metadata.tickers}`,
);
