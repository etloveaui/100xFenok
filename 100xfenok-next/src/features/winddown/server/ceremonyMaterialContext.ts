import {
  normalizeWindDownCeremonyMaterialContext,
  type WindDownCeremonyMaterialContext,
} from "@/features/winddown/game/model/ceremony";
import {
  loadWindDownStudyMaterial,
} from "@/features/winddown/server/publishedMaterialAdapter";

export class WindDownCeremonyMaterialError extends Error {
  constructor(
    readonly code: "WINDDOWN_CEREMONY_MATERIAL_UNAVAILABLE",
    readonly status: 503,
  ) {
    super(code);
    this.name = "WindDownCeremonyMaterialError";
  }
}

export async function loadWindDownCeremonyMaterialContext():
  Promise<WindDownCeremonyMaterialContext> {
  const material = await loadWindDownStudyMaterial({
    dueExpressionIds: [],
    deferredExpressionIds: [],
  });
  if (
    material.metadata.source !== "published-lkg"
    || material.metadata.publicationStatus !== "active"
    || !material.metadata.contentDigest
  ) {
    throw new WindDownCeremonyMaterialError(
      "WINDDOWN_CEREMONY_MATERIAL_UNAVAILABLE",
      503,
    );
  }
  const context = normalizeWindDownCeremonyMaterialContext({
    schemaVersion: 1,
    contentDigest: material.metadata.contentDigest,
    entries: material.entries.map((entry) => ({
      id: entry.id,
      en: entry.en,
    })),
  });
  if (!context) {
    throw new WindDownCeremonyMaterialError(
      "WINDDOWN_CEREMONY_MATERIAL_UNAVAILABLE",
      503,
    );
  }
  return context;
}
