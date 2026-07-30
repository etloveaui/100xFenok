import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildWindDownLunaBatchManifest,
  buildWindDownMaterialArtifactV2,
  resolveWindDownMaterialId,
  verifyWindDownMaterialArtifactDigest,
  type WindDownMaterialSourceRow,
} from "../src/features/winddown/content/materialIdentity";
import {
  legacyV1ExpressionId,
  runWindDownMaterialBootstrapCommand,
} from "./build-winddown-material-v2";

const source = {
  namespace: "mona-life",
  source: "mona-life-expression-bank",
  sourcePath: "mona-life/data/english/expression-bank.json",
  sourceRevision: "2026-07-31",
};

function row(overrides: Partial<WindDownMaterialSourceRow> = {}): WindDownMaterialSourceRow {
  return {
    legacyV1Id: "mona-life-v1-42",
    ko: "아직도 비가 와.",
    en: "It is still raining.",
    acceptedVariants: ["It is still raining."],
    difficulty: 1,
    grounded: true,
    verifiedInSource: true,
    provenance: {
      namespace: "mona-life",
      source: "mona-life-expression-bank",
      sourcePath: "mona-life/data/english/expression-bank.json",
      sourceRecordId: "42",
      sourceRevision: "2026-07-31",
    },
    materialWarnings: ["human_reviewed"],
    ...overrides,
  };
}

const original = buildWindDownMaterialArtifactV2({
  source,
  mode: "legacy-v1-bootstrap",
  generatedAt: "2026-07-31T00:00:00.000Z",
  rows: [
    row(),
    row({
      legacyV1Id: "mona-life-v1-43",
      ko: "다시 한 번 말해줄래?",
      en: "Can you say that again?",
      provenance: {
        namespace: "mona-life",
        source: "mona-life-expression-bank",
        sourcePath: "mona-life/data/english/expression-bank.json",
        sourceRecordId: "43",
        sourceRevision: "2026-07-31",
      },
    }),
  ],
});

assert.equal(original.schemaVersion, 2, "the material artifact must be explicitly versioned");
assert.equal(original.mode, "legacy-v1-bootstrap");
assert.equal(original.materials.length, 2);
assert.equal(original.quarantine.length, 0);
assert.equal(verifyWindDownMaterialArtifactDigest(original), true);
assert.deepEqual(original.migration.legacyAliasBootstrap, {
  sourceSchemaVersion: 1,
  policy: "record-v1-aliases-once",
  locatorStrategy: "frozen-legacy-v1-namespaced",
});
assert.deepEqual(original.migration.legacyAliasCoverage, {
  expectedCount: 2,
  mappedCount: 2,
  missingCount: 0,
  unaliasedRowCount: 0,
  missingAliases: [],
  status: "complete",
});
assert.equal(
  original.materials.find((material) => material.legacyAliases[0] === "mona-life-v1-42")?.sourceLocator,
  "legacy-v1:mona-life:mona-life-v1-42",
  "bootstrap must freeze a namespaced locator from each v1 ID",
);

const canonicalIdentity = "{\"locator\":\"legacy-v1:mona-life:mona-life-v1-42\",\"sourceNamespace\":\"mona-life\"}";
const expectedStableId = `winddown-material-${createHash("sha256").update(canonicalIdentity, "utf8").digest("hex").slice(0, 24)}`;
assert.equal(
  original.materials.find((material) => material.legacyAliases[0] === "mona-life-v1-42")?.id,
  expectedStableId,
  "stable IDs must match standard SHA-256 over canonical source namespace and frozen locator",
);

