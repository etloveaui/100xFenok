import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assertWindDownRuntimeProjection,
  canonicalWindDownLkgJson,
  windDownRuntimeProjectionBody,
  type WindDownRuntimeProjection,
} from "../src/features/winddown/content/lkgContract";
import {
  buildWindDownRuntimeProjection,
  readCurrentWindDownPublishedLkg,
} from "./generate-winddown-published-lkg";

const AUDIT_ROOT = "src/generated/winddown-published-lkg.audit";
const MAX_PATTERN_LENGTH = 160;
const MAX_THEME_LENGTH = 80;
const MAX_VARIATION_LENGTH = 240;
const MAX_VARIATIONS = 8;

const EXPECTED_AUTHORED_PRACTICE = [
  {
    id: "winddown-material-c071e288a6e7e0503aa7448e",
    pattern: "I am trying my best.",
    variationsEn: ["Are you trying your best?", "I tried my best."],
    theme: "work",
  },
  {
    id: "winddown-material-e67457ae3483424c433c4bfc",
    pattern: "Please [verb] and [verb].",
    variationsEn: [
      "Could you please like and subscribe?",
      "I liked and subscribed.",
    ],
    theme: "family-friends",
  },
] as const;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function assertPracticeMetadata(value: unknown): asserts value is {
  pattern: string | null;
  variationsEn: string[];
  theme: string | null;
} {
  assert(value && typeof value === "object" && !Array.isArray(value));
  const practice = value as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(practice).sort(),
    ["pattern", "theme", "variationsEn"],
    "practice metadata must expose only authored practice fields",
  );
  for (const [key, limit] of [
    ["pattern", MAX_PATTERN_LENGTH],
    ["theme", MAX_THEME_LENGTH],
  ] as const) {
    const item = practice[key];
    assert.equal(item === null || typeof item === "string", true);
    if (typeof item === "string") {
      assert.ok(item.trim(), `${key} must not be blank`);
      assert.equal(item, item.trim(), `${key} must stay normalized`);
      assert.ok(item.length <= limit, `${key} exceeds its publication bound`);
    }
  }
  assert.ok(Array.isArray(practice.variationsEn));
  assert.ok(practice.variationsEn.length <= MAX_VARIATIONS);
  const variations = practice.variationsEn as unknown[];
  assert.ok(
    variations.every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        item === item.trim() &&
        item.length <= MAX_VARIATION_LENGTH,
    ),
    "variationsEn must contain bounded, normalized strings",
  );
  assert.equal(
    new Set(variations).size,
    variations.length,
    "variationsEn must not contain duplicates",
  );
  assert.ok(
    practice.pattern !== null ||
      practice.theme !== null ||
      variations.length > 0,
    "an empty practice object must not be published",
  );
}

function assertPublicMaterialShape(value: unknown): void {
  assert(value && typeof value === "object" && !Array.isArray(value));
  const material = value as Record<string, unknown>;
  const keys = Object.keys(material).sort();
  assert.deepEqual(
    keys,
    keys.includes("practice")
      ? ["acceptedVariants", "en", "id", "ko", "practice"]
      : ["acceptedVariants", "en", "id", "ko"],
    "runtime material must keep the legacy fields and optionally add practice",
  );
  for (const privateField of [
    "sourceLocator",
    "legacyAliases",
    "difficulty",
    "grounded",
    "verifiedInSource",
    "provenance",
    "sourceMetadata",
    "materialWarnings",
    "staticQaStatus",
  ]) {
    assert.equal(
      Object.hasOwn(material, privateField),
      false,
      `runtime material must not expose ${privateField}`,
    );
  }
  if (Object.hasOwn(material, "practice")) {
    assertPracticeMetadata(material.practice);
  }
}

function withoutPractice(
  projection: WindDownRuntimeProjection,
): WindDownRuntimeProjection {
  const legacy = {
    ...projection,
    materials: projection.materials.map((material) => {
      const { practice: _practice, ...legacyMaterial } = material;
      return legacyMaterial;
    }),
  } as WindDownRuntimeProjection;
  return {
    ...legacy,
    projectionDigest: sha256(
      canonicalWindDownLkgJson(windDownRuntimeProjectionBody(legacy)),
    ),
  };
}

const lkg = readCurrentWindDownPublishedLkg({ lkgRoot: AUDIT_ROOT });
const projection = buildWindDownRuntimeProjection(lkg);
assertWindDownRuntimeProjection(projection);
assert.equal(projection.materials.length, lkg.materials.length);

for (const expected of EXPECTED_AUTHORED_PRACTICE) {
  const material = projection.materials.find((entry) => entry.id === expected.id);
  assert(material, `published projection is missing ${expected.id}`);
  assertPublicMaterialShape(material);
  assert.deepEqual(material.practice, {
    pattern: expected.pattern,
    variationsEn: expected.variationsEn,
    theme: expected.theme,
  });
}

assert(
  projection.materials.some((material) => "practice" in material),
  "the runtime projection must carry authored practice metadata",
);
for (const material of projection.materials) {
  assertPublicMaterialShape(material);
}

const legacyProjection = withoutPractice(projection);
assertWindDownRuntimeProjection(legacyProjection);
for (const material of legacyProjection.materials) {
  assert.deepEqual(Object.keys(material).sort(), [
    "acceptedVariants",
    "en",
    "id",
    "ko",
  ]);
  assertPublicMaterialShape(material);
}

console.log(
  `[PASS] Wind Down practice publication: ${EXPECTED_AUTHORED_PRACTICE.length} authored samples and legacy projection compatibility`,
);
