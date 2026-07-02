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

export function buildMonaVnextSessionExpressionBank(args: {
  seed: string;
  count?: number;
}): MonaVnextSessionExpressionBank {
  const seed = normalizeSeed(args.seed);
  const count = Math.max(1, Math.min(args.count ?? MONA_VNEXT_SESSION_EXPRESSION_COUNT, artifact.entries.length));
  const entries = artifact.entries
    .map((entry) => ({
      entry,
      score: hash32(`${seed}:${entry.id}`),
    }))
    .sort((a, b) => a.score - b.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, count)
    .map(({ entry }) => ({ ...entry, state: "prompt" as const }));

  return {
    metadata: {
      source: artifact.source,
      updatedAt: artifact.updatedAt,
      sourceEntryCount: artifact.sourceEntryCount,
      eligibleEntryCount: artifact.eligibleEntryCount,
      selectedCount: entries.length,
      seed,
      strategy: MONA_VNEXT_SESSION_BANK_STRATEGY,
    },
    entries,
  };
}
