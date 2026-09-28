import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  verifyWindDownMaterialArtifactDigest,
  type WindDownMaterialArtifactV2,
  type WindDownStaticMaterial,
} from "../src/features/winddown/content/materialIdentity";

export const WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION = 1 as const;
export const WINDDOWN_LUNA_REQUESTED_MODEL = "gpt-5.6-luna" as const;
export const WINDDOWN_LUNA_DEFAULT_SHARD_SIZE = 32 as const;

export const WINDDOWN_LUNA_SCENARIO_TAGS = [
  "daily-life",
  "travel",
  "work",
  "school",
  "shopping",
  "food",
  "health",
  "social",
] as const;

export const WINDDOWN_LUNA_NATURALNESS_FLAGS = [
  "natural",
  "idiomatic",
  "literal",
  "awkward",
  "ambiguous",
  "register-mismatch",
] as const;

export type WindDownLunaScenarioTag = (typeof WINDDOWN_LUNA_SCENARIO_TAGS)[number];
export type WindDownLunaNaturalnessFlag = (typeof WINDDOWN_LUNA_NATURALNESS_FLAGS)[number];

export type WindDownLunaManifestLike = {
  artifactDigest: string;
  items: Array<{ materialId: string }>;
};

export type WindDownLunaShardPlanItem = {
  materialId: string;
  inputMaterialDigest: string;
};

export type WindDownLunaShardPlanShard = {
  shardIndex: number;
  shardId: string;
  items: WindDownLunaShardPlanItem[];
};

export type WindDownLunaShardPlan = {
  schemaVersion: typeof WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION;
  kind: "winddown-luna-shard-plan";
  artifactDigest: string;
  artifactBytesDigest: string;
  manifestDigest: string;
  promptTemplateDigest: string;
  requestedModel: typeof WINDDOWN_LUNA_REQUESTED_MODEL;
  materialCount: number;
  shardSize: number;
  shardCount: number;
  shards: WindDownLunaShardPlanShard[];
  digest: string;
};

export type WindDownLunaCandidateItem = {
  materialId: string;
  inputMaterialDigest: string;
  verdict: "approve" | "needs_human_review" | "reject";
  evidence: string[];
  enrichment: {
    chunks: string[];
    distractors: string[];
    difficultyNote: string | null;
    scenarioTags: WindDownLunaScenarioTag[];
    naturalnessFlags: WindDownLunaNaturalnessFlag[];
  };
};

export type WindDownLunaShardReceipt = {
  schemaVersion: typeof WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION;
  kind: "winddown-luna-shard-receipt";
  shardIndex: number;
  shardId: string;
  requestedModel: typeof WINDDOWN_LUNA_REQUESTED_MODEL;
  responseModel: string;
  responseDigest: string;
  items: WindDownLunaCandidateItem[];
};

export type WindDownLunaReceiptContent = {
  schemaVersion: typeof WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION;
  kind: "winddown-luna-receipt-bundle";
  planDigest: string;
  artifactDigest: string;
  artifactBytesDigest: string;
  manifestDigest: string;
  promptTemplateDigest: string;
  requestedModel: typeof WINDDOWN_LUNA_REQUESTED_MODEL;
  materialCount: number;
  shardCount: number;
  shards: WindDownLunaShardReceipt[];
};

export type SignedWindDownLunaReceiptBundle = WindDownLunaReceiptContent & {
  receiptDigest: string;
  auth: {
    algorithm: "HMAC-SHA256";
    keyId: string;
    mac: string;
  };
};

export type WindDownLunaValidationResult =
  | {
      ok: true;
      errors: [];
      allItemsApproved: boolean;
      nonApproveItems: string[];
    }
  | {
      ok: false;
      errors: string[];
      allItemsApproved: false;
      nonApproveItems: [];
    };

const HEX_SHA256 = /^[a-f0-9]{64}$/;
const RESPONSE_MODEL = /^gpt-5\.6-luna(?:-\d{4}-\d{2}-\d{2})?$/;
const SECRET_LIKE_TEXT = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,})/i;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalWindDownJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function windDownMaterialInputDigest(material: WindDownStaticMaterial): string {
  return sha256Hex(canonicalWindDownJson(material));
}

