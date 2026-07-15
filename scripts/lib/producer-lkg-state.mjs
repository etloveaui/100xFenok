import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PRODUCER_LKG_STATE_SCHEMA = "producer-lkg-key-state/v1";
export const PRODUCER_LKG_INDEX_SCHEMA = "producer-lkg-index/v1";

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

function markerAdvances(candidate, retained) {
  const left = markerNumber(candidate);
  const right = markerNumber(retained);
  if (left === null || right === null || typeof left !== typeof right) return false;
  return left > right;
}

function compactFailure(error, failureKind, run) {
  return {
    run_id: String(run.run_id),
    run_attempt: Number(run.run_attempt ?? 1),
    event_name: run.event_name ?? null,
    observed_at: run.observed_at,
    failure_kind: failureKind,
    error: String(error ?? failureKind).slice(0, 1000),
  };
}

function sameAttempt(runId, runAttempt, run) {
  return String(runId) === String(run.run_id)
    && Number(runAttempt ?? 1) === Number(run.run_attempt ?? 1);
}

function isNaturalRun(run) {
  return run?.natural === true
    && run?.event_name === "schedule"
    && Number(run?.run_attempt ?? 1) === 1;
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
  }

  statePath(key) {
    assertKey(key);
    return path.join(this.root, "keys", key);
  }

  lkgPath(key) {
    assertKey(key);
    return path.join(this.root, "lkg", key);
  }

  loadState(key) {
    const inspected = this.inspectState(key);
    return inspected.kind === "valid" ? inspected.state : null;
  }

  inspectState(key) {
    assertKey(key);
    let text;
    try {
      text = fs.readFileSync(this.statePath(key), "utf8");
    } catch (error) {
      return error?.code === "ENOENT"
        ? { kind: "missing", state: null, reason: "state is missing" }
        : { kind: "corrupt", state: null, reason: `state read failed: ${error.message}` };
    }
    let state;
    try {
      state = JSON.parse(text);
    } catch (error) {
      return { kind: "corrupt", state: null, reason: `state decode failed: ${error.message}` };
    }
    if (state?.schema_version !== PRODUCER_LKG_STATE_SCHEMA || state?.lane_id !== this.laneId || state?.key !== key) {
      return { kind: "corrupt", state: null, reason: "state identity/schema binding is invalid" };
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
    const expectedCurrentPath = state.resolution_state === "lkg_primary"
      ? state.lkg.path
      : state.resolution_state === "fresh_primary"
        ? state.canonical_ref
        : null;
    if (expectedCurrentPath === null || (
      state?.current?.path !== expectedCurrentPath
      || state?.current?.payload_sha256 !== state.lkg.payload_sha256
      || state?.current?.source_as_of !== state.lkg.source_as_of
    )) {
      return { valid: false, reason: "current payload pointer is not bound to retained LKG state" };
    }
    return { ...inspected, payloadBytes };
  }

  recordCandidate({ key, payloadBytes, canonicalRef, run }) {
    assertKey(key);
    const inspected = this.inspectPayload(key, payloadBytes);
    if (!inspected.valid) throw new Error(`${key}: ${inspected.reason}`);
    const priorInspection = this.inspectState(key);
    if (priorInspection.kind === "corrupt") {
      const state = this.#writeUnavailable({
        key,
        canonicalRef,
        run,
        failure: compactFailure(priorInspection.reason, "corrupt_state", run),
        prior: null,
      });
      return { accepted: false, state };
    }
    const prior = priorInspection.state;
    if (prior?.retry === true && !isNaturalRun(run)) {
      if (prior.resolution_state === "lkg_primary") {
        const retained = this.validRetainedLkg(key, prior);
        if (!retained.valid) {
          const state = this.#writeUnavailable({
            key,
            canonicalRef,
            run,
            failure: compactFailure(`retained LKG is invalid: ${retained.reason}`, "corrupt_lkg", run),
            prior,
          });
          return { accepted: false, deferred: false, state };
        }
      }
      const state = {
        ...prior,
        updated_at: run.observed_at,
        last_run_id: String(run.run_id),
        last_run_attempt: Number(run.run_attempt ?? 1),
        deferred_observation: {
          run_id: String(run.run_id),
          run_attempt: Number(run.run_attempt ?? 1),
          observed_at: run.observed_at,
          source_as_of: inspected.source_as_of,
          reason: "non_natural_recovery_candidate",
        },
      };
      writeJsonAtomic(this.statePath(key), state);
      return { accepted: false, deferred: true, state };
    }
    if (prior?.retry === true && prior?.resolution_state === "lkg_primary") {
      const retained = this.validRetainedLkg(key, prior);
      if (!retained.valid) {
        const state = this.#writeUnavailable({
          key,
          canonicalRef,
          run,
          failure: compactFailure(`retained LKG is invalid: ${retained.reason}`, "corrupt_lkg", run),
          prior,
        });
        return { accepted: false, deferred: false, state };
      }
      if (!markerAdvances(inspected.source_as_of, retained.source_as_of)) {
        const state = this.recordFailure({
          key,
          error: `recovery candidate ${inspected.source_as_of} did not advance beyond retained LKG ${retained.source_as_of}`,
          failureKind: "stale_recovery",
          fallbackBytes: retained.payloadBytes,
          canonicalRef,
          run,
        });
        return { accepted: false, deferred: false, state };
      }
    }

    const recoveredFromRunId = prior?.retry === true
      ? prior?.latest_failure?.run_id ?? null
      : prior?.recovered_from_run_id ?? null;
    const recoveryRunId = prior?.retry === true && recoveredFromRunId
      ? String(run.run_id)
      : prior?.recovery_run_id ?? null;
    const recoveryRunAttempt = prior?.retry === true && recoveredFromRunId
      ? Number(run.run_attempt ?? 1)
      : prior?.recovery_run_attempt ?? null;
    const recoveryEventName = prior?.retry === true && recoveredFromRunId
      ? run.event_name ?? null
      : prior?.recovery_event_name ?? null;
    const recoveredAt = prior?.retry === true && recoveredFromRunId
      ? run.observed_at
      : prior?.recovered_at ?? null;
    writeBytesAtomic(this.lkgPath(key), payloadBytes);
    const state = {
      schema_version: PRODUCER_LKG_STATE_SCHEMA,
      lane_id: this.laneId,
      key,
      updated_at: run.observed_at,
      resolution_state: "fresh_primary",
      retry: false,
      current: {
        path: canonicalRef,
        payload_sha256: inspected.payload_sha256,
        source_as_of: inspected.source_as_of,
      },
      canonical_ref: canonicalRef,
      lkg: {
        path: `${this.publicRoot}/lkg/${key}`,
        payload_sha256: inspected.payload_sha256,
        source_as_of: inspected.source_as_of,
      },
      latest_failure: null,
      recovered_from_run_id: recoveredFromRunId,
      recovery_run_id: recoveryRunId,
      recovery_run_attempt: recoveryRunAttempt,
      recovery_event_name: recoveryEventName,
      recovered_at: recoveredAt,
      last_run_id: String(run.run_id),
      last_run_attempt: Number(run.run_attempt ?? 1),
    };
    writeJsonAtomic(this.statePath(key), state);
    return { accepted: true, deferred: false, state };
  }

  recordFailure({ key, error, failureKind, fallbackBytes, canonicalRef, run }) {
    assertKey(key);
    const priorInspection = this.inspectState(key);
    if (priorInspection.kind === "corrupt") {
      return this.#writeUnavailable({
        key,
        canonicalRef,
        run,
        failure: compactFailure(`${priorInspection.reason}; producer failure: ${error}`, "corrupt_state", run),
        prior: null,
      });
    }
    const prior = priorInspection.state;
    let retained = prior?.lkg ? this.validRetainedLkg(key, prior) : { valid: false, reason: "no retained LKG state" };
    if (!prior?.lkg && Buffer.isBuffer(fallbackBytes)) {
      const inspected = this.inspectPayload(key, fallbackBytes);
      if (inspected.valid) {
        writeBytesAtomic(this.lkgPath(key), fallbackBytes);
        retained = { ...inspected, payloadBytes: fallbackBytes };
      }
    }
    const failure = compactFailure(error, failureKind, run);
    if (!retained.valid) {
      return this.#writeUnavailable({ key, canonicalRef, run, failure, prior });
    }
    const state = {
      schema_version: PRODUCER_LKG_STATE_SCHEMA,
      lane_id: this.laneId,
      key,
      updated_at: run.observed_at,
      resolution_state: "lkg_primary",
      retry: true,
      current: {
        path: `${this.publicRoot}/lkg/${key}`,
        payload_sha256: retained.payload_sha256,
        source_as_of: retained.source_as_of,
      },
      lkg: {
        path: `${this.publicRoot}/lkg/${key}`,
        payload_sha256: retained.payload_sha256,
        source_as_of: retained.source_as_of,
      },
      canonical_ref: canonicalRef,
      latest_failure: failure,
      recovered_from_run_id: prior?.recovered_from_run_id ?? null,
      recovery_run_id: prior?.recovery_run_id ?? null,
      recovery_run_attempt: prior?.recovery_run_attempt ?? null,
      recovery_event_name: prior?.recovery_event_name ?? null,
      recovered_at: prior?.recovered_at ?? null,
      last_run_id: String(run.run_id),
      last_run_attempt: Number(run.run_attempt ?? 1),
    };
    writeJsonAtomic(this.statePath(key), state);
    return state;
  }

  #writeUnavailable({ key, canonicalRef, run, failure, prior }) {
    const state = {
      schema_version: PRODUCER_LKG_STATE_SCHEMA,
      lane_id: this.laneId,
      key,
      updated_at: run.observed_at,
      resolution_state: "unavailable",
      retry: true,
      current: null,
      lkg: null,
      canonical_ref: canonicalRef,
      latest_failure: failure,
      recovered_from_run_id: prior?.recovered_from_run_id ?? null,
      recovery_run_id: prior?.recovery_run_id ?? null,
      recovery_run_attempt: prior?.recovery_run_attempt ?? null,
      recovery_event_name: prior?.recovery_event_name ?? null,
      recovered_at: prior?.recovered_at ?? null,
      last_run_id: String(run.run_id),
      last_run_attempt: Number(run.run_attempt ?? 1),
    };
    fs.rmSync(this.lkgPath(key), { force: true });
    writeJsonAtomic(this.statePath(key), state);
    return state;
  }

  buildIndex({ keys, run }) {
    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.length !== keys.length) throw new Error("LKG index keys must be unique");
    const states = uniqueKeys.map((key) => ({ key, state: this.loadState(key) }));
    const retryKeys = states.filter(({ state }) => state?.retry === true).map(({ key }) => key);
    const failedKeys = states
      .filter(({ state }) => sameAttempt(state?.latest_failure?.run_id, state?.latest_failure?.run_attempt, run))
      .map(({ key }) => key);
    const lkgDetails = [];
    let unavailable = 0;
    for (const { key, state } of states) {
      if (!state || state.resolution_state === "unavailable") {
        unavailable += 1;
        continue;
      }
      const retained = this.validRetainedLkg(key, state);
      if (!retained.valid) {
        unavailable += 1;
        continue;
      }
      if (state.retry === true) {
        lkgDetails.push({
          key,
          payload_sha256: retained.payload_sha256,
          source_as_of: retained.source_as_of,
          failure_run_id: state.latest_failure?.run_id ?? null,
          failure_run_attempt: Number(state.latest_failure?.run_attempt ?? 1),
        });
      }
    }
    const recoveryDetails = states
      .filter(({ state }) => state?.recovered_from_run_id && state?.recovery_run_id)
      .map(({ key, state }) => ({
        key,
        recovered_from_run_id: state.recovered_from_run_id,
        recovery_run_id: state.recovery_run_id,
        recovery_run_attempt: state.recovery_run_attempt ?? null,
        recovery_event_name: state.recovery_event_name ?? null,
        recovered_at: state.recovered_at ?? null,
        source_as_of: state.current?.source_as_of ?? null,
      }));
    const index = {
      schema_version: PRODUCER_LKG_INDEX_SCHEMA,
      lane_id: this.laneId,
      generated_at: run.observed_at,
      keys: uniqueKeys,
      counts: {
        keys: uniqueKeys.length,
        fresh: states.filter(({ state }) => state?.resolution_state === "fresh_primary").length,
        lkg: states.filter(({ state }) => state?.resolution_state === "lkg_primary").length,
        retry: retryKeys.length,
        unavailable,
        failed: failedKeys.length,
        recovered: recoveryDetails.filter((row) => row.recovery_run_id === String(run.run_id)).length,
      },
      retry_keys: retryKeys,
      lkg_details: lkgDetails,
      recovery_details: recoveryDetails,
      current_attempt: {
        run_id: String(run.run_id),
        run_attempt: Number(run.run_attempt ?? 1),
        event_name: run.event_name ?? null,
        observed_at: run.observed_at,
        attempted: states.filter(({ state }) => sameAttempt(state?.last_run_id, state?.last_run_attempt, run)).length,
        successes: states.filter(({ state }) => sameAttempt(state?.last_run_id, state?.last_run_attempt, run)
          && !sameAttempt(state?.latest_failure?.run_id, state?.latest_failure?.run_attempt, run)).length,
        failed: failedKeys.length,
        failed_keys: failedKeys,
      },
    };
    writeJsonAtomic(path.join(this.root, "index.json"), index);
    return index;
  }
}

