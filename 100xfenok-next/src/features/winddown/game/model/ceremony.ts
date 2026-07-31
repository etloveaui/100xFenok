/**
 * Versioned, server-owned naming ceremonies for the fixed Mona learner.
 *
 * The client may select only an option ID from this catalog. Unlock state and
 * one-time commit semantics are derived and enforced by the server.
 */

export const WIND_DOWN_CEREMONY_SCHEMA_VERSION = 1 as const;
export const WIND_DOWN_CEREMONY_CATALOG_VERSION = "2.0.0" as const;
export const WIND_DOWN_CEREMONY_GENERATOR_VERSION = "mastery-v2" as const;
export const WIND_DOWN_CEREMONY_LEARNER_ID = "mona" as const;
export const WIND_DOWN_CEREMONY_OPTION_TARGET = 3 as const;

export type WindDownCeremonySlotId =
  | "group"
  | "debut-song"
  | "fandom";

export type WindDownCeremonyOption = {
  readonly id: string;
  readonly label: string;
};

export type WindDownCeremonyOptionSource =
  | "mastery-derived"
  | "fallback-insufficient-mastery"
  | "unavailable";

export type WindDownCeremonyMaterialContext = {
  schemaVersion: 1;
  contentDigest: string;
  entries: Array<{
    id: string;
    en: string;
  }>;
};

export type WindDownCeremonyMasteryEvidence = {
  materialId: string;
  reviewedAtIso: string;
  stability: number;
};

export type WindDownCeremonyOptionCatalog = {
  catalogVersion: typeof WIND_DOWN_CEREMONY_CATALOG_VERSION;
  generatorVersion: typeof WIND_DOWN_CEREMONY_GENERATOR_VERSION;
  materialContentDigest: string;
  optionSetId: string;
  slots: Record<WindDownCeremonySlotId, {
    source: WindDownCeremonyOptionSource;
    options: readonly WindDownCeremonyOption[];
  }>;
};

export type WindDownCeremonySlot = {
  readonly id: WindDownCeremonySlotId;
  readonly label: string;
  readonly unlockLevel: number;
  readonly options: readonly WindDownCeremonyOption[];
};

export const WIND_DOWN_CEREMONY_SLOTS: readonly WindDownCeremonySlot[] = [
  {
    id: "group",
    label: "그룹 이름",
    unlockLevel: 7,
    options: [
      { id: "lumen", label: "LUMEN" },
      { id: "moonrise", label: "MOONRISE" },
      { id: "afterglow", label: "AFTERGLOW" },
    ],
  },
  {
    id: "debut-song",
    label: "데뷔곡",
    unlockLevel: 10,
    options: [
      { id: "first-light", label: "First Light" },
      { id: "stay-awake", label: "Stay Awake" },
      { id: "into-the-night", label: "Into the Night" },
    ],
  },
  {
    id: "fandom",
    label: "팬덤 이름",
    unlockLevel: 13,
    options: [
      { id: "glow", label: "GLOW" },
      { id: "dreamers", label: "DREAMERS" },
      { id: "moonbeam", label: "MOONBEAM" },
    ],
  },
];

export type WindDownCeremonySelection = {
  slotId: WindDownCeremonySlotId;
  optionId: string;
};

export type WindDownCeremonyChoice = {
  schemaVersion: 1;
  slotId: WindDownCeremonySlotId;
  optionId: string;
  label: string;
  levelAtCommit: number;
  committedAtIso: string;
};

export type WindDownCeremonyRecord = {
  schemaVersion: 1;
  /** Informational snapshot; schema version owns compatibility. */
  catalogVersion: string;
  learnerId: typeof WIND_DOWN_CEREMONY_LEARNER_ID;
  choices: Partial<Record<WindDownCeremonySlotId, WindDownCeremonyChoice>>;
};

export type WindDownCeremonyProjection = {
  schemaVersion: 1;
  status: "ready" | "unavailable";
  catalogVersion: typeof WIND_DOWN_CEREMONY_CATALOG_VERSION;
  generatorVersion: typeof WIND_DOWN_CEREMONY_GENERATOR_VERSION;
  optionSetId: string | null;
  learnerId: typeof WIND_DOWN_CEREMONY_LEARNER_ID;
  currentLevel: number;
  slots: Array<{
    id: WindDownCeremonySlotId;
    label: string;
    unlockLevel: number;
    unlocked: boolean;
    optionSource: WindDownCeremonyOptionSource;
    options: readonly WindDownCeremonyOption[];
    choice: WindDownCeremonyChoice | null;
  }>;
};

