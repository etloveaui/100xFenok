import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { WindDownMaterialArtifactV2 } from "../src/features/winddown/content/materialIdentity";
import {
  assertWindDownMaterialLkg,
  assertWindDownMaterialLkgPointer,
  canonicalWindDownLkgJson,
  makeWindDownLkgPointer,
  windDownLkgBlobPath,
  windDownLkgBlobText,
  windDownLkgBody,
  windDownLkgPointerText,
  type WindDownMaterialLkg,
  type WindDownMaterialLkgBody,
  type WindDownMaterialLkgPointer,
} from "../src/features/winddown/content/lkgContract";
import {
  sha256Hex,
  validateWindDownLunaReceiptBundle,
  type SignedWindDownLunaReceiptBundle,
  type WindDownLunaManifestLike,
} from "./winddown-luna-contract";

export type WindDownLkgFilesystem = {
  exists(path: string): boolean;
  readText(path: string): string;
  mkdir(path: string): void;
  writeText(path: string, text: string): void;
  fsync(path: string): void;
  rename(fromPath: string, toPath: string): void;
  claimImmutable?(fromPath: string, toPath: string): boolean;
  remove?(path: string): void;
};

export type WindDownLkgPromotionInput = {
  rootPath: string;
  artifact: WindDownMaterialArtifactV2;
  artifactBytes: string | Buffer;
  manifest: WindDownLunaManifestLike;
  promptTemplate: string | Buffer;
  receiptBundle: unknown;
  keyId: string;
  key: string | Buffer;
  shardSize?: number;
  filesystem?: WindDownLkgFilesystem;
};

export type WindDownLkgPromotionResult = {
  status: "published" | "noop";
  lkg: WindDownMaterialLkg;
  currentPointer: WindDownMaterialLkgPointer;
  previousPointer: WindDownMaterialLkgPointer | null;
  blobPath: string;
  pointerHistoryPath: string;
};

