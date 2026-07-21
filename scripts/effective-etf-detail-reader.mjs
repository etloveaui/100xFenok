#!/usr/bin/env node

import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DATA_SUPPLY_POLICY_REGISTRY,
  getDataSupplyDomainPolicy,
} from "./data-supply-policy-registry.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STATE_REL_ROOT = "data/admin/data-supply-state/v1";
const PRIMARY_REL_ROOT = "data/stockanalysis/etfs";
const DOMAIN = "etf_detail";
const POLICY_CONSUMER_ID = "scripts.effective_etf_detail_reader";
const DOMAIN_POLICY = getDataSupplyDomainPolicy(
  DATA_SUPPLY_POLICY_REGISTRY,
  DOMAIN,
  POLICY_CONSUMER_ID,
);
const PRIMARY_POLICY = DOMAIN_POLICY.providers[0];
const SHA256_RE = /^[0-9a-f]{64}$/;
const IMMUTABLE_REF_KINDS = new Set(["provider_object", "provider_lkg"]);
const PYTHON_ACTIVE_READER = String.raw`
import json
import sys
from pathlib import Path

state_root = Path(sys.argv[1])
script_dir = Path(sys.argv[2])
sys.path.insert(0, str(script_dir))
from data_supply_state import DataSupplyStateStore

active = DataSupplyStateStore(state_root, defer_maintenance=True).read_active_domain("etf_detail")
print(json.dumps({
    "transaction_id": active.get("transaction_id"),
    "manifest_sha256": active.get("manifest_sha256"),
    "current": active.get("current", {}),
    "recovery": active.get("recovery", {}),
}, sort_keys=True, separators=(",", ":")))
`;

export class EffectiveEtfDetailIntegrityError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "EffectiveEtfDetailIntegrityError";
  }
}

function normalizeTicker(value) {
  const ticker = String(value ?? "").trim().toUpperCase();
  if (!ticker || ticker.includes("..") || !/^[A-Z0-9][A-Z0-9._-]*$/.test(ticker)) {
    throw new EffectiveEtfDetailIntegrityError(`invalid ETF ticker: ${value}`);
  }
  return ticker;
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readBytes(filePath, label) {
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    throw new EffectiveEtfDetailIntegrityError(`${label} read failed: ${error.message}`, { cause: error });
  }
}

function parseJson(bytes, label) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("top-level JSON value must be an object");
    }
    return value;
  } catch (error) {
    throw new EffectiveEtfDetailIntegrityError(`${label} JSON parse failed: ${error.message}`, { cause: error });
  }
}

function validatePrimary(payload, ticker) {
  if (
    payload.schema_version !== PRIMARY_POLICY.schema
    || payload.ticker !== ticker
    || payload.asset_type !== "etf"
    || (payload.source !== PRIMARY_POLICY.name && payload.source_provider !== PRIMARY_POLICY.name)
    || payload.source === DOMAIN_POLICY.providers[1].name
    || payload.source_provider === DOMAIN_POLICY.providers[1].name
    || payload.detail_status === "yf_fallback"
  ) {
    throw new EffectiveEtfDetailIntegrityError(`StockAnalysis primary ${ticker} identity mismatch`);
  }
  return payload;
}

function readPrimary(rootDir, ticker) {
  const relPath = `${PRIMARY_REL_ROOT}/${ticker}.json`;
  const filePath = path.join(rootDir, relPath);
  if (!fs.existsSync(filePath)) return null;
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw new EffectiveEtfDetailIntegrityError(`StockAnalysis primary ${ticker} stat failed: ${error.message}`, {
      cause: error,
    });
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new EffectiveEtfDetailIntegrityError(`StockAnalysis primary ${ticker} is not a regular file`);
  }
  const payload = validatePrimary(
    parseJson(readBytes(filePath, `StockAnalysis primary ${ticker}`), `StockAnalysis primary ${ticker}`),
    ticker,
  );
  return { payload, relPath };
}

