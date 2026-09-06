import type { MonaVnextExpression } from "@/features/mona-vnext/coach/coachPolicy";
import {
  normalizeWindDownLearnState,
  type WindDownLearnState,
} from "@/features/winddown/learn/engine";
import {
  normalizeWindDownLearnSessionManifest,
  type WindDownLearnSessionManifest,
} from "@/features/winddown/server/learnSessionProof";

export type WindDownLearnResumeInput = {
  entries: readonly MonaVnextExpression[];
  manifest: unknown;
  state: unknown;
  habitKstDay: string;
  contentDigest: string;
  now: Date;
};

export type WindDownLearnResume = {
  manifest: WindDownLearnSessionManifest;
  cards: MonaVnextExpression[];
  state: WindDownLearnState;
};

function validMaterialEntry(
  value: unknown,
): value is MonaVnextExpression {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return typeof source.id === "string"
    && source.id.trim() === source.id
    && source.id.length > 0
    && typeof source.ko === "string"
    && source.ko.trim() === source.ko
    && source.ko.length > 0
    && typeof source.en === "string"
    && source.en.trim() === source.en
    && source.en.length > 0
    && (
      source.state === "prompt"
      || source.state === "reveal"
      || source.state === "repair"
    )
    && (
      source.acceptedVariants === undefined
      || (
        Array.isArray(source.acceptedVariants)
        && source.acceptedVariants.every((item) => typeof item === "string")
      )
    );
}

function canonicalMaterialEntry(
  value: MonaVnextExpression,
): MonaVnextExpression {
  return {
    id: value.id,
    ko: value.ko,
    en: value.en,
    state: value.state,
    ...(value.acceptedVariants
      ? { acceptedVariants: [...value.acceptedVariants] }
      : {}),
  };
}

/**
 * Select a current five-card material set and validate its durable Learn
 * state. A null result is recoverable by the route, which must never issue a
 * replacement session when an active session exists but cannot be trusted.
 */
export function selectWindDownLearnResume(
  args: WindDownLearnResumeInput,
): WindDownLearnResume | null {
  if (
    !Number.isFinite(args.now.getTime())
    || typeof args.habitKstDay !== "string"
    || typeof args.contentDigest !== "string"
    || !Array.isArray(args.entries)
  ) return null;
  const manifest = normalizeWindDownLearnSessionManifest(args.manifest);
  if (!manifest) return null;
  if (
    manifest.habitKstDay !== args.habitKstDay
    || manifest.contentDigest !== args.contentDigest
    || Date.parse(manifest.issuedAtIso) > args.now.getTime() + 30_000
    || Date.parse(manifest.expiresAtIso) <= args.now.getTime()
  ) return null;

  const byId = new Map<string, MonaVnextExpression>();
  for (const entry of args.entries) {
    if (!validMaterialEntry(entry)) continue;
    if (byId.has(entry.id)) continue;
    byId.set(entry.id, canonicalMaterialEntry(entry));
  }
  const cards = manifest.cardIds.flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
  if (cards.length !== manifest.cardIds.length) return null;
  const state = normalizeWindDownLearnState(args.state, {
    cards,
    seed: manifest.seed,
  });
  if (!state) return null;
  return { manifest, cards, state };
}
