#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  THRESHOLDS,
  computeBankingHealthSnapshot,
  computeLiquidityFlowSnapshot,
  computeLiquidityStressSnapshot,
  computeSentimentSignalSnapshot,
  latestDate,
  normalizeSeries
} from '../tools/macro-monitor/shared/signals-core.mjs';
import { DATA_SUPPLY_DETECTION_CONFIG } from './lib/data-supply-detection-config.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUT_REL = 'data/computed/signals.json';
const NEXT_OUT_REL = '100xfenok-next/public/data/computed/signals.json';

export const RAW_SOURCE_NAMES = Object.freeze([
  'data/macro/fred-macro.json#M2SL',
  'data/macro/fred-macro.json#WALCL',
  'data/macro/tga.json#series',
  'data/macro/fred-macro.json#RRPONTSYD',
  'data/macro/stablecoins.json#current',
  'data/macro/fred-macro.json#SOFR',
  'data/macro/fred-macro.json#IORB',
  'data/macro/fred-macro.json#WRESBAL',
  'data/macro/fred-macro.json#GDP',
  'data/macro/fred-banking-quarterly.json#DRALACBN',
  'data/macro/fred-banking-weekly.json#TOTLL',
  'data/macro/fred-banking-weekly.json#DPSACBW027SBOG',
  'data/macro/fred-banking-quarterly.json#BOGZ1FL010000016Q',
  'data/macro/fdic-tier1.json#data',
  'data/sentiment/vix.json',
  'data/sentiment/move.json',
  'data/sentiment/cnn-fear-greed.json',
  'data/sentiment/aaii.json',
  'data/sentiment/cftc-sp500.json',
  'data/sentiment/crypto-fear-greed.json',
  'data/sentiment/cnn-put-call.json'
]);

const SOURCE_FRESHNESS_AUTHORITY_BY_PATH = new Map();
for (const lane of DATA_SUPPLY_DETECTION_CONFIG.lanes) {
  for (const member of lane.producer_members) {
    for (const artifact of member.artifact_contracts) {
      if (
        typeof artifact.path !== 'string'
        || artifact.path.includes('*')
        || artifact.source_selector?.kind === 'not_applicable'
      ) continue;
      const authorities = SOURCE_FRESHNESS_AUTHORITY_BY_PATH.get(artifact.path) ?? new Set();
      authorities.add(lane.id);
      SOURCE_FRESHNESS_AUTHORITY_BY_PATH.set(artifact.path, authorities);
    }
  }
}

const SOURCE_FILES = {
  liquidity_flow: [
    'data/macro/fred-macro.json',
    'data/macro/tga.json',
    'data/macro/stablecoins.json'
  ],
  liquidity_stress: [
    'data/macro/fred-macro.json'
  ],
  banking_health: [
    'data/macro/fred-banking-weekly.json',
    'data/macro/fred-banking-quarterly.json',
    'data/macro/fdic-tier1.json'
  ],
  sentiment_signal: [
    'data/sentiment/vix.json',
    'data/sentiment/move.json',
    'data/sentiment/cnn-fear-greed.json',
    'data/sentiment/aaii.json',
    'data/sentiment/cftc-sp500.json',
    'data/sentiment/crypto-fear-greed.json',
    'data/sentiment/cnn-put-call.json'
  ]
};

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8'));
}

function readJsonIfExists(relPath) {
  try {
    return readJson(relPath);
  } catch {
    return null;
  }
}