const reorderedAndEdited = buildWindDownMaterialArtifactV2({
  source,
  mode: "legacy-v1-bootstrap",
  generatedAt: "2026-08-01T00:00:00.000Z",
  rows: [
    row({
      legacyV1Id: "mona-life-v1-43",
      ko: "다시 한번 말해 줄래?",
      en: "Would you say that once more?",
      provenance: {
        namespace: "mona-life",
        source: "mona-life-expression-bank",
        sourcePath: "mona-life/data/english/expression-bank.json",
        sourceRecordId: "43",
        sourceRevision: "2026-08-01",
      },
    }),
    row({
      ko: "비가 아직도 내리고 있어.",
      en: "It is still raining outside.",
      materialWarnings: ["human_reviewed", "copy_updated"],
      // Deliberately supplied legacy user state must not be published in the static artifact.
      reviewState: { due: "2026-08-04", stability: 12 } as never,
    } as WindDownMaterialSourceRow),
  ],
});
assert.equal(
  reorderedAndEdited.materials.find((material) => material.legacyAliases[0] === "mona-life-v1-42")?.id,
  original.materials.find((material) => material.legacyAliases[0] === "mona-life-v1-42")?.id,
  "the frozen locator must keep identity through reordering and copy edits",
);
assert.equal(
  reorderedAndEdited.digest,
  buildWindDownMaterialArtifactV2({
    source,
    mode: "legacy-v1-bootstrap",
    generatedAt: "2030-01-01T00:00:00.000Z",
    rows: [...reorderedAndEdited.materials].reverse().map((material) => row({
      legacyV1Id: material.legacyAliases[0],
      ko: material.ko,
      en: material.en,
      acceptedVariants: material.acceptedVariants,
      difficulty: material.difficulty,
      grounded: material.grounded,
      verifiedInSource: material.verifiedInSource,
      provenance: material.provenance,
      materialWarnings: material.materialWarnings,
    })),
  }).digest,
  "generatedAt and input ordering must not change the artifact digest",
);
assert.equal(resolveWindDownMaterialId(original, "mona-life-v1-42"), expectedStableId);

const staticJson = JSON.stringify(reorderedAndEdited);
assert.equal(staticJson.includes("reviewState"), false);
assert.equal(staticJson.includes("stability"), false);
assert.equal(staticJson.includes("due"), false);
assert.ok(
  reorderedAndEdited.materials.find((material) => material.legacyAliases[0] === "mona-life-v1-42")?.materialWarnings.includes("copy_updated"),
  "source material warnings must remain attached",
);

const incompleteBootstrap = buildWindDownMaterialArtifactV2({
  source,
  mode: "legacy-v1-bootstrap",
  generatedAt: "2026-07-31T00:00:00.000Z",
  rows: [row({ legacyV1Id: undefined })],
});
assert.equal(incompleteBootstrap.materials.length, 0);
assert.deepEqual(incompleteBootstrap.migration.legacyAliasCoverage, {
  expectedCount: 0,
  mappedCount: 0,
  missingCount: 0,
  unaliasedRowCount: 1,
  missingAliases: [],
  status: "blocked",
});

const collisionBootstrap = buildWindDownMaterialArtifactV2({
  source,
  mode: "legacy-v1-bootstrap",
  generatedAt: "2026-07-31T00:00:00.000Z",
  rows: [
    row({ legacyV1Id: "duplicate-v1" }),
    row({
      legacyV1Id: "duplicate-v1",
      provenance: {
        namespace: "mona-life",
        source: "mona-life-expression-bank",
        sourcePath: "mona-life/data/english/expression-bank.json",
        sourceRecordId: "duplicate-b",
      },
    }),
  ],
});
assert.equal(collisionBootstrap.migration.legacyAliasCoverage.status, "blocked");
assert.equal(collisionBootstrap.migration.legacyAliasCoverage.mappedCount, 0);
assert.equal(collisionBootstrap.quarantine.length, 2);
assert.ok(collisionBootstrap.quarantine.every((entry) => entry.reasons.includes("duplicate_source_locator")));
assert.ok(collisionBootstrap.quarantine.every((entry) => entry.reasons.includes("duplicate_legacy_alias")));

const mappedButQuarantined = buildWindDownMaterialArtifactV2({
  source,
  mode: "legacy-v1-bootstrap",
  generatedAt: "2026-07-31T00:00:00.000Z",
  rows: [row({ legacyV1Id: "mona-life-v1-quarantined", verifiedInSource: false })],
});
assert.equal(mappedButQuarantined.materials.length, 0);
assert.equal(mappedButQuarantined.quarantine.length, 1);
assert.deepEqual(mappedButQuarantined.migration.legacyAliasCoverage, {
  expectedCount: 1,
  mappedCount: 1,
  missingCount: 0,
  unaliasedRowCount: 0,
  missingAliases: [],
  status: "complete",
});
const quarantinedCanonicalId = mappedButQuarantined.quarantine[0]?.canonicalId;
assert.ok(quarantinedCanonicalId);
assert.equal(resolveWindDownMaterialId(mappedButQuarantined, "mona-life-v1-quarantined"), quarantinedCanonicalId);
assert.equal(resolveWindDownMaterialId(mappedButQuarantined, quarantinedCanonicalId ?? ""), quarantinedCanonicalId);