function assertUniqueIds(ids: string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${label}_duplicate:${id}`);
    seen.add(id);
  }
}

function parseArtifactBytes(artifactBytes: string | Buffer): unknown {
  try {
    return JSON.parse(artifactBytes.toString());
  } catch {
    throw new Error("artifact_bytes_invalid_json");
  }
}

export function buildWindDownLunaShardPlan(input: {
  artifact: WindDownMaterialArtifactV2;
  artifactBytes: string | Buffer;
  manifest: WindDownLunaManifestLike;
  promptTemplate: string | Buffer;
  shardSize?: number;
}): WindDownLunaShardPlan {
  const shardSize = input.shardSize ?? WINDDOWN_LUNA_DEFAULT_SHARD_SIZE;
  if (!Number.isSafeInteger(shardSize) || shardSize < 1 || shardSize > 128) {
    throw new Error("shard_size_invalid");
  }
  if (!verifyWindDownMaterialArtifactDigest(input.artifact)) {
    throw new Error("artifact_digest_invalid");
  }
  const aliasCoverage = input.artifact.migration.legacyAliasCoverage;
  if (
    aliasCoverage.status !== "complete" ||
    aliasCoverage.expectedCount !== aliasCoverage.mappedCount ||
    aliasCoverage.missingCount !== 0 ||
    aliasCoverage.unaliasedRowCount !== 0
  ) {
    throw new Error("legacy_alias_coverage_incomplete");
  }
  if (
    canonicalWindDownJson(parseArtifactBytes(input.artifactBytes)) !==
    canonicalWindDownJson(input.artifact)
  ) {
    throw new Error("artifact_bytes_content_mismatch");
  }
  if (input.manifest.artifactDigest !== input.artifact.digest) {
    throw new Error("manifest_artifact_digest_mismatch");
  }

  const artifactIds = input.artifact.materials.map((material) => material.id);
  if (artifactIds.length === 0) throw new Error("artifact_materials_empty");
  const manifestIds = input.manifest.items.map((item) => item.materialId);
  assertUniqueIds(artifactIds, "artifact_material_id");
  assertUniqueIds(manifestIds, "manifest_material_id");
  if (
    artifactIds.length !== manifestIds.length ||
    artifactIds.some((materialId, index) => manifestIds[index] !== materialId)
  ) {
    throw new Error("manifest_material_order_or_coverage_mismatch");
  }

  const artifactBytesDigest = sha256Hex(input.artifactBytes);
  const manifestDigest = sha256Hex(canonicalWindDownJson(input.manifest));
  const promptTemplateDigest = sha256Hex(input.promptTemplate);
  const itemBindings = input.artifact.materials.map((material) => ({
    materialId: material.id,
    inputMaterialDigest: windDownMaterialInputDigest(material),
  }));
  const shards: WindDownLunaShardPlanShard[] = [];
  for (let start = 0; start < itemBindings.length; start += shardSize) {
    const shardIndex = shards.length;
    const items = itemBindings.slice(start, start + shardSize);
    const shardId = sha256Hex(
      canonicalWindDownJson({
        artifactDigest: input.artifact.digest,
        artifactBytesDigest,
        manifestDigest,
        promptTemplateDigest,
        requestedModel: WINDDOWN_LUNA_REQUESTED_MODEL,
        shardIndex,
        items,
      }),
    );
    shards.push({ shardIndex, shardId, items });
  }

  const planWithoutDigest = {
    schemaVersion: WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION,
    kind: "winddown-luna-shard-plan" as const,
    artifactDigest: input.artifact.digest,
    artifactBytesDigest,
    manifestDigest,
    promptTemplateDigest,
    requestedModel: WINDDOWN_LUNA_REQUESTED_MODEL,
    materialCount: itemBindings.length,
    shardSize,
    shardCount: shards.length,
    shards,
  };
  return {
    ...planWithoutDigest,
    digest: sha256Hex(canonicalWindDownJson(planWithoutDigest)),
  };
}

export function buildWindDownLunaReceiptContent(
  plan: WindDownLunaShardPlan,
  shards: WindDownLunaShardReceipt[],
): WindDownLunaReceiptContent {
  return {
    schemaVersion: WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION,
    kind: "winddown-luna-receipt-bundle",
    planDigest: plan.digest,
    artifactDigest: plan.artifactDigest,
    artifactBytesDigest: plan.artifactBytesDigest,
    manifestDigest: plan.manifestDigest,
    promptTemplateDigest: plan.promptTemplateDigest,
    requestedModel: WINDDOWN_LUNA_REQUESTED_MODEL,
    materialCount: plan.materialCount,
    shardCount: plan.shardCount,
    shards,
  };
}

export function signWindDownLunaReceiptBundle(
  content: WindDownLunaReceiptContent,
  keyId: string,
  key: string | Buffer,
): SignedWindDownLunaReceiptBundle {
  if (!keyId.trim()) throw new Error("hmac_key_id_empty");
  if (Buffer.byteLength(key) < 32) throw new Error("hmac_key_too_short");
  const receiptDigest = sha256Hex(canonicalWindDownJson(content));
  const mac = createHmac("sha256", key)
    .update(canonicalWindDownJson({ keyId, receiptDigest }))
    .digest("hex");
  return {
    ...content,
    receiptDigest,
    auth: { algorithm: "HMAC-SHA256", keyId, mac },
  };
}

function addExactKeyErrors(
  errors: string[],
  path: string,
  value: unknown,
  allowedKeys: readonly string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path}:object_required`);
    return false;
  }
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const allowed = [...allowedKeys].sort();
  for (const key of actual) {
    if (!allowed.includes(key)) errors.push(`${path}.${key}:forbidden_field`);
  }
  for (const key of allowed) {
    if (!actual.includes(key)) errors.push(`${path}.${key}:required`);
  }
  return true;
}