export type WindDownCeremonyCommitResult =
  | {
      status: "committed" | "duplicate";
      record: WindDownCeremonyRecord;
      choice: WindDownCeremonyChoice;
    }
  | {
      status: "locked" | "conflict" | "invalid" | "stale";
      record: WindDownCeremonyRecord;
      choice: WindDownCeremonyChoice | null;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && keys.every((key) => expected.includes(key));
}

function safeStoredOptionId(value: unknown) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value)
    ? value
    : null;
}

function safeDynamicOptionId(value: unknown) {
  return typeof value === "string" && /^wdc2-(group|debut-song|fandom)-[a-f0-9]{16}$/.test(value)
    ? value
    : null;
}

function safeStoredLabel(value: unknown) {
  if (typeof value !== "string") return null;
  const label = value.trim();
  return label.length >= 1
      && label.length <= 80
      && !/[\u0000-\u001f\u007f]/.test(label)
    ? label
    : null;
}

export function windDownCeremonySlot(
  slotId: unknown,
): WindDownCeremonySlot | null {
  return typeof slotId === "string"
    ? WIND_DOWN_CEREMONY_SLOTS.find((slot) => slot.id === slotId) ?? null
    : null;
}

export function windDownCeremonyOption(
  slotId: unknown,
  optionId: unknown,
  options?: readonly WindDownCeremonyOption[],
): WindDownCeremonyOption | null {
  const slot = windDownCeremonySlot(slotId);
  return slot && typeof optionId === "string"
    ? (options ?? slot.options).find((option) => option.id === optionId) ?? null
    : null;
}

export function normalizeWindDownCeremonySelection(
  value: unknown,
): WindDownCeremonySelection | null {
  if (!isRecord(value) || !hasExactKeys(value, ["slotId", "optionId"])) {
    return null;
  }
  const slot = windDownCeremonySlot(value.slotId);
  const optionId = safeStoredOptionId(value.optionId);
  const knownFallback = windDownCeremonyOption(value.slotId, value.optionId);
  return slot && optionId && (knownFallback || safeDynamicOptionId(optionId))
    ? { slotId: slot.id, optionId }
    : null;
}

export function normalizeWindDownCeremonyMaterialContext(
  value: unknown,
): WindDownCeremonyMaterialContext | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["schemaVersion", "contentDigest", "entries"])
    || value.schemaVersion !== 1
    || typeof value.contentDigest !== "string"
    || !/^[a-f0-9]{64}$/.test(value.contentDigest)
    || !Array.isArray(value.entries)
    || value.entries.length < 1
    || value.entries.length > 1_000
  ) {
    return null;
  }
  const entries: WindDownCeremonyMaterialContext["entries"] = [];
  const seen = new Set<string>();
  for (const candidate of value.entries) {
    if (
      !isRecord(candidate)
      || !hasExactKeys(candidate, ["id", "en"])
      || typeof candidate.id !== "string"
      || !/^[A-Za-z0-9._:-]{1,120}$/.test(candidate.id)
      || seen.has(candidate.id)
      || typeof candidate.en !== "string"
    ) {
      return null;
    }
    const en = candidate.en.trim().replace(/\s+/g, " ");
    if (!en || en.length > 400 || /[\u0000-\u001f\u007f]/.test(en)) {
      return null;
    }
    seen.add(candidate.id);
    entries.push({ id: candidate.id, en });
  }
  return {
    schemaVersion: 1,
    contentDigest: value.contentDigest,
    entries,
  };
}

const CEREMONY_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "but",
  "can",
  "could",
  "for",
  "from",
  "have",
  "here",
  "how",
  "into",
  "just",
  "not",
  "out",
  "same",
  "that",
  "the",
  "there",
  "this",
  "was",
  "what",
  "when",
  "where",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

const CEREMONY_LEAD_PRONOUNS = new Set([
  "he",
  "i",
  "it",
  "she",
  "they",
  "we",
  "you",
]);

