// Server-only module: it is consumed exclusively by the Wind Down API route.
import type { MonaVnextExpression } from "@/features/mona-vnext/coach/coachPolicy";
import { listTeacherApprovedMonaVnextExpressionEntries } from "@/features/mona-vnext/server/teacherMaterialBank";
import {
  assertWindDownRuntimeProjection,
  assertWindDownRuntimeProjectionPointer,
  canonicalWindDownLkgJson,
  windDownRuntimeProjectionBody,
  type WindDownLkgAdvisorGate,
  type WindDownLkgAdvisorOverlay,
  type WindDownRuntimeProjection,
} from "@/features/winddown/content/lkgContract";
import { WINDDOWN_PUBLISHED_LKG_BUILD } from "@/generated/winddown-published-lkg";
import { readPublicAssetText } from "@/lib/server/public-assets";

type PersistedIdResolution = {
  inputCount: number;
  resolvedCount: number;
  directResolvedCount: number;
  aliasResolvedCount: number;
  unresolvedCount: number;
  quarantinedCount: number;
};

export type WindDownStudyMaterialResolution = {
  due: PersistedIdResolution;
  deferred: PersistedIdResolution;
};

export type WindDownStudyAdvisorMetadata = Pick<
  WindDownLkgAdvisorOverlay,
  | "materialId"
  | "receiptDigest"
  | "requestedModel"
  | "responseModel"
  | "evidence"
  | "enrichment"
>;

export type WindDownStudyMaterialMetadata = {
  source: "published-lkg" | "legacy-fallback";
  publicationStatus: "active" | "absent" | "invalid";
  sourceEntryCount: number;
  activeMaterialCount: number;
  quarantinedMaterialCount: number;
  lunaQuarantinedMaterialCount: number;
  aliasMappingCount: number;
  artifactDigest: string | null;
  contentDigest: string | null;
  advisorGate: WindDownLkgAdvisorGate | null;
  advisor: {
    available: boolean;
    overlayCount: number;
    receiptDigests: string[];
    requestedModels: string[];
    responseModels: string[];
  };
};

export type WindDownStudyMaterialSelection = {
  entries: MonaVnextExpression[];
  dueExpressionIds: string[];
  deferredExpressionIds: string[];
  resolution: WindDownStudyMaterialResolution;
  metadata: WindDownStudyMaterialMetadata;
  advisorForExpressionIds(
    expressionIds: string[],
  ): WindDownStudyAdvisorMetadata[];
};

type PublishedStaticMaterial = {
  id: string;
  ko: string;
  en: string;
  acceptedVariants: string[];
};

type QuarantinedId = {
  canonicalId: string | null;
  legacyAliases: string[];
};

type ResolvedIds = {
  ids: string[];
  stats: PersistedIdResolution;
};

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function staticMaterial(value: unknown): PublishedStaticMaterial | null {
  const source = record(value);
  if (
    !source ||
    typeof source.id !== "string" ||
    typeof source.ko !== "string" ||
    typeof source.en !== "string"
  ) {
    return null;
  }
  const id = source.id.trim();
  const ko = source.ko.trim();
  const en = source.en.trim();
  if (!id || !ko || !en) return null;
  const acceptedVariants = Array.isArray(source.acceptedVariants)
    ? uniqueStrings(
        source.acceptedVariants.filter(
          (item): item is string => typeof item === "string",
        ),
      )
    : [];
  return { id, ko, en, acceptedVariants };
}

function quarantineIds(values: unknown[]): QuarantinedId[] {
  return values.flatMap((value) => {
    const source = record(value);
    if (!source) return [];
    const canonicalId =
      typeof source.canonicalId === "string" && source.canonicalId.trim()
        ? source.canonicalId.trim()
        : null;
    const legacyAliases = Array.isArray(source.legacyAliases)
      ? uniqueStrings(
          source.legacyAliases.filter(
            (item): item is string => typeof item === "string",
          ),
        )
      : [];
    return canonicalId || legacyAliases.length > 0
      ? [{ canonicalId, legacyAliases }]
      : [];
  });
}