function writeJson(relPath, payload) {
  const target = path.join(REPO_ROOT, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
}

function stablePayloadForCompare(payload) {
  return JSON.stringify({
    ...payload,
    generated_at: null
  });
}

function seriesFromFred(payload, seriesId) {
  return normalizeSeries(payload?.series?.[seriesId] ?? []);
}

function latestRaw(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[rows.length - 1] ?? null;
}

function latestNumber(rows, key) {
  const latest = latestRaw(rows);
  const value = latest?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function maxDate(...dates) {
  const valid = dates.filter(Boolean).sort();
  return valid[valid.length - 1] ?? null;
}

function sourceDate(name, rows) {
  return { name, as_of: latestRaw(rows)?.date };
}

function sourcePath(name) {
  return typeof name === 'string' ? name.split('#', 1)[0] : null;
}

// Source-family freshness remains authoritative in the existing detection
// registry. These warnings name only consumed contributors that have no
// registered source-family gate; they do not create a second SLA or block the
// computed payload from publishing.
export function sourceFreshnessWarnings(sourceDates) {
  return sourceDates
    .filter((entry) => !SOURCE_FRESHNESS_AUTHORITY_BY_PATH.has(sourcePath(entry?.name)))
    .map((entry) => ({
      contributor: entry.name,
      source_as_of: entry.as_of,
      status: 'unresolved',
      reason: 'no registered source-family freshness/SLA gate'
    }));
}

function buildSentimentValues() {
  const vix = readJson('data/sentiment/vix.json');
  const move = readJson('data/sentiment/move.json');
  const cnn = readJson('data/sentiment/cnn-fear-greed.json');
  const aaii = readJson('data/sentiment/aaii.json');
  const cftc = readJson('data/sentiment/cftc-sp500.json');
  const crypto = readJson('data/sentiment/crypto-fear-greed.json');
  const putcall = readJson('data/sentiment/cnn-put-call.json');

  const latestAaii = latestRaw(aaii);
  const aaiiSpread = typeof latestAaii?.spread === 'number'
    ? latestAaii.spread
    : ((latestAaii?.bullish ?? 0) - (latestAaii?.bearish ?? 0));

  return {
    values: {
      vix: latestNumber(vix, 'value'),
      move: latestNumber(move, 'value'),
      cnn_fg: latestNumber(cnn, 'score'),
      aaii_bearish: latestNumber(aaii, 'bearish'),
      aaii_spread: aaiiSpread,
      cftc_net: latestNumber(cftc, 'net'),
      crypto_fg: latestNumber(crypto, 'value'),
      putcall_ratio: latestNumber(putcall, 'value')
    },
    as_of: maxDate(
      latestRaw(vix)?.date,
      latestRaw(move)?.date,
      latestRaw(cnn)?.date,
      latestRaw(aaii)?.date,
      latestRaw(cftc)?.date,
      latestRaw(crypto)?.date,
      latestRaw(putcall)?.date
    ),
    source_dates: [
      sourceDate('data/sentiment/vix.json', vix),
      sourceDate('data/sentiment/move.json', move),
      sourceDate('data/sentiment/cnn-fear-greed.json', cnn),
      sourceDate('data/sentiment/aaii.json', aaii),
      sourceDate('data/sentiment/cftc-sp500.json', cftc),
      sourceDate('data/sentiment/crypto-fear-greed.json', crypto),
      sourceDate('data/sentiment/cnn-put-call.json', putcall)
    ]
  };
}

function buildSignals() {
  const fredMacro = readJson('data/macro/fred-macro.json');
  const fredBankingWeekly = readJson('data/macro/fred-banking-weekly.json');
  const fredBankingQuarterly = readJson('data/macro/fred-banking-quarterly.json');
  const fdicTier1 = readJson('data/macro/fdic-tier1.json');
  const tga = readJson('data/macro/tga.json');
  const stablecoins = readJson('data/macro/stablecoins.json');

  const m2 = seriesFromFred(fredMacro, 'M2SL');
  const fedBs = seriesFromFred(fredMacro, 'WALCL');
  const rrp = seriesFromFred(fredMacro, 'RRPONTSYD');
  const sofr = seriesFromFred(fredMacro, 'SOFR');
  const iorb = seriesFromFred(fredMacro, 'IORB');
  const reserves = seriesFromFred(fredMacro, 'WRESBAL');
  const gdp = seriesFromFred(fredMacro, 'GDP');
  const dailyTga = normalizeSeries(tga?.series ?? [], 'val');

  const stablecoinSeries = normalizeSeries(stablecoins?.series ?? [], 'val');
  const stablecoin = {
    current: stablecoins?.current ?? latestRaw(stablecoinSeries)?.val ?? 0,
    series: stablecoinSeries
  };

  const delinquency = seriesFromFred(fredBankingQuarterly, 'DRALACBN');
  const loans = seriesFromFred(fredBankingWeekly, 'TOTLL');
  const deposits = seriesFromFred(fredBankingWeekly, 'DPSACBW027SBOG');
  const fedTier1 = seriesFromFred(fredBankingQuarterly, 'BOGZ1FL010000016Q');
  const fdicTier1Series = normalizeSeries(fdicTier1?.data ?? []);

  const liquidityFlow = computeLiquidityFlowSnapshot({ m2, fedBs, tga: dailyTga, rrp, stablecoin });
  const liquidityStress = computeLiquidityStressSnapshot({ sofr, iorb, reserves, gdp });
  const bankingHealth = computeBankingHealthSnapshot({
    delinquency,
    loans,
    deposits,
    fedTier1,
    fdicTier1: fdicTier1Series
  });

  const sentimentInputs = buildSentimentValues();
  const sentimentSignal = computeSentimentSignalSnapshot(sentimentInputs.values);
  sentimentSignal.as_of = sentimentInputs.as_of;

  return {
    signals: {
      liquidity_flow: {
        ...liquidityFlow,
        source_files: SOURCE_FILES.liquidity_flow,
        threshold_ref: 'tools/macro-monitor/shared/signals-core.mjs#THRESHOLDS'
      },
      liquidity_stress: {
        ...liquidityStress,
        source_files: SOURCE_FILES.liquidity_stress,
        threshold_ref: 'tools/macro-monitor/shared/signals-core.mjs#THRESHOLDS'
      },
      banking_health: {
        ...bankingHealth,
        source_files: SOURCE_FILES.banking_health,
        threshold_ref: 'tools/macro-monitor/shared/signals-core.mjs#THRESHOLDS'
      },
      sentiment_signal: {
        ...sentimentSignal,
        source_files: SOURCE_FILES.sentiment_signal,
        threshold_ref: 'tools/macro-monitor/shared/signals-core.mjs#COMBO_SIGNALS'
      }
    },
    source_dates: [
      sourceDate('data/macro/fred-macro.json#M2SL', m2),
      sourceDate('data/macro/fred-macro.json#WALCL', fedBs),
      sourceDate('data/macro/tga.json#series', dailyTga),
      sourceDate('data/macro/fred-macro.json#RRPONTSYD', rrp),
      sourceDate('data/macro/stablecoins.json#current', stablecoins?.series ?? []),
      sourceDate('data/macro/fred-macro.json#SOFR', sofr),
      sourceDate('data/macro/fred-macro.json#IORB', iorb),
      sourceDate('data/macro/fred-macro.json#WRESBAL', reserves),
      sourceDate('data/macro/fred-macro.json#GDP', gdp),
      sourceDate('data/macro/fred-banking-quarterly.json#DRALACBN', delinquency),
      sourceDate('data/macro/fred-banking-weekly.json#TOTLL', loans),
      sourceDate('data/macro/fred-banking-weekly.json#DPSACBW027SBOG', deposits),
      sourceDate('data/macro/fred-banking-quarterly.json#BOGZ1FL010000016Q', fedTier1),
      sourceDate('data/macro/fdic-tier1.json#data', fdicTier1Series),
      ...sentimentInputs.source_dates
    ]
  };
}

const COMPONENT_NAMES = ['liquidity_flow', 'liquidity_stress', 'banking_health', 'sentiment_signal'];

function componentAsOfEntries(signalsValue) {
  return COMPONENT_NAMES.map((name) => ({ name, as_of: signalsValue?.[name]?.as_of }));
}

// Truthful conservative source clock: the minimum of every declared raw input
// date actually consumed by the four signal components. Every date must be an
// exact, real YYYY-MM-DD; generated_at is never substituted.
export function computeSourceAsOf(sourceDates, expectedNames = null, identity = 'raw input') {
  if (!Array.isArray(sourceDates) || sourceDates.length === 0) {
    throw new Error('export-computed-signals: cannot compute source_as_of; no component source dates available');
  }

  const byName = new Map();
  for (const entry of sourceDates) {
    const name = entry?.name ?? '<unknown>';
    if (byName.has(name)) {
      throw new Error(`export-computed-signals: duplicate ${identity} date: ${name}`);
    }
    byName.set(name, entry);
  }
  if (expectedNames) {
    for (const name of expectedNames) {
      if (!byName.has(name)) {
        throw new Error(`export-computed-signals: missing ${identity} date: ${name}`);
      }
    }
    for (const name of byName.keys()) {
      if (!expectedNames.includes(name)) {
        throw new Error(`export-computed-signals: unexpected ${identity} date: ${name}`);
      }
    }
  }

  for (const entry of sourceDates) {
    const name = entry?.name ?? '<unknown>';
    const value = entry?.as_of;
    const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    let validCalendarDate = false;
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      validCalendarDate = year >= 1 && month >= 1 && month <= 12
        && day >= 1 && day <= daysInMonth[month - 1];
    }
    if (!validCalendarDate) {
      const displayedValue = typeof value === 'string' ? JSON.stringify(value) : String(value);
      throw new Error(
        `export-computed-signals: ${identity} ${name} has invalid source date ${displayedValue}; `
        + 'expected a real calendar date in YYYY-MM-DD'
      );
    }
  }

  return sourceDates.map((entry) => entry.as_of).sort()[0];
}

export function buildComputedSignalsPayload(signalsValue, generatedAt, sourceDates) {
  const componentAsOfs = componentAsOfEntries(signalsValue);
  computeSourceAsOf(componentAsOfs, COMPONENT_NAMES, 'component');
  const sourceAsOf = computeSourceAsOf(sourceDates, RAW_SOURCE_NAMES);
  return {
    schema_version: '1.0.0',
    generated_at: generatedAt,
    as_of: latestDate(...componentAsOfs.map(({ as_of }) => [{ date: as_of, val: 1 }])),
    source_as_of: sourceAsOf,
    engine: {
      name: 'macro-monitor-computed-signals',
      version: '1.0.0',
      rules: 'tools/macro-monitor/shared/signals-core.mjs'
    },
    source_files: Array.from(new Set(Object.values(SOURCE_FILES).flat())).sort(),
    source_freshness_warnings: sourceFreshnessWarnings(sourceDates),
    thresholds: {
      liquidity_flow: {
        m2_yoy: THRESHOLDS.M2_YOY,
        net_liquidity: THRESHOLDS.NET_LIQUIDITY,
        stablecoin: THRESHOLDS.STABLECOIN,
        overall: THRESHOLDS.OVERALL
      },
      liquidity_stress: {
        spread: THRESHOLDS.SPREAD,
        reserves_gdp: THRESHOLDS.RESERVES_GDP
      },
      banking_health: {
        delinquency: THRESHOLDS.DELINQUENCY,
        tier1_ratio: THRESHOLDS.TIER1_RATIO,
        loan_deposit: THRESHOLDS.LOAN_DEPOSIT,
        loan_growth: THRESHOLDS.LOAN_GROWTH
      }
    },
    signals: signalsValue
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const { signals, source_dates: sourceDates } = buildSignals();
  const payload = buildComputedSignalsPayload(signals, new Date().toISOString(), sourceDates);

  const existingPayload = readJsonIfExists(OUT_REL);
  if (
    existingPayload
    && stablePayloadForCompare(existingPayload) === stablePayloadForCompare(payload)
    && typeof existingPayload.generated_at === 'string'
  ) {
    payload.generated_at = existingPayload.generated_at;
  }

  writeJson(OUT_REL, payload);
  writeJson(NEXT_OUT_REL, payload);
  console.log(`Wrote ${OUT_REL}`);
  console.log(`Mirrored ${NEXT_OUT_REL}`);
}