const CEREMONY_LEAD_HELPERS = new Set([
  "am",
  "are",
  "can",
  "could",
  "did",
  "do",
  "does",
  "had",
  "has",
  "have",
  "hope",
  "is",
  "like",
  "may",
  "might",
  "must",
  "need",
  "plan",
  "should",
  "try",
  "want",
  "was",
  "were",
  "will",
  "would",
]);

function hash32(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hash64(value: string) {
  return [
    hash32(value, 0x811c9dc5),
    hash32(value, 0x9e3779b9),
  ].map((part) => part.toString(16).padStart(8, "0")).join("");
}

function sentenceTokens(value: string) {
  return (value.normalize("NFKD").match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [])
    .map((token) => token.replace(/'/g, "").toLowerCase())
    .filter((token) => token.length > 0 && token.length <= 16);
}

function semanticTail(value: string) {
  const tokens = sentenceTokens(value);
  if (tokens[0] === "please") tokens.shift();
  if (tokens[0] === "lets") tokens.shift();
  if (
    CEREMONY_LEAD_HELPERS.has(tokens[0] ?? "")
    && CEREMONY_LEAD_PRONOUNS.has(tokens[1] ?? "")
  ) {
    tokens.splice(0, 2);
  } else if (CEREMONY_LEAD_PRONOUNS.has(tokens[0] ?? "")) {
    tokens.shift();
    while (CEREMONY_LEAD_HELPERS.has(tokens[0] ?? "")) tokens.shift();
    if (tokens[0] === "to") tokens.shift();
  }
  if (tokens[0] === "please") tokens.shift();
  return tokens;
}

function titleCase(value: string) {
  return value.length > 0
    ? `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}`
    : value;
}

function derivedLabel(slotId: WindDownCeremonySlotId, en: string) {
  const phrase = semanticTail(en);
  const content = phrase.filter((token) =>
    token.length >= 3 && !CEREMONY_STOP_WORDS.has(token)
  );
  const root = content.at(-1);
  if (!root || phrase.length < 1) return null;
  if (slotId === "group") return root.toUpperCase();
  if (slotId === "fandom") return `${root.toUpperCase()} CREW`;
  return phrase.slice(0, 4).map(titleCase).join(" ");
}

function derivedOptions(args: {
  slotId: WindDownCeremonySlotId;
  contentDigest: string;
  materialById: ReadonlyMap<string, string>;
  mastery: readonly WindDownCeremonyMasteryEvidence[];
}) {
  const options: Array<{
    materialId: string;
    option: WindDownCeremonyOption;
  }> = [];
  const labels = new Set<string>();
  for (const evidence of args.mastery) {
    const en = args.materialById.get(evidence.materialId);
    if (!en) continue;
    const label = derivedLabel(args.slotId, en);
    if (!label || labels.has(label.toLocaleLowerCase("en-US"))) continue;
    labels.add(label.toLocaleLowerCase("en-US"));
    options.push({
      materialId: evidence.materialId,
      option: {
        id: `wdc2-${args.slotId}-${hash64([
          WIND_DOWN_CEREMONY_GENERATOR_VERSION,
          args.slotId,
          args.contentDigest,
          evidence.materialId,
          en,
          label,
        ].join("\n"))}`,
        label,
      },
    });
    if (options.length >= WIND_DOWN_CEREMONY_OPTION_TARGET) break;
  }
  return options;
}

export function buildWindDownCeremonyOptionCatalog(args: {
  material: WindDownCeremonyMaterialContext;
  mastery: readonly WindDownCeremonyMasteryEvidence[];
}): WindDownCeremonyOptionCatalog {
  const materialById = new Map(
    args.material.entries.map((entry) => [entry.id, entry.en]),
  );
  const seenMastery = new Set<string>();
  const mastery = [...args.mastery]
    .filter((evidence) =>
      materialById.has(evidence.materialId)
      && typeof evidence.reviewedAtIso === "string"
      && Number.isFinite(Date.parse(evidence.reviewedAtIso))
      && typeof evidence.stability === "number"
      && Number.isFinite(evidence.stability)
      && evidence.stability >= 0
    )
    .sort((left, right) =>
      right.stability - left.stability
      || left.reviewedAtIso.localeCompare(right.reviewedAtIso)
      || left.materialId.localeCompare(right.materialId)
    )
    .filter((evidence) => {
      if (seenMastery.has(evidence.materialId)) return false;
      seenMastery.add(evidence.materialId);
      return true;
    });
  const slots = {} as WindDownCeremonyOptionCatalog["slots"];
  const assignedMaterialIds = new Set<string>();
  for (const slot of WIND_DOWN_CEREMONY_SLOTS) {
    const derived = derivedOptions({
      slotId: slot.id,
      contentDigest: args.material.contentDigest,
      materialById,
      mastery: mastery.filter(
        (evidence) => !assignedMaterialIds.has(evidence.materialId),
      ),
    });
    if (derived.length >= WIND_DOWN_CEREMONY_OPTION_TARGET) {
      derived.forEach((candidate) =>
        assignedMaterialIds.add(candidate.materialId)
      );
      slots[slot.id] = {
        source: "mastery-derived",
        options: derived.map((candidate) => candidate.option),
      };
    } else {
      slots[slot.id] = {
        source: "fallback-insufficient-mastery",
        options: slot.options,
      };
    }
  }
  const optionSetId = `wdc2set-${hash64(JSON.stringify(
    {
      generatorVersion: WIND_DOWN_CEREMONY_GENERATOR_VERSION,
      materialContentDigest: args.material.contentDigest,
      slots: WIND_DOWN_CEREMONY_SLOTS.map((slot) => ({
        slotId: slot.id,
        source: slots[slot.id].source,
        options: slots[slot.id].options,
      })),
    },
  ))}`;
  return {
    catalogVersion: WIND_DOWN_CEREMONY_CATALOG_VERSION,
    generatorVersion: WIND_DOWN_CEREMONY_GENERATOR_VERSION,
    materialContentDigest: args.material.contentDigest,
    optionSetId,
    slots,
  };
}

export function createEmptyWindDownCeremonyRecord(): WindDownCeremonyRecord {
  return {
    schemaVersion: WIND_DOWN_CEREMONY_SCHEMA_VERSION,
    catalogVersion: WIND_DOWN_CEREMONY_CATALOG_VERSION,
    learnerId: WIND_DOWN_CEREMONY_LEARNER_ID,
    choices: {},
  };
}

function normalizeChoice(
  value: unknown,
  expectedSlotId: WindDownCeremonySlotId,
): WindDownCeremonyChoice | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "schemaVersion",
      "slotId",
      "optionId",
      "label",
      "levelAtCommit",
      "committedAtIso",
    ])
    || value.schemaVersion !== WIND_DOWN_CEREMONY_SCHEMA_VERSION
    || value.slotId !== expectedSlotId
  ) {
    return null;
  }
  const slot = windDownCeremonySlot(value.slotId);
  const optionId = safeStoredOptionId(value.optionId);
  const label = safeStoredLabel(value.label);
  const committedAtMs =
    typeof value.committedAtIso === "string"
      ? Date.parse(value.committedAtIso)
      : Number.NaN;
  if (
    !slot
    || !optionId
    || !label
    || !Number.isInteger(value.levelAtCommit)
    || (value.levelAtCommit as number) < slot.unlockLevel
    || !Number.isFinite(committedAtMs)
  ) {
    return null;
  }
  return {
    schemaVersion: WIND_DOWN_CEREMONY_SCHEMA_VERSION,
    slotId: slot.id,
    optionId,
    label,
    levelAtCommit: value.levelAtCommit as number,
    committedAtIso: new Date(committedAtMs).toISOString(),
  };
}

