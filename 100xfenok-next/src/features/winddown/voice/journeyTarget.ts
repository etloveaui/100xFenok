import {
  containsWindDownVoiceUnsafeText,
} from "@/features/winddown/voice/product";

export type WindDownVoiceJourneyTarget = {
  materialId: string;
  en: string;
  acceptedVariants: string[];
};

const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const TARGET_KEYS = new Set(["materialId", "en", "acceptedVariants"]);

function cleanPhrase(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized && normalized.length <= 240 ? normalized : null;
}

export function normalizeWindDownVoiceJourneyTargets(
  value: unknown,
): WindDownVoiceJourneyTarget[] | null {
  if (!Array.isArray(value) || value.length > 2) return null;
  const targets: WindDownVoiceJourneyTarget[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const source = item as Record<string, unknown>;
    if (
      Object.keys(source).length !== TARGET_KEYS.size
      || !Object.keys(source).every((key) => TARGET_KEYS.has(key))
      || typeof source.materialId !== "string"
      || !SAFE_ID.test(source.materialId)
    ) return null;
    const en = cleanPhrase(source.en);
    const acceptedVariants = Array.isArray(source.acceptedVariants)
      ? source.acceptedVariants.flatMap((variant) => {
          const cleaned = cleanPhrase(variant);
          return cleaned ? [cleaned] : [];
        })
      : null;
    if (!en || !acceptedVariants || acceptedVariants.length > 8) return null;
    targets.push({
      materialId: source.materialId,
      en,
      acceptedVariants: [...new Set(acceptedVariants)],
    });
  }
  return new Set(targets.map((target) => target.materialId)).size === targets.length
    ? targets
    : null;
}

function normalizedWords(value: string) {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[’]/g, "'")
    .match(/[a-z0-9]+(?:'[a-z0-9]+)*/g)
    ?.join(" ") ?? "";
}

function containsWholePhrase(learner: string, phrase: string) {
  return learner === phrase
    || learner.startsWith(`${phrase} `)
    || learner.endsWith(` ${phrase}`)
    || learner.includes(` ${phrase} `);
}

export function windDownVoiceJourneyTargetEvidence(args: {
  targets: readonly WindDownVoiceJourneyTarget[];
  turns: readonly {
    userText: string | null;
    finalized: boolean;
    sttDrift: boolean;
    interrupted: boolean;
  }[];
}) {
  for (const turn of args.turns) {
    if (
      !turn.finalized
      || turn.sttDrift
      || turn.interrupted
      || !turn.userText
      || containsWindDownVoiceUnsafeText(turn.userText)
    ) continue;
    const learner = normalizedWords(turn.userText);
    for (const target of args.targets) {
      const matchedPhrase = [target.en, ...target.acceptedVariants]
        .map(normalizedWords)
        .find((phrase) => phrase.length > 0 && containsWholePhrase(learner, phrase));
      if (matchedPhrase) {
        return { materialId: target.materialId, matchedPhrase };
      }
    }
  }
  return null;
}
