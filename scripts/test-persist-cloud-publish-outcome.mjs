#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { persistPublishOutcome } from "./persist-cloud-publish-outcome.mjs";
import { PLANE_PUBLISH_OUTCOME_BINDINGS } from "./lib/lane-registry.mjs";
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

// Canonical workflow contract: every bound publisher follows the canonical
// data commit, owns exactly one family, fails the job on publish failure, and
// is immediately followed by a non-blocking always() persistence step.
{
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  assert.equal(Object.keys(PLANE_PUBLISH_OUTCOME_BINDINGS).length, 22);
  for (const [family, binding] of Object.entries(PLANE_PUBLISH_OUTCOME_BINDINGS)) {
    const workflowText = fs.readFileSync(path.join(REPO_ROOT, binding.workflow), "utf8");
    const publishCommand = `node scripts/publish-cloud-data-generation.mjs --family=${family} --tolerate-gate-block --json`;
    assert.equal(workflowText.split(publishCommand).length - 1, 1, `${family} must have exactly one publisher`);
    const publishIndex = workflowText.indexOf(publishCommand);
    const publishStepStart = workflowText.lastIndexOf("\n      - name:", publishIndex);
    const publishStepEnd = workflowText.indexOf("\n      - name:", publishIndex);
    const isCoordinator = binding.workflow === COORDINATOR_WORKFLOW;
    const persistenceStepStart = isCoordinator || family === "slickcharts-history"
      ? workflowText.lastIndexOf(
        "\n      - name:",
        workflowText.indexOf(`persist-cloud-publish-outcome.mjs --family=${family} --workflow=${binding.workflow}`),
      )
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
    assert.doesNotMatch(publishStep, /continue-on-error:/, `${family} publisher failure must remain a job failure`);
    assert.match(persistenceStep, new RegExp(
      `persist-cloud-publish-outcome\\.mjs --family=${family} --workflow=${binding.workflow.replaceAll(".", "\\.")} --publisher-outcome=\\$\\{\\{ steps\\.publish_cloud_generation\\.outcome \\}\\}`,
    ));
    assert.match(persistenceStep, /if: \$\{\{ always\(\) \}\}/);
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
      const previousStepStart = workflowText.lastIndexOf("\n      - name:", publishStepStart - 1);
      const previousStep = workflowText.slice(previousStepStart, publishStepStart);
      assert.match(previousStep, /- name: Commit/, `${family} must publish only after its canonical commit/push step`);
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
  console.log("publish-outcome workflow contract: 22/22 ordered, always-persisted, exact-owned");
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

    await appendPublishOutcome({
      outcomesRoot: path.join(workerA, OUTCOME_ROOT),
      family: "oecd-cli",
      record: buildPublishOutcomeRecord({
        family: "oecd-cli",
        result: "failed",
        generationId: "generation-a",
        observedAt: "2026-08-10T01:00:00.000Z",
      }),
    });
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