export function normalizeWindDownCeremonyRecord(
  value: unknown,
): WindDownCeremonyRecord | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "schemaVersion",
      "catalogVersion",
      "learnerId",
      "choices",
    ])
    || value.schemaVersion !== WIND_DOWN_CEREMONY_SCHEMA_VERSION
    || typeof value.catalogVersion !== "string"
    || !/^\d+\.\d+\.\d+$/.test(value.catalogVersion)
    || value.learnerId !== WIND_DOWN_CEREMONY_LEARNER_ID
    || !isRecord(value.choices)
  ) {
    return null;
  }
  const choiceKeys = Object.keys(value.choices);
  if (
    choiceKeys.some((key) => !WIND_DOWN_CEREMONY_SLOTS.some(
      (slot) => slot.id === key,
    ))
  ) {
    return null;
  }
  const choices: WindDownCeremonyRecord["choices"] = {};
  for (const slot of WIND_DOWN_CEREMONY_SLOTS) {
    const candidate = value.choices[slot.id];
    if (candidate === undefined) continue;
    const choice = normalizeChoice(candidate, slot.id);
    if (!choice) return null;
    choices[slot.id] = choice;
  }
  return {
    schemaVersion: WIND_DOWN_CEREMONY_SCHEMA_VERSION,
    catalogVersion: value.catalogVersion,
    learnerId: WIND_DOWN_CEREMONY_LEARNER_ID,
    choices,
  };
}