function publishedEntries(
  projection: WindDownRuntimeProjection,
): MonaVnextExpression[] | null {
  const entries = projection.materials.map(staticMaterial);
  if (entries.some((entry) => !entry)) return null;
  return (entries as PublishedStaticMaterial[]).map((entry) => ({
    id: entry.id,
    ko: entry.ko,
    en: entry.en,
    ...(entry.acceptedVariants.length > 0
      ? { acceptedVariants: entry.acceptedVariants }
      : {}),
    state: "prompt" as const,
  }));
}

function normalizeRuntimeProjection(
  value: unknown,
): WindDownRuntimeProjection | null {
  try {
    assertWindDownRuntimeProjection(value);
    return publishedEntries(value) ? value : null;
  } catch {
    return null;
  }
}

function resolveIds(args: {
  values: string[];
  activeIds: Set<string>;
  aliases: Map<string, string>;
  quarantinedIds: Set<string>;
}): ResolvedIds {
  const ids: string[] = [];
  const seen = new Set<string>();
  let directResolvedCount = 0;
  let aliasResolvedCount = 0;
  let unresolvedCount = 0;
  let quarantinedCount = 0;
  const sourceIds = uniqueStrings(args.values);

  for (const persistedId of sourceIds) {
    if (args.activeIds.has(persistedId)) {
      directResolvedCount += 1;
      if (!seen.has(persistedId)) {
        seen.add(persistedId);
        ids.push(persistedId);
      }
      continue;
    }
    const canonicalId = args.aliases.get(persistedId);
    if (canonicalId && args.activeIds.has(canonicalId)) {
      aliasResolvedCount += 1;
      if (!seen.has(canonicalId)) {
        seen.add(canonicalId);
        ids.push(canonicalId);
      }
      continue;
    }
    if (
      args.quarantinedIds.has(persistedId) ||
      (canonicalId && args.quarantinedIds.has(canonicalId))
    ) {
      quarantinedCount += 1;
      continue;
    }
    unresolvedCount += 1;
  }

  return {
    ids,
    stats: {
      inputCount: sourceIds.length,
      resolvedCount: directResolvedCount + aliasResolvedCount,
      directResolvedCount,
      aliasResolvedCount,
      unresolvedCount,
      quarantinedCount,
    },
  };
}

function cloneAdvisor(
  value: WindDownLkgAdvisorOverlay,
): WindDownStudyAdvisorMetadata {
  return {
    materialId: value.materialId,
    receiptDigest: value.receiptDigest,
    requestedModel: value.requestedModel,
    responseModel: value.responseModel,
    evidence: [...value.evidence],
    enrichment: {
      chunks: [...value.enrichment.chunks],
      distractors: [...value.enrichment.distractors],
      difficultyNote: value.enrichment.difficultyNote,
      scenarioTags: [...value.enrichment.scenarioTags],
      naturalnessFlags: [...value.enrichment.naturalnessFlags],
    },
  };
}

