import assert from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildWindDownMaterialArtifactV2,
  type WindDownMaterialSourceRow,
} from "../src/features/winddown/content/materialIdentity";
import {
  WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION,
  WINDDOWN_LUNA_REQUESTED_MODEL,
  buildWindDownLunaReceiptContent,
  canonicalWindDownJson,
  sha256Hex,
  validateWindDownLunaReceiptBundle,
  type WindDownLunaCandidateItem,
  type WindDownLunaShardPlan,
  type WindDownLunaShardReceipt,
} from "./winddown-luna-contract";
import {
  prepareWindDownLunaRun,
  windDownLunaPromptPath,
} from "./prepare-winddown-luna-run";
import {
  finalizeWindDownLunaRun,
  type WindDownSignedReceiptFilesystem,
} from "./finalize-winddown-luna-run";

const HMAC_KEY = Buffer.from("0123456789abcdef0123456789abcdef");
const HMAC_KEY_ID = "winddown-orchestration-score-v1";
const SOURCE = {
  namespace: "winddown-orchestration-score",
  source: "deterministic-fixture",
  sourcePath: "scripts/score-winddown-luna-orchestration.ts",
  sourceRevision: "fixture-v1",
};

function sourceRow(
  index: number,
  override: Partial<WindDownMaterialSourceRow> = {},
): WindDownMaterialSourceRow {
  return {
    legacyV1Id: `legacy-${String(index).padStart(3, "0")}`,
    ko: `오늘 문장 ${index}을 연습합니다`,
    en: `Practice sentence number ${index} today`,
    acceptedVariants: [`Practice number ${index} today`],
    difficulty: index % 2 === 0 ? 2 : 1,
    grounded: true,
    verifiedInSource: true,
    provenance: {
      namespace: SOURCE.namespace,
      source: SOURCE.source,
      sourcePath: SOURCE.sourcePath,
      sourceRecordId: `row-${index}`,
      sourceRevision: SOURCE.sourceRevision,
    },
    ...override,
  };
}

function buildBootstrapCandidate() {
  const artifact = buildWindDownMaterialArtifactV2({
    source: SOURCE,
    mode: "legacy-v1-bootstrap",
    generatedAt: "2026-07-31T00:00:00.000Z",
    rows: [
      sourceRow(1),
      sourceRow(2),
      sourceRow(3),
      sourceRow(4, { verifiedInSource: false }),
    ],
  });
  return {
    schemaVersion: 1,
    artifact,
    receipt: {
      schemaVersion: 1,
      kind: "winddown-material-v2-bootstrap-receipt",
      legacyV1: { status: "complete" },
      artifact: { digest: artifact.digest },
    },
  };
}

function candidateFor(
  item: WindDownLunaShardPlan["shards"][number]["items"][number],
  artifact: ReturnType<typeof buildWindDownMaterialArtifactV2>,
  verdict: WindDownLunaCandidateItem["verdict"] = "approve",
): WindDownLunaCandidateItem {
  const material = artifact.materials.find((entry) => entry.id === item.materialId);
  assert(material);
  return {
    materialId: item.materialId,
    inputMaterialDigest: item.inputMaterialDigest,
    verdict,
    evidence: ["Grounded in immutable source text."],
    enrichment: {
      chunks: [material.en.split(" ").slice(0, 2).join(" ")],
      distractors: [`Wrong alternative for ${material.legacyAliases[0]}`],
      difficultyNote: null,
      scenarioTags: ["daily-life"],
      naturalnessFlags: ["natural"],
    },
  };
}