function isBoundedStrings(
  errors: string[],
  path: string,
  value: unknown,
  maxItems: number,
  maxLength: number,
): value is string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path}:array_required`);
    return false;
  }
  if (value.length > maxItems) errors.push(`${path}:too_many_items`);
  const normalized = new Set<string>();
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > maxLength) {
      errors.push(`${path}[${index}]:invalid_text`);
      return;
    }
    const key = entry.trim().toLocaleLowerCase("en");
    if (normalized.has(key)) errors.push(`${path}[${index}]:duplicate`);
    normalized.add(key);
    if (SECRET_LIKE_TEXT.test(entry)) errors.push(`${path}[${index}]:secret_like_text`);
  });
  return true;
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function validateCandidateItem(
  errors: string[],
  path: string,
  value: unknown,
  expected: WindDownLunaShardPlanItem,
  material: WindDownStaticMaterial,
): void {
  if (
    !addExactKeyErrors(errors, path, value, [
      "materialId",
      "inputMaterialDigest",
      "verdict",
      "evidence",
      "enrichment",
    ])
  ) {
    return;
  }
  if (value.materialId !== expected.materialId) errors.push(`${path}.materialId:mismatch`);
  if (value.inputMaterialDigest !== expected.inputMaterialDigest) {
    errors.push(`${path}.inputMaterialDigest:mismatch`);
  }
  if (!["approve", "needs_human_review", "reject"].includes(String(value.verdict))) {
    errors.push(`${path}.verdict:invalid`);
  }
  if (isBoundedStrings(errors, `${path}.evidence`, value.evidence, 2, 240) && value.evidence.length === 0) {
    errors.push(`${path}.evidence:at_least_one_required`);
  }
  if (
    !addExactKeyErrors(errors, `${path}.enrichment`, value.enrichment, [
      "chunks",
      "distractors",
      "difficultyNote",
      "scenarioTags",
      "naturalnessFlags",
    ])
  ) {
    return;
  }

  if (isBoundedStrings(errors, `${path}.enrichment.chunks`, value.enrichment.chunks, 8, 120)) {
    const sourceTexts = [material.en, ...material.acceptedVariants].map(normalizedText);
    value.enrichment.chunks.forEach((chunk, index) => {
      const normalizedChunk = normalizedText(chunk);
      if (!sourceTexts.some((source) => source.includes(normalizedChunk))) {
        errors.push(`${path}.enrichment.chunks[${index}]:not_grounded_in_source`);
      }
    });
  }

  if (
    isBoundedStrings(errors, `${path}.enrichment.distractors`, value.enrichment.distractors, 4, 140)
  ) {
    const accepted = new Set([material.en, ...material.acceptedVariants].map(normalizedText));
    value.enrichment.distractors.forEach((distractor, index) => {
      if (accepted.has(normalizedText(distractor))) {
        errors.push(`${path}.enrichment.distractors[${index}]:matches_accepted_answer`);
      }
    });
  }

  const difficultyNote = value.enrichment.difficultyNote;
  if (
    difficultyNote !== null &&
    (typeof difficultyNote !== "string" ||
      !difficultyNote.trim() ||
      difficultyNote.length > 240 ||
      SECRET_LIKE_TEXT.test(difficultyNote))
  ) {
    errors.push(`${path}.enrichment.difficultyNote:invalid_text`);
  }

  if (
    isBoundedStrings(errors, `${path}.enrichment.scenarioTags`, value.enrichment.scenarioTags, 8, 32)
  ) {
    value.enrichment.scenarioTags.forEach((tag, index) => {
      if (!(WINDDOWN_LUNA_SCENARIO_TAGS as readonly string[]).includes(tag)) {
        errors.push(`${path}.enrichment.scenarioTags[${index}]:unknown`);
      }
    });
  }
  if (
    isBoundedStrings(
      errors,
      `${path}.enrichment.naturalnessFlags`,
      value.enrichment.naturalnessFlags,
      6,
      32,
    )
  ) {
    value.enrichment.naturalnessFlags.forEach((flag, index) => {
      if (!(WINDDOWN_LUNA_NATURALNESS_FLAGS as readonly string[]).includes(flag)) {
        errors.push(`${path}.enrichment.naturalnessFlags[${index}]:unknown`);
      }
    });
    const flags = new Set(value.enrichment.naturalnessFlags);
    const positive = flags.has("natural") || flags.has("idiomatic");
    const negative =
      flags.has("literal") ||
      flags.has("awkward") ||
      flags.has("ambiguous") ||
      flags.has("register-mismatch");
    if (positive && negative) {
      errors.push(`${path}.enrichment.naturalnessFlags:contradictory`);
    }
  }
}

function safeMacEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string" || !HEX_SHA256.test(actual)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function validateWindDownLunaReceiptBundle(input: {
  artifact: WindDownMaterialArtifactV2;
  artifactBytes: string | Buffer;
  manifest: WindDownLunaManifestLike;
  promptTemplate: string | Buffer;
  bundle: unknown;
  keyId: string;
  key: string | Buffer;
  shardSize?: number;
}): WindDownLunaValidationResult {
  const errors: string[] = [];
  let plan: WindDownLunaShardPlan;
  try {
    plan = buildWindDownLunaShardPlan(input);
  } catch (error) {
    return {
      ok: false,
      errors: [`plan:${error instanceof Error ? error.message : "build_failed"}`],
      allItemsApproved: false,
      nonApproveItems: [],
    };
  }

  if (
    !addExactKeyErrors(errors, "bundle", input.bundle, [
      "schemaVersion",
      "kind",
      "planDigest",
      "artifactDigest",
      "artifactBytesDigest",
      "manifestDigest",
      "promptTemplateDigest",
      "requestedModel",
      "materialCount",
      "shardCount",
      "shards",
      "receiptDigest",
      "auth",
    ])
  ) {
    return {
      ok: false,
      errors: [...new Set(errors)].sort(),
      allItemsApproved: false,
      nonApproveItems: [],
    };
  }
  const bundle = input.bundle;
  if (bundle.schemaVersion !== WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION) {
    errors.push("bundle.schemaVersion:mismatch");
  }
  if (bundle.kind !== "winddown-luna-receipt-bundle") errors.push("bundle.kind:mismatch");
  const bindings: Array<[keyof WindDownLunaShardPlan, unknown]> = [
    ["digest", bundle.planDigest],
    ["artifactDigest", bundle.artifactDigest],
    ["artifactBytesDigest", bundle.artifactBytesDigest],
    ["manifestDigest", bundle.manifestDigest],
    ["promptTemplateDigest", bundle.promptTemplateDigest],
    ["requestedModel", bundle.requestedModel],
    ["materialCount", bundle.materialCount],
    ["shardCount", bundle.shardCount],
  ];
  for (const [key, actual] of bindings) {
    if (actual !== plan[key]) errors.push(`bundle.${key === "digest" ? "planDigest" : key}:mismatch`);
  }

  if (
    addExactKeyErrors(errors, "bundle.auth", bundle.auth, ["algorithm", "keyId", "mac"])
  ) {
    if (bundle.auth.algorithm !== "HMAC-SHA256") errors.push("bundle.auth.algorithm:mismatch");
    if (bundle.auth.keyId !== input.keyId) errors.push("bundle.auth.keyId:mismatch");
  }

  const { receiptDigest, auth, ...content } = bundle;
  const expectedReceiptDigest = sha256Hex(canonicalWindDownJson(content));
  if (receiptDigest !== expectedReceiptDigest) errors.push("bundle.receiptDigest:mismatch");
  const expectedMac = createHmac("sha256", input.key)
    .update(canonicalWindDownJson({ keyId: input.keyId, receiptDigest: expectedReceiptDigest }))
    .digest("hex");
  if (
    !auth ||
    typeof auth !== "object" ||
    !safeMacEqual((auth as Record<string, unknown>).mac, expectedMac)
  ) {
    errors.push("bundle.auth.mac:mismatch");
  }

  if (!Array.isArray(bundle.shards)) {
    errors.push("bundle.shards:array_required");
  } else {
    if (bundle.shards.length !== plan.shards.length) errors.push("bundle.shards:count_mismatch");
    const allIds: string[] = [];
    bundle.shards.forEach((shardValue, shardPosition) => {
      const path = `bundle.shards[${shardPosition}]`;
      const expectedShard = plan.shards[shardPosition];
      if (
        !addExactKeyErrors(errors, path, shardValue, [
          "schemaVersion",
          "kind",
          "shardIndex",
          "shardId",
          "requestedModel",
          "responseModel",
          "responseDigest",
          "items",
        ])
      ) {
        return;
      }
      if (!expectedShard) {
        errors.push(`${path}:unexpected_shard`);
        return;
      }
      if (shardValue.schemaVersion !== WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION) {
        errors.push(`${path}.schemaVersion:mismatch`);
      }
      if (shardValue.kind !== "winddown-luna-shard-receipt") errors.push(`${path}.kind:mismatch`);
      if (shardValue.shardIndex !== expectedShard.shardIndex) {
        errors.push(`${path}.shardIndex:mismatch`);
      }
      if (shardValue.shardId !== expectedShard.shardId) errors.push(`${path}.shardId:mismatch`);
      if (shardValue.requestedModel !== WINDDOWN_LUNA_REQUESTED_MODEL) {
        errors.push(`${path}.requestedModel:mismatch`);
      }
      if (typeof shardValue.responseModel !== "string" || !RESPONSE_MODEL.test(shardValue.responseModel)) {
        errors.push(`${path}.responseModel:mismatch`);
      }
      if (!Array.isArray(shardValue.items)) {
        errors.push(`${path}.items:array_required`);
        return;
      }
      const expectedResponseDigest = sha256Hex(
        canonicalWindDownJson({
          schemaVersion: WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION,
          kind: "winddown-luna-shard-response",
          shardId: shardValue.shardId,
          items: shardValue.items,
        }),
      );
      if (shardValue.responseDigest !== expectedResponseDigest) {
        errors.push(`${path}.responseDigest:mismatch`);
      }
      if (shardValue.items.length !== expectedShard.items.length) {
        errors.push(`${path}.items:count_mismatch`);
      }
      shardValue.items.forEach((item, itemPosition) => {
        const itemPath = `${path}.items[${itemPosition}]`;
        const expectedItem = expectedShard.items[itemPosition];
        if (!expectedItem) {
          errors.push(`${itemPath}:unexpected_item`);
          return;
        }
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const materialId = (item as Record<string, unknown>).materialId;
          if (typeof materialId === "string") allIds.push(materialId);
        }
        const material = input.artifact.materials.find(
          (entry) => entry.id === expectedItem.materialId,
        );
        if (!material) {
          errors.push(`${itemPath}:expected_material_missing`);
          return;
        }
        validateCandidateItem(errors, itemPath, item, expectedItem, material);
      });
    });

    const expectedIds = input.artifact.materials.map((material) => material.id);
    const counts = new Map<string, number>();
    allIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
    for (const id of expectedIds) {
      const count = counts.get(id) ?? 0;
      if (count === 0) errors.push(`bundle.coverage.missing:${id}`);
      if (count > 1) errors.push(`bundle.coverage.duplicate:${id}`);
    }
    for (const id of counts.keys()) {
      if (!expectedIds.includes(id)) errors.push(`bundle.coverage.unknown:${id}`);
    }
    if (allIds.length !== expectedIds.length) errors.push("bundle.coverage:count_mismatch");
  }

  const uniqueErrors = [...new Set(errors)].sort();
  if (uniqueErrors.length > 0) {
    return {
      ok: false,
      errors: uniqueErrors,
      allItemsApproved: false,
      nonApproveItems: [],
    };
  }
  const nonApproveItems = (bundle.shards as WindDownLunaShardReceipt[]).flatMap((shard) =>
    shard.items
      .filter((item) => item.verdict !== "approve")
      .map((item) => `${item.materialId}:${item.verdict}`),
  );
  return {
    ok: true,
    errors: [],
    allItemsApproved: nonApproveItems.length === 0,
    nonApproveItems,
  };
}
