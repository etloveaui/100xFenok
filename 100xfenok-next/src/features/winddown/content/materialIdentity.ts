import { createHash } from "node:crypto";
import { validateTeacherMaterial } from "@/features/mona-vnext/teacher/materialGate";
import type { TeacherMaterialCandidate } from "@/features/mona-vnext/teacher/teacherSession";

export const WINDDOWN_MATERIAL_ARTIFACT_SCHEMA_VERSION = 2 as const;
export const WINDDOWN_LEGACY_ALIAS_BOOTSTRAP_SOURCE_SCHEMA_VERSION = 1 as const;

export type WindDownMaterialMode = "legacy-v1-bootstrap" | "steady-state";

export type WindDownMaterialProvenance = {
  namespace: string;
  source: string;
  sourcePath: string;
  sourceRecordId?: string;
  sourceRevision?: string | null;
};

export type WindDownMaterialSourceRow = {
  sourceLocator?: unknown;
  legacyV1Id?: unknown;
  ko?: unknown;
  en?: unknown;
  acceptedVariants?: unknown;
  difficulty?: unknown;
  grounded?: unknown;
  verifiedInSource?: unknown;
  provenance?: unknown;
  materialWarnings?: unknown;
  wordCount?: unknown;
  pattern?: unknown;
  variationsEn?: unknown;
  theme?: unknown;
  register?: unknown;
  note?: unknown;
  enrichment?: unknown;
};

export type WindDownMaterialArtifactSource = {
  namespace: string;
  source: string;
  sourcePath: string;
  sourceRevision: string | null;
};

export type WindDownMaterialQualityPolicy = {
  difficultyRange: {
    min: number;
    max: number;
  };
  requireGrounded: true;
  requireVerifiedInSource: true;
};

export type WindDownMaterialEnrichment = {
  upstreamSourceId: string | null;
  addedAt: string | null;
  extractedAt: string | null;
  enrichedAt: string | null;
  enrichVersion: number | null;
  upstreamVerifiedInSource: boolean | null;
  sibling: { ko: string; en: string } | null;
};

export type WindDownStaticSourceMetadata = {
  wordCount: number | null;
  pattern: string | null;
  variationsEn: string[];
  theme: string | null;
  register: string | null;
  note: string | null;
  enrichment: WindDownMaterialEnrichment;
};

export type WindDownStaticMaterial = {
  id: string;
  sourceLocator: string;
  legacyAliases: string[];
  ko: string;
  en: string;
  acceptedVariants: string[];
  difficulty: number;
  grounded: true;
  verifiedInSource: true;
  provenance: WindDownMaterialProvenance;
  sourceMetadata: WindDownStaticSourceMetadata;
  materialWarnings: string[];
  staticQaStatus: "passed";
};

export type WindDownMaterialQuarantine = {
  canonicalId: string | null;
  sourceLocator: string | null;
  legacyAliases: string[];
  ko: string;
  en: string;
  acceptedVariants: string[];
  difficulty: number | null;
  grounded: boolean;
  verifiedInSource: boolean;
  provenance: WindDownMaterialProvenance | null;
  sourceMetadata: WindDownStaticSourceMetadata;
  materialWarnings: string[];
  reasons: string[];
};

export type WindDownLegacyAliasCoverage = {
  expectedCount: number;
  mappedCount: number;
  missingCount: number;
  unaliasedRowCount: number;
  missingAliases: Array<{
    legacyV1Id: string | null;
    reason: "missing_legacy_v1_alias" | "legacy_alias_not_mapped";
  }>;
  status: "complete" | "blocked" | "not_applicable";
};

export type WindDownLegacyAliasMapEntry = {
  legacyV1Id: string;
  canonicalId: string;
};

export type WindDownMaterialArtifactV2 = {
  schemaVersion: typeof WINDDOWN_MATERIAL_ARTIFACT_SCHEMA_VERSION;
  kind: "winddown-static-material";
  generatedAt: string;
  source: WindDownMaterialArtifactSource;
  mode: WindDownMaterialMode;
  qualityPolicy: WindDownMaterialQualityPolicy;
  migration: {
    legacyAliasBootstrap: {
      sourceSchemaVersion: typeof WINDDOWN_LEGACY_ALIAS_BOOTSTRAP_SOURCE_SCHEMA_VERSION | null;
      policy: "record-v1-aliases-once" | "disabled-after-bootstrap";
      locatorStrategy: "frozen-legacy-v1-namespaced" | "source-locator-required";
    };
    legacyAliasMap: WindDownLegacyAliasMapEntry[];
    legacyAliasCoverage: WindDownLegacyAliasCoverage;
  };
  materials: WindDownStaticMaterial[];
  quarantine: WindDownMaterialQuarantine[];
  summary: {
    inputCount: number;
    staticCandidateCount: number;
    quarantinedCount: number;
  };
  digest: string;
};