const mixedArtifact = buildWindDownMaterialArtifactV2({
  source,
  mode: "legacy-v1-bootstrap",
  generatedAt: "2026-07-31T00:00:00.000Z",
  rows: [
    row(),
    row({
      legacyV1Id: "mona-life-v1-quarantined",
      verifiedInSource: false,
      provenance: {
        namespace: "mona-life",
        source: "mona-life-expression-bank",
        sourcePath: "mona-life/data/english/expression-bank.json",
        sourceRecordId: "quarantined",
        sourceRevision: "2026-07-31",
      },
    }),
  ],
});
const mixedManifest = buildWindDownLunaBatchManifest(mixedArtifact);
assert.equal(mixedArtifact.migration.legacyAliasCoverage.status, "complete");
assert.equal(mixedArtifact.materials.length, 1);
assert.equal(mixedArtifact.quarantine.length, 1);
assert.equal(
  mixedManifest.items[0]?.status,
  "awaiting_luna_receipt",
  "quarantined rows must stay excluded without blocking Luna review of accepted runtime materials",
);

const postBootstrap = buildWindDownMaterialArtifactV2({
  source,
  mode: "steady-state",
  generatedAt: "2026-07-31T00:00:00.000Z",
  rows: [
    row({ legacyV1Id: undefined, sourceLocator: "" }),
    row({ legacyV1Id: undefined, sourceLocator: "mona-life:expression:44" }),
  ],
});
assert.equal(postBootstrap.migration.legacyAliasCoverage.status, "not_applicable");
assert.equal(postBootstrap.materials.length, 1);
assert.ok(postBootstrap.quarantine[0]?.reasons.includes("missing_source_locator_after_legacy_bootstrap"));

const strictQa = buildWindDownMaterialArtifactV2({
  source,
  mode: "steady-state",
  generatedAt: "2026-07-31T00:00:00.000Z",
  rows: [
    row({ legacyV1Id: undefined, sourceLocator: "mona-life:expression:ungrounded", grounded: false }),
    row({ legacyV1Id: undefined, sourceLocator: "mona-life:expression:unverified", verifiedInSource: false }),
    row({ legacyV1Id: undefined, sourceLocator: "mona-life:expression:difficulty", difficulty: 3 }),
    row({
      legacyV1Id: undefined,
      sourceLocator: "mona-life:expression:wrong-namespace",
      provenance: {
        namespace: "other-source",
        source: "mona-life-expression-bank",
        sourcePath: "mona-life/data/english/expression-bank.json",
      },
    }),
    row({
      legacyV1Id: undefined,
      sourceLocator: "mona-life:expression:wrong-path",
      provenance: {
        namespace: "mona-life",
        source: "mona-life-expression-bank",
        sourcePath: "other/path.json",
      },
    }),
  ],
});
assert.equal(strictQa.materials.length, 0);
assert.ok(strictQa.quarantine.some((entry) => entry.reasons.includes("not_grounded")));
assert.ok(strictQa.quarantine.some((entry) => entry.reasons.includes("not_verified_in_source")));
assert.ok(strictQa.quarantine.some((entry) => entry.reasons.includes("difficulty_outside_declared_range")));
assert.ok(strictQa.quarantine.some((entry) => entry.reasons.includes("provenance_namespace_mismatch")));
assert.ok(strictQa.quarantine.some((entry) => entry.reasons.includes("provenance_source_path_mismatch")));

const manifest = buildWindDownLunaBatchManifest(original);
assert.equal(manifest.receiptValidatorStatus, "not_implemented");
assert.deepEqual(manifest.items.map((item) => item.status), ["awaiting_luna_receipt", "awaiting_luna_receipt"]);
assert.ok(manifest.items.every((item) => item.releaseState === "not_released"));
assert.ok(manifest.items.every((item) => item.requestedReceipt.artifactDigest === original.digest));