function loadActiveGeneration(rootDir) {
  const stateRoot = path.join(rootDir, STATE_REL_ROOT);
  const run = spawnSync(
    process.env.PYTHON || "python3",
    ["-c", PYTHON_ACTIVE_READER, stateRoot, SCRIPT_DIR],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.error || run.status !== 0) {
    const detail = String(run.stderr || run.error?.message || run.stdout || "unknown validation failure").trim();
    throw new EffectiveEtfDetailIntegrityError(`R2 active generation validation failed: ${detail}`, {
      cause: run.error,
    });
  }
  let active;
  try {
    active = JSON.parse(run.stdout);
  } catch (error) {
    throw new EffectiveEtfDetailIntegrityError(`R2 active generation export parse failed: ${error.message}`, {
      cause: error,
    });
  }
  if (!active || typeof active !== "object" || Array.isArray(active)) {
    throw new EffectiveEtfDetailIntegrityError("R2 active generation export must be an object");
  }
  if (!active.current || typeof active.current !== "object" || Array.isArray(active.current)) {
    throw new EffectiveEtfDetailIntegrityError("R2 active current map is invalid");
  }
  if (!active.recovery || typeof active.recovery !== "object" || Array.isArray(active.recovery)) {
    throw new EffectiveEtfDetailIntegrityError("R2 active recovery map is invalid");
  }
  return {
    ...active,
    stateRoot,
    stateRootReal: fs.realpathSync(stateRoot),
  };
}

function safePayloadObjectPath(active, refPath, ticker) {
  const relPath = String(refPath ?? "");
  const segments = relPath.split("/");
  if (
    !relPath
    || path.posix.isAbsolute(relPath)
    || relPath.includes("\\")
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new EffectiveEtfDetailIntegrityError(`R2 active selection ${ticker} payload_ref.path is unsafe`);
  }
  const objectPath = path.resolve(active.stateRoot, relPath);
  let stat;
  let realPath;
  try {
    stat = fs.lstatSync(objectPath);
    realPath = fs.realpathSync(objectPath);
  } catch (error) {
    throw new EffectiveEtfDetailIntegrityError(`R2 active selection ${ticker} payload object read failed: ${error.message}`, {
      cause: error,
    });
  }
  const rootPrefix = `${active.stateRootReal}${path.sep}`;
  if (stat.isSymbolicLink() || !stat.isFile() || !realPath.startsWith(rootPrefix)) {
    throw new EffectiveEtfDetailIntegrityError(`R2 active selection ${ticker} payload object is unsafe`);
  }
  return { objectPath, relPath };
}

function readSelectedPayload(active, ticker, selection) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    throw new EffectiveEtfDetailIntegrityError(`R2 active selection ${ticker} must be an object`);
  }
  if (
    selection.schema_version !== "data-supply-selection/v1"
    || selection.domain !== DOMAIN
    || selection.entity !== ticker
  ) {
    throw new EffectiveEtfDetailIntegrityError(`R2 active selection ${ticker} identity mismatch`);
  }
  const ref = selection.payload_ref;
  const providerPolicy = DOMAIN_POLICY.providers.find((provider) => provider.name === selection.provider);
  if (!providerPolicy || selection.provider_schema !== providerPolicy.schema) {
    throw new EffectiveEtfDetailIntegrityError(`R2 active selection ${ticker} provider contract mismatch`);
  }
  if (!ref || typeof ref !== "object" || !IMMUTABLE_REF_KINDS.has(ref.kind)) {
    throw new EffectiveEtfDetailIntegrityError(`R2 active selection ${ticker} payload_ref is not immutable`);
  }
  if (!SHA256_RE.test(ref.sha256) || ref.sha256 !== selection.payload_sha256) {
    throw new EffectiveEtfDetailIntegrityError(`R2 active selection ${ticker} payload_ref digest mismatch`);
  }
  const expectedPath = ref.kind === "provider_object"
    ? `providers/${selection.provider}/${DOMAIN}/objects/${ticker}/${ref.sha256}.json`
    : `providers/${selection.provider}/${DOMAIN}/lkg/${ticker}/objects/${ref.sha256}.json`;
  if (ref.path !== expectedPath) {
    throw new EffectiveEtfDetailIntegrityError(`R2 active selection ${ticker} payload_ref identity mismatch`);
  }
  const resolved = safePayloadObjectPath(active, ref.path, ticker);
  const bytes = readBytes(resolved.objectPath, `R2 active selection ${ticker} payload object`);
  if (digest(bytes) !== ref.sha256) {
    throw new EffectiveEtfDetailIntegrityError(`R2 active selection ${ticker} payload digest mismatch`);
  }
  const payload = parseJson(bytes, `R2 active selection ${ticker} payload object`);
  if (
    payload.ticker !== ticker
    || payload.schema_version !== selection.provider_schema
    || payload.asset_type !== "etf"
  ) {
    throw new EffectiveEtfDetailIntegrityError(`R2 active selection ${ticker} payload identity mismatch`);
  }
  return { payload, relPath: resolved.relPath, sha256: ref.sha256 };
}