function publishedSelection(
  projection: WindDownRuntimeProjection,
): WindDownStudyMaterialSelection | null {
  const entries = publishedEntries(projection);
  if (!entries) return null;
  const advisors = new Map(
    projection.advisorOverlay.map((entry) => [entry.materialId, entry]),
  );

  return {
    entries,
    dueExpressionIds: [],
    deferredExpressionIds: [],
    resolution: {
      due: {
        inputCount: 0,
        resolvedCount: 0,
        directResolvedCount: 0,
        aliasResolvedCount: 0,
        unresolvedCount: 0,
        quarantinedCount: 0,
      },
      deferred: {
        inputCount: 0,
        resolvedCount: 0,
        directResolvedCount: 0,
        aliasResolvedCount: 0,
        unresolvedCount: 0,
        quarantinedCount: 0,
      },
    },
    metadata: {
      source: "published-lkg",
      publicationStatus: "active",
      sourceEntryCount:
        entries.length +
        projection.quarantine.length +
        projection.lunaQuarantinedMaterialIds.length,
      activeMaterialCount: entries.length,
      quarantinedMaterialCount: projection.quarantine.length,
      lunaQuarantinedMaterialCount:
        projection.lunaQuarantinedMaterialIds.length,
      aliasMappingCount: projection.aliases.length,
      artifactDigest: projection.sourceArtifactDigest,
      contentDigest: projection.sourceContentDigest,
      advisorGate: { ...projection.advisorGate },
      advisor: {
        available: true,
        overlayCount: advisors.size,
        receiptDigests: uniqueStrings(
          projection.advisorOverlay.map((entry) => entry.receiptDigest),
        ),
        requestedModels: uniqueStrings(
          projection.advisorOverlay.map((entry) => entry.requestedModel),
        ),
        responseModels: uniqueStrings(
          projection.advisorOverlay.map((entry) => entry.responseModel),
        ),
      },
    },
    advisorForExpressionIds: (expressionIds) =>
      uniqueStrings(expressionIds).flatMap((id) => {
        const advisor = advisors.get(id);
        return advisor ? [cloneAdvisor(advisor)] : [];
      }),
  };
}

function legacyFallbackSelection(
  publicationStatus: "absent" | "invalid",
): WindDownStudyMaterialSelection {
  const approved = listTeacherApprovedMonaVnextExpressionEntries();
  return {
    entries: approved.entries,
    dueExpressionIds: [],
    deferredExpressionIds: [],
    resolution: {
      due: {
        inputCount: 0,
        resolvedCount: 0,
        directResolvedCount: 0,
        aliasResolvedCount: 0,
        unresolvedCount: 0,
        quarantinedCount: 0,
      },
      deferred: {
        inputCount: 0,
        resolvedCount: 0,
        directResolvedCount: 0,
        aliasResolvedCount: 0,
        unresolvedCount: 0,
        quarantinedCount: 0,
      },
    },
    metadata: {
      source: "legacy-fallback",
      publicationStatus,
      sourceEntryCount: approved.metadata.sourceEntryCount,
      activeMaterialCount: approved.entries.length,
      quarantinedMaterialCount: approved.metadata.materialQuarantine.length,
      lunaQuarantinedMaterialCount: 0,
      aliasMappingCount: 0,
      artifactDigest: null,
      contentDigest: null,
      advisorGate: null,
      advisor: {
        available: false,
        overlayCount: 0,
        receiptDigests: [],
        requestedModels: [],
        responseModels: [],
      },
    },
    advisorForExpressionIds: () => [],
  };
}

function withPersistedIds(args: {
  base: WindDownStudyMaterialSelection;
  dueExpressionIds: string[];
  deferredExpressionIds: string[];
  projection: WindDownRuntimeProjection | null;
}): WindDownStudyMaterialSelection {
  const activeIds = new Set(args.base.entries.map((entry) => entry.id));
  const aliases = new Map(
    args.projection?.aliases.map((entry) => [
      entry.legacyV1Id,
      entry.canonicalId,
    ]) ?? [],
  );
  const quarantinedIds = new Set<string>();
  for (const entry of quarantineIds(args.projection?.quarantine ?? [])) {
    if (entry.canonicalId) quarantinedIds.add(entry.canonicalId);
    entry.legacyAliases.forEach((alias) => quarantinedIds.add(alias));
  }
  args.projection?.lunaQuarantinedMaterialIds.forEach((materialId) =>
    quarantinedIds.add(materialId),
  );
  const due = resolveIds({
    values: args.dueExpressionIds,
    activeIds,
    aliases,
    quarantinedIds,
  });
  const deferred = resolveIds({
    values: args.deferredExpressionIds,
    activeIds,
    aliases,
    quarantinedIds,
  });
  return {
    ...args.base,
    dueExpressionIds: due.ids,
    deferredExpressionIds: deferred.ids,
    resolution: { due: due.stats, deferred: deferred.stats },
  };
}

