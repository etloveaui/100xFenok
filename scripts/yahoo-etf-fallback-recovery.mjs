#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import { atomicWrite } from "./lib/data-supply-attempt-shard.mjs";
import {
  LaneLkgStore,
  PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
  buildProviderObservationV2,
  classifyLkgFailure,
} from "./lib/data-supply-lkg-store.mjs";

export const YAHOO_ETF_FALLBACK_LANE_ID = "yahoo_etf_fallback";

const TICKER_RE = /^[A-Z0-9][A-Z0-9._-]{0,11}$/;
const TICKER_KEY_PREFIX = "ticker_";
const TICKER_KEY_RE = /^ticker_([0-9a-f]{2})+$/;

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseJsonBytes(payloadBytes, label) {
  const bytes = Buffer.from(payloadBytes);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return { bytes, document };
}

function canonicalTicker(value) {
  if (typeof value !== "string" || !TICKER_RE.test(value)) {
    throw new Error(`Yahoo ETF ticker is invalid: ${String(value)}`);
  }
  return value;
}

export function encodeYahooEtfTickerKey(ticker) {
  const validated = canonicalTicker(ticker);
  return `${TICKER_KEY_PREFIX}${Buffer.from(validated, "utf8").toString("hex")}`;
}

export function decodeYahooEtfTickerKey(key) {
  if (typeof key !== "string" || !TICKER_KEY_RE.test(key)) {
    throw new Error(`Yahoo ETF recovery key is invalid: ${String(key)}`);
  }
  const ticker = Buffer.from(key.slice(TICKER_KEY_PREFIX.length), "hex").toString("utf8");
  canonicalTicker(ticker);
  if (encodeYahooEtfTickerKey(ticker) !== key) {
    throw new Error(`Yahoo ETF recovery key is not canonical: ${key}`);
  }
  return ticker;
}

function utcFromEpoch(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const seconds = Math.abs(value) >= 100_000_000_000 ? value / 1000 : value;
  const milliseconds = Math.trunc(seconds) * 1000;
  const parsed = new Date(milliseconds);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > Date.now() + 86_400_000) return null;
  return parsed.toISOString().replace(".000Z", "Z");
}

function utcDay(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > Date.now() + 86_400_000) return null;
  return parsed.toISOString().slice(0, 10);
}

function latestHistorySourceAsOf(data) {
  const history = Array.isArray(data?.history_1y) ? data.history_1y : [];
  const days = history
    .map((row) => utcDay(row?.date ?? row?.t ?? row?.time))
    .filter(Boolean)
    .sort();
  return days.length > 0 ? `${days.at(-1)}T00:00:00Z` : null;
}

function providerData(document) {
  if (document?.data && typeof document.data === "object" && !Array.isArray(document.data)) {
    return document.data;
  }
  if (document?.raw?.yf && typeof document.raw.yf === "object" && !Array.isArray(document.raw.yf)) {
    return document.raw.yf;
  }
  return null;
}

export function yahooEtfProviderSourceAsOf(document) {
  const data = providerData(document);
  if (data === null) return null;
  const info = data.info && typeof data.info === "object" && !Array.isArray(data.info)
    ? data.info
    : {};
  return utcFromEpoch(info.regularMarketTime) ?? latestHistorySourceAsOf(data);
}

function validYahooFinanceDocument(document, ticker) {
  const data = providerData(document);
  const sourceAsOf = yahooEtfProviderSourceAsOf(document);
  return document?.schema_version === "yf-finance/v2"
    && document.ticker === ticker
    && document.profile === "etf"
    && document.source === "yahoo_finance"
    && document.source_context === "stockanalysis_etf_fallback"
    && data !== null
    && Object.keys(data).length > 0
    && validTimestamp(document.fetched_at)
    && validTimestamp(sourceAsOf)
    && document.source_as_of === sourceAsOf;
}

