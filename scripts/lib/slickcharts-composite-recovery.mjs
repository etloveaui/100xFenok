import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { canonicalJson } from "./json-canonical.mjs";

// Lane opt-in to the shared first-attempt structured workflow_dispatch
// recovery policy (isEligibleRecoveryRun in data-supply-lkg-store.mjs).
const ALLOW_BOUND_WORKFLOW_DISPATCH_RECOVERY = true;

// Local mirror of the shared eligibility predicate from
// data-supply-lkg-store.mjs (isNaturalScheduleRun,
// hasStructuredGithubRunBinding, isEligibleRecoveryRun). A static import of
// that module is impossible here: lane-registry.mjs:699 reads
// SLICKCHARTS_MEMBER_PATHS at module-evaluation time inside the
// data-supply-lkg-store import graph (data-supply-attempt-shard.mjs ->
// data-supply-detection-config.mjs -> lane-registry.mjs -> this module),
// so the edge would TDZ-crash every entry point. Keep this mirror
// byte-identical in behavior to the shared predicate.
function isEligibleRecoveryRun(run, allowBoundWorkflowDispatchRecovery = false) {
  const natural = run?.eventName === "schedule" && Number(run?.runAttempt ?? 1) === 1;
  if (natural) return true;
  if (allowBoundWorkflowDispatchRecovery !== true) return false;
  if (run?.eventName !== "workflow_dispatch" || Number(run?.runAttempt ?? 0) !== 1) return false;
  if (typeof run?.runId !== "string" || run.runId.length === 0) return false;
  const numeric = Number(run.runId);
  return Number.isInteger(numeric) && numeric > 0 && String(numeric) === run.runId.trim();
}

export const SLICKCHARTS_COMPOSITE_SCHEMA = "slickcharts-composite-lkg-index/v1";
export const SLICKCHARTS_COMPOSITE_LANE_ID = "slickcharts";
export const SLICKCHARTS_COMPOSITE_MEMBERS = Object.freeze([
  "daily",
  "weekly",
  "monthly",
  "history",
  "symbols",
]);

export const SLICKCHARTS_MEMBER_PATHS = Object.freeze({
  daily: Object.freeze([
    { path: "data/slickcharts/gainers.json", kind: "file", required: true },
    { path: "data/slickcharts/losers.json", kind: "file", required: true },
    { path: "data/slickcharts/treasury.json", kind: "file", required: true },
    { path: "data/slickcharts/currency.json", kind: "file", required: true },
    { path: "data/slickcharts/mortgage.json", kind: "file", required: true },
  ]),
  weekly: Object.freeze([
    { path: "data/slickcharts/sp500.json", kind: "file", required: true },
    { path: "data/slickcharts/magnificent7.json", kind: "file", required: true },
    { path: "data/slickcharts/etf.json", kind: "file", required: true },
    { path: "data/slickcharts/berkshire.json", kind: "file", required: true },
  ]),
  monthly: Object.freeze([
    ...[
      "sp500-returns.json",
      "sp500-returns-details.json",
      "nasdaq100-returns.json",
      "dowjones-returns.json",
      "sp500-drawdown.json",
      "btc-returns.json",
      "eth-returns.json",
      "sp500-performance.json",
      "nasdaq100-performance.json",
      "dowjones-performance.json",
      "sp500-yield.json",
      "nasdaq100-yield.json",
      "dowjones-yield.json",
      "sp500-analysis.json",
      "nasdaq100-analysis.json",
      "dowjones-analysis.json",
      "sp500-marketcap.json",
      "nasdaq100-ratio.json",
      "nasdaq100.json",
      "dowjones.json",
      "inflation.json",
    ].map((name) => ({ path: `data/slickcharts/${name}`, kind: "file", required: true })),
    { path: "data/slickcharts/1929crash.json", kind: "file", required: false },
  ]),
  history: Object.freeze([
    { path: "data/slickcharts/stocks-returns.json", kind: "file", required: true },
    { path: "data/slickcharts/stocks-dividends.json", kind: "file", required: true },
    { path: "data/slickcharts/stocks-dividends-recent.json", kind: "file", required: true },
    { path: "data/slickcharts/stocks-dividends-historical.json", kind: "file", required: true },
    { path: "data/slickcharts/stocks", kind: "directory", required: true },
  ]),
  symbols: Object.freeze([
    { path: "data/slickcharts/symbols.json", kind: "file", required: true },
    { path: "data/slickcharts/symbols-all.json", kind: "file", required: true },
  ]),
});