export function projectWindDownCeremony(
  record: WindDownCeremonyRecord,
  currentLevel: number,
  catalog: WindDownCeremonyOptionCatalog,
): WindDownCeremonyProjection {
  const level = Number.isInteger(currentLevel) && currentLevel >= 1
    ? currentLevel
    : 1;
  return {
    schemaVersion: WIND_DOWN_CEREMONY_SCHEMA_VERSION,
    status: "ready",
    catalogVersion: WIND_DOWN_CEREMONY_CATALOG_VERSION,
    generatorVersion: WIND_DOWN_CEREMONY_GENERATOR_VERSION,
    optionSetId: catalog.optionSetId,
    learnerId: WIND_DOWN_CEREMONY_LEARNER_ID,
    currentLevel: level,
    slots: WIND_DOWN_CEREMONY_SLOTS.map((slot) => {
      const generated = catalog.slots[slot.id];
      return {
        id: slot.id,
        label: slot.label,
        unlockLevel: slot.unlockLevel,
        unlocked: level >= slot.unlockLevel,
        optionSource: generated.source,
        options: level >= slot.unlockLevel ? generated.options : [],
        choice: record.choices[slot.id] ?? null,
      };
    }),
  };
}

export function projectUnavailableWindDownCeremony(
  record: WindDownCeremonyRecord,
  currentLevel: number,
): WindDownCeremonyProjection {
  const level = Number.isInteger(currentLevel) && currentLevel >= 1
    ? currentLevel
    : 1;
  return {
    schemaVersion: WIND_DOWN_CEREMONY_SCHEMA_VERSION,
    status: "unavailable",
    catalogVersion: WIND_DOWN_CEREMONY_CATALOG_VERSION,
    generatorVersion: WIND_DOWN_CEREMONY_GENERATOR_VERSION,
    optionSetId: null,
    learnerId: WIND_DOWN_CEREMONY_LEARNER_ID,
    currentLevel: level,
    slots: WIND_DOWN_CEREMONY_SLOTS.map((slot) => ({
      id: slot.id,
      label: slot.label,
      unlockLevel: slot.unlockLevel,
      unlocked: level >= slot.unlockLevel,
      optionSource: "unavailable",
      options: [],
      choice: record.choices[slot.id] ?? null,
    })),
  };
}

