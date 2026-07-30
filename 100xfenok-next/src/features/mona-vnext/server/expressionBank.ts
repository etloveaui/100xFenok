import expressionBankArtifact from "@/features/mona-vnext/coach/expressionBank.generated.json";
import type {
  MonaVnextExpression,
  MonaVnextSessionExpressionBank,
} from "@/features/mona-vnext/coach/coachPolicy";

export const MONA_VNEXT_SESSION_EXPRESSION_COUNT = 20;
export const MONA_VNEXT_SESSION_BANK_STRATEGY = "fnv1a-seeded-score-v1";

type GeneratedExpressionBankArtifact = {
  source: string;
  updatedAt: string | null;
  sourceEntryCount: number;
  eligibleEntryCount: number;
  entries: MonaVnextExpression[];
};

const artifact = expressionBankArtifact as GeneratedExpressionBankArtifact;

function hash32(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizeSeed(value: string) {
  return value.trim().replace(/\s+/g, "-").slice(0, 160) || "mona-vnext-session";
}

export function buildMonaVnextSessionBankSeed(args: {
  startedAt: Date;
  conversationId: string;
}) {
  return normalizeSeed(`${args.startedAt.toISOString().slice(0, 10)}:${args.conversationId}`);
}

export function listMonaVnextGeneratedExpressionEntries(): MonaVnextExpression[] {
  return artifact.entries.map((entry) => ({ ...entry, state: "prompt" }));
}

export function buildMonaVnextSessionExpressionBank(args: {
  seed: string;
  count?: number;
  entries?: MonaVnextExpression[];
  prioritizedExpressionIds?: string[];
  deferredExpressionIds?: string[];
  metadata?: Partial<MonaVnextSessionExpressionBank["metadata"]>;
}): MonaVnextSessionExpressionBank {
  const seed = normalizeSeed(args.seed);
  const sourceEntries = args.entries ?? artifact.entries;
  const count = sourceEntries.length === 0
    ? 0
    : Math.max(1, Math.min(args.count ?? MONA_VNEXT_SESSION_EXPRESSION_COUNT, sourceEntries.length));
  const byId = new Map(sourceEntries.map((entry) => [entry.id, entry]));
  const prioritizedIds = [...new Set(args.prioritizedExpressionIds ?? [])]
    .filter((id) => byId.has(id));
  const prioritySet = new Set(prioritizedIds);
  const deferredSet = new Set(args.deferredExpressionIds ?? []);
  const prioritizedEntries = prioritizedIds
    .map((id) => byId.get(id))
    .filter((entry): entry is MonaVnextExpression => Boolean(entry))
    .slice(0, count);
  const remaining = sourceEntries.filter((entry) => !prioritySet.has(entry.id));
  const preferred = remaining.filter((entry) => !deferredSet.has(entry.id));
  const deferred = remaining.filter((entry) => deferredSet.has(entry.id));
  const ranked = [...preferred, ...deferred]
    .map((entry) => ({
      entry,
      score: hash32(`${seed}:${entry.id}`),
      deferred: deferredSet.has(entry.id),
    }))
    .sort((a, b) => Number(a.deferred) - Number(b.deferred) || a.score - b.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, Math.max(0, count - prioritizedEntries.length))
    .map(({ entry }) => ({ ...entry, state: "prompt" as const }));
  const entries = [
    ...prioritizedEntries.map((entry) => ({ ...entry, state: "prompt" as const })),
    ...ranked,
  ];

  return {
    metadata: {
      source: artifact.source,
      updatedAt: artifact.updatedAt,
      sourceEntryCount: artifact.sourceEntryCount,
      eligibleEntryCount: sourceEntries.length,
      selectedCount: entries.length,
      seed,
      strategy: MONA_VNEXT_SESSION_BANK_STRATEGY,
      reviewPriorityCount: prioritizedEntries.length,
      deferredExcludedCount: deferred.filter((entry) => !entries.some((selected) => selected.id === entry.id)).length,
      ...args.metadata,
    },
    entries,
  };
}
