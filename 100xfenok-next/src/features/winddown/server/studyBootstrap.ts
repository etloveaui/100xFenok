import type { MonaVnextExpression } from "@/features/mona-vnext/coach/coachPolicy";
import type { WindDownMode } from "@/features/winddown/model/productContract";

export type WindDownModelFreeMode = Extract<WindDownMode, "learn" | "review">;

type StudyBootstrapArgs = {
  mode: WindDownModelFreeMode;
  seed: string;
  entries: MonaVnextExpression[];
  dueExpressionIds: string[];
  deferredExpressionIds: string[];
  count: number;
};

function uniqueIds(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueEntries(entries: MonaVnextExpression[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (!entry.id || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function seededRank(seed: string, id: string) {
  let hash = 2166136261;
  for (const character of `${seed}:${id}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function orderEntriesBySeed(entries: MonaVnextExpression[], seed: string) {
  return [...entries].sort((left, right) => (
    seededRank(seed, left.id) - seededRank(seed, right.id)
    || left.id.localeCompare(right.id)
  ));
}

export function buildWindDownStudyBootstrap(args: StudyBootstrapArgs) {
  const entries = uniqueEntries(args.entries);
  const normalizedCount = Number.isFinite(args.count) ? Math.floor(args.count) : 20;
  const count = Math.max(1, Math.min(normalizedCount, 20));
  const dueExpressionIds = uniqueIds(args.dueExpressionIds);
  const deferredExpressionIds = uniqueIds(args.deferredExpressionIds);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const knownIds = new Set([...dueExpressionIds, ...deferredExpressionIds]);
  const freshAvailableCount = entries.filter((entry) => !knownIds.has(entry.id)).length;
  const missingDueExpressionIds = dueExpressionIds.filter((id) => !byId.has(id));
  const missingDeferredExpressionIds = deferredExpressionIds.filter((id) => !byId.has(id));
  const knownInMaterialCount = entries.length - freshAvailableCount;

  if (args.mode === "review") {
    const cards = dueExpressionIds
      .map((id) => byId.get(id))
      .filter((entry): entry is MonaVnextExpression => Boolean(entry))
      .slice(0, count);
    return {
      schemaVersion: 1 as const,
      mode: args.mode,
      seed: args.seed,
      modelOpened: false as const,
      cards,
      inventory: {
        requestedCount: count,
        selectedCount: cards.length,
        profileKnownCount: knownIds.size,
        knownInMaterialCount,
        freshAvailableCount,
        insufficientFreshCount: 0,
        dueCount: dueExpressionIds.length,
        deferredCount: deferredExpressionIds.length,
        unresolvedDueCount: missingDueExpressionIds.length,
        missingDueExpressionIds,
        missingDeferredExpressionIds,
      },
    };
  }

  const fresh = entries.filter((entry) => !knownIds.has(entry.id));
  const cards = orderEntriesBySeed(fresh, args.seed).slice(0, count);
  return {
    schemaVersion: 1 as const,
    mode: args.mode,
    seed: args.seed,
    modelOpened: false as const,
    cards,
    inventory: {
      requestedCount: count,
      selectedCount: cards.length,
      profileKnownCount: knownIds.size,
      knownInMaterialCount,
      freshAvailableCount: fresh.length,
      insufficientFreshCount: Math.max(0, count - cards.length),
      dueCount: dueExpressionIds.length,
      deferredCount: deferredExpressionIds.length,
      unresolvedDueCount: missingDueExpressionIds.length,
      missingDueExpressionIds,
      missingDeferredExpressionIds,
    },
  };
}