function fakeUnsignedBundle(
  plan: WindDownLunaShardPlan,
  artifact: ReturnType<typeof buildWindDownMaterialArtifactV2>,
  verdicts: Partial<
    Record<string, WindDownLunaCandidateItem["verdict"]>
  > = {},
) {
  const shards: WindDownLunaShardReceipt[] = plan.shards.map((shard) => {
    const items = shard.items.map((item) =>
      candidateFor(item, artifact, verdicts[item.materialId] ?? "approve"),
    );
    return {
      schemaVersion: WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION,
      kind: "winddown-luna-shard-receipt",
      shardIndex: shard.shardIndex,
      shardId: shard.shardId,
      requestedModel: WINDDOWN_LUNA_REQUESTED_MODEL,
      responseModel: "gpt-5.6-luna-2026-07-31",
      responseDigest: sha256Hex(
        canonicalWindDownJson({
          schemaVersion: WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION,
          kind: "winddown-luna-shard-response",
          shardId: shard.shardId,
          items,
        }),
      ),
      items,
    };
  });
  return buildWindDownLunaReceiptContent(plan, shards);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main(): void {
  const scratch = mkdtempSync(join(tmpdir(), "winddown-luna-orchestration-"));
  try {
    const candidate = buildBootstrapCandidate();
    const candidatePath = join(scratch, "bootstrap-candidate.json");
    const runDirectory = join(scratch, "prepared");
    writeJson(candidatePath, candidate);

    const prepared = prepareWindDownLunaRun({
      bootstrapCandidatePath: candidatePath,
      outputDirectory: runDirectory,
      shardSize: 2,
    });
    assert.equal(prepared.artifact.materials.length, 3);
    assert.equal(prepared.artifact.quarantine.length, 1);
    assert.equal(prepared.plan.materialCount, 3);
    assert.equal(prepared.plan.shardCount, 2);
    for (const name of ["artifact.json", "manifest.json", "shard-plan.json"]) {
      assert(existsSync(join(runDirectory, name)));
    }
    assert.throws(
      () =>
        prepareWindDownLunaRun({
          bootstrapCandidatePath: candidatePath,
          outputDirectory: runDirectory,
          shardSize: 2,
        }),
      /prepare_output_directory_exists/,
    );

    const unsigned = fakeUnsignedBundle(prepared.plan, prepared.artifact);
    const unsignedPath = join(scratch, "unsigned.json");
    writeJson(unsignedPath, unsigned);
    const signedReceiptPath = join(scratch, "signed-receipt.json");
    const lkgRootPath = join(scratch, "lkg");
    const environment = {
      WINDDOWN_LUNA_RECEIPT_HMAC_KEY_B64: HMAC_KEY.toString("base64"),
      WINDDOWN_LUNA_RECEIPT_HMAC_KEY_ID: HMAC_KEY_ID,
    };
    const finalized = finalizeWindDownLunaRun({
      runDirectory,
      unsignedBundlePath: unsignedPath,
      signedReceiptPath,
      lkgRootPath,
      environment,
    });
    assert.equal(finalized.promotion.status, "published");
    assert.equal(finalized.promotion.lkg.materials.length, 3);
    assert.equal(finalized.promotion.lkg.quarantine.length, 1);
    assert.equal(finalized.promotion.lkg.advisorOverlay.length, 3);
    assert.deepEqual(
      finalized.promotion.lkg.advisorOverlay.map((entry) => entry.materialId),
      prepared.artifact.materials.map((entry) => entry.id),
    );
    const signedText = readFileSync(signedReceiptPath, "utf8");
    assert(!signedText.includes(HMAC_KEY.toString("base64")));
    assert(!signedText.includes(HMAC_KEY.toString("utf8")));
    const signed = JSON.parse(signedText) as unknown;
    const validation = validateWindDownLunaReceiptBundle({
      artifact: prepared.artifact,
      artifactBytes: readFileSync(join(runDirectory, "artifact.json")),
      manifest: prepared.manifest,
      promptTemplate: readFileSync(windDownLunaPromptPath()),
      bundle: signed,
      keyId: HMAC_KEY_ID,
      key: HMAC_KEY,
      shardSize: 2,
    });
    assert.equal(validation.ok, true);
    assert.equal(validation.allItemsApproved, true);

    const [approvedMaterial, reviewMaterial, rejectedMaterial] =
      prepared.artifact.materials;
    const mixedUnsigned = fakeUnsignedBundle(prepared.plan, prepared.artifact, {
      [reviewMaterial.id]: "needs_human_review",
      [rejectedMaterial.id]: "reject",
    });
    const mixedUnsignedPath = join(scratch, "mixed-unsigned.json");
    const mixedSignedReceiptPath = join(scratch, "mixed-signed-receipt.json");
    const mixedLkgRoot = join(scratch, "mixed-lkg");
    writeJson(mixedUnsignedPath, mixedUnsigned);
    const mixedFinalized = finalizeWindDownLunaRun({
      runDirectory,
      unsignedBundlePath: mixedUnsignedPath,
      signedReceiptPath: mixedSignedReceiptPath,
      lkgRootPath: mixedLkgRoot,
      environment,
    });
    assert.equal(mixedFinalized.promotion.status, "published");
    assert.deepEqual(
      mixedFinalized.promotion.lkg.materials.map((entry) => entry.id),
      [approvedMaterial.id],
    );
    assert.deepEqual(
      mixedFinalized.promotion.lkg.advisorOverlay.map(
        (entry) => entry.materialId,
      ),
      [approvedMaterial.id],
    );
    assert.deepEqual(
      mixedFinalized.promotion.lkg.lunaQuarantine.map((entry) => ({
        materialId: entry.materialId,
        verdict: entry.verdict,
      })),
      [
        {
          materialId: reviewMaterial.id,
          verdict: "needs_human_review",
        },
        {
          materialId: rejectedMaterial.id,
          verdict: "reject",
        },
      ],
    );
    assert(existsSync(mixedSignedReceiptPath));
    assert(existsSync(join(mixedLkgRoot, "current.json")));
    const mixedValidation = validateWindDownLunaReceiptBundle({
      artifact: prepared.artifact,
      artifactBytes: readFileSync(join(runDirectory, "artifact.json")),
      manifest: prepared.manifest,
      promptTemplate: readFileSync(windDownLunaPromptPath()),
      bundle: JSON.parse(readFileSync(mixedSignedReceiptPath, "utf8")),
      keyId: HMAC_KEY_ID,
      key: HMAC_KEY,
      shardSize: 2,
    });
    assert.equal(mixedValidation.ok, true);
    assert.equal(mixedValidation.allItemsApproved, false);

    const allNonApproveUnsigned = fakeUnsignedBundle(
      prepared.plan,
      prepared.artifact,
      Object.fromEntries(
        prepared.artifact.materials.map((entry) => [entry.id, "reject"]),
      ),
    );
    const allNonApproveUnsignedPath = join(
      scratch,
      "all-nonapprove-unsigned.json",
    );
    const allNonApproveSignedPath = join(
      scratch,
      "all-nonapprove-signed-receipt.json",
    );
    const allNonApproveLkgRoot = join(scratch, "all-nonapprove-lkg");
    writeJson(allNonApproveUnsignedPath, allNonApproveUnsigned);
    const runAllNonApprove = () =>
      finalizeWindDownLunaRun({
        runDirectory,
        unsignedBundlePath: allNonApproveUnsignedPath,
        signedReceiptPath: allNonApproveSignedPath,
        lkgRootPath: allNonApproveLkgRoot,
        environment,
      });
    assert.throws(runAllNonApprove, /lkg_no_approved_material/);
    assert(existsSync(allNonApproveSignedPath));
    assert(!existsSync(join(allNonApproveLkgRoot, "current.json")));
    const preservedAllNonApproveReceipt = readFileSync(
      allNonApproveSignedPath,
      "utf8",
    );
    assert.throws(runAllNonApprove, /lkg_no_approved_material/);
    assert.equal(
      readFileSync(allNonApproveSignedPath, "utf8"),
      preservedAllNonApproveReceipt,
    );
    assert(!existsSync(join(allNonApproveLkgRoot, "current.json")));

    const preservedSignedText = readFileSync(signedReceiptPath, "utf8");
    const idempotentRetry = finalizeWindDownLunaRun({
      runDirectory,
      unsignedBundlePath: unsignedPath,
      signedReceiptPath,
      lkgRootPath,
      environment,
    });
    assert.equal(idempotentRetry.promotion.status, "noop");
    assert.equal(readFileSync(signedReceiptPath, "utf8"), preservedSignedText);

    const differentKeyEnvironment = {
      WINDDOWN_LUNA_RECEIPT_HMAC_KEY_B64: Buffer.from(
        "abcdef0123456789abcdef0123456789",
      ).toString("base64"),
      WINDDOWN_LUNA_RECEIPT_HMAC_KEY_ID: "different-key-v1",
    };
    assert.throws(
      () =>
        finalizeWindDownLunaRun({
          runDirectory,
          unsignedBundlePath: unsignedPath,
          signedReceiptPath,
          lkgRootPath,
          environment: differentKeyEnvironment,
        }),
      /signed_receipt_immutable_collision/,
    );

    const partial = structuredClone(unsigned);
    partial.shards[0].items.pop();
    const partialPath = join(scratch, "partial.json");
    writeJson(partialPath, partial);
    const rejectedReceiptPath = join(scratch, "rejected-receipt.json");
    const rejectedLkgRoot = join(scratch, "rejected-lkg");
    assert.throws(
      () =>
        finalizeWindDownLunaRun({
          runDirectory,
          unsignedBundlePath: partialPath,
          signedReceiptPath: rejectedReceiptPath,
          lkgRootPath: rejectedLkgRoot,
          environment,
        }),
      /unsigned_bundle_plan_mismatch/,
    );
    assert(!existsSync(rejectedReceiptPath));
    assert(!existsSync(rejectedLkgRoot));

    const wrongPlan = structuredClone(unsigned);
    wrongPlan.planDigest = "0".repeat(64);
    const wrongPlanPath = join(scratch, "wrong-plan.json");
    writeJson(wrongPlanPath, wrongPlan);
    assert.throws(
      () =>
        finalizeWindDownLunaRun({
          runDirectory,
          unsignedBundlePath: wrongPlanPath,
          signedReceiptPath: join(scratch, "wrong-plan-receipt.json"),
          lkgRootPath: join(scratch, "wrong-plan-lkg"),
          environment,
        }),
      /unsigned_bundle_plan_mismatch/,
    );

    assert.throws(
      () =>
        finalizeWindDownLunaRun({
          runDirectory,
          unsignedBundlePath: unsignedPath,
          signedReceiptPath: join(scratch, "missing-key-receipt.json"),
          lkgRootPath: join(scratch, "missing-key-lkg"),
          environment: {},
        }),
      /receipt_hmac_configuration_missing/,
    );

    const commitFailureReceiptPath = join(
      scratch,
      "commit-failure-receipt.json",
    );
    const commitFailureLkgRoot = join(scratch, "commit-failure-lkg");
    const commitFailureFilesystem: WindDownSignedReceiptFilesystem = {
      exists: existsSync,
      readText: (path) => readFileSync(path, "utf8"),
      mkdir: (path) => mkdirSync(path, { recursive: true }),
      writeTextExclusive: (path, text) =>
        writeFileSync(path, text, { encoding: "utf8", flag: "wx" }),
      fsync: () => {},
      link: () => {
        throw new Error("injected_receipt_commit_failure");
      },
      remove: (path) => rmSync(path, { force: true }),
    };
    assert.throws(
      () =>
        finalizeWindDownLunaRun({
          runDirectory,
          unsignedBundlePath: unsignedPath,
          signedReceiptPath: commitFailureReceiptPath,
          lkgRootPath: commitFailureLkgRoot,
          environment,
          receiptFilesystem: commitFailureFilesystem,
        }),
      /injected_receipt_commit_failure/,
    );
    assert(!existsSync(commitFailureReceiptPath));
    assert(!existsSync(join(commitFailureLkgRoot, "current.json")));

    const directoryFsyncReceiptPath = join(
      scratch,
      "directory-fsync-receipt.json",
    );
    const directoryFsyncLkgRoot = join(scratch, "directory-fsync-lkg");
    const receiptEvents: string[] = [];
    let receiptDirectoryFsyncFailures = 0;
    const directoryFsyncFilesystem: WindDownSignedReceiptFilesystem = {
      exists: existsSync,
      readText: (path) => readFileSync(path, "utf8"),
      mkdir: (path) => mkdirSync(path, { recursive: true }),
      writeTextExclusive: (path, text) => {
        receiptEvents.push(`write:${path}`);
        writeFileSync(path, text, { encoding: "utf8", flag: "wx" });
      },
      fsync: (path) => {
        receiptEvents.push(`fsync:${path}`);
        if (
          path === dirname(directoryFsyncReceiptPath) &&
          receiptDirectoryFsyncFailures === 0
        ) {
          receiptDirectoryFsyncFailures += 1;
          throw new Error("injected_receipt_directory_fsync_failure");
        }
      },
      link: (fromPath, toPath) => {
        receiptEvents.push(`link:${toPath}`);
        linkSync(fromPath, toPath);
      },
      remove: (path) => {
        receiptEvents.push(`remove:${path}`);
        rmSync(path, { force: true });
      },
    };
    assert.throws(
      () =>
        finalizeWindDownLunaRun({
          runDirectory,
          unsignedBundlePath: unsignedPath,
          signedReceiptPath: directoryFsyncReceiptPath,
          lkgRootPath: directoryFsyncLkgRoot,
          environment,
          receiptFilesystem: directoryFsyncFilesystem,
        }),
      /injected_receipt_directory_fsync_failure/,
    );
    assert(existsSync(directoryFsyncReceiptPath));
    assert(!existsSync(join(directoryFsyncLkgRoot, "current.json")));
    const linkEventIndex = receiptEvents.indexOf(
      `link:${directoryFsyncReceiptPath}`,
    );
    const parentFsyncEventIndex = receiptEvents.indexOf(
      `fsync:${dirname(directoryFsyncReceiptPath)}`,
    );
    const stagedRemoveEventIndex = receiptEvents.findIndex((event) =>
      event.startsWith(`remove:${directoryFsyncReceiptPath}.tmp-`),
    );
    assert(linkEventIndex >= 0);
    assert(stagedRemoveEventIndex > linkEventIndex);
    assert(parentFsyncEventIndex > stagedRemoveEventIndex);
    const retryAfterReceiptDirectoryFsync = finalizeWindDownLunaRun({
      runDirectory,
      unsignedBundlePath: unsignedPath,
      signedReceiptPath: directoryFsyncReceiptPath,
      lkgRootPath: directoryFsyncLkgRoot,
      environment,
      receiptFilesystem: directoryFsyncFilesystem,
    });
    assert.equal(retryAfterReceiptDirectoryFsync.promotion.status, "published");
    assert(existsSync(join(directoryFsyncLkgRoot, "current.json")));

    const orphanReceiptPath = join(scratch, "orphan-receipt.json");
    const retryLkgRoot = join(scratch, "retry-lkg");
    assert.throws(
      () =>
        finalizeWindDownLunaRun({
          runDirectory,
          unsignedBundlePath: unsignedPath,
          signedReceiptPath: orphanReceiptPath,
          lkgRootPath: retryLkgRoot,
          environment,
          promotionFunction: () => {
            throw new Error("injected_promotion_failure");
          },
        }),
      /injected_promotion_failure/,
    );
    assert(existsSync(orphanReceiptPath));
    assert(!existsSync(join(retryLkgRoot, "current.json")));
    const retryAfterPromotionFailure = finalizeWindDownLunaRun({
      runDirectory,
      unsignedBundlePath: unsignedPath,
      signedReceiptPath: orphanReceiptPath,
      lkgRootPath: retryLkgRoot,
      environment,
    });
    assert.equal(retryAfterPromotionFailure.promotion.status, "published");
    assert(existsSync(join(retryLkgRoot, "current.json")));

    console.log(
      JSON.stringify(
        {
          status: "PASS",
          activeMaterials: prepared.artifact.materials.length,
          quarantinedMaterials: prepared.artifact.quarantine.length,
          shards: prepared.plan.shardCount,
          overlayCoverage: finalized.promotion.lkg.advisorOverlay.length,
          prepareNonOverwrite: "passed",
          signedReceiptIdempotency: "passed",
          signedReceiptCollision: "passed",
          receiptCommitFailureBlocksLkg: "passed",
          receiptDirectoryFsyncRetry: "passed",
          promotionFailureRetry: "passed",
          mixedVerdictPublication: "passed",
          allNonApproveFailClosedRetry: "passed",
          partialUnsignedRejected: "passed",
          wrongPlanRejected: "passed",
          missingKeyRejected: "passed",
          liveLunaCalls: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main();