function validYahooEtfDetailDocument(document, ticker) {
  const data = providerData(document);
  const sourceAsOf = yahooEtfProviderSourceAsOf(document);
  return document?.schema_version === "yf-etf-detail/v1"
    && document.source === "yahoo_finance"
    && document.source_provider === "yahoo_finance"
    && document.detail_status === "yf_fallback"
    && document.asset_type === "etf"
    && document.ticker === ticker
    && data !== null
    && Object.keys(data).length > 0
    && document.normalized
    && typeof document.normalized === "object"
    && !Array.isArray(document.normalized)
    && validTimestamp(document.fetched_at)
    && validTimestamp(sourceAsOf)
    && document.source_as_of === sourceAsOf;
}

function normalizeRun(run) {
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new Error("Yahoo ETF recovery run context is required");
  }
  return {
    runId: String(run.runId ?? run.run_id ?? ""),
    runAttempt: Number(run.runAttempt ?? run.run_attempt ?? 1),
    eventName: String(run.eventName ?? run.event_name ?? ""),
    observedAt: String(run.observedAt ?? run.observed_at ?? ""),
  };
}

function lanePaths(repoRoot, ticker) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new Error("Yahoo ETF fallback repoRoot is required");
  }
  const root = path.resolve(repoRoot);
  const validatedTicker = canonicalTicker(ticker);
  const key = encodeYahooEtfTickerKey(validatedTicker);
  const adminRoot = path.join(root, "data", "admin", YAHOO_ETF_FALLBACK_LANE_ID);
  return {
    root,
    ticker: validatedTicker,
    key,
    canonicalPath: path.join(root, "data", "yf", "etf-details", `${validatedTicker}.json`),
    providerPath: path.join(root, "data", "yf", "finance", `${validatedTicker}.json`),
    publicProviderPath: path.join(
      root,
      "100xfenok-next",
      "public",
      "data",
      "yf",
      "finance",
      `${validatedTicker}.json`,
    ),
    statePath: path.join(adminRoot, "index.json"),
    lkgPath: path.join(adminRoot, "lkg", `${key}.json`),
  };
}

function artifactDescriptor(paths) {
  return {
    key: paths.key,
    canonicalPath: paths.canonicalPath,
    validateDocument: (document) => validYahooEtfDetailDocument(document, paths.ticker),
    sourceAsOf: yahooEtfProviderSourceAsOf,
  };
}

function snapshotFiles(filePaths) {
  return [...new Set(filePaths)].map((filePath) => ({
    filePath,
    bytes: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
  }));
}

function restoreSnapshots(snapshots) {
  const failures = [];
  for (const { filePath, bytes } of snapshots) {
    try {
      if (bytes === null) fs.rmSync(filePath, { force: true });
      else atomicWrite(filePath, bytes);
    } catch (error) {
      failures.push(new Error(`${filePath}: ${error.message}`, { cause: error }));
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `failed to restore ${failures.length} Yahoo ETF fallback path(s)`);
  }
}