type NormalizedSourceRow = {
  sourceLocator: string | null;
  legacyAlias: string | null;
  ko: string;
  en: string;
  acceptedVariants: string[];
  difficulty: number | null;
  grounded: boolean;
  verifiedInSource: boolean;
  provenance: WindDownMaterialProvenance | null;
  sourceMetadata: WindDownStaticSourceMetadata;
  materialWarnings: string[];
  reasons: string[];
};

type ArtifactDigestInput = Omit<WindDownMaterialArtifactV2, "generatedAt" | "digest">;

const DEFAULT_QUALITY_POLICY: WindDownMaterialQualityPolicy = {
  difficultyRange: { min: 1, max: 2 },
  requireGrounded: true,
  requireVerifiedInSource: true,
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeLocator(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(normalizeText).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function normalizeNullableText(value: unknown) {
  return normalizeText(value) || null;
}

function normalizeEnrichment(value: unknown): WindDownMaterialEnrichment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      upstreamSourceId: null,
      addedAt: null,
      extractedAt: null,
      enrichedAt: null,
      enrichVersion: null,
      upstreamVerifiedInSource: null,
      sibling: null,
    };
  }
  const record = value as Record<string, unknown>;
  const siblingRecord = record.sibling && typeof record.sibling === "object" && !Array.isArray(record.sibling)
    ? record.sibling as Record<string, unknown>
    : null;
  const siblingKo = normalizeText(siblingRecord?.ko);
  const siblingEn = normalizeText(siblingRecord?.en);
  return {
    upstreamSourceId: normalizeNullableText(record.upstreamSourceId),
    addedAt: normalizeNullableText(record.addedAt),
    extractedAt: normalizeNullableText(record.extractedAt),
    enrichedAt: normalizeNullableText(record.enrichedAt),
    enrichVersion: typeof record.enrichVersion === "number" && Number.isFinite(record.enrichVersion)
      ? record.enrichVersion
      : null,
    upstreamVerifiedInSource: typeof record.upstreamVerifiedInSource === "boolean"
      ? record.upstreamVerifiedInSource
      : null,
    sibling: siblingKo && siblingEn ? { ko: siblingKo, en: siblingEn } : null,
  };
}

function normalizeSourceMetadata(row: WindDownMaterialSourceRow): WindDownStaticSourceMetadata {
  return {
    wordCount: typeof row.wordCount === "number" && Number.isFinite(row.wordCount) ? row.wordCount : null,
    pattern: normalizeNullableText(row.pattern),
    variationsEn: normalizeStrings(row.variationsEn),
    theme: normalizeNullableText(row.theme),
    register: normalizeNullableText(row.register),
    note: normalizeNullableText(row.note),
    enrichment: normalizeEnrichment(row.enrichment),
  };
}

function normalizeProvenance(value: unknown): WindDownMaterialProvenance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const namespace = normalizeText(record.namespace);
  const source = normalizeText(record.source);
  const sourcePath = normalizeText(record.sourcePath);
  if (!namespace || !source || !sourcePath) return null;
  const sourceRecordId = normalizeText(record.sourceRecordId);
  const sourceRevision = normalizeText(record.sourceRevision);
  return {
    namespace,
    source,
    sourcePath,
    ...(sourceRecordId ? { sourceRecordId } : {}),
    sourceRevision: sourceRevision || null,
  };
}

function normalizeArtifactSource(source: WindDownMaterialArtifactSource): WindDownMaterialArtifactSource {
  const namespace = normalizeText(source.namespace);
  const sourceName = normalizeText(source.source);
  const sourcePath = normalizeText(source.sourcePath);
  if (!namespace || !sourceName || !sourcePath) {
    throw new Error("material artifact namespace, source, and sourcePath are required");
  }
  const sourceRevision = normalizeText(source.sourceRevision);
  return { namespace, source: sourceName, sourcePath, sourceRevision: sourceRevision || null };
}

