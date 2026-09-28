import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildWindDownLunaBatchManifest,
  buildWindDownMaterialArtifactV2,
  type WindDownMaterialArtifactV2,
  type WindDownMaterialSourceRow,
} from "../src/features/winddown/content/materialIdentity";
import {
  loadWindDownMaterialLkg,
  windDownLkgBlobPath,
  windDownLkgPointerText,
} from "../src/features/winddown/content/lkgContract";
import {
  promoteWindDownMaterialLkg,
  rollbackWindDownMaterialLkg,
  type WindDownLkgFilesystem,
  type WindDownLkgPromotionInput,
} from "./promote-winddown-material-lkg";
import {
  WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION,
  WINDDOWN_LUNA_REQUESTED_MODEL,
  buildWindDownLunaReceiptContent,
  buildWindDownLunaShardPlan,
  canonicalWindDownJson,
  sha256Hex,
  signWindDownLunaReceiptBundle,
  type WindDownLunaCandidateItem,
  type WindDownLunaShardPlan,
  type WindDownLunaShardReceipt,
} from "./winddown-luna-contract";

const ROOT = "/winddown-lkg-score";
const HMAC_KEY_ID = "winddown-lkg-score-v1";
const HMAC_KEY = "0123456789abcdef0123456789abcdef";
const PROMPT = "Ground every answer in the approved source material.";
const SOURCE = {
  namespace: "winddown-lkg-score",
  source: "deterministic-fixture",
  sourcePath: "scripts/score-winddown-lkg-promotion.ts",
  sourceRevision: "fixture-v1",
};

type FilesystemOperation = "write" | "fsync" | "link" | "rename";
type LunaVerdict = WindDownLunaCandidateItem["verdict"];

class MemoryFilesystem implements WindDownLkgFilesystem {
  readonly files: Map<string, string>;
  readonly reads: string[] = [];
  readonly mutations: Array<{ operation: FilesystemOperation; path: string }> =
    [];
  private failure:
    ((operation: FilesystemOperation, path: string) => boolean) | null;

  constructor(
    initial = new Map<string, string>(),
    failure:
      ((operation: FilesystemOperation, path: string) => boolean) | null = null,
  ) {
    this.files = new Map(initial);
    this.failure = failure;
  }

  exists(path: string): boolean {
    return this.files.has(path);
  }

  readText(path: string): string {
    this.reads.push(path);
    const value = this.files.get(path);
    if (value === undefined) throw new Error("current_unavailable");
    return value;
  }

  mkdir(): void {}

  writeText(path: string, text: string): void {
    this.maybeFail("write", path);
    this.files.set(path, text);
  }

  fsync(path: string): void {
    this.maybeFail("fsync", path);
  }

  rename(fromPath: string, toPath: string): void {
    this.maybeFail("rename", toPath);
    const content = this.files.get(fromPath);
    if (content === undefined) throw new Error("rename_source_missing");
    this.files.set(toPath, content);
    this.files.delete(fromPath);
  }

  claimImmutable(fromPath: string, toPath: string): boolean {
    this.maybeFail("link", toPath);
    if (this.files.has(toPath)) return false;
    const content = this.files.get(fromPath);
    if (content === undefined) throw new Error("link_source_missing");
    this.files.set(toPath, content);
    return true;
  }

  remove(path: string): void {
    this.files.delete(path);
  }

  private maybeFail(operation: FilesystemOperation, path: string): void {
    this.mutations.push({ operation, path });
    if (this.failure?.(operation, path))
      throw new Error(`injected_${operation}_failure`);
  }
}

function sourceRow(
  index: number,
  release: string,
  override: Partial<WindDownMaterialSourceRow> = {},
) {
  return {
    sourceLocator: `fixture:${index}`,
    legacyV1Id: `legacy-${String(index).padStart(3, "0")}`,
    ko: `${release} 문장 ${index}`,
    en: `${release} practice sentence number ${index}`,
    acceptedVariants: [`${release} practice number ${index}`],
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
  } satisfies WindDownMaterialSourceRow;
}