function fail(message) {
  throw new Error(`slickcharts composite recovery: ${message}`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertMember(member) {
  if (!SLICKCHARTS_COMPOSITE_MEMBERS.includes(member)) fail(`unknown member ${member}`);
}

function safeRelative(relative) {
  return typeof relative === "string"
    && relative.length > 0
    && !path.isAbsolute(relative)
    && !relative.split("/").includes("..")
    && !/[\u0000-\u001f\u007f]/u.test(relative);
}

function walkFiles(root, relativeRoot) {
  const absolute = path.join(root, relativeRoot);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .flatMap((entry) => {
      if (entry.isSymbolicLink()) fail(`symlink is forbidden in owned bundle: ${relativeRoot}/${entry.name}`);
      const relative = `${relativeRoot}/${entry.name}`;
      if (entry.isDirectory()) return walkFiles(root, relative);
      if (!entry.isFile()) fail(`unsupported owned bundle entry: ${relative}`);
      return [relative];
    });
}

function ownedFiles(repoRoot, member) {
  assertMember(member);
  const files = [];
  for (const spec of SLICKCHARTS_MEMBER_PATHS[member]) {
    if (!safeRelative(spec.path)) fail(`unsafe owned path ${spec.path}`);
    const absolute = path.join(repoRoot, spec.path);
    if (spec.kind === "directory") {
      if (!fs.existsSync(absolute)) {
        if (spec.required) fail(`required owned directory is missing: ${spec.path}`);
        continue;
      }
      if (!fs.statSync(absolute).isDirectory()) fail(`owned directory is not a directory: ${spec.path}`);
      const children = walkFiles(repoRoot, spec.path);
      if (spec.required && children.length === 0) fail(`required owned directory is empty: ${spec.path}`);
      files.push(...children);
    } else {
      if (!fs.existsSync(absolute)) {
        if (spec.required) fail(`required owned file is missing: ${spec.path}`);
        continue;
      }
      if (!fs.statSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) {
        fail(`owned file is not a regular file: ${spec.path}`);
      }
      files.push(spec.path);
    }
  }
  return [...new Set(files)].sort((left, right) => left.localeCompare(right, "en"));
}

export function memberContractSha256(member) {
  assertMember(member);
  return sha256(canonicalJson(SLICKCHARTS_MEMBER_PATHS[member]));
}

export function inspectSlickchartsMemberBundle(repoRoot, member) {
  const files = ownedFiles(repoRoot, member).map((relative) => {
    const bytes = fs.readFileSync(path.join(repoRoot, relative));
    return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
  });
  return {
    contract_sha256: memberContractSha256(member),
    file_count: files.length,
    bytes: files.reduce((sum, row) => sum + row.bytes, 0),
    tree_sha256: sha256(canonicalJson(files)),
    files,
  };
}

export function inspectSlickchartsCompositeLiveIntegrity(repoRoot, index) {
  validateSlickchartsCompositeIndex(index);
  const mismatches = [];
  for (const member of SLICKCHARTS_COMPOSITE_MEMBERS) {
    try {
      const actual = inspectSlickchartsMemberBundle(repoRoot, member);
      if (canonicalJson(actual) !== canonicalJson(index.members[member].bundle)) {
        mismatches.push({ member, reason: "owned_bundle_differs_from_index" });
      }
    } catch (error) {
      mismatches.push({ member, reason: error.message });
    }
  }
  return { valid: mismatches.length === 0, mismatches };
}

function copyFile(repoRoot, snapshotRoot, relative) {
  const source = path.join(repoRoot, relative);
  const destination = path.join(snapshotRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function writeJsonAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function prepareSlickchartsCompositeSnapshot({ repoRoot, member, snapshotRoot }) {
  assertMember(member);
  fs.rmSync(snapshotRoot, { recursive: true, force: true });
  fs.mkdirSync(snapshotRoot, { recursive: true });
  const bundle = inspectSlickchartsMemberBundle(repoRoot, member);
  for (const row of bundle.files) copyFile(repoRoot, snapshotRoot, row.path);
  writeJsonAtomic(path.join(snapshotRoot, "baseline.json"), { member, bundle });
  return bundle;
}

function removeOwnedPaths(repoRoot, member) {
  for (const spec of SLICKCHARTS_MEMBER_PATHS[member]) {
    fs.rmSync(path.join(repoRoot, spec.path), { recursive: spec.kind === "directory", force: true });
  }
}

function readSnapshotBaseline({ member, snapshotRoot }) {
  const baselinePath = path.join(snapshotRoot, "baseline.json");
  if (!fs.existsSync(baselinePath)) fail("baseline manifest is missing");
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (baseline.member !== member || baseline.bundle?.contract_sha256 !== memberContractSha256(member)) {
    fail("baseline ownership contract does not match");
  }
  if (!Array.isArray(baseline.bundle.files)
    || baseline.bundle.files.some((row) => !safeRelative(row?.path)
      || !/^[a-f0-9]{64}$/u.test(row?.sha256 ?? "")
      || !fs.existsSync(path.join(snapshotRoot, row.path))
      || sha256(fs.readFileSync(path.join(snapshotRoot, row.path))) !== row.sha256)) {
    fail("baseline payload set is missing or corrupt");
  }
  return baseline;
}

export function restoreSlickchartsCompositeSnapshot({ repoRoot, member, snapshotRoot }) {
  const baseline = readSnapshotBaseline({ member, snapshotRoot });
  removeOwnedPaths(repoRoot, member);
  for (const row of baseline.bundle.files) {
    copyFile(snapshotRoot, repoRoot, row.path);
  }
  const restored = inspectSlickchartsMemberBundle(repoRoot, member);
  if (restored.tree_sha256 !== baseline.bundle.tree_sha256) fail("restored bundle digest differs from baseline");
  return restored;
}

function strictIso(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
}

function eventFiles(target) {
  if (!target || !fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return target.endsWith(".jsonl") ? [target] : [];
  if (!stat.isDirectory()) return [];
  return fs.readdirSync(target, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .flatMap((entry) => eventFiles(path.join(target, entry.name)));
}

export function readProviderReceiptSet(targets) {
  const rows = targets.flatMap(eventFiles).flatMap((filePath) => fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line)));
  const successful = rows.filter((row) => row.execution === "returned"
    && Number.isSafeInteger(row.http_status)
    && row.http_status >= 200
    && row.http_status < 300
    && row.decode === "ok"
    && row.payload === "non_empty"
    && Array.isArray(row.assertions)
    && row.assertions.every((assertion) => assertion.passed === true));
  if (successful.length === 0) fail("successful provider receipt set is empty");
  const receipts = successful.map((row) => {
    const providerDate = strictIso(row.provider_date);
    if (!providerDate || !/^[a-f0-9]{64}$/u.test(row.response_sha256 ?? "")) {
      fail("successful provider receipt lacks Date or response digest");
    }
    return { provider_date: providerDate, response_sha256: row.response_sha256 };
  }).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right), "en"));
  return {
    kind: "http_date_receipt_set",
    receipt_count: receipts.length,
    source_floor: receipts.map((row) => row.provider_date).sort().at(0),
    source_ceiling: receipts.map((row) => row.provider_date).sort().at(-1),
    content_set_sha256: sha256(canonicalJson(receipts.map((row) => row.response_sha256).sort())),
    receipt_set_sha256: sha256(canonicalJson(receipts)),
  };
}

function generationFor(members) {
  const vector = SLICKCHARTS_COMPOSITE_MEMBERS.map((member) => ({
    member,
    tree_sha256: members[member]?.bundle?.tree_sha256 ?? null,
  }));
  return { generation_id: sha256(canonicalJson(vector)), members: Object.fromEntries(vector.map((row) => [row.member, row.tree_sha256])) };
}

function stateFor(members) {
  const states = SLICKCHARTS_COMPOSITE_MEMBERS.map((member) => members[member]?.resolution_state ?? "unavailable");
  if (states.includes("unavailable")) return "unavailable";
  if (states.includes("bootstrap_unverified")) return "bootstrap_unverified";
  if (states.includes("lkg_primary")) return "degraded_lkg";
  return "ready";
}

function retryMembers(members) {
  return SLICKCHARTS_COMPOSITE_MEMBERS.filter((member) => members[member]?.retry === true);
}

function memberStateSha256(row) {
  return sha256(canonicalJson(row));
}

function currentBundleEntry(bundle, run, providerObservation, resolutionState = "bootstrap_unverified") {
  return {
    resolution_state: resolutionState,
    retry: false,
    bundle,
    provider_observation: providerObservation,
    promoted_run: run,
    last_failure: null,
    last_recovery: null,
  };
}

export function bootstrapSlickchartsCompositeIndex({
  repoRoot,
  run,
  member = null,
  baselineBundle = null,
}) {
  const members = {};
  for (const candidateMember of SLICKCHARTS_COMPOSITE_MEMBERS) {
    try {
      const bundle = candidateMember === member && baselineBundle !== null
        ? structuredClone(baselineBundle)
        : inspectSlickchartsMemberBundle(repoRoot, candidateMember);
      members[candidateMember] = currentBundleEntry(bundle, run, null);
    } catch (error) {
      members[candidateMember] = {
        resolution_state: "unavailable",
        retry: false,
        bundle: null,
        provider_observation: null,
        promoted_run: null,
        last_failure: { kind: "bootstrap", detail: error.message, run },
        last_recovery: null,
      };
    }
  }
  const active = generationFor(members);
  return {
    schema_version: SLICKCHARTS_COMPOSITE_SCHEMA,
    lane_id: SLICKCHARTS_COMPOSITE_LANE_ID,
    generated_at: run.observed_at,
    state_revision: 1,
    composite_state: stateFor(members),
    active_composite: { ...active, commit_sha: run.head_sha ?? null },
    retained_composite: null,
    retry_members: retryMembers(members),
    members,
  };
}

export function validateSlickchartsCompositeIndex(index) {
  if (!index || index.schema_version !== SLICKCHARTS_COMPOSITE_SCHEMA || index.lane_id !== SLICKCHARTS_COMPOSITE_LANE_ID) {
    fail("index identity is invalid");
  }
  if (!Number.isSafeInteger(index.state_revision) || index.state_revision < 1) fail("state revision is invalid");
  if (!index.members || Object.keys(index.members).sort().join(",") !== [...SLICKCHARTS_COMPOSITE_MEMBERS].sort().join(",")) {
    fail("index member denominator is invalid");
  }
  for (const member of SLICKCHARTS_COMPOSITE_MEMBERS) {
    const row = index.members[member];
    if (!new Set(["bootstrap_unverified", "fresh_primary", "lkg_primary", "unavailable"]).has(row.resolution_state)) {
      fail(`${member} resolution state is invalid`);
    }
    if (typeof row.retry !== "boolean") fail(`${member} retry flag is invalid`);
    if ((row.resolution_state === "lkg_primary") !== row.retry) {
      fail(`${member} retry state is inconsistent`);
    }
    if ((row.resolution_state === "unavailable") !== (row.bundle === null)) {
      fail(`${member} availability state is inconsistent`);
    }
    if (row.provider_observation !== null) {
      const observation = row.provider_observation;
      if (observation?.kind !== "http_date_receipt_set"
        || !Number.isSafeInteger(observation.receipt_count)
        || observation.receipt_count < 1
        || strictIso(observation.source_floor) !== observation.source_floor
        || strictIso(observation.source_ceiling) !== observation.source_ceiling
        || observation.source_floor > observation.source_ceiling
        || !/^[a-f0-9]{64}$/u.test(observation.content_set_sha256 ?? "")
        || !/^[a-f0-9]{64}$/u.test(observation.receipt_set_sha256 ?? "")) {
        fail(`${member} provider observation is invalid`);
      }
    }
    if (row.bundle !== null) {
      const files = row.bundle.files;
      const paths = Array.isArray(files) ? files.map((entry) => entry?.path) : [];
      const specs = SLICKCHARTS_MEMBER_PATHS[member];
      const allowed = (relative) => specs.some((spec) => spec.kind === "file"
        ? relative === spec.path
        : relative.startsWith(`${spec.path}/`));
      const requiredPresent = specs.filter((spec) => spec.required).every((spec) => spec.kind === "file"
        ? paths.includes(spec.path)
        : paths.some((relative) => relative.startsWith(`${spec.path}/`)));
      const rowsValid = Array.isArray(files)
        && files.every((entry) => safeRelative(entry?.path)
          && allowed(entry.path)
          && Number.isSafeInteger(entry.bytes)
          && entry.bytes >= 0
          && /^[a-f0-9]{64}$/u.test(entry.sha256 ?? ""))
        && new Set(paths).size === paths.length
        && paths.every((relative, index) => index === 0 || paths[index - 1].localeCompare(relative, "en") < 0);
      if (row.bundle.contract_sha256 !== memberContractSha256(member)
        || !/^[a-f0-9]{64}$/u.test(row.bundle.tree_sha256 ?? "")
        || !rowsValid
        || !requiredPresent
        || row.bundle.file_count !== files.length
        || row.bundle.bytes !== files.reduce((sum, entry) => sum + entry.bytes, 0)
        || sha256(canonicalJson(files)) !== row.bundle.tree_sha256) fail(`${member} bundle is invalid`);
    }
  }
  const expectedActive = generationFor(index.members);
  if (index.active_composite?.generation_id !== expectedActive.generation_id
    || canonicalJson(index.active_composite.members) !== canonicalJson(expectedActive.members)) {
    fail("active composite generation does not match members");
  }
  if (index.active_composite.commit_sha !== null
    && !/^[a-f0-9]{40}$/u.test(index.active_composite.commit_sha ?? "")) {
    fail("active composite commit is invalid");
  }
  const expectedRetryMembers = retryMembers(index.members);
  if (expectedRetryMembers.length > 1) fail("more than one composite retry is forbidden");
  if (index.composite_state !== stateFor(index.members)
    || canonicalJson(index.retry_members) !== canonicalJson(expectedRetryMembers)) {
    fail("composite state does not match members");
  }
  if (expectedRetryMembers.length === 0 && index.retained_composite !== null) {
    fail("retained composite exists without a retry");
  }
  if (expectedRetryMembers.length === 1) {
    // The retained generation records the last all-fresh checkpoint. Healthy
    // members may advance while one member remains on LKG, so it need not
    // equal the current active generation.
    const retainedMembers = index.retained_composite?.members ?? {};
    const retainedVector = SLICKCHARTS_COMPOSITE_MEMBERS.map((member) => ({
      member,
      tree_sha256: retainedMembers[member],
    }));
    if (!index.retained_composite
      || Object.keys(retainedMembers).sort().join(",") !== [...SLICKCHARTS_COMPOSITE_MEMBERS].sort().join(",")
      || retainedVector.some((row) => !/^[a-f0-9]{64}$/u.test(row.tree_sha256 ?? ""))
      || index.retained_composite.generation_id !== sha256(canonicalJson(retainedVector))
      || (index.retained_composite.commit_sha !== null
        && !/^[a-f0-9]{40}$/u.test(index.retained_composite.commit_sha ?? ""))) {
      fail("retained composite generation is invalid");
    }
  }
  return true;
}

function readIndex(indexPath, repoRoot, run, member, snapshotRoot) {
  if (!fs.existsSync(indexPath)) {
    const baseline = readSnapshotBaseline({ member, snapshotRoot });
    return bootstrapSlickchartsCompositeIndex({
      repoRoot,
      run,
      member,
      baselineBundle: baseline.bundle,
    });
  }
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  validateSlickchartsCompositeIndex(index);
  return index;
}

function attemptReady(row) {
  return row?.execution === "returned"
    && row.http_status >= 200
    && row.http_status < 300
    && row.decode === "ok"
    && row.payload === "non_empty"
    && Array.isArray(row.assertions)
    && row.assertions.every((assertion) => assertion.passed === true);
}

function updateEnvelope(index, run, { generationPublished = false } = {}) {
  index.state_revision += 1;
  index.generated_at = run.observed_at;
  index.composite_state = stateFor(index.members);
  index.retry_members = retryMembers(index.members);
  const active = generationFor(index.members);
  index.active_composite = {
    ...active,
    commit_sha: generationPublished ? null : index.active_composite?.commit_sha ?? null,
  };
  validateSlickchartsCompositeIndex(index);
  return index;
}

export function finalizeSlickchartsCompositeRecovery({
  repoRoot,
  member,
  snapshotRoot,
  indexPath,
  rowPath,
  receiptTargets,
  statusPath,
  run,
  fullRun,
}) {
  assertMember(member);
  const index = readIndex(indexPath, repoRoot, run, member, snapshotRoot);
  const row = JSON.parse(fs.readFileSync(rowPath, "utf8"));
  if (row.lane_id !== SLICKCHARTS_COMPOSITE_LANE_ID || row.member_id !== member) fail("attempt row identity is invalid");
  const prior = structuredClone(index.members[member]);
  // Natural schedule attempt 1, or (lane opt-in) a bound first-attempt
  // workflow_dispatch with a numeric nonzero GITHUB_RUN_ID.
  const natural = isEligibleRecoveryRun({
    eventName: run.event_name,
    runAttempt: run.run_attempt,
    runId: run.run_id == null ? run.run_id : String(run.run_id),
  }, ALLOW_BOUND_WORKFLOW_DISPATCH_RECOVERY);
  let publishData = false;
  let exitCode = 0;
  let decision;
  const existingRetryMember = retryMembers(index.members)[0] ?? null;

  if (!fullRun) {
    restoreSlickchartsCompositeSnapshot({ repoRoot, member, snapshotRoot });
    index.members[member] = prior;
    decision = "partial_run_deferred";
  } else if (existingRetryMember !== null && existingRetryMember !== member && !attemptReady(row)) {
    restoreSlickchartsCompositeSnapshot({ repoRoot, member, snapshotRoot });
    index.members[member] = prior;
    decision = "secondary_failure_deferred";
  } else if (!attemptReady(row)) {
    const restored = restoreSlickchartsCompositeSnapshot({ repoRoot, member, snapshotRoot });
    const hasTrustedLkg = prior.resolution_state === "fresh_primary" || prior.resolution_state === "lkg_primary";
    index.members[member] = {
      ...prior,
      resolution_state: hasTrustedLkg ? "lkg_primary" : prior.resolution_state,
      retry: hasTrustedLkg,
      bundle: restored,
      last_failure: {
        run,
        attempt_id: row.attempt_id,
        retained_generation_id: index.active_composite.generation_id,
      },
    };
    if (index.retained_composite === null && hasTrustedLkg) {
      index.retained_composite = structuredClone(index.active_composite);
    }
    decision = hasTrustedLkg ? "retained_lkg" : "bootstrap_failure_retained";
  } else {
    let providerObservation;
    try {
      providerObservation = readProviderReceiptSet(receiptTargets);
    } catch (error) {
      restoreSlickchartsCompositeSnapshot({ repoRoot, member, snapshotRoot });
      if (existingRetryMember !== null && existingRetryMember !== member) {
        index.members[member] = prior;
        decision = "secondary_failure_deferred";
      } else {
        const hasTrustedLkg = prior.resolution_state === "fresh_primary" || prior.resolution_state === "lkg_primary";
        index.members[member] = {
          ...prior,
          resolution_state: hasTrustedLkg ? "lkg_primary" : prior.resolution_state,
          retry: hasTrustedLkg,
          last_failure: { run, attempt_id: row.attempt_id, detail: error.message, retained_generation_id: index.active_composite.generation_id },
        };
        if (index.retained_composite === null && index.members[member].resolution_state === "lkg_primary") {
          index.retained_composite = structuredClone(index.active_composite);
        }
        decision = "provider_receipt_invalid";
      }
      exitCode = 2;
      providerObservation = null;
    }

    if (providerObservation !== null) {
      const recovering = prior.retry === true || prior.resolution_state === "lkg_primary";
      const priorFloor = prior.provider_observation?.source_floor ?? null;
      const advances = priorFloor !== null && providerObservation.source_floor > priorFloor;
      const priorContentSet = prior.provider_observation?.content_set_sha256 ?? null;
      const contentAdvances = /^[a-f0-9]{64}$/u.test(priorContentSet ?? "")
        && providerObservation.content_set_sha256 !== priorContentSet;
      if (recovering && (!natural || !advances || !contentAdvances)) {
        restoreSlickchartsCompositeSnapshot({ repoRoot, member, snapshotRoot });
        index.members[member] = {
          ...prior,
          retry: true,
          last_failure: prior.last_failure,
        };
        decision = !natural
          ? "recovery_requires_natural_schedule_attempt_1"
          : !advances
            ? "recovery_requires_advancing_provider_time"
            : "recovery_requires_advancing_provider_content";
      } else {
        let bundle;
        try {
          bundle = inspectSlickchartsMemberBundle(repoRoot, member);
        } catch (error) {
          if (existingRetryMember === null || existingRetryMember === member) throw error;
          restoreSlickchartsCompositeSnapshot({ repoRoot, member, snapshotRoot });
          index.members[member] = prior;
          decision = "secondary_failure_deferred";
          exitCode = 2;
          bundle = null;
        }
        if (bundle !== null) {
          index.members[member] = {
            resolution_state: "fresh_primary",
            retry: false,
            bundle,
            provider_observation: providerObservation,
            promoted_run: run,
            last_failure: prior.last_failure,
            last_recovery: recovering ? {
              recovered_from_run_id: prior.last_failure?.run?.run_id ?? null,
              recovery_run_id: run.run_id,
              recovery_run_attempt: run.run_attempt,
              recovery_event_name: run.event_name,
              recovered_at: run.observed_at,
              retained_generation_id: prior.last_failure?.retained_generation_id ?? index.retained_composite?.generation_id ?? null,
            } : prior.last_recovery,
          };
          publishData = true;
          decision = recovering ? "recovered_and_promoted" : "candidate_promoted";
        }
      }
    }
  }

  if (retryMembers(index.members).length === 0) index.retained_composite = null;
  updateEnvelope(index, run, { generationPublished: publishData });
  index.current_attempt = {
    run_id: String(run.run_id),
    run_attempt: run.run_attempt,
    event_name: run.event_name,
    observed_at: run.observed_at,
    member_id: member,
    decision,
    base_member_state_sha256: memberStateSha256(prior),
  };
  const status = {
    schema_version: "slickcharts-composite-run-status/v1",
    lane_id: SLICKCHARTS_COMPOSITE_LANE_ID,
    member,
    run_id: String(run.run_id),
    generated_at: run.observed_at,
    decision,
    exit_code: exitCode,
    publish_data: publishData,
    composite_state: index.composite_state,
    active_generation_id: index.active_composite.generation_id,
    retry_members: index.retry_members,
  };
  writeJsonAtomic(indexPath, index);
  writeJsonAtomic(statusPath, status);
  return { index, status };
}

export function mergeSlickchartsCompositeMember({ baseIndex, savedIndex, member, generatedAt }) {
  assertMember(member);
  validateSlickchartsCompositeIndex(baseIndex);
  validateSlickchartsCompositeIndex(savedIndex);
  const expectedBaseMemberSha256 = savedIndex.current_attempt?.member_id === member
    ? savedIndex.current_attempt?.base_member_state_sha256
    : null;
  const baseMemberSha256 = memberStateSha256(baseIndex.members[member]);
  const savedMemberSha256 = memberStateSha256(savedIndex.members[member]);
  if (!/^[a-f0-9]{64}$/u.test(expectedBaseMemberSha256 ?? "")
    || (baseMemberSha256 !== expectedBaseMemberSha256 && baseMemberSha256 !== savedMemberSha256)) {
    fail(`foreign_writer_conflict for ${member}`);
  }
  const merged = structuredClone(baseIndex);
  merged.members[member] = structuredClone(savedIndex.members[member]);
  merged.current_attempt = structuredClone(savedIndex.current_attempt);
  const mergedRetryMember = retryMembers(merged.members)[0] ?? null;
  if (mergedRetryMember === null) {
    merged.retained_composite = null;
  } else if (baseIndex.retained_composite !== null) {
    // Preserve the original all-fresh checkpoint across healthy updates from
    // other members while the retrying member stays on LKG.
    merged.retained_composite = structuredClone(baseIndex.retained_composite);
  } else {
    merged.retained_composite = structuredClone(baseIndex.active_composite);
  }
  merged.generated_at = generatedAt;
  return updateEnvelope(merged, {
    observed_at: generatedAt,
    head_sha: baseIndex.active_composite.commit_sha,
  });
}