function normalizeQualityPolicy(value: WindDownMaterialQualityPolicy | undefined): WindDownMaterialQualityPolicy {
  const candidate = value ?? DEFAULT_QUALITY_POLICY;
  const min = candidate.difficultyRange?.min;
  const max = candidate.difficultyRange?.max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new Error("material quality policy requires a finite difficulty range");
  }
  if (candidate.requireGrounded !== true || candidate.requireVerifiedInSource !== true) {
    throw new Error("material quality policy must require grounded and source-verified rows");
  }
  return {
    difficultyRange: { min, max },
    requireGrounded: true,
    requireVerifiedInSource: true,
  };
}

function frozenLegacyV1Locator(namespace: string, legacyV1Id: string) {
  return `legacy-v1:${encodeURIComponent(namespace)}:${encodeURIComponent(legacyV1Id)}`;
}

function normalizedRow(args: {
  row: WindDownMaterialSourceRow;
  mode: WindDownMaterialMode;
  source: WindDownMaterialArtifactSource;
  qualityPolicy: WindDownMaterialQualityPolicy;
}): NormalizedSourceRow {
  const legacyAlias = normalizeLocator(args.row.legacyV1Id);
  const inputLocator = normalizeLocator(args.row.sourceLocator);
  const reasons: string[] = [];
  if (args.mode === "legacy-v1-bootstrap" && !legacyAlias) reasons.push("missing_legacy_v1_alias");
  if (args.mode === "steady-state" && !inputLocator) reasons.push("missing_source_locator_after_legacy_bootstrap");
  if (args.mode === "steady-state" && legacyAlias) reasons.push("legacy_alias_not_allowed_after_bootstrap");
  const sourceLocator = args.mode === "legacy-v1-bootstrap"
    ? legacyAlias ? frozenLegacyV1Locator(args.source.namespace, legacyAlias) : null
    : inputLocator;
  const provenance = normalizeProvenance(args.row.provenance);
  if (!provenance) {
    reasons.push("missing_provenance");
  } else {
    if (provenance.namespace !== args.source.namespace) reasons.push("provenance_namespace_mismatch");
    if (provenance.source !== args.source.source) reasons.push("provenance_source_mismatch");
    if (provenance.sourcePath !== args.source.sourcePath) reasons.push("provenance_source_path_mismatch");
  }
  const difficulty = typeof args.row.difficulty === "number" && Number.isFinite(args.row.difficulty)
    ? args.row.difficulty
    : null;
  if (difficulty === null) {
    reasons.push("invalid_difficulty");
  } else if (difficulty < args.qualityPolicy.difficultyRange.min || difficulty > args.qualityPolicy.difficultyRange.max) {
    reasons.push("difficulty_outside_declared_range");
  }
  const grounded = args.row.grounded === true;
  const verifiedInSource = args.row.verifiedInSource === true;
  if (!grounded) reasons.push("not_grounded");
  if (!verifiedInSource) reasons.push("not_verified_in_source");
  return {
    sourceLocator,
    legacyAlias,
    ko: normalizeText(args.row.ko),
    en: normalizeText(args.row.en),
    acceptedVariants: normalizeStrings(args.row.acceptedVariants),
    difficulty,
    grounded,
    verifiedInSource,
    provenance,
    sourceMetadata: normalizeSourceMetadata(args.row),
    materialWarnings: normalizeStrings(args.row.materialWarnings),
    reasons,
  };
}