const defaultFilesystem: WindDownLkgFilesystem = {
  exists: existsSync,
  readText: (path) => readFileSync(path, "utf8"),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  writeText: (path, text) => writeFileSync(path, text, "utf8"),
  fsync: (path) => {
    const descriptor = openSync(path, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  },
  rename: renameSync,
  claimImmutable: (fromPath, toPath) => {
    try {
      linkSync(fromPath, toPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  },
  remove: (path) => rmSync(path, { force: true }),
};

let temporarySequence = 0;

function temporaryPath(targetPath: string): string {
  temporarySequence += 1;
  return `${targetPath}.tmp-${process.pid}-${temporarySequence}`;
}

function pointerHistoryPath(rootPath: string, contentDigest: string): string {
  return join(rootPath, "pointers", `${contentDigest}.json`);
}

function fsyncParent(
  filesystem: WindDownLkgFilesystem,
  targetPath: string,
): void {
  filesystem.fsync(dirname(targetPath));
}

function readPointerOrNull(
  filesystem: WindDownLkgFilesystem,
  currentPath: string,
): WindDownMaterialLkgPointer | null {
  if (!filesystem.exists(currentPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(filesystem.readText(currentPath));
  } catch {
    throw new Error("lkg_current_pointer_json_invalid");
  }
  assertWindDownMaterialLkgPointer(parsed);
  return parsed;
}

function writeAtomic(
  filesystem: WindDownLkgFilesystem,
  targetPath: string,
  text: string,
): void {
  filesystem.mkdir(dirname(targetPath));
  const stagedPath = temporaryPath(targetPath);
  try {
    filesystem.writeText(stagedPath, text);
    filesystem.fsync(stagedPath);
    filesystem.rename(stagedPath, targetPath);
    fsyncParent(filesystem, targetPath);
  } catch (error) {
    try {
      filesystem.remove?.(stagedPath);
    } catch {
      // A cleanup failure must never mask the publication failure.
    }
    throw error;
  }
}

function writeImmutable(
  filesystem: WindDownLkgFilesystem,
  targetPath: string,
  text: string,
): boolean {
  if (filesystem.exists(targetPath)) {
    if (filesystem.readText(targetPath) !== text) {
      throw new Error("lkg_immutable_content_collision");
    }
    fsyncParent(filesystem, targetPath);
    return false;
  }
  filesystem.mkdir(dirname(targetPath));
  const stagedPath = temporaryPath(targetPath);
  const removeStaged = () => {
    try {
      filesystem.remove?.(stagedPath);
    } catch {
      // A cleanup failure must never mask the publication result.
    }
  };
  try {
    filesystem.writeText(stagedPath, text);
    filesystem.fsync(stagedPath);
    if (filesystem.claimImmutable) {
      if (!filesystem.claimImmutable(stagedPath, targetPath)) {
        const existingText = filesystem.readText(targetPath);
        removeStaged();
        if (existingText !== text) {
          throw new Error("lkg_immutable_content_collision");
        }
        fsyncParent(filesystem, targetPath);
        return false;
      }
      removeStaged();
      fsyncParent(filesystem, targetPath);
      return true;
    }
    filesystem.rename(stagedPath, targetPath);
    fsyncParent(filesystem, targetPath);
    return true;
  } catch (error) {
    removeStaged();
    throw error;
  }
}

export function buildWindDownMaterialLkg(
  artifact: WindDownMaterialArtifactV2,
  receiptBundle: SignedWindDownLunaReceiptBundle,
): WindDownMaterialLkg {
  const receiptItems = new Map(
    receiptBundle.shards.flatMap((shard) =>
      shard.items.map((item) => [
        item.materialId,
        {
          item,
          requestedModel: shard.requestedModel,
          responseModel: shard.responseModel,
        },
      ]),
    ),
  );
  if (receiptItems.size !== artifact.materials.length) {
    throw new Error("lkg_receipt_material_coverage_invalid");
  }
  const materials = [] as WindDownMaterialArtifactV2["materials"];
  const advisorOverlay: WindDownMaterialLkgBody["advisorOverlay"] = [];
  const lunaQuarantine: WindDownMaterialLkgBody["lunaQuarantine"] = [];
  for (const material of artifact.materials) {
    const bound = receiptItems.get(material.id);
    if (!bound) throw new Error("lkg_receipt_material_missing");
    if (bound.item.verdict === "approve") {
      materials.push(material);
      advisorOverlay.push({
        materialId: material.id,
        receiptDigest: receiptBundle.receiptDigest,
        requestedModel: bound.requestedModel,
        responseModel: bound.responseModel,
        evidence: [...bound.item.evidence],
        enrichment: {
          chunks: [...bound.item.enrichment.chunks],
          distractors: [...bound.item.enrichment.distractors],
          difficultyNote: bound.item.enrichment.difficultyNote,
          scenarioTags: [...bound.item.enrichment.scenarioTags],
          naturalnessFlags: [...bound.item.enrichment.naturalnessFlags],
        },
      });
      continue;
    }
    if (
      bound.item.verdict !== "needs_human_review" &&
      bound.item.verdict !== "reject"
    ) {
      throw new Error("lkg_receipt_verdict_invalid");
    }
    lunaQuarantine.push({
      materialId: material.id,
      verdict: bound.item.verdict,
      receiptDigest: receiptBundle.receiptDigest,
      requestedModel: bound.requestedModel,
      responseModel: bound.responseModel,
      evidence: [...bound.item.evidence],
    });
  }
  if (materials.length === 0) throw new Error("lkg_no_approved_material");
  const needsHumanReviewCount = lunaQuarantine.filter(
    (entry) => entry.verdict === "needs_human_review",
  ).length;
  const rejectCount = lunaQuarantine.length - needsHumanReviewCount;
  const body: WindDownMaterialLkgBody = {
    schemaVersion: 1,
    kind: "winddown-material-lkg",
    artifactDigest: artifact.digest,
    // The artifact material list is already the active subset. Quarantine and
    // migration data are copied unchanged so legacy resolution stays auditable.
    materials,
    quarantine: artifact.quarantine,
    migration: artifact.migration,
    advisorOverlay,
    lunaQuarantine,
    advisorGate: {
      sourceActiveCount: artifact.materials.length,
      approvedCount: materials.length,
      needsHumanReviewCount,
      rejectCount,
      quarantinedCount: lunaQuarantine.length,
    },
  };
  const contentDigest = sha256Hex(canonicalWindDownLkgJson(body));
  const lkg: WindDownMaterialLkg = { ...body, contentDigest };
  assertWindDownMaterialLkg(lkg);
  return lkg;
}

function verifiedBlobText(
  filesystem: WindDownLkgFilesystem,
  blobPath: string,
): string {
  const text = filesystem.readText(blobPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("lkg_rollback_blob_json_invalid");
  }
  assertWindDownMaterialLkg(parsed);
  if (
    sha256Hex(canonicalWindDownLkgJson(windDownLkgBody(parsed))) !==
    parsed.contentDigest
  ) {
    throw new Error("lkg_rollback_blob_digest_invalid");
  }
  return text;
}

export function promoteWindDownMaterialLkg(
  input: WindDownLkgPromotionInput,
): WindDownLkgPromotionResult {
  const receiptValidation = validateWindDownLunaReceiptBundle({
    artifact: input.artifact,
    artifactBytes: input.artifactBytes,
    manifest: input.manifest,
    promptTemplate: input.promptTemplate,
    bundle: input.receiptBundle,
    keyId: input.keyId,
    key: input.key,
    shardSize: input.shardSize,
  });
  if (!receiptValidation.ok) {
    throw new Error(
      `lkg_receipt_invalid:${receiptValidation.errors.join(",")}`,
    );
  }

  const filesystem = input.filesystem ?? defaultFilesystem;
  const lkg = buildWindDownMaterialLkg(
    input.artifact,
    input.receiptBundle as SignedWindDownLunaReceiptBundle,
  );
  const pointer = makeWindDownLkgPointer(lkg.contentDigest);
  const blobPath = join(input.rootPath, windDownLkgBlobPath(lkg.contentDigest));
  const historyPath = pointerHistoryPath(input.rootPath, lkg.contentDigest);
  const currentPath = join(input.rootPath, "current.json");
  const blobText = windDownLkgBlobText(lkg);
  const pointerText = windDownLkgPointerText(pointer);
  const previousPointer = readPointerOrNull(filesystem, currentPath);

  writeImmutable(filesystem, blobPath, blobText);
  writeImmutable(filesystem, historyPath, pointerText);
  if (
    filesystem.exists(currentPath) &&
    filesystem.readText(currentPath) === pointerText
  ) {
    fsyncParent(filesystem, currentPath);
    return {
      status: "noop",
      lkg,
      currentPointer: pointer,
      previousPointer,
      blobPath,
      pointerHistoryPath: historyPath,
    };
  }

  // This rename is the only mutable commit point. A failure leaves the old
  // current pointer untouched; immutable release files remain available for retry.
  writeAtomic(filesystem, currentPath, pointerText);
  return {
    status: "published",
    lkg,
    currentPointer: pointer,
    previousPointer,
    blobPath,
    pointerHistoryPath: historyPath,
  };
}

export function rollbackWindDownMaterialLkg(input: {
  rootPath: string;
  targetPointer: WindDownMaterialLkgPointer;
  filesystem?: WindDownLkgFilesystem;
}): WindDownLkgPromotionResult["status"] {
  const filesystem = input.filesystem ?? defaultFilesystem;
  assertWindDownMaterialLkgPointer(input.targetPointer);
  const blobPath = join(input.rootPath, input.targetPointer.blobPath);
  if (!filesystem.exists(blobPath))
    throw new Error("lkg_rollback_blob_missing");
  verifiedBlobText(filesystem, blobPath);
  const currentPath = join(input.rootPath, "current.json");
  const targetText = windDownLkgPointerText(input.targetPointer);
  if (
    filesystem.exists(currentPath) &&
    filesystem.readText(currentPath) === targetText
  ) {
    fsyncParent(filesystem, currentPath);
    return "noop";
  }
  writeAtomic(filesystem, currentPath, targetText);
  return "published";
}
