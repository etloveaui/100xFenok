import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

export const PRODUCER_LKG_STATE_SCHEMA = "producer-lkg-key-state/v1";
export const PRODUCER_LKG_STATE_SCHEMA_V2 = "producer-lkg-key-state/v2";
export const PRODUCER_LKG_INDEX_SCHEMA = "producer-lkg-index/v1";
export const PRODUCER_LKG_INDEX_SCHEMA_V2 = "producer-lkg-index/v2";
export const PRODUCER_PROMOTION_CONTRACT_V2 = "provider_observation/v2";
export const PRODUCER_PROMOTION_ANCHOR_SCHEMA = "producer-promotion-anchor/v1";
export const LEGACY_RECOVERY_PROVENANCE_CONTRACT = "legacy_source_marker/v1";

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

function validRun(run) {
  return run
    && String(run.run_id ?? "").length > 0
    && Number.isInteger(Number(run.run_attempt ?? 1))
    && Number(run.run_attempt ?? 1) >= 1
    && String(run.event_name ?? "").length > 0
    && typeof run.observed_at === "string"
    && run.observed_at.endsWith("Z")
    && Number.isFinite(Date.parse(run.observed_at));
}

function validSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function validSourceMarker(value) {
  return value !== null && value !== undefined && value !== "";
}

export class ProducerLkgStateStore {
  constructor({ root, laneId, publicRoot, validatePayload, progressMarker, candidateContainsObservation = isDeepStrictEqual }) {
    if (!root || !laneId || !publicRoot) throw new Error("root, laneId, and publicRoot are required");
    if (typeof validatePayload !== "function" || typeof progressMarker !== "function"
      || typeof candidateContainsObservation !== "function") {
      throw new Error("validatePayload, progressMarker, and candidateContainsObservation are required");
    }
    this.root = root;
    this.laneId = laneId;
    this.publicRoot = String(publicRoot).replace(/\/$/u, "");
    this.validatePayload = validatePayload;
    this.progressMarker = progressMarker;
    this.candidateContainsObservation = candidateContainsObservation;
  }

  statePath(key) {
    assertKey(key);
    return path.join(this.root, "keys", key);
  }

  lkgPath(key) {
    assertKey(key);
    return path.join(this.root, "lkg", key);
  }

  promotionAnchorPath(key) {
    assertKey(key);
    return path.join(this.root, "promotion-contracts", key);
  }

