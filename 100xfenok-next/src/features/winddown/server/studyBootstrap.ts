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
  learningProfile?: unknown;
  practice?: readonly { materialId: string; pattern: string | null; theme: string | null; variationsEn: readonly string[] }[];
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

type EvidenceRecord = { expressionId: string; lastRating: string; lastInputMode?: string; lastReviewedAt?: string };
function rankForLearner(entries: MonaVnextExpression[], args: StudyBootstrapArgs) {
  const seeded = orderEntriesBySeed(entries, args.seed);
  if (args.learningProfile === undefined) return { cards: seeded, basis: "rotation" as const };
  const profile = args.learningProfile as { records?: Record<string, unknown> } | null;
  const records = Object.values(profile?.records ?? {}).filter((value): value is EvidenceRecord => {
    const r = value as Partial<EvidenceRecord> | null;
    return !!r && typeof r.expressionId === "string" && ["again", "hard", "good"].includes(r.lastRating ?? "");
  }).sort((a, b) => String(b.lastReviewedAt ?? "").localeCompare(String(a.lastReviewedAt ?? ""))).slice(0, 24);
  const published = new Map(args.entries.map(entry => [entry.id, entry]));
  const metadata = new Map((args.practice ?? []).map(item => [item.materialId, item]));
  const weak = records.filter(r => r.lastRating === "again" || r.lastRating === "hard").filter(r => published.has(r.expressionId));
  const mastered = records.filter(r => r.lastRating === "good" && r.lastInputMode === "typed").filter(r => published.has(r.expressionId));
  const wordCount = (text: string) => text.match(/[a-z]+(?:['’][a-z]+)*/gi)?.length ?? 0;
  const reference = weak.length ? weak : mastered;
  const lengths = reference.map(r => wordCount(published.get(r.expressionId)!.en)).sort((a, b) => a - b);
  // Length is a pacing proxy, never a CEFR/proficiency claim.
  const targetLength = Math.max(4, Math.min(16, (lengths[Math.floor(lengths.length / 2)] ?? 6) + (weak.length ? -1 : mastered.length >= 3 ? 2 : 0)));
  const relation = (entry: MonaVnextExpression) => {
    const candidate = metadata.get(entry.id);
    return weak.reduce((score, record) => {
      const source = metadata.get(record.expressionId);
      if (!candidate || !source) return score;
      const severity = record.lastRating === "again" ? 3 : 1;
      return score + severity * (candidate.pattern && candidate.pattern === source.pattern ? 100 : candidate.theme && candidate.theme === source.theme ? 20 : 0);
    }, 0);
  };
  const cards = [...seeded].sort((a, b) => relation(b) - relation(a)
    || Math.abs(wordCount(a.en) - targetLength) - Math.abs(wordCount(b.en) - targetLength));
  const related = cards.slice(0, args.count).some(entry => relation(entry) > 0);
  return { cards, basis: related ? "review-patterns" as const : reference.length ? "review-pace" as const : "starter" as const };
}

export function buildWindDownStudyBootstrap(args: StudyBootstrapArgs) {
  const entries = uniqueEntries(args.entries);
  const normalizedCount = Number.isFinite(args.count) ? Math.floor(args.count) : 20;
  const count = args.mode === "review"
    ? Math.max(0, Math.min(normalizedCount, 20))
    : Math.max(1, Math.min(normalizedCount, 20));
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
  const ranked = rankForLearner(fresh, { ...args, count });
  const cards = ranked.cards.slice(0, count);
  return {
    schemaVersion: 1 as const,
    mode: args.mode,
    seed: args.seed,
    modelOpened: false as const,
    cards,
    selectionBasis: ranked.basis,
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
