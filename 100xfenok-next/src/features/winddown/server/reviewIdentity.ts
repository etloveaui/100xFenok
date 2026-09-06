import type { WindDownLkgAliasEntry } from "../content/lkgContract";
import {
  normalizeMonaVnextLearningProfile,
  type MonaVnextLearningProfile,
  type MonaVnextLearningRecord,
} from "../../mona-vnext/memory/fsrsLearningProfile";

export type WindDownReviewAlias = WindDownLkgAliasEntry;

export type WindDownResolvedLearningRecord = {
  canonicalId: string;
  recordKey: string;
  record: MonaVnextLearningRecord;
  source: "canonical" | "legacy-alias";
};

function latestReviewFirst(
  left: WindDownResolvedLearningRecord,
  right: WindDownResolvedLearningRecord,
) {
  return Date.parse(right.record.lastReviewedAt) - Date.parse(left.record.lastReviewedAt)
    || left.recordKey.localeCompare(right.recordKey);
}

export type WindDownLearningRecordResolver = {
  profile: MonaVnextLearningProfile;
  recordKeys: readonly string[];
  resolve(canonicalId: string): WindDownResolvedLearningRecord | null;
};

/** Prepare one normalized profile and alias index for a batch of lookups. */
export function prepareWindDownLearningRecordResolver(args: {
  profile: MonaVnextLearningProfile;
  aliases?: readonly WindDownReviewAlias[];
}): WindDownLearningRecordResolver {
  const profile = normalizeMonaVnextLearningProfile(args.profile);
  const aliasesByCanonical = new Map<string, string[]>();
  for (const alias of args.aliases ?? []) {
    const legacyIds = aliasesByCanonical.get(alias.canonicalId) ?? [];
    legacyIds.push(alias.legacyV1Id);
    aliasesByCanonical.set(alias.canonicalId, legacyIds);
  }
  for (const legacyIds of aliasesByCanonical.values()) {
    legacyIds.sort((left, right) => left.localeCompare(right));
  }

  return {
    profile,
    recordKeys: Object.keys(profile.records),
    resolve(canonicalId) {
      const canonical = profile.records[canonicalId];
      if (canonical) {
        return {
          canonicalId,
          recordKey: canonicalId,
          record: canonical,
          source: "canonical",
        };
      }
      const candidates = (aliasesByCanonical.get(canonicalId) ?? [])
        .flatMap((recordKey) => {
          const record = profile.records[recordKey];
          return record
            ? [{ canonicalId, recordKey, record, source: "legacy-alias" as const }]
            : [];
        });
      return candidates.sort(latestReviewFirst)[0] ?? null;
    },
  };
}

/**
 * Resolve one canonical material id without rewriting the profile. Canonical
 * keys always win. With several legacy aliases, the latest reviewed record
 * wins; equal timestamps use the lexical profile key for deterministic output.
 */
export function resolveWindDownLearningRecord(args: {
  profile: MonaVnextLearningProfile;
  canonicalId: string;
  aliases?: readonly WindDownReviewAlias[];
}): WindDownResolvedLearningRecord | null {
  return prepareWindDownLearningRecordResolver(args).resolve(args.canonicalId);
}

export type WindDownReviewProfileSelection = {
  dueExpressionIds: string[];
  deferredExpressionIds: string[];
};

/**
 * Classify active canonical materials through the same record resolver used by
 * review cards and commits, preventing a due legacy record from overriding a
 * canonical record whose own schedule is deferred.
 */
export function classifyWindDownReviewProfile(args: {
  profile: MonaVnextLearningProfile;
  activeMaterialIds: Iterable<string>;
  aliases?: readonly WindDownReviewAlias[];
  nowIso: string;
}): WindDownReviewProfileSelection {
  const nowMs = Date.parse(args.nowIso);
  if (!Number.isFinite(nowMs)) throw new Error("INVALID_REVIEW_CYCLE");
  const resolver = prepareWindDownLearningRecordResolver({
    profile: args.profile,
    aliases: args.aliases,
  });
  const selected = [...new Set(args.activeMaterialIds)]
    .flatMap((canonicalId) => {
      const resolved = resolver.resolve(canonicalId);
      return resolved ? [resolved] : [];
    })
    .sort((left, right) =>
      Date.parse(left.record.card.dueAtIso) - Date.parse(right.record.card.dueAtIso)
      || left.canonicalId.localeCompare(right.canonicalId)
    );
  return {
    dueExpressionIds: selected
      .filter((resolved) => Date.parse(resolved.record.card.dueAtIso) <= nowMs)
      .map((resolved) => resolved.canonicalId),
    deferredExpressionIds: selected
      .filter((resolved) => Date.parse(resolved.record.card.dueAtIso) > nowMs)
      .map((resolved) => resolved.canonicalId),
  };
}