export function createEffectiveEtfDetailReader({ rootDir }) {
  const resolvedRoot = path.resolve(rootDir);
  let activeGeneration = null;

  function active() {
    if (!activeGeneration) activeGeneration = loadActiveGeneration(resolvedRoot);
    return activeGeneration;
  }

  return {
    resolve(value) {
      const ticker = normalizeTicker(value);
      const generation = active();
      const recovery = generation.recovery[ticker];
      const selection = generation.current[ticker];
      if (recovery && selection) {
        const selected = readSelectedPayload(generation, ticker, selection);
        return {
          status: "available",
          sourceKind: "r2_active_selection",
          primaryPresent: false,
          ticker,
          payload: selected.payload,
          payloadPath: `${STATE_REL_ROOT}/${selected.relPath}`,
          payloadSha256: selected.sha256,
          selection,
          enrolled: true,
          activeTransactionId: generation.transaction_id,
          generationManifestSha256: generation.manifest_sha256,
        };
      }

      if (recovery && recovery.last_transition === "unavailable") {
        return {
          status: "unavailable",
          sourceKind: "r2_unavailable",
          primaryPresent: false,
          ticker,
          payload: null,
          payloadPath: null,
          selection: null,
          enrolled: true,
          activeTransactionId: generation.transaction_id,
          generationManifestSha256: generation.manifest_sha256,
        };
      }

      if (recovery) {
        throw new EffectiveEtfDetailIntegrityError(
          `R2 enrolled entity ${ticker} is neither selected nor unavailable`,
        );
      }

      const primary = readPrimary(resolvedRoot, ticker);
      if (primary) {
        return {
          status: "available",
          sourceKind: "stockanalysis_primary",
          primaryPresent: true,
          ticker,
          payload: primary.payload,
          payloadPath: primary.relPath,
          selection: null,
          enrolled: false,
          activeTransactionId: generation.transaction_id,
          generationManifestSha256: generation.manifest_sha256,
        };
      }

      return {
        status: "missing",
        sourceKind: "missing",
        primaryPresent: false,
        ticker,
        payload: null,
        payloadPath: null,
        selection: null,
        enrolled: false,
        activeTransactionId: generation.transaction_id,
        generationManifestSha256: generation.manifest_sha256,
      };
    },

    listSelectedTickers() {
      return Object.keys(active().current).map(normalizeTicker).sort();
    },

    activeMetadata() {
      const generation = active();
      return {
        transactionId: generation.transaction_id,
        generationManifestSha256: generation.manifest_sha256,
        selectedCount: Object.keys(generation.current).length,
        enrolledCount: Object.keys(generation.recovery).length,
      };
    },
  };
}