function addReason(row: NormalizedSourceRow, reason: string) {
  if (!row.reasons.includes(reason)) row.reasons.push(reason);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("artifact digest input must not contain a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    )).join(",")}}`;
  }
  throw new Error("artifact digest input must be JSON-compatible");
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function materialIdForLocator(sourceNamespace: string, sourceLocator: string) {
  return `winddown-material-${sha256(canonicalJson({ sourceNamespace, locator: sourceLocator })).slice(0, 24)}`;
}

function addCollisionReasons(rows: NormalizedSourceRow[], sourceNamespace: string) {
  const byLocator = new Map<string, NormalizedSourceRow[]>();
  const byAlias = new Map<string, NormalizedSourceRow[]>();
  const byMaterialId = new Map<string, NormalizedSourceRow[]>();
  for (const row of rows) {
    if (row.sourceLocator) {
      const values = byLocator.get(row.sourceLocator) ?? [];
      values.push(row);
      byLocator.set(row.sourceLocator, values);
      const id = materialIdForLocator(sourceNamespace, row.sourceLocator);
      const idValues = byMaterialId.get(id) ?? [];
      idValues.push(row);
      byMaterialId.set(id, idValues);
    }
    if (row.legacyAlias) {
      const values = byAlias.get(row.legacyAlias) ?? [];
      values.push(row);
      byAlias.set(row.legacyAlias, values);
    }
  }
  for (const values of byLocator.values()) {
    if (values.length > 1) values.forEach((row) => addReason(row, "duplicate_source_locator"));
  }
  for (const values of byMaterialId.values()) {
    if (new Set(values.map((row) => row.sourceLocator)).size > 1) {
      values.forEach((row) => addReason(row, "stable_material_id_collision"));
    }
  }
  for (const values of byAlias.values()) {
    const locators = new Set(values.map((row) => row.sourceLocator ?? "__unknown__"));
    if (locators.size > 1 || values.length > 1) values.forEach((row) => addReason(row, "duplicate_legacy_alias"));
  }
  for (const [alias, aliasRows] of byAlias) {
    const canonicalRows = byMaterialId.get(alias) ?? [];
    if (canonicalRows.some((canonical) => aliasRows.some((aliasRow) => canonical !== aliasRow))) {
      [...aliasRows, ...canonicalRows].forEach((row) => addReason(row, "legacy_alias_canonical_id_collision"));
    }
  }
}

function asCandidate(sourceNamespace: string, row: NormalizedSourceRow): TeacherMaterialCandidate {
  return {
    expressionId: materialIdForLocator(sourceNamespace, row.sourceLocator ?? ""),
    ko: row.ko,
    targetEn: row.en,
    acceptedVariants: row.acceptedVariants,
    difficulty: row.difficulty ?? Number.NaN,
    grounded: row.grounded,
    verifiedInSource: row.verifiedInSource,
    tried: [],
  };
}

function sortedUnique(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function compareMaterial(left: WindDownStaticMaterial, right: WindDownStaticMaterial) {
  return left.sourceLocator.localeCompare(right.sourceLocator) || left.id.localeCompare(right.id);
}

function compareQuarantine(left: WindDownMaterialQuarantine, right: WindDownMaterialQuarantine) {
  return (left.sourceLocator ?? "\uffff").localeCompare(right.sourceLocator ?? "\uffff")
    || left.legacyAliases.join("\u0000").localeCompare(right.legacyAliases.join("\u0000"))
    || left.ko.localeCompare(right.ko)
    || left.en.localeCompare(right.en);
}

function buildLegacyAliasMap(args: {
  mode: WindDownMaterialMode;
  rows: NormalizedSourceRow[];
  sourceNamespace: string;
}): WindDownLegacyAliasMapEntry[] {
  if (args.mode === "steady-state") return [];
  const rowsByAlias = new Map<string, NormalizedSourceRow[]>();
  const rowsByCanonicalId = new Map<string, NormalizedSourceRow[]>();
  for (const row of args.rows) {
    if (!row.sourceLocator) continue;
    const canonicalId = materialIdForLocator(args.sourceNamespace, row.sourceLocator);
    const canonicalRows = rowsByCanonicalId.get(canonicalId) ?? [];
    canonicalRows.push(row);
    rowsByCanonicalId.set(canonicalId, canonicalRows);
    if (row.legacyAlias) {
      const aliasRows = rowsByAlias.get(row.legacyAlias) ?? [];
      aliasRows.push(row);
      rowsByAlias.set(row.legacyAlias, aliasRows);
    }
  }
  const aliasMap: WindDownLegacyAliasMapEntry[] = [];
  for (const [legacyV1Id, aliasRows] of rowsByAlias) {
    const row = aliasRows[0];
    if (aliasRows.length !== 1 || !row?.sourceLocator) continue;
    const canonicalId = materialIdForLocator(args.sourceNamespace, row.sourceLocator);
    if ((rowsByCanonicalId.get(canonicalId)?.length ?? 0) !== 1) continue;
    aliasMap.push({ legacyV1Id, canonicalId });
  }
  return aliasMap.sort((left, right) => left.legacyV1Id.localeCompare(right.legacyV1Id));
}

function buildLegacyAliasCoverage(args: {
  mode: WindDownMaterialMode;
  rows: NormalizedSourceRow[];
  aliasMap: WindDownLegacyAliasMapEntry[];
}): WindDownLegacyAliasCoverage {
  if (args.mode === "steady-state") {
    return {
      expectedCount: 0,
      mappedCount: 0,
      missingCount: 0,
      unaliasedRowCount: 0,
      missingAliases: [],
      status: "not_applicable",
    };
  }
  const expectedAliases = new Set(args.rows.flatMap((row) => row.legacyAlias ? [row.legacyAlias] : []));
  const mappedAliases = new Set(args.aliasMap.map((entry) => entry.legacyV1Id));
  const missingAliases = [...expectedAliases]
    .filter((legacyV1Id) => !mappedAliases.has(legacyV1Id))
    .map((legacyV1Id) => ({ legacyV1Id, reason: "legacy_alias_not_mapped" as const }))
    .sort((left, right) => left.legacyV1Id.localeCompare(right.legacyV1Id));
  const unaliasedRowCount = args.rows.filter((row) => !row.legacyAlias).length;
  const expectedCount = expectedAliases.size;
  const mappedCount = args.aliasMap.length;
  return {
    expectedCount,
    mappedCount,
    missingCount: missingAliases.length,
    unaliasedRowCount,
    missingAliases,
    status: missingAliases.length === 0 && unaliasedRowCount === 0 && mappedCount === expectedCount
      ? "complete"
      : "blocked",
  };
}

export function windDownMaterialArtifactDigest(artifact: Omit<WindDownMaterialArtifactV2, "digest">) {
  const digestInput: ArtifactDigestInput = {
    schemaVersion: artifact.schemaVersion,
    kind: artifact.kind,
    source: artifact.source,
    mode: artifact.mode,
    qualityPolicy: artifact.qualityPolicy,
    migration: artifact.migration,
    materials: artifact.materials,
    quarantine: artifact.quarantine,
    summary: artifact.summary,
  };
  return sha256(canonicalJson(digestInput));
}

export function verifyWindDownMaterialArtifactDigest(artifact: WindDownMaterialArtifactV2) {
  return artifact.digest === windDownMaterialArtifactDigest(artifact);
}

export function buildWindDownMaterialArtifactV2(args: {
  source: WindDownMaterialArtifactSource;
  mode: WindDownMaterialMode;
  generatedAt: string;
  rows: WindDownMaterialSourceRow[];
  qualityPolicy?: WindDownMaterialQualityPolicy;
}): WindDownMaterialArtifactV2 {
  const source = normalizeArtifactSource(args.source);
  const qualityPolicy = normalizeQualityPolicy(args.qualityPolicy);
  const rows = args.rows.map((row) => normalizedRow({ row, mode: args.mode, source, qualityPolicy }));
  addCollisionReasons(rows, source.namespace);
  const gateCandidates = rows.filter((row) => row.reasons.length === 0);
  const teacherGate = validateTeacherMaterial(gateCandidates.map((row) => asCandidate(source.namespace, row)));
  const gateWarningsById = new Map(teacherGate.warnings.map((entry) => [entry.expressionId, entry.reasons]));
  const gateQuarantineById = new Map(teacherGate.quarantine.map((entry) => [entry.expressionId, entry.reasons]));
  const staticQaPassedIds = new Set(teacherGate.accepted.map((entry) => entry.expressionId));
  const materials: WindDownStaticMaterial[] = [];
  const quarantine: WindDownMaterialQuarantine[] = [];
  for (const row of rows) {
    const id = row.sourceLocator ? materialIdForLocator(source.namespace, row.sourceLocator) : null;
    const reasons = sortedUnique([
      ...row.reasons,
      ...(id ? gateQuarantineById.get(id) ?? [] : []),
    ]);
    const materialWarnings = sortedUnique([
      ...row.materialWarnings,
      ...(id ? gateWarningsById.get(id) ?? [] : []),
    ]);
    if (!id || reasons.length > 0 || !staticQaPassedIds.has(id) || !row.provenance || row.difficulty === null) {
      quarantine.push({
        canonicalId: id,
        sourceLocator: row.sourceLocator,
        legacyAliases: row.legacyAlias ? [row.legacyAlias] : [],
        ko: row.ko,
        en: row.en,
        acceptedVariants: row.acceptedVariants,
        difficulty: row.difficulty,
        grounded: row.grounded,
        verifiedInSource: row.verifiedInSource,
        provenance: row.provenance,
        sourceMetadata: row.sourceMetadata,
        materialWarnings,
        reasons: reasons.length > 0 ? reasons : ["teacher_material_gate_rejected"],
      });
      continue;
    }
    materials.push({
      id,
      sourceLocator: row.sourceLocator!,
      legacyAliases: row.legacyAlias ? [row.legacyAlias] : [],
      ko: row.ko,
      en: row.en,
      acceptedVariants: row.acceptedVariants,
      difficulty: row.difficulty,
      grounded: true,
      verifiedInSource: true,
      provenance: row.provenance,
      sourceMetadata: row.sourceMetadata,
      materialWarnings,
      staticQaStatus: "passed",
    });
  }
  materials.sort(compareMaterial);
  quarantine.sort(compareQuarantine);
  const generatedAt = normalizeText(args.generatedAt);
  if (!generatedAt) throw new Error("material artifact generatedAt is required");
  const legacyAliasMap = buildLegacyAliasMap({ mode: args.mode, rows, sourceNamespace: source.namespace });
  const legacyAliasCoverage = buildLegacyAliasCoverage({ mode: args.mode, rows, aliasMap: legacyAliasMap });
  const withoutDigest: Omit<WindDownMaterialArtifactV2, "digest"> = {
    schemaVersion: WINDDOWN_MATERIAL_ARTIFACT_SCHEMA_VERSION,
    kind: "winddown-static-material",
    generatedAt,
    source,
    mode: args.mode,
    qualityPolicy,
    migration: {
      legacyAliasBootstrap: args.mode === "legacy-v1-bootstrap"
        ? {
          sourceSchemaVersion: WINDDOWN_LEGACY_ALIAS_BOOTSTRAP_SOURCE_SCHEMA_VERSION,
          policy: "record-v1-aliases-once",
          locatorStrategy: "frozen-legacy-v1-namespaced",
        }
        : {
          sourceSchemaVersion: null,
          policy: "disabled-after-bootstrap",
          locatorStrategy: "source-locator-required",
        },
      legacyAliasMap,
      legacyAliasCoverage,
    },
    materials,
    quarantine,
    summary: {
      inputCount: rows.length,
      staticCandidateCount: materials.length,
      quarantinedCount: quarantine.length,
    },
  };
  return { ...withoutDigest, digest: windDownMaterialArtifactDigest(withoutDigest) };
}

export function resolveWindDownMaterialId(artifact: WindDownMaterialArtifactV2, idOrLegacyAlias: string) {
  const normalized = normalizeLocator(idOrLegacyAlias);
  if (!normalized) return null;
  const direct = artifact.materials.find((material) => material.id === normalized)?.id
    ?? artifact.quarantine.find((material) => material.canonicalId === normalized)?.canonicalId;
  if (direct) return direct;
  return artifact.migration.legacyAliasMap.find((entry) => entry.legacyV1Id === normalized)?.canonicalId ?? null;
}

export type WindDownLunaBatchManifest = {
  artifactSchemaVersion: typeof WINDDOWN_MATERIAL_ARTIFACT_SCHEMA_VERSION;
  artifactDigest: string;
  receiptValidatorStatus: "not_implemented";
  items: Array<{
    materialId: string;
    sourceLocator: string;
    status: "awaiting_luna_receipt" | "blocked";
    blockers: string[];
    releaseState: "not_released";
    requestedReceipt: {
      schemaVersion: 1;
      artifactDigest: string;
      materialId: string;
      sourceLocator: string;
      requiredFields: ["materialId", "artifactDigest", "verdict", "evidence"];
    };
  }>;
};

export function buildWindDownLunaBatchManifest(artifact: WindDownMaterialArtifactV2): WindDownLunaBatchManifest {
  const artifactDigestValid = verifyWindDownMaterialArtifactDigest(artifact);
  const bootstrapCoverageBlocked = artifact.migration.legacyAliasCoverage.status === "blocked";
  return {
    artifactSchemaVersion: WINDDOWN_MATERIAL_ARTIFACT_SCHEMA_VERSION,
    artifactDigest: artifact.digest,
    receiptValidatorStatus: "not_implemented",
    items: artifact.materials.map((material) => {
      const blockers = [
        ...(artifactDigestValid ? [] : ["artifact_digest_invalid"]),
        ...(bootstrapCoverageBlocked ? ["legacy_alias_coverage_incomplete"] : []),
      ];
      return {
        materialId: material.id,
        sourceLocator: material.sourceLocator,
        status: blockers.length === 0 ? "awaiting_luna_receipt" : "blocked",
        blockers,
        releaseState: "not_released",
        requestedReceipt: {
          schemaVersion: 1,
          artifactDigest: artifact.digest,
          materialId: material.id,
          sourceLocator: material.sourceLocator,
          requiredFields: ["materialId", "artifactDigest", "verdict", "evidence"],
        },
      };
    }),
  };
}
