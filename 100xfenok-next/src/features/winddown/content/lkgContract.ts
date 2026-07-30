/**
 * Browser/edge-safe contract for published Wind Down material.
 *
 * This file deliberately has no filesystem, provider, or Node dependencies. The
 * publisher owns writing a release; clients are allowed to read only its current
 * pointer and the immutable blob named by that pointer.
 */
import type { WindDownStaticMaterial } from "./materialIdentity";

export const WINDDOWN_LKG_SCHEMA_VERSION = 1 as const;

const SHA256_HEX = /^[a-f0-9]{64}$/;

export type WindDownLkgMaterial = WindDownStaticMaterial;

export type WindDownLkgAliasEntry = {
  legacyV1Id: string;
  canonicalId: string;
};

export type WindDownLkgMigration = {
  legacyAliasBootstrap: unknown;
  legacyAliasMap: WindDownLkgAliasEntry[];
  legacyAliasCoverage: unknown;
};

export type WindDownLkgAdvisorEnrichment = {
  chunks: string[];
  distractors: string[];
  difficultyNote: string | null;
  scenarioTags: string[];
  naturalnessFlags: string[];
};

/**
 * Verified guidance is separate from source truth. It can guide an interaction,
 * but it cannot introduce or replace a material's Korean/English answer fields.
 */
export type WindDownLkgAdvisorOverlay = {
  materialId: string;
  receiptDigest: string;
  requestedModel: string;
  responseModel: string;
  evidence: string[];
  enrichment: WindDownLkgAdvisorEnrichment;
};

export type WindDownLkgLunaQuarantine = {
  materialId: string;
  verdict: "needs_human_review" | "reject";
  receiptDigest: string;
  requestedModel: string;
  responseModel: string;
  evidence: string[];
};

export type WindDownLkgAdvisorGate = {
  sourceActiveCount: number;
  approvedCount: number;
  needsHumanReviewCount: number;
  rejectCount: number;
  quarantinedCount: number;
};

export type WindDownMaterialLkg = {
  schemaVersion: typeof WINDDOWN_LKG_SCHEMA_VERSION;
  kind: "winddown-material-lkg";
  contentDigest: string;
  artifactDigest: string;
  materials: WindDownLkgMaterial[];
  quarantine: unknown[];
  migration: WindDownLkgMigration;
  advisorOverlay: WindDownLkgAdvisorOverlay[];
  lunaQuarantine: WindDownLkgLunaQuarantine[];
  advisorGate: WindDownLkgAdvisorGate;
};

export type WindDownMaterialLkgBody = Omit<
  WindDownMaterialLkg,
  "contentDigest"
>;

export type WindDownMaterialLkgPointer = {
  schemaVersion: typeof WINDDOWN_LKG_SCHEMA_VERSION;
  kind: "winddown-material-lkg-pointer";
  contentDigest: string;
  blobPath: string;
};

export type WindDownLkgReadOperations = {
  readText(path: string): Promise<string>;
  sha256(text: string): Promise<string>;
};

export type WindDownLkgLoadResult = {
  lkg: WindDownMaterialLkg;
  source: "current" | "fallback";
  fallbackReason?: "current_unavailable" | "current_invalid";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalWindDownLkgJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function windDownLkgBlobPath(contentDigest: string): string {
  return `blobs/${contentDigest}.json`;
}

export function windDownLkgPointerPath(): string {
  return "current.json";
}

export function windDownLkgBody(
  value: WindDownMaterialLkg,
): WindDownMaterialLkgBody {
  return {
    schemaVersion: value.schemaVersion,
    kind: value.kind,
    artifactDigest: value.artifactDigest,
    materials: value.materials,
    quarantine: value.quarantine,
    migration: value.migration,
    advisorOverlay: value.advisorOverlay,
    lunaQuarantine: value.lunaQuarantine,
    advisorGate: value.advisorGate,
  };
}

export function windDownLkgBlobText(value: WindDownMaterialLkg): string {
  return canonicalWindDownLkgJson(value);
}

export function windDownLkgPointerText(
  value: WindDownMaterialLkgPointer,
): string {
  return canonicalWindDownLkgJson(value);
}

export function makeWindDownLkgPointer(
  contentDigest: string,
): WindDownMaterialLkgPointer {
  if (!SHA256_HEX.test(contentDigest))
    throw new Error("lkg_content_digest_invalid");
  return {
    schemaVersion: WINDDOWN_LKG_SCHEMA_VERSION,
    kind: "winddown-material-lkg-pointer",
    contentDigest,
    blobPath: windDownLkgBlobPath(contentDigest),
  };
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_HEX.test(value))
    throw new Error(`${label}_invalid`);
}