  #inspectPromotionAnchor(key) {
    let anchor;
    try {
      anchor = JSON.parse(fs.readFileSync(this.promotionAnchorPath(key), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return { corrupt: false, required: false };
      return { corrupt: true, required: false };
    }
    if (anchor?.schema_version !== PRODUCER_PROMOTION_ANCHOR_SCHEMA
      || anchor?.lane_id !== this.laneId
      || anchor?.key !== key
      || anchor?.promotion_contract !== PRODUCER_PROMOTION_CONTRACT_V2
      || !(anchor?.recovery_observation_sha256 === null || validSha256(anchor?.recovery_observation_sha256))) {
      return { corrupt: true, required: false };
    }
    return { corrupt: false, required: true, recovery_observation_sha256: anchor.recovery_observation_sha256 };
  }

  #anchorProviderProofKey(key, recoveryObservation) {
    const inspected = this.#inspectPromotionAnchor(key);
    if (inspected.corrupt) throw new Error("provider promotion anchor is corrupt");
    const recoveryObservationSha256 = recoveryObservation === null
      ? null
      : sha256(Buffer.from(JSON.stringify(recoveryObservation)));
    if (inspected.required && inspected.recovery_observation_sha256 === recoveryObservationSha256) return;
    writeJsonAtomic(this.promotionAnchorPath(key), {
      schema_version: PRODUCER_PROMOTION_ANCHOR_SCHEMA,
      lane_id: this.laneId,
      key,
      promotion_contract: PRODUCER_PROMOTION_CONTRACT_V2,
      recovery_observation_sha256: recoveryObservationSha256,
    });
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
    const v2State = state?.schema_version === PRODUCER_LKG_STATE_SCHEMA_V2;
    if (![PRODUCER_LKG_STATE_SCHEMA, PRODUCER_LKG_STATE_SCHEMA_V2].includes(state?.schema_version)
      || state?.lane_id !== this.laneId || state?.key !== key) {
      return { kind: "corrupt", state: null, reason: "state identity/schema binding is invalid" };
    }
    const promotionAnchor = this.#inspectPromotionAnchor(key);
    if (promotionAnchor.corrupt) {
      return { kind: "corrupt", state: null, reason: "provider promotion anchor is invalid" };
    }
    if (state.resolution_state === "unavailable") {
      if (state.current !== null || state.lkg !== null || state.retry !== true) {
        return { kind: "corrupt", state: null, reason: "unavailable state pointers are invalid" };
      }
      return { kind: "valid", state, reason: null };
    }
    if (!["fresh_primary", "lkg_primary"].includes(state.resolution_state)
      || typeof state.canonical_ref !== "string" || state.canonical_ref === ""
      || !validSha256(state?.current?.payload_sha256)
      || !validSourceMarker(state?.current?.source_as_of)
      || !validSha256(state?.lkg?.payload_sha256)
      || !validSourceMarker(state?.lkg?.source_as_of)
      || state?.lkg?.path !== `${this.publicRoot}/lkg/${key}`) {
      return { kind: "corrupt", state: null, reason: "state payload pointer binding is invalid" };
    }
    if (state.resolution_state === "fresh_primary" && (
      state.retry !== false || state.current.path !== state.canonical_ref
    )) {
      return { kind: "corrupt", state: null, reason: "fresh current pointer binding is invalid" };
    }
    if (state.resolution_state === "lkg_primary" && (
      state.retry !== true || state.current.path !== state.lkg.path
      || state.current.payload_sha256 !== state.lkg.payload_sha256
      || state.current.source_as_of !== state.lkg.source_as_of
    )) {
      return { kind: "corrupt", state: null, reason: "LKG current pointer binding is invalid" };
    }
    const requiresProviderProof = state.resolution_state === "fresh_primary" && (
      promotionAnchor.required || v2State
      || state.promotion_proof_required === true || Boolean(state.provider_observation)
    );
    if (requiresProviderProof && state.promotion_contract !== PRODUCER_PROMOTION_CONTRACT_V2) {
      return { kind: "corrupt", state: null, reason: "provider observation contract downgrade is invalid" };
    }
    // Pre-contract states recovered before provider-observation binding existed; their
    // lineage is provable only as a declared exception (DEC-266), never inferred at read time.
    const declaredLegacyProvenance = Object.hasOwn(state, "recovery_provenance_contract");
    if (declaredLegacyProvenance && (
      state.recovery_provenance_contract !== LEGACY_RECOVERY_PROVENANCE_CONTRACT
      || state.promotion_contract !== PRODUCER_PROMOTION_CONTRACT_V2
      || (state.recovered_from_run_id ?? null) === null
      || Object.hasOwn(state, "recovery_observation")
      || Object.hasOwn(state, "last_recovered_failure")
      || promotionAnchor.recovery_observation_sha256 !== null
    )) {
      return { kind: "corrupt", state: null, reason: "legacy recovery provenance declaration is invalid" };
    }
    if (state.promotion_contract === PRODUCER_PROMOTION_CONTRACT_V2) {
      const proof = state.provider_observation;
      const proofRun = proof && {
        run_id: proof.run_id,
        run_attempt: proof.run_attempt,
        event_name: proof.event_name,
        observed_at: proof.observed_at,
      };
      const recoveryProof = state.recovery_observation;
      const recoveryProofRun = recoveryProof && {
        run_id: recoveryProof.run_id,
        run_attempt: recoveryProof.run_attempt,
        event_name: recoveryProof.event_name,
        observed_at: recoveryProof.observed_at,
      };
      if (proof?.schema_version !== PRODUCER_PROMOTION_CONTRACT_V2
        || !Object.hasOwn(proof, "recovered_from_run_id")
        || !validSha256(proof.payload_sha256)
        || !validSourceMarker(proof.source_as_of)
        || !validRun(proofRun)
        || proof.payload_sha256 !== state.current.payload_sha256
        || proof.source_as_of !== state.current.source_as_of
        || proof.run_id !== String(state.last_run_id)
        || Number(proof.run_attempt ?? 1) !== Number(state.last_run_attempt ?? 1)
        || proof.event_name !== state.last_event_name
        || proof.observed_at !== state.updated_at
        || proof.recovered_from_run_id !== (state.recovered_from_run_id ?? null)
        || ((state.recovered_from_run_id ?? null) !== null && !declaredLegacyProvenance && (
          state.last_recovered_failure?.run_id !== state.recovered_from_run_id
          || recoveryProof?.schema_version !== PRODUCER_PROMOTION_CONTRACT_V2
          || promotionAnchor.recovery_observation_sha256 !== sha256(Buffer.from(JSON.stringify(recoveryProof)))
          || !validSha256(recoveryProof?.payload_sha256)
          || !validSourceMarker(recoveryProof?.source_as_of)
          || !validRun(recoveryProofRun)
          || recoveryProof.recovered_from_run_id !== state.recovered_from_run_id
          || state.recovery_run_id !== recoveryProof.run_id
          || state.recovery_run_attempt !== recoveryProof.run_attempt
          || state.recovery_event_name !== recoveryProof.event_name
          || state.recovered_at !== recoveryProof.observed_at
        ))
        || ((state.recovered_from_run_id ?? null) === null
          && promotionAnchor.recovery_observation_sha256 !== null)) {
        return { kind: "corrupt", state: null, reason: "provider observation proof binding is invalid" };
      }
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

  buildProviderObservation({ key, payloadBytes, run }) {
    assertKey(key);
    if (!validRun(run)) throw new Error(`${key}: provider observation run binding is invalid`);
    const inspected = this.inspectPayload(key, payloadBytes);
    if (!inspected.valid) throw new Error(`${key}: ${inspected.reason}`);
    return {
      schema_version: PRODUCER_PROMOTION_CONTRACT_V2,
      payloadBytes: Buffer.from(payloadBytes),
      payload_sha256: inspected.payload_sha256,
      source_as_of: inspected.source_as_of,
      run_id: String(run.run_id),
      run_attempt: Number(run.run_attempt ?? 1),
      event_name: String(run.event_name),
      observed_at: run.observed_at,
    };
  }

  #inspectProviderObservation(key, providerObservation, run) {
    if (!providerObservation || providerObservation.schema_version !== PRODUCER_PROMOTION_CONTRACT_V2
      || !Buffer.isBuffer(providerObservation.payloadBytes)) {
      throw new Error(`${key}: provider observation contract is invalid`);
    }
    const inspected = this.inspectPayload(key, providerObservation.payloadBytes);
    if (!inspected.valid) throw new Error(`${key}: provider observation ${inspected.reason}`);
    if (providerObservation.payload_sha256 !== inspected.payload_sha256
      || providerObservation.source_as_of !== inspected.source_as_of) {
      throw new Error(`${key}: provider observation proof is not payload-bound`);
    }
    if (!validRun(run)
      || providerObservation.run_id !== String(run.run_id)
      || providerObservation.run_attempt !== Number(run.run_attempt ?? 1)
      || providerObservation.event_name !== String(run.event_name)
      || providerObservation.observed_at !== run.observed_at) {
      throw new Error(`${key}: provider observation proof is not bound to the current run`);
    }
    return inspected;
  }

  planCandidate({ key, payloadBytes, canonicalRef, run, providerObservation = null }) {
    assertKey(key);
    if (!validRun(run)) throw new Error(`${key}: run context is invalid`);
    const inspected = this.inspectPayload(key, payloadBytes);
    if (!inspected.valid) throw new Error(`${key}: ${inspected.reason}`);
    const provider = providerObservation === null ? null : this.#inspectProviderObservation(key, providerObservation, run);
    const priorInspection = this.inspectState(key);
    if (priorInspection.kind === "corrupt") {
      return { accepted: false, deferred: false, corrupt: true, reason: "corrupt_state", error: priorInspection.reason,
        key, payloadBytes, canonicalRef, run, providerObservation };
    }
    const prior = priorInspection.state;
    if (prior?.retry === true && !isNaturalRun(run)) {
      if (prior.resolution_state === "lkg_primary") {
        const retained = this.validRetainedLkg(key, prior);
        if (!retained.valid) {
          return { accepted: false, deferred: false, corrupt: true, reason: "corrupt_lkg",
            error: `retained LKG is invalid: ${retained.reason}`, key, payloadBytes, canonicalRef, run, providerObservation };
        }
      }
      return { accepted: false, deferred: true, corrupt: false, reason: "recovery_requires_schedule",
        key, payloadBytes, canonicalRef, run, providerObservation, inspected, provider, prior };
    }
    if (prior?.retry === true && prior?.resolution_state === "lkg_primary") {
      const retained = this.validRetainedLkg(key, prior);
      if (!retained.valid) {
        return { accepted: false, deferred: false, corrupt: true, reason: "corrupt_lkg",
          error: `retained LKG is invalid: ${retained.reason}`, key, payloadBytes, canonicalRef, run, providerObservation };
      }
      if (provider !== null) {
        if (inspected.source_as_of !== provider.source_as_of
          || this.candidateContainsObservation(inspected.payload, provider.payload) !== true) {
          return { accepted: false, deferred: true, corrupt: false, reason: "foreign_writer_conflict",
            key, payloadBytes, canonicalRef, run, providerObservation, inspected, provider, prior };
        }
        if (!markerAdvances(provider.source_as_of, retained.source_as_of)) {
          return { accepted: false, deferred: true, corrupt: false, reason: "recovery_not_advanced_by_provider",
            key, payloadBytes, canonicalRef, run, providerObservation, inspected, provider, prior };
        }
      } else if (!markerAdvances(inspected.source_as_of, retained.source_as_of)) {
        return { accepted: false, deferred: false, corrupt: false, reason: "stale_recovery",
          key, payloadBytes, canonicalRef, run, providerObservation, inspected, provider, prior };
      }
    }

    return { accepted: true, deferred: false, corrupt: false, reason: "ok",
      key, payloadBytes, canonicalRef, run, providerObservation, inspected, provider, prior };
  }

  recordPromotionDeferral(plan) {
    if (!plan?.deferred || !plan.prior?.retry) throw new Error("promotion deferral requires an active retry plan");
    const state = {
      ...plan.prior,
      updated_at: plan.run.observed_at,
      last_run_id: String(plan.run.run_id),
      last_run_attempt: Number(plan.run.run_attempt ?? 1),
      last_event_name: plan.run.event_name ?? null,
      latest_promotion_deferral: {
        run_id: String(plan.run.run_id),
        run_attempt: Number(plan.run.run_attempt ?? 1),
        event_name: plan.run.event_name ?? null,
        observed_at: plan.run.observed_at,
        source_as_of: plan.provider?.source_as_of ?? plan.inspected?.source_as_of ?? null,
        reason: plan.reason,
      },
    };
    writeJsonAtomic(this.statePath(plan.key), state);
    return state;
  }

  commitCandidate(plan) {
    if (!plan?.accepted) throw new Error("accepted candidate plan is required");
    const verified = this.planCandidate({
      key: plan.key,
      payloadBytes: plan.payloadBytes,
      canonicalRef: plan.canonicalRef,
      run: plan.run,
      providerObservation: plan.providerObservation,
    });
    if (!verified.accepted) throw new Error(`${plan.key}: candidate plan is no longer committable: ${verified.reason}`);
    const { key, payloadBytes, canonicalRef, run, inspected, providerObservation, prior } = verified;

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
    const recoveryObservation = prior?.retry === true && recoveredFromRunId && providerObservation
      ? {
          schema_version: providerObservation.schema_version,
          payload_sha256: providerObservation.payload_sha256,
          source_as_of: providerObservation.source_as_of,
          run_id: providerObservation.run_id,
          run_attempt: providerObservation.run_attempt,
          event_name: providerObservation.event_name,
          observed_at: providerObservation.observed_at,
          recovered_from_run_id: recoveredFromRunId,
        }
      : prior?.recovery_observation ?? null;
    const preserveRetainedLkg = prior?.retry === true && prior?.resolution_state === "lkg_primary";
    if (!preserveRetainedLkg) writeBytesAtomic(this.lkgPath(key), payloadBytes);
    const lkg = preserveRetainedLkg
      ? { ...prior.lkg }
      : {
          path: `${this.publicRoot}/lkg/${key}`,
          payload_sha256: inspected.payload_sha256,
          source_as_of: inspected.source_as_of,
        };
    const state = {
      schema_version: providerObservation ? PRODUCER_LKG_STATE_SCHEMA_V2 : PRODUCER_LKG_STATE_SCHEMA,
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
      lkg,
      latest_failure: null,
      recovered_from_run_id: recoveredFromRunId,
      recovery_run_id: recoveryRunId,
      recovery_run_attempt: recoveryRunAttempt,
      recovery_event_name: recoveryEventName,
      recovered_at: recoveredAt,
      last_run_id: String(run.run_id),
      last_run_attempt: Number(run.run_attempt ?? 1),
      last_event_name: run.event_name ?? null,
      promotion_contract: providerObservation ? PRODUCER_PROMOTION_CONTRACT_V2 : "legacy_source_marker/v1",
    };
    if (providerObservation) {
      state.promotion_proof_required = true;
      state.provider_observation = {
        schema_version: providerObservation.schema_version,
        payload_sha256: providerObservation.payload_sha256,
        source_as_of: providerObservation.source_as_of,
        run_id: providerObservation.run_id,
        run_attempt: providerObservation.run_attempt,
        event_name: providerObservation.event_name,
        observed_at: providerObservation.observed_at,
        recovered_from_run_id: recoveredFromRunId,
      };
    }
    if (recoveryObservation) state.recovery_observation = recoveryObservation;
    if (prior?.retry === true && prior?.latest_failure) state.last_recovered_failure = prior.latest_failure;
    else if (prior?.last_recovered_failure) state.last_recovered_failure = prior.last_recovered_failure;
    // Lineage inherited from a pre-contract prior cannot carry a recovery observation;
    // declare that exception explicitly (DEC-266) instead of leaving the state unprovable.
    // The declaration only carries forward an existing pre-contract lineage — a new
    // recovery in this commit always builds a full recoveryObservation above.
    const inheritsLegacyLineage = Boolean(providerObservation)
      && recoveredFromRunId !== null
      && recoveryObservation === null
      && !state.last_recovered_failure
      && (prior?.recovered_from_run_id ?? null) === recoveredFromRunId
      && !prior?.recovery_observation
      && (!Object.hasOwn(prior ?? {}, "promotion_contract")
        || prior?.promotion_contract === LEGACY_RECOVERY_PROVENANCE_CONTRACT
        || prior?.recovery_provenance_contract === LEGACY_RECOVERY_PROVENANCE_CONTRACT);
    if (inheritsLegacyLineage) state.recovery_provenance_contract = LEGACY_RECOVERY_PROVENANCE_CONTRACT;
    delete state.latest_promotion_deferral;
    if (providerObservation) this.#anchorProviderProofKey(key, recoveryObservation);
    writeJsonAtomic(this.statePath(key), state);
    return { accepted: true, deferred: false, state };
  }

  recordCandidate(args) {
    const plan = this.planCandidate(args);
    if (plan.accepted) return this.commitCandidate(plan);
    if (plan.corrupt) {
      const state = this.#writeUnavailable({
        key: plan.key,
        canonicalRef: plan.canonicalRef,
        run: plan.run,
        failure: compactFailure(plan.error, plan.reason, plan.run),
        prior: null,
      });
      return { accepted: false, deferred: false, state };
    }
    if (plan.deferred) return { accepted: false, deferred: true, reason: plan.reason, state: this.recordPromotionDeferral(plan) };
    const retained = this.validRetainedLkg(plan.key, plan.prior);
    const state = this.recordFailure({
      key: plan.key,
      error: `recovery candidate ${plan.inspected.source_as_of} did not advance beyond retained LKG ${retained.source_as_of}`,
      failureKind: "stale_recovery",
      fallbackBytes: retained.payloadBytes,
      canonicalRef: plan.canonicalRef,
      run: plan.run,
    });
    return { accepted: false, deferred: false, reason: plan.reason, state };
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
    if (Buffer.isBuffer(fallbackBytes)) {
      const inspected = this.inspectPayload(key, fallbackBytes);
      const fallbackMatchesPublishedCurrent = prior?.resolution_state === "fresh_primary"
        && prior?.current?.payload_sha256 === inspected.payload_sha256
        && prior?.current?.source_as_of === inspected.source_as_of;
      if (inspected.valid && (!prior?.lkg || fallbackMatchesPublishedCurrent)) {
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
      last_event_name: run.event_name ?? null,
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
    const promotionDeferralDetails = states
      .filter(({ state }) => sameAttempt(
        state?.latest_promotion_deferral?.run_id,
        state?.latest_promotion_deferral?.run_attempt,
        run,
      ))
      .map(({ key, state }) => ({ key, ...state.latest_promotion_deferral }));
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
      schema_version: PRODUCER_LKG_INDEX_SCHEMA_V2,
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
      promotion_deferral_details: promotionDeferralDetails,
      current_attempt: {
        run_id: String(run.run_id),
        run_attempt: Number(run.run_attempt ?? 1),
        event_name: run.event_name ?? null,
        observed_at: run.observed_at,
        attempted: states.filter(({ state }) => sameAttempt(state?.last_run_id, state?.last_run_attempt, run)).length,
        successes: states.filter(({ state }) => sameAttempt(state?.last_run_id, state?.last_run_attempt, run)
          && !sameAttempt(state?.latest_failure?.run_id, state?.latest_failure?.run_attempt, run)
          && !sameAttempt(
            state?.latest_promotion_deferral?.run_id,
            state?.latest_promotion_deferral?.run_attempt,
            run,
          )).length,
        failed: failedKeys.length,
        failed_keys: failedKeys,
        promotion_deferrals: promotionDeferralDetails.length,
        promotion_deferral_keys: promotionDeferralDetails.map(({ key }) => key),
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