export function buildWindDownStudyMaterialFromRuntimeProjection(args: {
  runtimeProjection: unknown;
  dueExpressionIds: string[];
  deferredExpressionIds: string[];
}): WindDownStudyMaterialSelection {
  const projection = normalizeRuntimeProjection(args.runtimeProjection);
  const base = projection
    ? publishedSelection(projection)
    : legacyFallbackSelection("invalid");
  return withPersistedIds({
    base: base ?? legacyFallbackSelection("invalid"),
    dueExpressionIds: args.dueExpressionIds,
    deferredExpressionIds: args.deferredExpressionIds,
    projection,
  });
}

export type WindDownPublishedMaterialLoadOperations = {
  readAssetText(path: string): Promise<string>;
  sha256(text: string): Promise<string>;
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const DEFAULT_LOAD_OPERATIONS: WindDownPublishedMaterialLoadOperations = {
  readAssetText: readPublicAssetText,
  sha256,
};

async function loadPublishedRuntimeProjection(
  operations: WindDownPublishedMaterialLoadOperations,
): Promise<WindDownRuntimeProjection | null> {
  if (
    WINDDOWN_PUBLISHED_LKG_BUILD.status !== "published" ||
    !WINDDOWN_PUBLISHED_LKG_BUILD.runtimeProjection
  ) {
    return null;
  }

  const pointer = WINDDOWN_PUBLISHED_LKG_BUILD.runtimeProjection;
  try {
    assertWindDownRuntimeProjectionPointer(pointer);
    if (
      WINDDOWN_PUBLISHED_LKG_BUILD.contentDigest !==
        pointer.sourceContentDigest ||
      WINDDOWN_PUBLISHED_LKG_BUILD.artifactDigest !==
        pointer.sourceArtifactDigest
    ) {
      return null;
    }
    const raw = await operations.readAssetText(pointer.assetPath);
    const parsed = JSON.parse(raw) as unknown;
    assertWindDownRuntimeProjection(parsed);
    if (
      parsed.projectionDigest !== pointer.projectionDigest ||
      parsed.sourceContentDigest !== pointer.sourceContentDigest ||
      parsed.sourceArtifactDigest !== pointer.sourceArtifactDigest
    ) {
      return null;
    }
    const calculated = await operations.sha256(
      canonicalWindDownLkgJson(windDownRuntimeProjectionBody(parsed)),
    );
    return calculated === pointer.projectionDigest ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadWindDownStudyMaterial(
  args: {
    dueExpressionIds: string[];
    deferredExpressionIds: string[];
  },
  operations: WindDownPublishedMaterialLoadOperations =
    DEFAULT_LOAD_OPERATIONS,
): Promise<WindDownStudyMaterialSelection> {
  if (
    WINDDOWN_PUBLISHED_LKG_BUILD.status !== "published" ||
    !WINDDOWN_PUBLISHED_LKG_BUILD.runtimeProjection
  ) {
    return withPersistedIds({
      base: legacyFallbackSelection("absent"),
      dueExpressionIds: args.dueExpressionIds,
      deferredExpressionIds: args.deferredExpressionIds,
      projection: null,
    });
  }
  const projection = await loadPublishedRuntimeProjection(operations);
  if (!projection) {
    return withPersistedIds({
      base: legacyFallbackSelection("invalid"),
      dueExpressionIds: args.dueExpressionIds,
      deferredExpressionIds: args.deferredExpressionIds,
      projection: null,
    });
  }
  return buildWindDownStudyMaterialFromRuntimeProjection({
    runtimeProjection: projection,
    dueExpressionIds: args.dueExpressionIds,
    deferredExpressionIds: args.deferredExpressionIds,
  });
}

/*
 * The published runtime path above is deliberately asynchronous: local Node
 * reads from public/, while Cloudflare reads the same immutable asset through
 * the ASSETS binding. Full audit LKG blobs, signed receipts, candidates, and
 * provider files are never reachable from this module.
 */
