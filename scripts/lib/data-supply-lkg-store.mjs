import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { atomicWrite, writeJsonAtomic } from "./atomic-file.mjs";

export const LKG_STATE_SCHEMA = "data-supply-lkg-state/v1";
const IDENTIFIER_RE = /^[a-z][a-z0-9_-]{0,95}$/;
const SYSTEMIC_REASONS = new Set([
  "auth_error",
  "rate_limited",
  "decode_error",
  "schema_drift",
  "empty_payload",
  "future_source",
  "unexpected_error",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedRelative(filePath) {
  return filePath.split(path.sep).join("/");
}

function parseDocument(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

function validUtc(value) {
  return typeof value === "string" && value.endsWith("Z") && Number.isFinite(Date.parse(value));
}

function validateRun(run) {
  if (!run || !validUtc(run.observedAt)) throw new Error("observedAt must be RFC3339 UTC");
}

function validateArtifactDescriptor(artifact) {
  if (!artifact || typeof artifact !== "object" || !IDENTIFIER_RE.test(artifact.key)) {
    throw new Error("artifact key is invalid");
  }
  if (typeof artifact.canonicalPath !== "string" || artifact.canonicalPath.length === 0) {
    throw new Error(`canonicalPath is required for ${artifact.key}`);
  }
  if (typeof artifact.validateDocument !== "function" || typeof artifact.sourceAsOf !== "function") {
    throw new Error(`artifact validators are required for ${artifact.key}`);
  }
}

function validateCandidate(candidate, run = null) {
  if (!candidate || typeof candidate !== "object" || !IDENTIFIER_RE.test(candidate.key)) {
    throw new Error("candidate key is invalid");
  }
  if (!(candidate.payloadBytes instanceof Uint8Array)) throw new Error(`payloadBytes are required for ${candidate.key}`);
  if (typeof candidate.currentRelativePath !== "string" || candidate.currentRelativePath.length === 0) {
    throw new Error(`currentRelativePath is required for ${candidate.key}`);
  }
  const relativePath = normalizedRelative(candidate.currentRelativePath);
  if (path.isAbsolute(candidate.currentRelativePath)
    || relativePath === ".." || relativePath.startsWith("../") || relativePath.split("/").includes("..")) {
    throw new Error(`currentRelativePath must stay inside repoRoot for ${candidate.key}`);
  }
  if (typeof candidate.validateDocument !== "function" || typeof candidate.deriveSourceAsOf !== "function") {
    throw new Error(`candidate validators are required for ${candidate.key}`);
  }
  const document = parseDocument(Buffer.from(candidate.payloadBytes));
  if (!document || candidate.validateDocument(document) !== true) throw new Error(`candidate payload is invalid for ${candidate.key}`);
  if (typeof candidate.sourceAsOf !== "string" || !Number.isFinite(Date.parse(candidate.sourceAsOf))) {
    throw new Error(`candidate sourceAsOf is invalid for ${candidate.key}`);
  }
  if (candidate.deriveSourceAsOf(document) !== candidate.sourceAsOf) {
    throw new Error(`candidate sourceAsOf is not payload-bound for ${candidate.key}`);
  }
  if (run !== null && Date.parse(candidate.sourceAsOf) > Date.parse(run.observedAt)) {
    throw new Error(`candidate sourceAsOf is in the future for ${candidate.key}`);
  }
  return { document };

}

export function systemicLkgFailureReason(reasons) {
  if (!Array.isArray(reasons)) throw new Error("failure reasons must be an array");
  return reasons.find((reason) => SYSTEMIC_REASONS.has(reason)) ?? null;
}

export function allNaturalRequestsFailed(results, isControlled = () => false) {
  if (!Array.isArray(results) || typeof isControlled !== "function") {
    throw new Error("request results and controlled selector are required");
  }
  const naturalResults = results.filter((row, index) => !isControlled(row, index));
  return naturalResults.length > 0 && naturalResults.every((row) => row?.status !== "ready");
}

export function classifyLkgFailure({ reason, hasCompleteLkg, systemic = false }) {
  const corrupt = hasCompleteLkg !== true || systemic === true || SYSTEMIC_REASONS.has(reason);
  return {
    degraded: !corrupt,
    corrupt,
    exitCode: corrupt ? 2 : 0,
  };
}

export class LaneLkgStore {
  constructor({ repoRoot, laneId }) {
    if (typeof repoRoot !== "string" || repoRoot.length === 0) throw new Error("repoRoot is required");
    if (!IDENTIFIER_RE.test(laneId)) throw new Error("laneId is invalid");
    this.repoRoot = path.resolve(repoRoot);
    this.laneId = laneId;
    this.adminRoot = path.join(this.repoRoot, "data", "admin", laneId);
    this.lkgRoot = path.join(this.adminRoot, "lkg");
    this.statePath = path.join(this.adminRoot, "index.json");
  }

  _emptyState() {
    return {
      schema_version: LKG_STATE_SCHEMA,
      lane_id: this.laneId,
      updated_at: null,
      retry_set: [],
      items: {},
    };
  }

  _loadState() {
    if (!fs.existsSync(this.statePath)) return this._emptyState();
    let state;
    try {
      state = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
    } catch (error) {
      throw new Error(`recovery state is invalid JSON for ${this.laneId}: ${error.message}`);
    }
    if (state?.schema_version !== LKG_STATE_SCHEMA || state?.lane_id !== this.laneId
      || !Array.isArray(state?.retry_set) || !state?.items || typeof state.items !== "object" || Array.isArray(state.items)) {
      throw new Error(`recovery state contract is invalid for ${this.laneId}`);
    }
    const retrySet = [...state.retry_set];
    const retryItems = Object.entries(state.items)
      .filter(([, item]) => item?.retry === true)
      .map(([key, item]) => {
        if (item.key !== key) throw new Error(`recovery item identity is invalid for ${this.laneId}/${key}`);
        return key;
      })
      .sort();
    if (retrySet.some((key) => typeof key !== "string" || !IDENTIFIER_RE.test(key))
      || new Set(retrySet).size !== retrySet.length
      || retrySet.some((key, index) => index > 0 && retrySet[index - 1].localeCompare(key) >= 0)
      || JSON.stringify(retrySet) !== JSON.stringify(retryItems)) {
      throw new Error(`recovery retry_set is inconsistent for ${this.laneId}`);
    }
    return state;
  }

  _lkgPath(key) {
    return path.join(this.lkgRoot, `${key}.json`);
  }

  _lkgRelativePath(key) {
    return `data/admin/${this.laneId}/lkg/${key}.json`;
  }

  _relativeCanonical(canonicalPath) {
    const relative = normalizedRelative(path.relative(this.repoRoot, path.resolve(canonicalPath)));
    if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
      throw new Error("canonical artifact must be inside repoRoot");
    }
    return relative;
  }

  _readValidCanonical(artifact) {
    if (!fs.existsSync(artifact.canonicalPath)) return null;
    const bytes = fs.readFileSync(artifact.canonicalPath);
    const document = parseDocument(bytes);
    if (!document || artifact.validateDocument(document) !== true) return null;
    const sourceAsOf = artifact.sourceAsOf(document);
    if (typeof sourceAsOf !== "string" || !Number.isFinite(Date.parse(sourceAsOf))) return null;
    return { bytes, document, sourceAsOf };
  }

  _readValidLkg(key, item, validateDocument, sourceAsOf) {
    const descriptor = item?.lkg;
    const current = item?.current;
    if (item?.resolution_state !== "lkg_primary" || item?.retry !== true
      || !descriptor || !current || descriptor.path !== this._lkgRelativePath(key)
      || typeof descriptor.payload_sha256 !== "string" || typeof descriptor.source_as_of !== "string") {
      return null;
    }
    if (current.path !== descriptor.path
      || current.payload_sha256 !== descriptor.payload_sha256
      || current.source_as_of !== descriptor.source_as_of) return null;
    const lkgPath = this._lkgPath(key);
    if (!fs.existsSync(lkgPath)) return null;
    const bytes = fs.readFileSync(lkgPath);
    const document = parseDocument(bytes);
    const derivedSourceAsOf = document && typeof sourceAsOf === "function" ? sourceAsOf(document) : null;
    if (!document || validateDocument(document) !== true || sha256(bytes) !== descriptor.payload_sha256
      || typeof derivedSourceAsOf !== "string" || !Number.isFinite(Date.parse(derivedSourceAsOf))
      || derivedSourceAsOf !== descriptor.source_as_of) return null;
    return { bytes, document, descriptor: structuredClone(descriptor) };
  }

  validRetainedLkg(key, validateDocument, sourceAsOf) {
    if (!IDENTIFIER_RE.test(key) || typeof validateDocument !== "function" || typeof sourceAsOf !== "function") return false;
    const state = this._loadState();
    return this._readValidLkg(key, state.items[key], validateDocument, sourceAsOf) !== null;
  }

  stateSnapshot() {
    return structuredClone(this._loadState());
  }

  recordFailure({ artifacts, run, reason }) {
    validateRun(run);
    if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error("failure artifacts are required");
    if (typeof reason !== "string" || reason.length === 0) throw new Error("failure reason is required");
    artifacts.forEach(validateArtifactDescriptor);
    const keys = artifacts.map((artifact) => artifact.key);
    if (new Set(keys).size !== keys.length) throw new Error("failure artifact keys must be unique");

    const state = this._loadState();
    for (const artifact of artifacts) {
      this._relativeCanonical(artifact.canonicalPath);
      const priorItem = state.items[artifact.key] ?? {};
      const priorLkg = this._readValidLkg(artifact.key, priorItem, artifact.validateDocument, artifact.sourceAsOf);
      const canonical = this._readValidCanonical(artifact);
      let lkg = priorLkg?.descriptor ?? null;
      if (canonical !== null) {
        atomicWrite(this._lkgPath(artifact.key), canonical.bytes);
        lkg = {
          path: this._lkgRelativePath(artifact.key),
          payload_sha256: sha256(canonical.bytes),
          source_as_of: canonical.sourceAsOf,
        };
      }
      const latestFailure = {
        observed_at: run.observedAt,
        reason,
      };
      state.items[artifact.key] = {
        key: artifact.key,
        resolution_state: lkg ? "lkg_primary" : "unavailable",
        retry: true,
        ...(lkg ? { current: structuredClone(lkg), lkg: structuredClone(lkg) } : {}),
        latest_failure: latestFailure,
        updated_at: run.observedAt,
      };
      if (!lkg) {
        delete state.items[artifact.key].current;
        delete state.items[artifact.key].lkg;
      }

    }
    state.updated_at = run.observedAt;
    state.retry_set = Object.values(state.items)
      .filter((item) => item?.retry === true)
      .map((item) => item.key)
      .sort();
    writeJsonAtomic(this.statePath, state);
    const hasCompleteLkg = artifacts.every((artifact) => this.validRetainedLkg(
      artifact.key,
      artifact.validateDocument,
      artifact.sourceAsOf,
    ));
    return { hasCompleteLkg, retrySet: [...state.retry_set], state };
  }

  evaluatePromotionCandidates(artifacts, run) {
    if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error("recovery candidates are required");
    validateRun(run);
    const state = this._loadState();
    const seen = new Set();
    return artifacts.map((artifact) => {
      validateCandidate(artifact, run);
      if (seen.has(artifact.key)) throw new Error("recovery candidate keys must be unique");
      seen.add(artifact.key);
      const item = state.items[artifact.key];
      const retainedSource = item?.resolution_state === "lkg_primary" ? item?.lkg?.source_as_of : item?.current?.source_as_of;
      if (retainedSource && Date.parse(artifact.sourceAsOf) < Date.parse(retainedSource)) {
        return { key: artifact.key, eligible: false, reason: "source_regression", artifact };
      }
      return { key: artifact.key, eligible: true, reason: "ok", artifact };
    });
  }

  recoveryCandidateAdvances(artifacts, run) {
    return this.evaluatePromotionCandidates(artifacts, run).every((decision) => decision.eligible);
  }

  promotableCandidates(artifacts, run) {
    return this.evaluatePromotionCandidates(artifacts, run)
      .filter((decision) => decision.eligible)
      .map((decision) => decision.artifact);
  }

  recordSuccess({ artifacts, run }) {
    const decisions = this.evaluatePromotionCandidates(artifacts, run);
    const rejected = decisions.find((decision) => !decision.eligible);
    if (rejected) throw new Error(`recovery promotion rejected for ${this.laneId}/${rejected.key}: ${rejected.reason}`);
    const state = this._loadState();
    for (const artifact of artifacts) {
      const priorItem = state.items[artifact.key] ?? {};
      state.items[artifact.key] = {
        key: artifact.key,
        resolution_state: "fresh_primary",
        retry: false,
        current: {
          path: normalizedRelative(artifact.currentRelativePath),
          payload_sha256: sha256(Buffer.from(artifact.payloadBytes)),
          source_as_of: artifact.sourceAsOf,
        },
        ...(priorItem.lkg ? { lkg: priorItem.lkg } : {}),
        updated_at: run.observedAt,
      };
    }
    state.updated_at = run.observedAt;
    state.retry_set = Object.values(state.items).filter((item) => item?.retry === true).map((item) => item.key).sort();
    writeJsonAtomic(this.statePath, state);
    return { retrySet: [...state.retry_set], state };
  }
}
