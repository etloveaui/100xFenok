import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PRODUCER_LKG_STATE_SCHEMA = "producer-lkg-key-state/v1";
export const PRODUCER_LKG_STATE_SCHEMA_V2 = "producer-lkg-key-state/v2";
export const PRODUCER_LKG_INDEX_SCHEMA = "producer-lkg-index/v1";
export const PRODUCER_LKG_INDEX_SCHEMA_V2 = "producer-lkg-index/v2";
function assertKey(key) {
  if (typeof key !== "string" || key === "" || path.basename(key) !== key || key === "." || key === "..") {
    throw new Error(`invalid LKG key: ${String(key)}`);
  }
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function writeBytesAtomic(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tempPath, bytes, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function writeJsonAtomic(filePath, value) {
  writeBytesAtomic(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

function parsePayload(payloadBytes) {
  if (!Buffer.isBuffer(payloadBytes)) throw new Error("payloadBytes must be a Buffer");
  return JSON.parse(payloadBytes.toString("utf8"));
}

function markerNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value === "") return null;
  const timestamp = new Date(value).getTime();
  if (Number.isFinite(timestamp)) return timestamp;
  return value;
}

function compactFailure(error, failureKind, run) {
  return { observed_at: run.observed_at, failure_kind: failureKind, error: String(error ?? failureKind).slice(0, 1000) };
}

function validRun(run) {
  return typeof run?.observed_at === "string" && run.observed_at.endsWith("Z") && Number.isFinite(Date.parse(run.observed_at));
}

function validSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function validSourceMarker(value) {
  return value !== null && value !== undefined && value !== "";
}

export class ProducerLkgStateStore {
  constructor({ root, laneId, publicRoot, validatePayload, progressMarker }) {
    if (!root || !laneId || !publicRoot) throw new Error("root, laneId, and publicRoot are required");
    if (typeof validatePayload !== "function" || typeof progressMarker !== "function") {
      throw new Error("validatePayload and progressMarker are required");
    }
    this.root = root;
    this.laneId = laneId;
    this.publicRoot = String(publicRoot).replace(/\/$/u, "");
    this.validatePayload = validatePayload;
    this.progressMarker = progressMarker;
    this.results = new Map();
  }

  statePath(key) { assertKey(key); return path.join(this.root, "keys", key); }
  lkgPath(key) { assertKey(key); return path.join(this.root, "lkg", key); }

  loadState(key) {
    const inspected = this.inspectState(key);
    return inspected.kind === "valid" ? inspected.state : null;
  }

  inspectState(key) {
    assertKey(key);
    let state;
    try { state = JSON.parse(fs.readFileSync(this.statePath(key), "utf8")); }
    catch (error) {
      return error?.code === "ENOENT" ? { kind: "missing", state: null, reason: "state is missing" }
        : { kind: "corrupt", state: null, reason: `state read failed: ${error.message}` };
    }
    if (![PRODUCER_LKG_STATE_SCHEMA, PRODUCER_LKG_STATE_SCHEMA_V2].includes(state?.schema_version)
      || state.lane_id !== this.laneId || state.key !== key) {
      return { kind: "corrupt", state: null, reason: "state identity/schema binding is invalid" };
    }
    if (state.resolution_state === "unavailable") {
      if (state.current !== null || state.lkg !== null || state.retry !== true) {
        return { kind: "corrupt", state: null, reason: "unavailable state pointers are invalid" };
      }
      return { kind: "valid", state, reason: null };
    }
    if (!["fresh_primary", "lkg_primary"].includes(state.resolution_state)
      || typeof state.canonical_ref !== "string" || state.canonical_ref === ""
      || !validSha256(state.current?.payload_sha256) || !validSourceMarker(state.current?.source_as_of)
      || !validSha256(state.lkg?.payload_sha256) || !validSourceMarker(state.lkg?.source_as_of)
      || state.lkg.path !== `${this.publicRoot}/lkg/${key}`) {
      return { kind: "corrupt", state: null, reason: "state payload pointer binding is invalid" };
    }
    if (state.resolution_state === "fresh_primary" && (state.retry !== false || state.current.path !== state.canonical_ref)) {
      return { kind: "corrupt", state: null, reason: "fresh current pointer binding is invalid" };
    }
    if (state.resolution_state === "lkg_primary" && (state.retry !== true || state.current.path !== state.lkg.path
      || state.current.payload_sha256 !== state.lkg.payload_sha256 || state.current.source_as_of !== state.lkg.source_as_of)) {
      return { kind: "corrupt", state: null, reason: "LKG current pointer binding is invalid" };
    }
    return { kind: "valid", state, reason: null };
  }

  inspectPayload(key, payloadBytes) {
    try {
      const payload = parsePayload(payloadBytes);
      if (this.validatePayload(key, payload) !== true) return { valid: false, reason: "payload validation failed" };
      const sourceAsOf = this.progressMarker(key, payload);
      if (sourceAsOf === null || sourceAsOf === undefined || sourceAsOf === "") {
        return { valid: false, reason: "payload progress marker is missing" };
      }
      return { valid: true, payload, source_as_of: sourceAsOf, payload_sha256: sha256(payloadBytes) };
    } catch (error) {
      return { valid: false, reason: `payload decode failed: ${error.message}` };
    }
  }

  validRetainedLkg(key, state = this.loadState(key)) {
    if (!state?.lkg?.payload_sha256 || state.lkg.path !== `${this.publicRoot}/lkg/${key}`) {
      return { valid: false, reason: "LKG state binding is missing" };
    }
    let payloadBytes;
    try {
      payloadBytes = fs.readFileSync(this.lkgPath(key));
    } catch {
      return { valid: false, reason: "LKG payload is missing" };
    }
    const inspected = this.inspectPayload(key, payloadBytes);
    if (!inspected.valid) return { valid: false, reason: inspected.reason };
    if (inspected.payload_sha256 !== state.lkg.payload_sha256) {
      return { valid: false, reason: "LKG payload sha256 does not match state" };
    }
    if (inspected.source_as_of !== state.lkg.source_as_of) {
      return { valid: false, reason: "LKG source marker does not match state" };
    }
    const expectedCurrentPath = state.resolution_state === "lkg_primary" ? state.lkg.path : state.canonical_ref;
    const lkgPrimaryMismatch = state.resolution_state === "lkg_primary" && (
      state?.current?.payload_sha256 !== state.lkg.payload_sha256
      || state?.current?.source_as_of !== state.lkg.source_as_of
    );
    if (!["lkg_primary", "fresh_primary"].includes(state.resolution_state)
      || state?.current?.path !== expectedCurrentPath || lkgPrimaryMismatch) {
      return { valid: false, reason: "current payload pointer is not bound to retained LKG state" };
    }
    return { ...inspected, payloadBytes };
  }

  planCandidate({ key, payloadBytes, canonicalRef, run }) {
    assertKey(key);
    if (!validRun(run)) throw new Error(`${key}: observed_at is invalid`);
    const inspected = this.inspectPayload(key, payloadBytes);
    if (!inspected.valid) throw new Error(`${key}: ${inspected.reason}`);
    if (typeof canonicalRef !== "string" || canonicalRef === "" || path.isAbsolute(canonicalRef) || canonicalRef.split("/").includes("..")) {
      throw new Error(`${key}: canonicalRef must stay inside the repository`);
    }
    const sourceTime = markerNumber(inspected.source_as_of);
    if (typeof sourceTime === "number" && sourceTime > Date.parse(run.observed_at)) throw new Error(`${key}: future_source`);
    const priorInspection = this.inspectState(key);
    if (priorInspection.kind === "corrupt") {
      return { accepted: false, deferred: false, corrupt: true, reason: "corrupt_state", error: priorInspection.reason,
        key, payloadBytes, canonicalRef, run };
    }
    const prior = priorInspection.state;
    if (prior && prior.resolution_state !== "unavailable") {
      const retained = this.validRetainedLkg(key, prior);
      if (!retained.valid) return { accepted: false, deferred: false, corrupt: true, reason: "corrupt_lkg", error: retained.reason, key, payloadBytes, canonicalRef, run };
      const priorTime = markerNumber(prior.current?.source_as_of ?? retained.source_as_of);
      if (typeof sourceTime !== typeof priorTime || sourceTime < priorTime) {
        return { accepted: false, deferred: false, corrupt: false, reason: "source_regression", key, payloadBytes, canonicalRef, run, inspected, prior };
      }
    }
    return { accepted: true, deferred: false, corrupt: false, reason: "ok", key, payloadBytes, canonicalRef, run, inspected, prior };
  }

  commitCandidate(plan) {
    if (!plan?.accepted) throw new Error("accepted candidate plan is required");
    const verified = this.planCandidate(plan);
    if (!verified.accepted) throw new Error(`${plan.key}: candidate plan is no longer committable: ${verified.reason}`);
    const { key, payloadBytes, canonicalRef, run, inspected } = verified;
    writeBytesAtomic(this.lkgPath(key), payloadBytes);
    const state = {
      schema_version: PRODUCER_LKG_STATE_SCHEMA,
      lane_id: this.laneId, key, updated_at: run.observed_at,
      resolution_state: "fresh_primary", retry: false,
      current: { path: canonicalRef, payload_sha256: inspected.payload_sha256, source_as_of: inspected.source_as_of },
      canonical_ref: canonicalRef,
      lkg: { path: `${this.publicRoot}/lkg/${key}`, payload_sha256: inspected.payload_sha256, source_as_of: inspected.source_as_of },
      latest_failure: null,
    };
    writeJsonAtomic(this.statePath(key), state);
    this.results.set(key, "ready");
    return { accepted: true, deferred: false, state };
  }

  recordCandidate(args) {
    const plan = this.planCandidate(args);
    if (plan.accepted) return this.commitCandidate(plan);
    const state = this.recordFailure({ key: plan.key, canonicalRef: plan.canonicalRef, run: plan.run,
      error: plan.error ?? plan.reason, failureKind: plan.reason, fallbackBytes: null });
    return { accepted: false, deferred: false, reason: plan.reason, state };
  }

  recordFailure({ key, error, failureKind, fallbackBytes, canonicalRef, run }) {
    assertKey(key);
    if (!validRun(run)) throw new Error(`${key}: observed_at is invalid`);
    const inspection = this.inspectState(key);
    const prior = inspection.state;
    let retained = prior?.lkg ? this.validRetainedLkg(key, prior) : { valid: false };
    if (inspection.kind !== "corrupt" && Buffer.isBuffer(fallbackBytes)) {
      const inspected = this.inspectPayload(key, fallbackBytes);
      const matchesCurrent = prior?.resolution_state === "fresh_primary"
        && prior.current.payload_sha256 === inspected.payload_sha256 && prior.current.source_as_of === inspected.source_as_of;
      if (inspected.valid && (!prior?.lkg || matchesCurrent)) {
        writeBytesAtomic(this.lkgPath(key), fallbackBytes);
        retained = { ...inspected, payloadBytes: fallbackBytes };
      }
    }
    const lkg = retained.valid ? { path: `${this.publicRoot}/lkg/${key}`, payload_sha256: retained.payload_sha256, source_as_of: retained.source_as_of } : null;
    const state = {
      schema_version: PRODUCER_LKG_STATE_SCHEMA, lane_id: this.laneId, key, updated_at: run.observed_at,
      resolution_state: lkg ? "lkg_primary" : "unavailable", retry: true,
      current: lkg, lkg, canonical_ref: canonicalRef,
      latest_failure: compactFailure(inspection.kind === "corrupt" ? inspection.reason : error,
        inspection.kind === "corrupt" ? "corrupt_state" : failureKind, run),
    };
    writeJsonAtomic(this.statePath(key), state);
    this.results.set(key, "failed");
    return state;
  }

  buildIndex({ keys, run }) {
    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.length !== keys.length) throw new Error("LKG index keys must be unique");
    const states = uniqueKeys.map((key) => ({ key, state: this.loadState(key) }));
    const retryKeys = states.filter(({ state }) => state?.retry === true).map(({ key }) => key);
    const failedKeys = uniqueKeys.filter((key) => this.results.get(key) === "failed");
    const lkgDetails = states.filter(({ state }) => state?.retry === true)
      .filter(({ key, state }) => this.validRetainedLkg(key, state).valid)
      .map(({ key, state }) => ({ key, payload_sha256: state.lkg.payload_sha256, source_as_of: state.lkg.source_as_of }));
    const index = {
      schema_version: PRODUCER_LKG_INDEX_SCHEMA, lane_id: this.laneId, generated_at: run.observed_at, keys: uniqueKeys,
      counts: { keys: uniqueKeys.length, fresh: states.filter(({ state }) => state?.resolution_state === "fresh_primary").length,
        lkg: states.filter(({ state }) => state?.resolution_state === "lkg_primary").length,
        retry: retryKeys.length, unavailable: states.filter(({ key, state }) => !state || !this.validRetainedLkg(key, state).valid).length,
        failed: failedKeys.length },
      retry_keys: retryKeys, lkg_details: lkgDetails,
      current_attempt: { observed_at: run.observed_at, attempted: uniqueKeys.filter((key) => this.results.has(key)).length,
        successes: uniqueKeys.filter((key) => this.results.get(key) === "ready").length, failed: failedKeys.length, failed_keys: failedKeys },
    };
    writeJsonAtomic(path.join(this.root, "index.json"), index);
    return index;
  }
}

export function assessRecoveryExit({ store, failedKeys, fatalKeys = [] }) {
  const keys = [...new Set(failedKeys)].sort();
  const reasons = [...new Set(fatalKeys)].map((key) => `${key}: true corruption is not degradable`);
  for (const key of keys) {
    const retained = store.validRetainedLkg(key);
    if (!retained.valid) reasons.push(`${key}: no valid retained LKG (${retained.reason})`);
  }
  return { exit_code: reasons.length === 0 ? 0 : 2, keys, reasons };
}