function assertMigration(
  value: unknown,
): asserts value is WindDownLkgMigration {
  if (!isRecord(value)) throw new Error("lkg_migration_invalid");
  if (!Array.isArray(value.legacyAliasMap))
    throw new Error("lkg_alias_map_invalid");
  if (!("legacyAliasBootstrap" in value) || !("legacyAliasCoverage" in value)) {
    throw new Error("lkg_migration_metadata_missing");
  }
  const aliases = new Set<string>();
  for (const entry of value.legacyAliasMap) {
    if (
      !isRecord(entry) ||
      typeof entry.legacyV1Id !== "string" ||
      typeof entry.canonicalId !== "string"
    ) {
      throw new Error("lkg_alias_entry_invalid");
    }
    if (
      !entry.legacyV1Id ||
      !entry.canonicalId ||
      aliases.has(entry.legacyV1Id)
    ) {
      throw new Error("lkg_alias_entry_duplicate_or_empty");
    }
    aliases.add(entry.legacyV1Id);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label}_fields_invalid`);
  }
}

function assertStringArray(
  value: unknown,
  label: string,
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(`${label}_invalid`);
  }
}

function assertMaterial(
  value: unknown,
): asserts value is WindDownLkgMaterial {
  if (!isRecord(value)) throw new Error("lkg_material_invalid");
  assertExactKeys(
    value,
    [
      "id",
      "sourceLocator",
      "legacyAliases",
      "ko",
      "en",
      "acceptedVariants",
      "difficulty",
      "grounded",
      "verifiedInSource",
      "provenance",
      "sourceMetadata",
      "materialWarnings",
      "staticQaStatus",
    ],
    "lkg_material",
  );
  for (const key of ["id", "sourceLocator", "ko", "en"] as const) {
    if (typeof value[key] !== "string" || !value[key].trim()) {
      throw new Error(`lkg_material_${key}_invalid`);
    }
  }
  assertStringArray(value.legacyAliases, "lkg_material_legacy_aliases");
  assertStringArray(value.acceptedVariants, "lkg_material_accepted_variants");
  assertStringArray(value.materialWarnings, "lkg_material_warnings");
  if (
    !Number.isSafeInteger(value.difficulty) ||
    (value.difficulty as number) < 1 ||
    (value.difficulty as number) > 2
  ) {
    throw new Error("lkg_material_difficulty_invalid");
  }
  if (
    value.grounded !== true ||
    value.verifiedInSource !== true ||
    value.staticQaStatus !== "passed"
  ) {
    throw new Error("lkg_material_quality_invalid");
  }
  if (!isRecord(value.provenance) || !isRecord(value.sourceMetadata)) {
    throw new Error("lkg_material_source_metadata_invalid");
  }
  for (const key of ["namespace", "source", "sourcePath"] as const) {
    if (
      typeof value.provenance[key] !== "string" ||
      !value.provenance[key].trim()
    ) {
      throw new Error("lkg_material_provenance_invalid");
    }
  }
}

function assertAdvisorOverlay(
  value: unknown,
  materialIds: readonly string[],
): asserts value is WindDownLkgAdvisorOverlay[] {
  if (!Array.isArray(value) || value.length !== materialIds.length) {
    throw new Error("lkg_advisor_coverage_invalid");
  }
  const receivedIds = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) throw new Error("lkg_advisor_entry_invalid");
    assertExactKeys(
      entry,
      [
        "materialId",
        "receiptDigest",
        "requestedModel",
        "responseModel",
        "evidence",
        "enrichment",
      ],
      "lkg_advisor_entry",
    );
    if (typeof entry.materialId !== "string") {
      throw new Error("lkg_advisor_material_id_invalid");
    }
    if (
      entry.materialId !== materialIds[index] ||
      receivedIds.has(entry.materialId)
    ) {
      throw new Error("lkg_advisor_material_id_invalid");
    }
    receivedIds.add(entry.materialId);
    assertDigest(entry.receiptDigest, "lkg_advisor_receipt_digest");
    if (
      typeof entry.requestedModel !== "string" ||
      !entry.requestedModel ||
      typeof entry.responseModel !== "string" ||
      !entry.responseModel
    ) {
      throw new Error("lkg_advisor_model_invalid");
    }
    assertStringArray(entry.evidence, "lkg_advisor_evidence");
    if (!isRecord(entry.enrichment))
      throw new Error("lkg_advisor_enrichment_invalid");
    assertExactKeys(
      entry.enrichment,
      [
        "chunks",
        "distractors",
        "difficultyNote",
        "scenarioTags",
        "naturalnessFlags",
      ],
      "lkg_advisor_enrichment",
    );
    assertStringArray(entry.enrichment.chunks, "lkg_advisor_chunks");
    assertStringArray(entry.enrichment.distractors, "lkg_advisor_distractors");
    assertStringArray(
      entry.enrichment.scenarioTags,
      "lkg_advisor_scenario_tags",
    );
    assertStringArray(
      entry.enrichment.naturalnessFlags,
      "lkg_advisor_naturalness_flags",
    );
    if (
      entry.enrichment.difficultyNote !== null &&
      (typeof entry.enrichment.difficultyNote !== "string" ||
        !entry.enrichment.difficultyNote.trim())
    ) {
      throw new Error("lkg_advisor_difficulty_note_invalid");
    }
  }
}

function assertLunaQuarantine(
  value: unknown,
  materialIds: ReadonlySet<string>,
): { needsHumanReviewCount: number; rejectCount: number } {
  if (!Array.isArray(value)) throw new Error("lkg_luna_quarantine_invalid");
  const ids = new Set<string>();
  let needsHumanReviewCount = 0;
  let rejectCount = 0;
  for (const entry of value) {
    if (!isRecord(entry)) throw new Error("lkg_luna_quarantine_entry_invalid");
    assertExactKeys(
      entry,
      [
        "materialId",
        "verdict",
        "receiptDigest",
        "requestedModel",
        "responseModel",
        "evidence",
      ],
      "lkg_luna_quarantine_entry",
    );
    if (
      typeof entry.materialId !== "string" ||
      !entry.materialId ||
      ids.has(entry.materialId) ||
      materialIds.has(entry.materialId)
    ) {
      throw new Error("lkg_luna_quarantine_material_id_invalid");
    }
    ids.add(entry.materialId);
    if (entry.verdict === "needs_human_review") needsHumanReviewCount += 1;
    else if (entry.verdict === "reject") rejectCount += 1;
    else throw new Error("lkg_luna_quarantine_verdict_invalid");
    assertDigest(entry.receiptDigest, "lkg_luna_quarantine_receipt_digest");
    if (
      typeof entry.requestedModel !== "string" ||
      !entry.requestedModel ||
      typeof entry.responseModel !== "string" ||
      !entry.responseModel
    ) {
      throw new Error("lkg_luna_quarantine_model_invalid");
    }
    assertStringArray(entry.evidence, "lkg_luna_quarantine_evidence");
  }
  return { needsHumanReviewCount, rejectCount };
}

function assertAdvisorGate(
  value: unknown,
  materialCount: number,
  lunaCounts: { needsHumanReviewCount: number; rejectCount: number },
): void {
  if (!isRecord(value)) throw new Error("lkg_advisor_gate_invalid");
  assertExactKeys(
    value,
    [
      "sourceActiveCount",
      "approvedCount",
      "needsHumanReviewCount",
      "rejectCount",
      "quarantinedCount",
    ],
    "lkg_advisor_gate",
  );
  for (const key of Object.keys(value)) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) {
      throw new Error("lkg_advisor_gate_count_invalid");
    }
  }
  if (
    value.approvedCount !== materialCount ||
    value.needsHumanReviewCount !== lunaCounts.needsHumanReviewCount ||
    value.rejectCount !== lunaCounts.rejectCount ||
    value.quarantinedCount !==
      lunaCounts.needsHumanReviewCount + lunaCounts.rejectCount ||
    value.sourceActiveCount !== value.approvedCount + value.quarantinedCount
  ) {
    throw new Error("lkg_advisor_gate_count_mismatch");
  }
}

export function assertWindDownMaterialLkg(
  value: unknown,
): asserts value is WindDownMaterialLkg {
  if (!isRecord(value)) throw new Error("lkg_object_required");
  if (
    value.schemaVersion !== WINDDOWN_LKG_SCHEMA_VERSION ||
    value.kind !== "winddown-material-lkg"
  ) {
    throw new Error("lkg_schema_invalid");
  }
  assertDigest(value.contentDigest, "lkg_content_digest");
  assertDigest(value.artifactDigest, "lkg_artifact_digest");
  if (!Array.isArray(value.materials) || value.materials.length === 0) {
    throw new Error("lkg_materials_invalid");
  }
  const ids = new Set<string>();
  for (const material of value.materials) {
    assertMaterial(material);
    if (ids.has(material.id)) {
      throw new Error("lkg_material_id_invalid");
    }
    ids.add(material.id);
  }
  if (!Array.isArray(value.quarantine))
    throw new Error("lkg_quarantine_invalid");
  assertMigration(value.migration);
  assertAdvisorOverlay(value.advisorOverlay, [...ids]);
  const lunaCounts = assertLunaQuarantine(value.lunaQuarantine, ids);
  assertAdvisorGate(value.advisorGate, ids.size, lunaCounts);
}

export function assertWindDownMaterialLkgPointer(
  value: unknown,
): asserts value is WindDownMaterialLkgPointer {
  if (!isRecord(value)) throw new Error("lkg_pointer_object_required");
  if (
    value.schemaVersion !== WINDDOWN_LKG_SCHEMA_VERSION ||
    value.kind !== "winddown-material-lkg-pointer"
  ) {
    throw new Error("lkg_pointer_schema_invalid");
  }
  assertDigest(value.contentDigest, "lkg_pointer_content_digest");
  if (value.blobPath !== windDownLkgBlobPath(value.contentDigest)) {
    throw new Error("lkg_pointer_blob_path_invalid");
  }
}

async function verifyLkgDigest(
  value: WindDownMaterialLkg,
  sha256: WindDownLkgReadOperations["sha256"],
): Promise<void> {
  const calculated = await sha256(
    canonicalWindDownLkgJson(windDownLkgBody(value)),
  );
  if (calculated !== value.contentDigest)
    throw new Error("lkg_blob_digest_invalid");
}

function pathAt(rootPath: string, relativePath: string): string {
  return `${rootPath.replace(/\/+$/, "")}/${relativePath}`;
}

async function readCurrent(
  rootPath: string,
  operations: WindDownLkgReadOperations,
): Promise<WindDownMaterialLkg> {
  const pointerText = await operations.readText(
    pathAt(rootPath, windDownLkgPointerPath()),
  );
  let pointerValue: unknown;
  try {
    pointerValue = JSON.parse(pointerText);
  } catch {
    throw new Error("lkg_pointer_json_invalid");
  }
  assertWindDownMaterialLkgPointer(pointerValue);

  const blobText = await operations.readText(
    pathAt(rootPath, pointerValue.blobPath),
  );
  let blobValue: unknown;
  try {
    blobValue = JSON.parse(blobText);
  } catch {
    throw new Error("lkg_blob_json_invalid");
  }
  assertWindDownMaterialLkg(blobValue);
  await verifyLkgDigest(blobValue, operations.sha256);
  if (blobValue.contentDigest !== pointerValue.contentDigest) {
    throw new Error("lkg_pointer_blob_digest_mismatch");
  }
  return blobValue;
}

export async function loadWindDownMaterialLkg(input: {
  rootPath: string;
  previousLkg: WindDownMaterialLkg;
  operations: WindDownLkgReadOperations;
}): Promise<WindDownLkgLoadResult> {
  assertWindDownMaterialLkg(input.previousLkg);
  await verifyLkgDigest(input.previousLkg, input.operations.sha256);
  try {
    return {
      lkg: await readCurrent(input.rootPath, input.operations),
      source: "current",
    };
  } catch (error) {
    const reason =
      error instanceof Error && error.message.includes("unavailable")
        ? "current_unavailable"
        : "current_invalid";
    return {
      lkg: input.previousLkg,
      source: "fallback",
      fallbackReason: reason,
    };
  }
}