export function withYahooEtfFallbackRollback(filePaths, action, restore = restoreSnapshots) {
  const snapshots = snapshotFiles(filePaths);
  try {
    return action();
  } catch (error) {
    try {
      restore(snapshots);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Yahoo ETF fallback transaction failed (${error.message}) and rollback failed (${rollbackError.message})`,
      );
    }
    throw new Error(`Yahoo ETF fallback transaction failed and was rolled back: ${error.message}`, {
      cause: error,
    });
  }
}

function defaultStore(repoRoot) {
  return new LaneLkgStore({
    repoRoot: path.resolve(String(repoRoot)),
    laneId: YAHOO_ETF_FALLBACK_LANE_ID,
  });
}

export function recordYahooEtfFallbackFailure({
  repoRoot,
  ticker,
  run,
  reason,
  requireCompleteLkg = false,
  store = defaultStore(repoRoot),
}) {
  if (typeof reason !== "string" || reason.length === 0) {
    throw new Error("Yahoo ETF fallback failure reason is required");
  }
  const paths = lanePaths(repoRoot, ticker);
  const normalizedRun = normalizeRun(run);
  if (reason === "controlled_failure" && normalizedRun.eventName !== "workflow_dispatch") {
    throw new Error("controlled Yahoo ETF fallback failure requires workflow_dispatch");
  }
  const failure = withYahooEtfFallbackRollback(
    [paths.statePath, paths.lkgPath],
    () => {
      const recorded = store.recordFailure({
        artifacts: [artifactDescriptor(paths)],
        run: normalizedRun,
        reason,
      });
      if (requireCompleteLkg && recorded.hasCompleteLkg !== true) {
        throw new Error(`controlled Yahoo ETF fallback failure requires a complete retained LKG for ${paths.ticker}`);
      }
      return recorded;
    },
  );
  const classification = classifyLkgFailure({
    reason,
    hasCompleteLkg: failure.hasCompleteLkg,
  });
  return {
    kind: "failure",
    updated: false,
    reason,
    key: paths.key,
    hasCompleteLkg: failure.hasCompleteLkg,
    retrySet: failure.retrySet,
    ...classification,
  };
}

export function recordYahooEtfFallbackControlledFailure({
  repoRoot,
  ticker,
  run,
  store = defaultStore(repoRoot),
}) {
  const normalizedRun = normalizeRun(run);
  if (normalizedRun.eventName !== "workflow_dispatch") {
    throw new Error("controlled Yahoo ETF fallback failure requires workflow_dispatch");
  }
  return recordYahooEtfFallbackFailure({
    repoRoot,
    ticker,
    run: normalizedRun,
    reason: "controlled_failure",
    requireCompleteLkg: true,
    store,
  });
}

export function listYahooEtfFallbackRetryTargets({
  repoRoot,
  store = defaultStore(repoRoot),
}) {
  const state = store.stateSnapshot();
  return state.retry_set.map((key) => {
    const ticker = decodeYahooEtfTickerKey(key);
    const paths = lanePaths(repoRoot, ticker);
    const item = state.items[key];
    if (item?.resolution_state !== "lkg_primary"
      || store.validRetainedLkg(
        key,
        (document) => validYahooEtfDetailDocument(document, ticker),
        yahooEtfProviderSourceAsOf,
      ) !== true
      || paths.key !== key) {
      throw new Error(`Yahoo ETF fallback retry state lacks a valid retained LKG for ${ticker}`);
    }
    return ticker;
  }).sort();
}

function recoveryCandidate(paths, candidateBytes, providerBytes, run) {
  const candidate = parseJsonBytes(candidateBytes, "Yahoo ETF fallback candidate");
  const provider = parseJsonBytes(providerBytes, "Yahoo ETF provider observation");
  if (!validYahooEtfDetailDocument(candidate.document, paths.ticker)) {
    throw new Error(`Yahoo ETF fallback candidate is invalid for ${paths.ticker}`);
  }
  if (!validYahooFinanceDocument(provider.document, paths.ticker)) {
    throw new Error(`Yahoo ETF provider observation is invalid for ${paths.ticker}`);
  }
  const sourceAsOf = yahooEtfProviderSourceAsOf(candidate.document);
  const providerSourceAsOf = yahooEtfProviderSourceAsOf(provider.document);
  return {
    key: paths.key,
    currentRelativePath: path.relative(paths.root, paths.canonicalPath).split(path.sep).join("/"),
    payloadBytes: candidate.bytes,
    sourceAsOf,
    validateDocument: (document) => validYahooEtfDetailDocument(document, paths.ticker),
    deriveSourceAsOf: yahooEtfProviderSourceAsOf,
    promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
    provider_observation: buildProviderObservationV2({
      payloadBytes: provider.bytes,
      sourceAsOf: providerSourceAsOf,
      validateDocument: (document) => validYahooFinanceDocument(document, paths.ticker),
      deriveSourceAsOf: yahooEtfProviderSourceAsOf,
      candidateContainsObservation: (candidateDocument, providerDocument) => (
        candidateDocument.ticker === providerDocument.ticker
        && candidateDocument.source_as_of === providerDocument.source_as_of
        && isDeepStrictEqual(candidateDocument.raw?.yf, providerDocument.data)
      ),
      run,
    }),
  };
}

export function promoteYahooEtfFallbackCandidate({
  repoRoot,
  ticker,
  candidateBytes,
  providerBytes,
  run,
  mirrorPublic = false,
  store = defaultStore(repoRoot),
}) {
  const paths = lanePaths(repoRoot, ticker);
  const normalizedRun = normalizeRun(run);
  const state = store.stateSnapshot();
  if (state.items[paths.key]?.retry !== true) {
    throw new Error(`Yahoo ETF fallback promotion requires an active retry for ${paths.ticker}`);
  }
  const candidate = recoveryCandidate(
    paths,
    Buffer.from(candidateBytes),
    Buffer.from(providerBytes),
    normalizedRun,
  );
  const [decision] = store.evaluatePromotionCandidates([candidate], normalizedRun);
  if (!decision.eligible) {
    if (["foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(decision.reason)) {
      withYahooEtfFallbackRollback([paths.statePath], () => (
        store.recordPromotionDeferral({
          artifacts: [candidate],
          run: normalizedRun,
          reason: decision.reason,
        })
      ));
    }
    return {
      kind: "deferred",
      updated: false,
      reason: decision.reason,
      key: paths.key,
      retrySet: store.stateSnapshot().retry_set,
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }

  const outputPaths = [
    paths.canonicalPath,
    paths.providerPath,
    ...(mirrorPublic ? [paths.publicProviderPath] : []),
    paths.statePath,
  ];
  const success = withYahooEtfFallbackRollback(outputPaths, () => {
    atomicWrite(paths.canonicalPath, candidate.payloadBytes);
    atomicWrite(paths.providerPath, Buffer.from(providerBytes));
    if (mirrorPublic) atomicWrite(paths.publicProviderPath, Buffer.from(providerBytes));
    const recorded = store.recordSuccess({ artifacts: [candidate], run: normalizedRun });
    if (!fs.readFileSync(paths.canonicalPath).equals(candidate.payloadBytes)
      || !fs.readFileSync(paths.providerPath).equals(Buffer.from(providerBytes))
      || (mirrorPublic && !fs.readFileSync(paths.publicProviderPath).equals(Buffer.from(providerBytes)))) {
      throw new Error("Yahoo ETF fallback published bytes diverged from the accepted candidate");
    }
    return recorded;
  });
  const item = success.state.items[paths.key];
  return {
    kind: "success",
    updated: true,
    reason: "ok",
    key: paths.key,
    retrySet: success.retrySet,
    recovered: item?.recovered_from_run_id !== undefined
      && item?.recovery_run_id === normalizedRun.runId,
    sourceAsOf: candidate.sourceAsOf,
  };
}

function decodeBase64(value, label) {
  if (typeof value !== "string" || value.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${label} base64 is invalid`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error(`${label} base64 is not canonical`);
  return bytes;
}

export function executeYahooEtfFallbackRecoveryCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new Error("Yahoo ETF fallback recovery command must be an object");
  }
  if (command.action === "retry_targets") {
    return {
      retry_targets: listYahooEtfFallbackRetryTargets({ repoRoot: command.repo_root }),
    };
  }
  if (command.action === "record_failure") {
    return recordYahooEtfFallbackFailure({
      repoRoot: command.repo_root,
      ticker: command.ticker,
      run: command.run,
      reason: command.reason,
      requireCompleteLkg: command.require_complete_lkg === true,
    });
  }
  if (command.action === "record_controlled_failure") {
    return recordYahooEtfFallbackControlledFailure({
      repoRoot: command.repo_root,
      ticker: command.ticker,
      run: command.run,
    });
  }
  if (command.action === "promote") {
    return promoteYahooEtfFallbackCandidate({
      repoRoot: command.repo_root,
      ticker: command.ticker,
      candidateBytes: decodeBase64(command.candidate_payload_base64, "candidate payload"),
      providerBytes: decodeBase64(command.provider_payload_base64, "provider payload"),
      run: command.run,
      mirrorPublic: command.mirror_public === true,
    });
  }
  throw new Error(`unknown Yahoo ETF fallback recovery action: ${String(command.action)}`);
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") throw new Error("Yahoo ETF fallback recovery command is missing");
  const command = JSON.parse(raw);
  process.stdout.write(`${JSON.stringify(executeYahooEtfFallbackRecoveryCommand(command))}\n`);
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