function candidateFor(
  planItem: WindDownLunaShardPlan["shards"][number]["items"][number],
  artifact: WindDownMaterialArtifactV2,
  verdicts: Partial<Record<number, LunaVerdict>>,
): WindDownLunaCandidateItem {
  const material = artifact.materials.find(
    (entry) => entry.id === planItem.materialId,
  );
  assert(material, `missing active material: ${planItem.materialId}`);
  const materialIndex = artifact.materials.findIndex(
    (entry) => entry.id === material.id,
  );
  assert(materialIndex >= 0, `missing material index: ${material.id}`);
  return {
    materialId: planItem.materialId,
    inputMaterialDigest: planItem.inputMaterialDigest,
    verdict: verdicts[materialIndex] ?? "approve",
    evidence: ["Grounded in immutable source text."],
    enrichment: {
      chunks: [material.en.split(" ").slice(0, 2).join(" ")],
      distractors: [`Wrong alternative for ${material.legacyAliases[0]}`],
      difficultyNote: `Source difficulty ${material.difficulty}.`,
      scenarioTags: ["daily-life"],
      naturalnessFlags: ["natural"],
    },
  };
}

function shardReceipt(
  plan: WindDownLunaShardPlan,
  artifact: WindDownMaterialArtifactV2,
  shardIndex: number,
  verdicts: Partial<Record<number, LunaVerdict>>,
): WindDownLunaShardReceipt {
  const shard = plan.shards[shardIndex];
  assert(shard, `missing shard: ${shardIndex}`);
  const items = shard.items.map((item) =>
    candidateFor(item, artifact, verdicts),
  );
  return {
    schemaVersion: WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION,
    kind: "winddown-luna-shard-receipt",
    shardIndex,
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
}

function promotionFixture(
  release: string,
  verdicts: Partial<Record<number, LunaVerdict>> = {},
): Omit<WindDownLkgPromotionInput, "filesystem"> {
  const artifact = buildWindDownMaterialArtifactV2({
    source: SOURCE,
    mode: "legacy-v1-bootstrap",
    generatedAt: "2026-07-31T00:00:00.000Z",
    rows: [
      sourceRow(1, release),
      sourceRow(2, release),
      sourceRow(3, release, { verifiedInSource: false }),
    ],
  });
  const artifactBytes = JSON.stringify(artifact);
  const manifest = buildWindDownLunaBatchManifest(artifact);
  const plan = buildWindDownLunaShardPlan({
    artifact,
    artifactBytes,
    manifest,
    promptTemplate: PROMPT,
    shardSize: 2,
  });
  const receiptBundle = signWindDownLunaReceiptBundle(
    buildWindDownLunaReceiptContent(
      plan,
      plan.shards.map((_, index) =>
        shardReceipt(plan, artifact, index, verdicts),
      ),
    ),
    HMAC_KEY_ID,
    HMAC_KEY,
  );
  return {
    rootPath: ROOT,
    artifact,
    artifactBytes,
    manifest,
    promptTemplate: PROMPT,
    receiptBundle,
    keyId: HMAC_KEY_ID,
    key: HMAC_KEY,
    shardSize: 2,
  };
}

function sha256Runtime(text: string): Promise<string> {
  return Promise.resolve(createHash("sha256").update(text).digest("hex"));
}

async function loadCurrent(
  filesystem: MemoryFilesystem,
  previous: Awaited<ReturnType<typeof promoteWindDownMaterialLkg>>["lkg"],
) {
  return loadWindDownMaterialLkg({
    rootPath: ROOT,
    previousLkg: previous,
    operations: {
      readText: async (path) => filesystem.readText(path),
      sha256: sha256Runtime,
    },
  });
}

function assertFailedPublicationKeepsCurrent(
  fixture: Omit<WindDownLkgPromotionInput, "filesystem">,
  baseFiles: Map<string, string>,
  previous: Awaited<ReturnType<typeof promoteWindDownMaterialLkg>>["lkg"],
  failure: (operation: FilesystemOperation, path: string) => boolean,
): Promise<void> {
  const filesystem = new MemoryFilesystem(baseFiles, failure);
  assert.throws(
    () => promoteWindDownMaterialLkg({ ...fixture, filesystem }),
    /injected_/,
  );
  return loadCurrent(filesystem, previous).then((loaded) => {
    assert.equal(loaded.source, "current");
    assert.equal(loaded.lkg.contentDigest, previous.contentDigest);
  });
}

async function main(): Promise<void> {
  const firstFixture = promotionFixture("first");
  const filesystem = new MemoryFilesystem();
  const first = promoteWindDownMaterialLkg({ ...firstFixture, filesystem });

  assert.equal(first.status, "published");
  assert.equal(
    first.lkg.materials.length,
    firstFixture.artifact.materials.length,
  );
  assert.equal(
    first.lkg.quarantine.length,
    firstFixture.artifact.quarantine.length,
  );
  assert.deepEqual(first.lkg.migration, firstFixture.artifact.migration);
  assert.deepEqual(
    first.lkg.advisorOverlay.map((entry) => entry.materialId),
    firstFixture.artifact.materials.map((material) => material.id),
  );
  assert.equal(
    first.lkg.advisorOverlay[0]?.receiptDigest,
    firstFixture.receiptBundle.receiptDigest,
  );
  assert.equal(firstFixture.artifact.materials.length, 2);
  assert.equal(firstFixture.artifact.quarantine.length, 1);
  assert.deepEqual(first.lkg.lunaQuarantine, []);
  assert.deepEqual(first.lkg.advisorGate, {
    sourceActiveCount: 2,
    approvedCount: 2,
    needsHumanReviewCount: 0,
    rejectCount: 0,
    quarantinedCount: 0,
  });
  assert(filesystem.files.has(first.blobPath));
  assert(filesystem.files.has(first.pointerHistoryPath));

  const invalidReceiptFilesystem = new MemoryFilesystem();
  const invalidReceiptFixture = promotionFixture("invalid-receipt");
  const invalidReceiptBundle = structuredClone(
    invalidReceiptFixture.receiptBundle,
  ) as { auth: { mac: string } };
  invalidReceiptBundle.auth.mac = "0".repeat(64);
  assert.throws(
    () =>
      promoteWindDownMaterialLkg({
        ...invalidReceiptFixture,
        receiptBundle: invalidReceiptBundle,
        filesystem: invalidReceiptFilesystem,
      }),
    /lkg_receipt_invalid:bundle\.auth\.mac:mismatch/,
  );
  assert.equal(
    invalidReceiptFilesystem.files.has(`${ROOT}/current.json`),
    false,
  );

  const initiallyLoaded = await loadCurrent(filesystem, first.lkg);
  assert.equal(initiallyLoaded.source, "current");
  assert.equal(initiallyLoaded.lkg.contentDigest, first.lkg.contentDigest);
  assert.deepEqual(filesystem.reads.slice(-2), [
    `${ROOT}/current.json`,
    `${ROOT}/${windDownLkgBlobPath(first.lkg.contentDigest)}`,
  ]);

  const maliciousPointer = {
    ...first.currentPointer,
    blobPath: "staged/unpublished.json",
  };
  filesystem.files.set(
    `${ROOT}/current.json`,
    JSON.stringify(maliciousPointer),
  );
  filesystem.reads.length = 0;
  const unpublished = await loadCurrent(filesystem, first.lkg);
  assert.equal(unpublished.source, "fallback");
  assert.deepEqual(filesystem.reads, [`${ROOT}/current.json`]);
  filesystem.files.set(
    `${ROOT}/current.json`,
    windDownLkgPointerText(first.currentPointer),
  );

  const preservedBlob = filesystem.files.get(first.blobPath);
  assert(preservedBlob);
  const missingOverlay = JSON.parse(preservedBlob);
  missingOverlay.advisorOverlay.pop();
  filesystem.files.set(first.blobPath, JSON.stringify(missingOverlay));
  const missing = await loadCurrent(filesystem, first.lkg);
  assert.equal(missing.source, "fallback");

  const alteredOverlay = JSON.parse(preservedBlob);
  alteredOverlay.advisorOverlay[0].evidence = ["Altered after validation."];
  filesystem.files.set(first.blobPath, JSON.stringify(alteredOverlay));
  const altered = await loadCurrent(filesystem, first.lkg);
  assert.equal(altered.source, "fallback");

  const sourceTruthOverlay = JSON.parse(preservedBlob);
  sourceTruthOverlay.advisorOverlay[0].en = "Attempted source replacement";
  filesystem.files.set(first.blobPath, JSON.stringify(sourceTruthOverlay));
  const sourceTruth = await loadCurrent(filesystem, first.lkg);
  assert.equal(sourceTruth.source, "fallback");

  filesystem.files.set(first.blobPath, "{corrupt");
  const corrupt = await loadCurrent(filesystem, first.lkg);
  assert.equal(corrupt.source, "fallback");
  filesystem.files.set(first.blobPath, preservedBlob);

  const mixedFilesystem = new MemoryFilesystem();
  const mixedFixture = promotionFixture("mixed", { 1: "needs_human_review" });
  const mixed = promoteWindDownMaterialLkg({
    ...mixedFixture,
    filesystem: mixedFilesystem,
  });
  assert.equal(mixed.status, "published");
  assert.equal(mixed.lkg.materials.length, 1);
  assert.deepEqual(
    mixed.lkg.advisorOverlay.map((entry) => entry.materialId),
    mixed.lkg.materials.map((material) => material.id),
  );
  assert.equal(mixed.lkg.lunaQuarantine.length, 1);
  assert.equal(mixed.lkg.lunaQuarantine[0]?.verdict, "needs_human_review");
  assert.deepEqual(mixed.lkg.advisorGate, {
    sourceActiveCount: 2,
    approvedCount: 1,
    needsHumanReviewCount: 1,
    rejectCount: 0,
    quarantinedCount: 1,
  });
  const mixedBlob = mixedFilesystem.files.get(mixed.blobPath);
  assert(mixedBlob);
  const overlappingLunaQuarantine = JSON.parse(mixedBlob);
  overlappingLunaQuarantine.lunaQuarantine[0].materialId =
    overlappingLunaQuarantine.materials[0].id;
  mixedFilesystem.files.set(
    mixed.blobPath,
    JSON.stringify(overlappingLunaQuarantine),
  );
  const mixedTampered = await loadCurrent(mixedFilesystem, mixed.lkg);
  assert.equal(mixedTampered.source, "fallback");
  mixedFilesystem.files.set(mixed.blobPath, mixedBlob);

  const allNonApprove = promotionFixture("all-non-approve", {
    0: "needs_human_review",
    1: "reject",
  });
  assert.throws(
    () =>
      promoteWindDownMaterialLkg({
        ...allNonApprove,
        filesystem: mixedFilesystem,
      }),
    /lkg_no_approved_material/,
  );
  const retainedAfterAllNonApprove = await loadCurrent(
    mixedFilesystem,
    mixed.lkg,
  );
  assert.equal(retainedAfterAllNonApprove.source, "current");
  assert.equal(
    retainedAfterAllNonApprove.lkg.contentDigest,
    mixed.lkg.contentDigest,
  );

  filesystem.mutations.length = 0;
  const noOp = promoteWindDownMaterialLkg({ ...firstFixture, filesystem });
  assert.equal(noOp.status, "noop");
  assert.equal(
    filesystem.mutations.filter(({ operation }) => operation !== "fsync")
      .length,
    0,
    "byte-identical promotion may re-fsync directories but must not rewrite publication files",
  );

  const baseFiles = new Map(filesystem.files);
  const secondFixture = promotionFixture("second");
  await assertFailedPublicationKeepsCurrent(
    secondFixture,
    baseFiles,
    first.lkg,
    (operation, path) => operation === "write" && path.includes("/blobs/"),
  );
  await assertFailedPublicationKeepsCurrent(
    secondFixture,
    baseFiles,
    first.lkg,
    (operation, path) => operation === "fsync" && path.includes("/blobs/"),
  );
  await assertFailedPublicationKeepsCurrent(
    secondFixture,
    baseFiles,
    first.lkg,
    (operation, path) => operation === "link" && path.includes("/blobs/"),
  );
  await assertFailedPublicationKeepsCurrent(
    secondFixture,
    baseFiles,
    first.lkg,
    (operation, path) =>
      operation === "rename" && path === `${ROOT}/current.json`,
  );

  let blobDirectoryFsyncFailures = 0;
  const blobDirectoryRetryFilesystem = new MemoryFilesystem(
    baseFiles,
    (operation, path) => {
      if (
        operation === "fsync" &&
        path === `${ROOT}/blobs` &&
        blobDirectoryFsyncFailures === 0
      ) {
        blobDirectoryFsyncFailures += 1;
        return true;
      }
      return false;
    },
  );
  assert.throws(
    () =>
      promoteWindDownMaterialLkg({
        ...secondFixture,
        filesystem: blobDirectoryRetryFilesystem,
      }),
    /injected_fsync_failure/,
  );
  const baseBlobCount = [...baseFiles].filter(([path]) =>
    path.includes("/blobs/"),
  ).length;
  assert.equal(
    [...blobDirectoryRetryFilesystem.files].filter(([path]) =>
      path.includes("/blobs/"),
    ).length,
    baseBlobCount + 1,
    "immutable blob link must precede its parent-directory fsync",
  );
  assert.equal(
    (
      await loadCurrent(blobDirectoryRetryFilesystem, first.lkg)
    ).lkg.contentDigest,
    first.lkg.contentDigest,
  );
  const retryAfterBlobDirectoryFsync = promoteWindDownMaterialLkg({
    ...secondFixture,
    filesystem: blobDirectoryRetryFilesystem,
  });
  assert.equal(retryAfterBlobDirectoryFsync.status, "published");
  const secondBlobPath = `${ROOT}/${windDownLkgBlobPath(
    retryAfterBlobDirectoryFsync.lkg.contentDigest,
  )}`;
  assert(blobDirectoryRetryFilesystem.files.has(secondBlobPath));

  let currentDirectoryFsyncFailures = 0;
  const currentDirectoryRetryFilesystem = new MemoryFilesystem(
    baseFiles,
    (operation, path) => {
      if (
        operation === "fsync" &&
        path === ROOT &&
        currentDirectoryFsyncFailures === 0
      ) {
        currentDirectoryFsyncFailures += 1;
        return true;
      }
      return false;
    },
  );
  assert.throws(
    () =>
      promoteWindDownMaterialLkg({
        ...secondFixture,
        filesystem: currentDirectoryRetryFilesystem,
      }),
    /injected_fsync_failure/,
  );
  const retryAfterCurrentDirectoryFsync = promoteWindDownMaterialLkg({
    ...secondFixture,
    filesystem: currentDirectoryRetryFilesystem,
  });
  assert.equal(retryAfterCurrentDirectoryFsync.status, "noop");
  assert.equal(
    currentDirectoryRetryFilesystem.mutations.at(-1)?.operation,
    "fsync",
  );
  assert.equal(currentDirectoryRetryFilesystem.mutations.at(-1)?.path, ROOT);

  const second = promoteWindDownMaterialLkg({ ...secondFixture, filesystem });
  assert.equal(second.status, "published");
  assert(second.previousPointer);
  assert.equal(second.previousPointer.contentDigest, first.lkg.contentDigest);
  assert(
    filesystem.files.has(first.blobPath),
    "old blob remains after pointer switch",
  );
  assert(
    filesystem.files.has(first.pointerHistoryPath),
    "old pointer remains in immutable history",
  );

  const rollback = rollbackWindDownMaterialLkg({
    rootPath: ROOT,
    targetPointer: second.previousPointer,
    filesystem,
  });
  assert.equal(rollback, "published");
  const rolledBack = await loadCurrent(filesystem, second.lkg);
  assert.equal(rolledBack.source, "current");
  assert.equal(rolledBack.lkg.contentDigest, first.lkg.contentDigest);

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        activeMaterials: first.lkg.materials.length,
        quarantinedMaterials: first.lkg.quarantine.length,
        aliasMappings: first.lkg.migration.legacyAliasMap.length,
        advisorOverlay:
          "exact active coverage; digest and source-truth tamper rejected",
        advisorGate: mixed.lkg.advisorGate,
        nonApprovePolicy:
          "quarantine_non_approve; all_nonapprove_retains_prior_lkg",
        invalidReceipt: "blocks_before_publication",
        publicationFailuresCovered: [
          "write",
          "file_fsync",
          "blob_link",
          "parent_directory_fsync",
          "pointer_rename",
        ],
        rollback: "passed",
        runtimeReadScope: "current_pointer_and_blob_only",
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
