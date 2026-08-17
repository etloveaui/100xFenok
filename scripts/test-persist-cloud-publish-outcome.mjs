#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { persistPublishOutcome } from "./persist-cloud-publish-outcome.mjs";
import {
  PLANE_CANONICAL_COMMIT_MODES,
  PLANE_PUBLISH_OUTCOME_BINDINGS,
  PLANE_PUBLISHER_EXCEPTIONS,
} from "./lib/lane-registry.mjs";
import {
  appendPublishOutcome,
  buildPublishOutcomeRecord,
  PUBLISH_OUTCOME_SHARD_SCHEMA,
  validatePublishOutcomeShard,
} from "./lib/publish-outcome-shard.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_PATH = path.join(REPO_ROOT, "data", "admin", "lane-commit-manifest.json");
const OUTCOME_ROOT = "data/admin/data-supply-state/publish-outcomes";
const COORDINATOR_WORKFLOW = ".github/workflows/coordinate-computed-signals.yml";
const TRACKED_SIGNAL_PATHS = [
  "data/computed/signals.json",
  "100xfenok-next/public/data/computed/signals.json",
];
const SEED_SIGNAL_TEXT = "{\"generated_at\":\"2026-08-10T00:00:00.000Z\"}\n";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function persistCommandPattern(family, workflow) {
  return new RegExp(
    `persist-cloud-publish-outcome\\.mjs\\s+--family=${escapeRegExp(family)}`
      + `\\s+--workflow=${escapeRegExp(workflow)}`,
  );
}

function jobBlockAt(text, index) {
  const headings = [...text.matchAll(/^  [a-z][a-z0-9_-]*:\s*$/gmu)];
  const position = headings.findIndex((match, candidate) => (
    match.index <= index && (candidate === headings.length - 1 || headings[candidate + 1].index > index)
  ));
  assert.ok(position >= 0, "persistence command must belong to a workflow job");
  const start = headings[position].index;
  const end = position + 1 < headings.length ? headings[position + 1].index : text.length;
  return text.slice(start, end);
}