export function assessRecoveryExit({ store, index, failedKeys, fatalKeys = [] }) {
  const keys = [...new Set(failedKeys)].sort();
  const reasons = [];
  for (const key of new Set(fatalKeys)) reasons.push(`${key}: true corruption is not degradable`);
  for (const key of keys) {
    const state = store.loadState(key);
    const retained = store.validRetainedLkg(key, state);
    if (!retained.valid) reasons.push(`${key}: no valid retained LKG (${retained.reason})`);
    if (state?.retry !== true || state?.resolution_state !== "lkg_primary") reasons.push(`${key}: retry/LKG resolution is not active`);
    if (!sameAttempt(state?.latest_failure?.run_id, state?.latest_failure?.run_attempt, {
      run_id: index?.current_attempt?.run_id,
      run_attempt: index?.current_attempt?.run_attempt,
    })) reasons.push(`${key}: failure is not bound to current attempt`);
    if (!index?.retry_keys?.includes(key)) reasons.push(`${key}: retry set is missing the failed key`);
    if (!index?.current_attempt?.failed_keys?.includes(key)) reasons.push(`${key}: current attempt does not name the failed key`);
    if (!index?.lkg_details?.some((row) => row?.key === key && row?.payload_sha256 === state?.lkg?.payload_sha256)) {
      reasons.push(`${key}: KPI-named LKG detail is missing or hash-unbound`);
    }
  }
  return { exit_code: reasons.length === 0 ? 0 : 2, keys, reasons };
}