export function normalizeWindDownCeremonyProjection(
  value: unknown,
): WindDownCeremonyProjection | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== WIND_DOWN_CEREMONY_SCHEMA_VERSION
    || (value.status !== "ready" && value.status !== "unavailable")
    || value.catalogVersion !== WIND_DOWN_CEREMONY_CATALOG_VERSION
    || value.generatorVersion !== WIND_DOWN_CEREMONY_GENERATOR_VERSION
    || (
      value.status === "ready"
        ? typeof value.optionSetId !== "string"
          || !/^wdc2set-[a-f0-9]{16}$/.test(value.optionSetId)
        : value.optionSetId !== null
    )
    || value.learnerId !== WIND_DOWN_CEREMONY_LEARNER_ID
    || !Number.isInteger(value.currentLevel)
    || (value.currentLevel as number) < 1
    || !Array.isArray(value.slots)
    || value.slots.length !== WIND_DOWN_CEREMONY_SLOTS.length
  ) {
    return null;
  }
  const status = value.status;
  const currentLevel = value.currentLevel as number;
  const slots: WindDownCeremonyProjection["slots"] = [];
  for (const expected of WIND_DOWN_CEREMONY_SLOTS) {
    const candidate = value.slots.find(
      (slot) => isRecord(slot) && slot.id === expected.id,
    );
    const unlocked = currentLevel >= expected.unlockLevel;
    if (
      !isRecord(candidate)
      || candidate.label !== expected.label
      || candidate.unlockLevel !== expected.unlockLevel
      || candidate.unlocked !== unlocked
      || !Array.isArray(candidate.options)
      || (
        status === "unavailable"
          ? candidate.optionSource !== "unavailable"
            || candidate.options.length !== 0
          : (
              candidate.optionSource !== "mastery-derived"
              && candidate.optionSource !== "fallback-insufficient-mastery"
            )
            || candidate.options.length !== (unlocked
              ? WIND_DOWN_CEREMONY_OPTION_TARGET
              : 0)
      )
    ) {
      return null;
    }
    const options: WindDownCeremonyOption[] = [];
    for (const optionValue of candidate.options) {
      if (!isRecord(optionValue)) return null;
      const id = safeStoredOptionId(optionValue.id);
      const label = safeStoredLabel(optionValue.label);
      if (!id || !label) return null;
      const fallbackOption = windDownCeremonyOption(expected.id, id);
      if (
        candidate.optionSource === "mastery-derived"
          ? !safeDynamicOptionId(id)
          : !fallbackOption || fallbackOption.label !== label
      ) return null;
      options.push({ id, label });
    }
    const choice = candidate.choice === null
      ? null
      : normalizeChoice(candidate.choice, expected.id);
    if (candidate.choice !== null && !choice) return null;
    slots.push({
      id: expected.id,
      label: expected.label,
      unlockLevel: expected.unlockLevel,
      unlocked,
      optionSource: candidate.optionSource as WindDownCeremonyOptionSource,
      options,
      choice,
    });
  }
  return {
    schemaVersion: WIND_DOWN_CEREMONY_SCHEMA_VERSION,
    status,
    catalogVersion: WIND_DOWN_CEREMONY_CATALOG_VERSION,
    generatorVersion: WIND_DOWN_CEREMONY_GENERATOR_VERSION,
    optionSetId: value.optionSetId as string | null,
    learnerId: WIND_DOWN_CEREMONY_LEARNER_ID,
    currentLevel,
    slots,
  };
}

export function commitWindDownCeremonyChoice(args: {
  record: WindDownCeremonyRecord;
  selection: WindDownCeremonySelection;
  currentLevel: number;
  committedAtIso: string;
  catalog: WindDownCeremonyOptionCatalog;
}): WindDownCeremonyCommitResult {
  const slot = windDownCeremonySlot(args.selection.slotId);
  const committedAtMs = Date.parse(args.committedAtIso);
  if (
    !slot
    || !Number.isInteger(args.currentLevel)
    || args.currentLevel < 1
    || !Number.isFinite(committedAtMs)
  ) {
    return { status: "invalid", record: args.record, choice: null };
  }
  const existing = args.record.choices[slot.id] ?? null;
  if (existing) {
    return existing.optionId === args.selection.optionId
      ? { status: "duplicate", record: args.record, choice: existing }
      : { status: "conflict", record: args.record, choice: existing };
  }
  if (args.currentLevel < slot.unlockLevel) {
    return { status: "locked", record: args.record, choice: null };
  }
  const option = windDownCeremonyOption(
    slot.id,
    args.selection.optionId,
    args.catalog.slots[slot.id].options,
  );
  if (!option) {
    return { status: "stale", record: args.record, choice: null };
  }
  const choice: WindDownCeremonyChoice = {
    schemaVersion: WIND_DOWN_CEREMONY_SCHEMA_VERSION,
    slotId: slot.id,
    optionId: option.id,
    label: option.label,
    levelAtCommit: args.currentLevel,
    committedAtIso: new Date(committedAtMs).toISOString(),
  };
  return {
    status: "committed",
    record: {
      ...args.record,
      catalogVersion: WIND_DOWN_CEREMONY_CATALOG_VERSION,
      choices: {
        ...args.record.choices,
        [slot.id]: choice,
      },
    },
    choice,
  };
}