// Canonical workflow contract: every bound publisher follows the canonical
// data commit, owns exactly one family, fails the job on publish failure, and
// is immediately followed by a non-blocking always() persistence step.
{
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  assert.ok(PLANE_PUBLISH_OUTCOME_BINDINGS["global-scouter"],
    "Global Scouter caller publication must be authorized by the registry");
  assert.equal(Object.keys(PLANE_PUBLISH_OUTCOME_BINDINGS).length, 24,
    "the authorized publisher set is an exact registry contract");
  for (const [family, binding] of Object.entries(PLANE_PUBLISH_OUTCOME_BINDINGS)) {
    const workflowText = fs.readFileSync(path.join(REPO_ROOT, binding.workflow), "utf8");
    // Deviations are read from the registry, never hardcoded here: an exception
    // is a reviewed declaration with a reason, and it must name the same
    // workflow the binding resolves to or it is describing something else.
    const exception = PLANE_PUBLISHER_EXCEPTIONS[family] ?? null;
    if (exception) {
      assert.equal(exception.workflow, binding.workflow,
        `${family} publisher exception must name its bound workflow`);
      assert.ok(typeof exception.reason === "string" && exception.reason.length > 0,
        `${family} publisher exception must carry a reason`);
    }
    // Gate tolerance is per-family and declared. A tolerated publisher records
    // a blocked gate and exits 0; a strict one must go red, because a run that
    // was explicitly requested and published nothing is not a success.
    const strictGate = Boolean(exception?.strict_gate);
    if (strictGate) {
      assert.ok(typeof exception.strict_gate_reason === "string" && exception.strict_gate_reason.length > 0,
        `${family} must carry a strict_gate_reason`);
      // Scoped to executed commands, not prose: the workflow is expected to
      // explain in a comment which flag it refuses and why, and banning the
      // word outright would punish exactly that documentation.
      const toleratingRunLines = workflowText.split("\n")
        .filter((line) => /^\s*(run:|- run:)/.test(line) && line.includes("--tolerate-gate-block"));
      assert.deepEqual(toleratingRunLines, [],
        `${family} declares strict_gate, so no run command may tolerate a blocked gate`);
      // Going red must not cost the evidence. A blocked gate still writes the
      // outcome shard, so the upload and the persistence job both have to run
      // on a failed publish, not only on a successful one.
      assert.match(workflowText, /Upload [^\n]*outcome shard\n\s*if: \$\{\{ always\(\) \}\}/,
        `${family} must upload its outcome shard under always()`);
      assert.match(workflowText, /needs\.[a-z0-9_-]+\.result != 'cancelled'/,
        `${family} persistence must run on a failed publish, skipping only a cancelled one`);
    }
    const publishCommand = `node scripts/publish-cloud-data-generation.mjs --family=${family}`
      + `${strictGate ? "" : " --tolerate-gate-block"} --json`;
    assert.equal(workflowText.split(publishCommand).length - 1, 1, `${family} must have exactly one publisher`);
    const publishIndex = workflowText.indexOf(publishCommand);
    const publishStepStart = workflowText.lastIndexOf("\n      - name:", publishIndex);
    const publishStepEnd = workflowText.indexOf("\n      - name:", publishIndex);
    const isCoordinator = binding.workflow === COORDINATOR_WORKFLOW;
    const detachedPersistence = isCoordinator || Boolean(exception?.detached_persistence);
    const persistenceCommandIndex = workflowText.search(persistCommandPattern(family, binding.workflow));
    const persistenceStepStart = detachedPersistence
      ? workflowText.lastIndexOf("\n      - name:", persistenceCommandIndex)
      : workflowText.indexOf("\n      - name:", publishIndex);
    assert.ok(
      publishStepStart >= 0 && publishStepEnd > publishIndex && persistenceStepStart >= publishStepEnd,
      `${family} step boundaries are missing`,
    );
    const publishStep = workflowText.slice(publishStepStart, publishStepEnd);
    const nextStepEnd = workflowText.indexOf("\n      - name:", persistenceStepStart + 1);
    const persistenceStep = workflowText.slice(
      persistenceStepStart,
      nextStepEnd === -1 ? workflowText.length : nextStepEnd,
    );
    assert.match(publishStep, /\n        id: publish_cloud_generation\n/);
    if (exception?.non_blocking_publisher) {
      assert.match(publishStep, /continue-on-error:/,
        `${family} declares a non-blocking publisher, so the exception must describe the shipped workflow`);
    } else {
      assert.doesNotMatch(publishStep, /continue-on-error:/, `${family} publisher failure must remain a job failure`);
    }
    // The outcome may be carried within the job or across jobs; both are exact
    // expressions, and persistence stays mandatory either way.
    assert.match(persistenceStep, new RegExp(
      `persist-cloud-publish-outcome\\.mjs\\s+--family=${escapeRegExp(family)}`
      + `\\s+--workflow=${escapeRegExp(binding.workflow)}`
      + `\\s+--publisher-outcome=\\$\\{\\{ (?:steps\\.publish_cloud_generation\\.outcome|needs\\.[a-z0-9_-]+\\.outputs\\.publisher_outcome) \\}\\}`,
    ));
    // Persistence is unconditional by default. A declared conditional guard may
    // narrow it, but only by ANDing onto always() — the step can never stop
    // being an always() step, so a failed publish still persists its outcome.
    if (exception?.conditional_persistence) {
      assert.match(persistenceStep, /if: \$\{\{ always\(\) && /,
        `${family} declares conditional persistence, which must still begin at always()`);
    } else if (exception?.detached_persistence && !/\n        if: /.test(persistenceStep)) {
      assert.match(jobBlockAt(workflowText, persistenceCommandIndex), /\n    if: >-\n\s+always\(\) &&/,
        `${family} detached persistence job must begin with always()`);
    } else {
      assert.match(persistenceStep, /if: \$\{\{ always\(\) \}\}/);
    }
    assert.doesNotMatch(persistenceStep, /continue-on-error:/, `${family} evidence failure must fail the workflow`);

    if (isCoordinator) {
      // Coordinator contract: there is no Commit step anywhere; the publisher
      // follows the exporter, and the cleanup + persistence steps follow the
      // publisher (no signals Git commit exists to publish "after").
      assert.equal((workflowText.match(/- name: Commit/g) ?? []).length, 0,
        "coordinator must have no Commit step");
      const exportStepStart = workflowText.indexOf("- name: Export computed signals");
      assert.ok(exportStepStart >= 0 && exportStepStart < publishStepStart,
        "coordinator publisher must follow the exporter step");
    } else {
      // Canonical-commit contract. The default is unchanged and strict: the step
      // immediately before publication is the job's own Commit. The two other
      // modes are declared per family in the registry with their own reason, so
      // a deviation is a reviewed statement and never an inferred allowance.
      const canonicalCommit = exception?.canonical_commit ?? "immediately_preceding";
      assert.ok(PLANE_CANONICAL_COMMIT_MODES.includes(canonicalCommit),
        `${family} declares an unknown canonical-commit mode: ${canonicalCommit}`);
      if (canonicalCommit !== "immediately_preceding") {
        assert.ok(
          typeof exception?.canonical_commit_reason === "string" && exception.canonical_commit_reason.length > 0,
          `${family} must carry a canonical_commit_reason for mode ${canonicalCommit}`,
        );
      }
      const previousStepStart = workflowText.lastIndexOf("\n      - name:", publishStepStart - 1);
      const previousStep = workflowText.slice(previousStepStart, publishStepStart);
      // The publish job's own text, so "no Commit in this job" cannot be
      // satisfied or broken by a sibling job's steps.
      const jobStart = workflowText.lastIndexOf("\n  ", workflowText.lastIndexOf("\n    steps:", publishStepStart));
      const nextJobMatch = /\n {2}[a-z][a-z0-9_-]*:\n/.exec(workflowText.slice(publishStepStart));
      const publishJobText = workflowText.slice(
        jobStart === -1 ? 0 : jobStart,
        nextJobMatch ? publishStepStart + nextJobMatch.index : workflowText.length,
      );
      if (canonicalCommit === "immediately_preceding") {
        assert.match(previousStep, /- name: Commit/, `${family} must publish only after its canonical commit/push step`);
      } else if (canonicalCommit === "earlier_same_job") {
        // Still a canonical committer: prove the Commit step exists before the
        // publisher in this job, just not adjacent to it.
        const commitIndex = publishJobText.indexOf("- name: Commit");
        assert.ok(commitIndex >= 0 && commitIndex < publishJobText.indexOf("- name: Publish"),
          `${family} declares earlier_same_job, so its publish job must still contain a Commit step before publication`);
      } else {
        // external_authority: another workflow owns the canonical tree, so this
        // publish job must perform no canonical Git write of its own.
        assert.equal((publishJobText.match(/- name: Commit/g) ?? []).length, 0,
          `${family} declares external_authority, so its publish job must contain no Commit step`);
      }
    }

    const shardPath = `${OUTCOME_ROOT}/${family}.json`;
    const stageSpecs = manifest.workflows[binding.workflow].stages.always_if_exists;
    assert.equal(
      stageSpecs.filter((spec) => spec.path === shardPath && spec.kind === "file" && spec.required === false).length,
      1,
      `${family} must own exactly one optional file shard in always_if_exists`,
    );
    if (workflowText.includes("sparse-checkout:")) {
      assert.match(workflowText, /data\/admin\/data-supply-state\/publish-outcomes/);
    }
  }

  // Caller-only Global Scouter shadow contract: workflow_dispatch confirmation,
  // latest-main/Node 22 setup, a family-local non-writer publish concurrency
  // group, and a persistence-only global writer lock with artifact handoff.
  {
    const workflowRel = ".github/workflows/global-scouter-shadow-publish.yml";
    const workflowText = fs.readFileSync(path.join(REPO_ROOT, workflowRel), "utf8");
    const publishJob = jobBlockAt(workflowText, workflowText.indexOf("  publish:"));
    const persistJob = jobBlockAt(workflowText, workflowText.indexOf("  persist:"));
    const trigger = workflowText.slice(workflowText.indexOf("on:"), workflowText.indexOf("permissions:"));
    assert.match(trigger, /workflow_dispatch:/);
    assert.doesNotMatch(trigger, /schedule:|workflow_run:|push:|pull_request:/);
    assert.match(workflowText, /confirm must be exactly PUBLISH-SHADOW/);
    assert.match(workflowText, /if \[ \"\$CONFIRM\" != \"PUBLISH-SHADOW\" \]; then/);
    assert.match(publishJob, /group: global-scouter-shadow-publish/);
    assert.doesNotMatch(publishJob, /group: fenok-data-writer-refs\/heads\/main/);
    assert.match(persistJob, /group: fenok-data-writer-refs\/heads\/main/);
    assert.match(workflowText, /node-version: '22'/g);
    assert.match(workflowText, /Start from latest main/);
    assert.match(workflowText, /node scripts\/publish-cloud-data-generation\.mjs --family=global-scouter --json/);
    assert.doesNotMatch(workflowText.split("\n").filter((line) => /^\s*(run:|- run:)/.test(line)).join("\n"), /--tolerate-gate-block/);
    assert.match(workflowText, /Upload global-scouter outcome shard\n\s*if: \$\{\{ always\(\) \}\}/);
    assert.match(workflowText, /global-scouter-outcome-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/g);
    assert.match(workflowText, /Download global-scouter outcome shard/);
    assert.match(workflowText, /if: \$\{\{ always\(\) && needs\.publish\.result != 'cancelled' \}\}/);
    assert.match(workflowText, /Persist global-scouter publish outcome\n\s*if: \$\{\{ always\(\) \}\}/);
  }

  const slickchartsHistory = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/slickcharts-history.yml"), "utf8");
  const finalizeStart = slickchartsHistory.indexOf("- name: Finalize SlickCharts composite recovery");
  const returnsTarget = slickchartsHistory.indexOf("artifacts/attempt-returns-*");
  const cleanupStart = slickchartsHistory.lastIndexOf("\n      - name:", returnsTarget);
  const cleanupEnd = slickchartsHistory.indexOf("\n      - name:", cleanupStart + 1);
  const persistStart = slickchartsHistory.indexOf("- name: Persist slickcharts-history publish outcome");
  assert.ok(finalizeStart >= 0 && finalizeStart < cleanupStart && cleanupStart < persistStart,
    "slickcharts-history cleanup must run after finalize and before outcome persistence");
  const cleanupStep = slickchartsHistory.slice(cleanupStart, cleanupEnd);
  assert.match(cleanupStep, /artifacts\/attempt-returns-\*/);
  assert.match(cleanupStep, /artifacts\/attempt-dividends-\*/);
  assert.deepEqual(
    [...cleanupStep.matchAll(/^\s*rm\s+(.+)$/gmu)].map((match) => match[1]).sort(),
    ["-rf artifacts/attempt-dividends-*", "-rf artifacts/attempt-returns-*"],
    "slickcharts-history cleanup must not remove broader runner paths",
  );
  console.log(`publish-outcome workflow contract: ${Object.keys(PLANE_PUBLISH_OUTCOME_BINDINGS).length}/${Object.keys(PLANE_PUBLISH_OUTCOME_BINDINGS).length} ordered, always-persisted, exact-owned`);
}

// Real local-git integration: one helper invocation lands the shard on main;
// a concurrent stale clone rebases, merges only the same family shard, and
// preserves both outcomes without touching another family's file.
{
  const temp = await mkdtemp(path.join(os.tmpdir(), "persist-publish-outcome-"));
  try {
    const origin = path.join(temp, "origin.git");
    const seed = path.join(temp, "seed");
    const workerA = path.join(temp, "worker-a");
    const workerB = path.join(temp, "worker-b");
    const workerFailure = path.join(temp, "worker-failure");
    const workerPushFail = path.join(temp, "worker-push-fail");
    const workerCoordinator = path.join(temp, "worker-coordinator");
    const verify = path.join(temp, "verify");
    run("git", ["init", "--bare", origin], temp);
    run("git", ["init", seed], temp);
    run("git", ["config", "user.name", "test"], seed);
    run("git", ["config", "user.email", "test@example.invalid"], seed);
    const seedOutcomeRoot = path.join(seed, OUTCOME_ROOT);
    await mkdir(seedOutcomeRoot, { recursive: true });
    const initial = buildPublishOutcomeRecord({
      family: "oecd-cli",
      result: "published",
      generationId: "generation-initial",
      observedAt: "2026-08-10T00:00:00.000Z",
    });
    const sentiment = buildPublishOutcomeRecord({
      family: "sentiment",
      result: "published",
      generationId: "sentiment-initial",
      observedAt: "2026-08-10T00:00:00.000Z",
    });
    await writeFile(path.join(seedOutcomeRoot, "oecd-cli.json"), `${JSON.stringify({
      schema_version: PUBLISH_OUTCOME_SHARD_SCHEMA,
      family: "oecd-cli",
      records: [initial],
    }, null, 2)}\n`);
    await writeFile(path.join(seedOutcomeRoot, "sentiment.json"), `${JSON.stringify({
      schema_version: PUBLISH_OUTCOME_SHARD_SCHEMA,
      family: "sentiment",
      records: [sentiment],
    }, null, 2)}\n`);
    for (const signalPath of TRACKED_SIGNAL_PATHS) {
      await mkdir(path.dirname(path.join(seed, signalPath)), { recursive: true });
      await writeFile(path.join(seed, signalPath), SEED_SIGNAL_TEXT);
    }
    run("git", ["add", "--", OUTCOME_ROOT, ...TRACKED_SIGNAL_PATHS], seed);
    run("git", ["commit", "-m", "seed outcomes"], seed);
    run("git", ["branch", "-M", "main"], seed);
    run("git", ["remote", "add", "origin", origin], seed);
    run("git", ["push", "-u", "origin", "main"], seed);
    run("git", ["symbolic-ref", "HEAD", "refs/heads/main"], origin);
    run("git", ["clone", origin, workerA], temp);
    run("git", ["clone", origin, workerB], temp);

    const generationA = buildPublishOutcomeRecord({
      family: "oecd-cli",
      result: "failed",
      generationId: "generation-a",
      observedAt: "2026-08-10T01:00:00.000Z",
    });
    await writeFile(path.join(workerA, OUTCOME_ROOT, "oecd-cli.json"), `${JSON.stringify({
      schema_version: PUBLISH_OUTCOME_SHARD_SCHEMA,
      family: "oecd-cli",
      records: [generationA],
    }, null, 2)}\n`);
    await appendPublishOutcome({
      outcomesRoot: path.join(workerB, OUTCOME_ROOT),
      family: "oecd-cli",
      record: buildPublishOutcomeRecord({
        family: "oecd-cli",
        result: "gate_blocked",
        generationId: "generation-b",
        observedAt: "2026-08-10T02:00:00.000Z",
      }),
    });

    const first = persistPublishOutcome({
      family: "oecd-cli",
      workflow: ".github/workflows/fetch-oecd-cli.yml",
      publisherOutcome: "success",
      repoRoot: workerA,
      manifestPath: MANIFEST_PATH,
      log: () => {},
    });
    assert.equal(first.persisted, true);
    assert.deepEqual(
      run("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], workerA).split("\n"),
      [`${OUTCOME_ROOT}/oecd-cli.json`],
      "same-run persistence commit must contain only the owned family shard",
    );

    const second = persistPublishOutcome({
      family: "oecd-cli",
      workflow: ".github/workflows/fetch-oecd-cli.yml",
      publisherOutcome: "success",
      repoRoot: workerB,
      manifestPath: MANIFEST_PATH,
      log: () => {},
    });
    assert.equal(second.persisted, true);
    run("git", ["clone", origin, verify], temp);
    const finalShard = JSON.parse(await readFile(path.join(verify, OUTCOME_ROOT, "oecd-cli.json"), "utf8"));
    validatePublishOutcomeShard(finalShard, "oecd-cli");
    assert.deepEqual(finalShard.records.map((record) => record.generation_id), [
      "generation-initial",
      "generation-a",
      "generation-b",
    ]);
    const finalSentiment = await readFile(path.join(verify, OUTCOME_ROOT, "sentiment.json"), "utf8");
    assert.equal(finalSentiment, await readFile(path.join(seed, OUTCOME_ROOT, "sentiment.json"), "utf8"));

    const skippedAbsent = persistPublishOutcome({
      family: "fred-macro",
      workflow: ".github/workflows/fetch-fred-macro.yml",
      publisherOutcome: "skipped",
      repoRoot: verify,
      manifestPath: MANIFEST_PATH,
      log: () => {},
    });
    assert.equal(skippedAbsent.reason, "skipped_absent");
    for (const publisherOutcome of ["success", "failure"]) {
      assert.throws(
        () => persistPublishOutcome({
          family: "fred-macro",
          workflow: ".github/workflows/fetch-fred-macro.yml",
          publisherOutcome,
          repoRoot: verify,
          manifestPath: MANIFEST_PATH,
          log: () => {},
        }),
        /outcome shard is absent/,
      );
    }
    const skippedUnchanged = persistPublishOutcome({
      family: "oecd-cli",
      workflow: ".github/workflows/fetch-oecd-cli.yml",
      publisherOutcome: "skipped",
      repoRoot: verify,
      manifestPath: MANIFEST_PATH,
      log: () => {},
    });
    assert.equal(skippedUnchanged.reason, "skipped_unchanged");
    for (const publisherOutcome of ["success", "failure"]) {
      assert.throws(
        () => persistPublishOutcome({
          family: "oecd-cli",
          workflow: ".github/workflows/fetch-oecd-cli.yml",
          publisherOutcome,
          repoRoot: verify,
          manifestPath: MANIFEST_PATH,
          log: () => {},
        }),
        /outcome shard is unchanged/,
      );
    }
    assert.throws(
      () => persistPublishOutcome({
        family: "oecd-cli",
        workflow: ".github/workflows/fetch-oecd-cli.yml",
        repoRoot: verify,
        manifestPath: MANIFEST_PATH,
        log: () => {},
      }),
      /publisherOutcome must be/,
    );
    assert.throws(
      () => persistPublishOutcome({
        family: "oecd-cli",
        workflow: ".github/workflows/fetch-oecd-cli.yml",
        publisherOutcome: "cancelled",
        repoRoot: verify,
        manifestPath: MANIFEST_PATH,
        log: () => {},
      }),
      /publisherOutcome must be/,
    );
    assert.throws(
      () => persistPublishOutcome({
        family: "oecd-cli",
        workflow: ".github/workflows/fetch-sentiment.yml",
        publisherOutcome: "success",
        repoRoot: verify,
        manifestPath: MANIFEST_PATH,
        log: () => {},
      }),
      /belongs to/,
    );

    run("git", ["clone", origin, workerFailure], temp);
    await appendPublishOutcome({
      outcomesRoot: path.join(workerFailure, OUTCOME_ROOT),
      family: "oecd-cli",
      record: buildPublishOutcomeRecord({
        family: "oecd-cli",
        result: "failed",
        generationId: "generation-publisher-failed",
        observedAt: "2026-08-10T03:00:00.000Z",
      }),
    });
    const persistedAfterPublisherFailure = persistPublishOutcome({
      family: "oecd-cli",
      workflow: ".github/workflows/fetch-oecd-cli.yml",
      publisherOutcome: "failure",
      repoRoot: workerFailure,
      manifestPath: MANIFEST_PATH,
      log: () => {},
    });
    assert.equal(persistedAfterPublisherFailure.persisted, true, "failed publisher evidence must still persist successfully");

    run("git", ["clone", origin, workerPushFail], temp);
    await appendPublishOutcome({
      outcomesRoot: path.join(workerPushFail, OUTCOME_ROOT),
      family: "oecd-cli",
      record: buildPublishOutcomeRecord({
        family: "oecd-cli",
        result: "published",
        generationId: "generation-push-rejected",
        observedAt: "2026-08-10T04:00:00.000Z",
      }),
    });
    const rejectHook = path.join(origin, "hooks", "pre-receive");
    await writeFile(rejectHook, "#!/usr/bin/env bash\nexit 1\n");
    await chmod(rejectHook, 0o755);
    assert.throws(
      () => persistPublishOutcome({
        family: "oecd-cli",
        workflow: ".github/workflows/fetch-oecd-cli.yml",
        publisherOutcome: "success",
        repoRoot: workerPushFail,
        manifestPath: MANIFEST_PATH,
        maxAttempts: 1,
        log: () => {},
      }),
      /push failed after 1 attempts/,
    );
    // The push-exhaustion case installs a rejecting pre-receive hook; remove
    // it before the coordinator case so later pushes reach the origin.
    await rm(rejectHook, { force: true });

    // Coordinator authorization: only the owned outcome shard may commit.
    // Exercise the real tracked-file states the exporter/cleanup can produce:
    // one modified canonical file and one deleted public mirror. Persistence
    // must refuse both until `git restore --source=HEAD --worktree` restores
    // the exact checked-out bytes.
    run("git", ["clone", origin, workerCoordinator], temp);
    await appendPublishOutcome({
      outcomesRoot: path.join(workerCoordinator, OUTCOME_ROOT),
      family: "computed-signals",
      record: buildPublishOutcomeRecord({
        family: "computed-signals",
        result: "published",
        generationId: "generation-coordinator",
        observedAt: "2026-08-11T00:00:00.000Z",
      }),
    });
    const canonicalSignalsPath = path.join(workerCoordinator, TRACKED_SIGNAL_PATHS[0]);
    const publicSignalsPath = path.join(workerCoordinator, TRACKED_SIGNAL_PATHS[1]);
    await writeFile(canonicalSignalsPath, "{\"generated_at\":\"2026-08-11T00:00:00.000Z\"}\n");
    await rm(publicSignalsPath);
    const dirtySignalStatus = run("git", ["diff", "--name-status", "--", ...TRACKED_SIGNAL_PATHS], workerCoordinator);
    assert.match(dirtySignalStatus, /^M\s+data\/computed\/signals\.json$/m,
      "coordinator fixture must contain a real tracked modification");
    assert.match(dirtySignalStatus, /^D\s+100xfenok-next\/public\/data\/computed\/signals\.json$/m,
      "coordinator fixture must contain a real tracked deletion");
    assert.throws(
      () => persistPublishOutcome({
        family: "computed-signals",
        workflow: COORDINATOR_WORKFLOW,
        publisherOutcome: "success",
        repoRoot: workerCoordinator,
        manifestPath: MANIFEST_PATH,
        log: () => {},
      }),
      /refusing dirty paths outside owned shard/,
      "generated signal files must be cleaned before outcome persistence",
    );
    run("git", ["restore", "--source=HEAD", "--worktree", "--", ...TRACKED_SIGNAL_PATHS], workerCoordinator);
    for (const signalPath of TRACKED_SIGNAL_PATHS) {
      assert.equal(await readFile(path.join(workerCoordinator, signalPath), "utf8"), SEED_SIGNAL_TEXT,
        `${signalPath} must be restored to its tracked HEAD bytes`);
    }
    assert.equal(run("git", ["status", "--short", "--", ...TRACKED_SIGNAL_PATHS], workerCoordinator), "",
      "tracked signal files must be clean before outcome persistence");
    const coordinatorPersisted = persistPublishOutcome({
      family: "computed-signals",
      workflow: COORDINATOR_WORKFLOW,
      publisherOutcome: "success",
      repoRoot: workerCoordinator,
      manifestPath: MANIFEST_PATH,
      log: () => {},
    });
    assert.equal(coordinatorPersisted.persisted, true, "coordinator outcome must persist once the tree is clean");
    assert.deepEqual(
      run("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], workerCoordinator).split("\n"),
      [`${OUTCOME_ROOT}/computed-signals.json`],
      "coordinator persistence commit must contain only the owned outcome shard",
    );
    console.log("publish-outcome persistence helper: run/skip contract, concurrent merge, failure evidence, push exhaustion ok");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

console.log("test-persist-cloud-publish-outcome: ok");