const fixtureRoot = mkdtempSync(path.join(tmpdir(), "winddown-material-v2-"));
try {
  const fixtureSourcePath = path.join(fixtureRoot, "expression-bank.json");
  const fixtureV1Path = path.join(fixtureRoot, "expressionBank.generated.json");
  const fixtureCandidatePath = path.join(fixtureRoot, "candidate.json");
  const fixtureSource = {
    source: "fixture-distill",
    updatedAt: "2026-07-31T00:00:00.000Z",
    entries: [
      {
        source_id: "fixture-a",
        ko: "비가 아직도 와.",
        en: "It is still raining.",
        grounded: true,
        verifiedInSource: true,
        difficulty: 1,
        word_count: 4,
        pattern: "It is still [weather].",
        variations: [{ en: "It is raining again." }, { en: "It is still raining." }],
        theme: "weather",
        register: "neutral",
        note: "fixture note",
        enrichedAt: "2026-07-30T00:00:00.000Z",
        enrichVersion: 2,
        sibling: { ko: "비가 와.", en: "It is raining." },
      },
      {
        source_id: "fixture-ineligible",
        ko: "너무 어려운 문장",
        en: "This must not join the v1 bootstrap.",
        grounded: true,
        verifiedInSource: true,
        difficulty: 3,
        word_count: 7,
      },
      {
        source_id: "fixture-b",
        ko: "다시 말해줄래?",
        en: "Can you say that again?",
        grounded: true,
        verifiedInSource: true,
        difficulty: 2,
        word_count: 5,
        variations: [{ en: "Would you say that once more?" }],
        theme: "conversation",
        register: "casual",
        note: "fixture note b",
      },
    ],
  };
  const fixtureLegacyEntries = [0, 2].map((index) => ({
    id: legacyV1ExpressionId(fixtureSource.entries[index], index),
    ko: fixtureSource.entries[index].ko,
    en: fixtureSource.entries[index].en,
    state: "prompt",
  }));
  writeFileSync(fixtureSourcePath, `${JSON.stringify(fixtureSource)}\n`, "utf8");
  writeFileSync(fixtureV1Path, `${JSON.stringify({
    schemaVersion: 1,
    source: "fixture-distill",
    updatedAt: fixtureSource.updatedAt,
    sourcePath: "fixture/expression-bank.json",
    sourceEntryCount: fixtureSource.entries.length,
    eligibleEntryCount: fixtureLegacyEntries.length,
    entries: fixtureLegacyEntries,
  })}\n`, "utf8");
  const fixtureCheck = runWindDownMaterialBootstrapCommand({
    sourcePath: fixtureSourcePath,
    legacyArtifactPath: fixtureV1Path,
    check: true,
    writeCandidate: null,
    expectedLegacyEntryCount: 2,
  });
  assert.equal(fixtureCheck.passed, true);
  assert.equal(existsSync(fixtureCandidatePath), false, "check mode must not write a candidate");
  assert.equal(fixtureCheck.candidate.receipt.legacyV1.matchedCount, 2);
  assert.deepEqual(fixtureCheck.candidate.receipt.artifact.aliasCoverage, {
    expectedCount: 2,
    mappedCount: 2,
    missingCount: 0,
    unaliasedRowCount: 0,
    missingAliases: [],
    status: "complete",
  });
  const fixtureMaterial = fixtureCheck.candidate.artifact.materials.find(
    (material) => material.sourceMetadata.enrichment.upstreamSourceId === "fixture-a",
  );
  assert.match(fixtureMaterial?.provenance.sourceRecordId ?? "", /^legacy-v1:mona-life-/);
  assert.deepEqual(fixtureMaterial?.acceptedVariants, ["It is raining again.", "It is still raining."]);
  assert.deepEqual(fixtureMaterial?.sourceMetadata, {
    wordCount: 4,
    pattern: "It is still [weather].",
    variationsEn: ["It is raining again.", "It is still raining."],
    theme: "weather",
    register: "neutral",
    note: "fixture note",
    enrichment: {
      upstreamSourceId: "fixture-a",
      addedAt: null,
      extractedAt: null,
      enrichedAt: "2026-07-30T00:00:00.000Z",
      enrichVersion: 2,
      upstreamVerifiedInSource: true,
      sibling: { ko: "비가 와.", en: "It is raining." },
    },
  });
  runWindDownMaterialBootstrapCommand({
    sourcePath: fixtureSourcePath,
    legacyArtifactPath: fixtureV1Path,
    check: false,
    writeCandidate: fixtureCandidatePath,
    expectedLegacyEntryCount: 2,
  });
  assert.equal(existsSync(fixtureCandidatePath), true, "explicit candidate write must be atomic and opt-in");
  const writtenCandidate = JSON.parse(readFileSync(fixtureCandidatePath, "utf8"));
  assert.equal(writtenCandidate.receipt.source.digest, fixtureCheck.candidate.receipt.source.digest);
  assert.equal(writtenCandidate.receipt.artifact.digest, fixtureCheck.candidate.receipt.artifact.digest);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

const implementation = readFileSync(
  path.join(process.cwd(), "src/features/winddown/content/materialIdentity.ts"),
  "utf8",
);
assert.ok(implementation.includes("node:crypto"), "artifact hashing must stay build-time Node crypto");
for (const forbidden of ["SHA256_INITIAL_HASHES", "fetch(", "WebSocket", "useGemini", "fsrs", "reviewState", "runtime-approved"]) {
  assert.equal(implementation.includes(forbidden), false, `static identity module must not depend on ${forbidden}`);
}

console.log("[PASS] winddown stable material identity, strict static QA, and Luna batch manifest");
