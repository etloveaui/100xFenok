import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildWindDownLunaBatchManifest,
  buildWindDownMaterialArtifactV2,
  type WindDownMaterialArtifactV2,
  type WindDownMaterialSourceRow,
} from "../src/features/winddown/content/materialIdentity";
import {
  WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION,
  WINDDOWN_LUNA_REQUESTED_MODEL,
  buildWindDownLunaReceiptContent,
  buildWindDownLunaShardPlan,
  canonicalWindDownJson,
  sha256Hex,
  signWindDownLunaReceiptBundle,
  validateWindDownLunaReceiptBundle,
  type SignedWindDownLunaReceiptBundle,
  type WindDownLunaCandidateItem,
  type WindDownLunaReceiptContent,
  type WindDownLunaShardPlan,
  type WindDownLunaShardReceipt,
} from "./winddown-luna-contract";

const PROMPT_PATH = fileURLToPath(new URL("./winddown-luna/prompt.v1.txt", import.meta.url));
const HMAC_KEY_ID = "winddown-luna-test-v1";
const HMAC_KEY = "0123456789abcdef0123456789abcdef";
const SOURCE = {
  namespace: "winddown-score",
  source: "deterministic-fixture",
  sourcePath: "scripts/score-winddown-luna-receipt.ts",
  sourceRevision: "fixture-v1",
};

function sourceRow(index: number, override: Partial<WindDownMaterialSourceRow> = {}): WindDownMaterialSourceRow {
  return {
    legacyV1Id: `legacy-${String(index).padStart(3, "0")}`,
    ko: `오늘 문장 ${index}을 연습합니다`,
    en: `Practice sentence number ${index} today`,
    acceptedVariants: [`Practice number ${index} today`],
    difficulty: index % 2 === 0 ? 2 : 1,
    grounded: true,
    verifiedInSource: true,
    provenance: {
      namespace: SOURCE.namespace,
      source: SOURCE.source,
      sourcePath: SOURCE.sourcePath,
      sourceRecordId: `row-${index}`,
      sourceRevision: SOURCE.sourceRevision,
    },
    ...override,
  };
}

function buildFixtureArtifact(): WindDownMaterialArtifactV2 {
  return buildWindDownMaterialArtifactV2({
    source: SOURCE,
    mode: "legacy-v1-bootstrap",
    generatedAt: "2026-07-31T00:00:00.000Z",
    rows: [
      sourceRow(1),
      sourceRow(2),
      sourceRow(3),
      sourceRow(4),
      sourceRow(5, { verifiedInSource: false }),
    ],
  });
}

function candidateFor(
  planItem: WindDownLunaShardPlan["shards"][number]["items"][number],
  artifact: WindDownMaterialArtifactV2,
): WindDownLunaCandidateItem {
  const material = artifact.materials.find((entry) => entry.id === planItem.materialId);
  assert(material, `fixture material missing: ${planItem.materialId}`);
  return {
    materialId: planItem.materialId,
    inputMaterialDigest: planItem.inputMaterialDigest,
    verdict: "approve",
    evidence: ["Grounded in the immutable English source."],
    enrichment: {
      chunks: [material.en.split(" ").slice(0, 2).join(" ")],
      distractors: [`Incorrect alternative for ${material.legacyAliases[0]}`],
      difficultyNote: `Source difficulty ${material.difficulty}.`,
      scenarioTags: ["daily-life"],
      naturalnessFlags: ["natural"],
    },
  };
}

function shardReceipt(
  plan: WindDownLunaShardPlan,
  artifact: WindDownMaterialArtifactV2,
  shardIndex: number,
): WindDownLunaShardReceipt {
  const shard = plan.shards[shardIndex];
  assert(shard, `fixture shard missing: ${shardIndex}`);
  const items = shard.items.map((item) => candidateFor(item, artifact));
  const responseDigest = sha256Hex(
    canonicalWindDownJson({
      schemaVersion: WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION,
      kind: "winddown-luna-shard-response",
      shardId: shard.shardId,
      items,
    }),
  );
  return {
    schemaVersion: WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION,
    kind: "winddown-luna-shard-receipt",
    shardIndex,
    shardId: shard.shardId,
    requestedModel: WINDDOWN_LUNA_REQUESTED_MODEL,
    responseModel: "gpt-5.6-luna-2026-07-31",
    responseDigest,
    items,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function unsigned(bundle: SignedWindDownLunaReceiptBundle): WindDownLunaReceiptContent {
  const content = { ...bundle } as Partial<SignedWindDownLunaReceiptBundle>;
  delete content.receiptDigest;
  delete content.auth;
  return content as WindDownLunaReceiptContent;
}

function resign(bundle: SignedWindDownLunaReceiptBundle): SignedWindDownLunaReceiptBundle {
  return signWindDownLunaReceiptBundle(unsigned(bundle), HMAC_KEY_ID, HMAC_KEY);
}

function refreshResponseDigest(bundle: SignedWindDownLunaReceiptBundle, shardIndex: number): void {
  const shard = bundle.shards[shardIndex];
  shard.responseDigest = sha256Hex(
    canonicalWindDownJson({
      schemaVersion: WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION,
      kind: "winddown-luna-shard-response",
      shardId: shard.shardId,
      items: shard.items,
    }),
  );
}

const artifact = buildFixtureArtifact();
const artifactBytes = `${JSON.stringify(artifact, null, 2)}\n`;
const manifest = buildWindDownLunaBatchManifest(artifact);
const promptTemplate = readFileSync(PROMPT_PATH);
const plan = buildWindDownLunaShardPlan({
  artifact,
  artifactBytes,
  manifest,
  promptTemplate,
  shardSize: 2,
});
const deterministicPlan = buildWindDownLunaShardPlan({
  artifact,
  artifactBytes,
  manifest,
  promptTemplate,
  shardSize: 2,
});

assert.equal(artifact.summary.inputCount, 5);
assert.equal(artifact.materials.length, 4);
assert.equal(artifact.quarantine.length, 1);
assert.equal(artifact.migration.legacyAliasCoverage.status, "complete");
assert.equal(artifact.migration.legacyAliasCoverage.mappedCount, 5);
assert.equal(plan.materialCount, artifact.materials.length);
assert.equal(plan.shardCount, 2);
assert.deepEqual(plan, deterministicPlan);

const validContent = buildWindDownLunaReceiptContent(
  plan,
  plan.shards.map((_, index) => shardReceipt(plan, artifact, index)),
);
const validBundle = signWindDownLunaReceiptBundle(validContent, HMAC_KEY_ID, HMAC_KEY);

function validate(bundle: unknown, overrides: Partial<Parameters<typeof validateWindDownLunaReceiptBundle>[0]> = {}) {
  return validateWindDownLunaReceiptBundle({
    artifact,
    artifactBytes,
    manifest,
    promptTemplate,
    bundle,
    keyId: HMAC_KEY_ID,
    key: HMAC_KEY,
    shardSize: 2,
    ...overrides,
  });
}

function expectRejected(name: string, mutate: (bundle: SignedWindDownLunaReceiptBundle) => void, code: string) {
  const attacked = clone(validBundle);
  mutate(attacked);
  const result = validate(resign(attacked));
  assert.equal(result.ok, false, `${name}: expected rejection`);
  assert(
    result.errors.some((error) => error.includes(code)),
    `${name}: expected ${code}; received ${result.errors.join(", ")}`,
  );
  return name;
}

const validResult = validate(validBundle);
assert.deepEqual(validResult, {
  ok: true,
  errors: [],
  allItemsApproved: true,
  nonApproveItems: [],
});

const attacks: string[] = [];
attacks.push(expectRejected("missing active item", (bundle) => {
  bundle.shards[0].items.pop();
  refreshResponseDigest(bundle, 0);
}, "coverage.missing"));
attacks.push(expectRejected("duplicate active item", (bundle) => {
  bundle.shards[0].items[1].materialId = bundle.shards[0].items[0].materialId;
  refreshResponseDigest(bundle, 0);
}, "coverage.duplicate"));
attacks.push(expectRejected("unknown material id", (bundle) => {
  bundle.shards[0].items[0].materialId = "winddown-material-unknown";
  refreshResponseDigest(bundle, 0);
}, "coverage.unknown"));
attacks.push(expectRejected("shuffled item order", (bundle) => {
  bundle.shards[0].items.reverse();
  refreshResponseDigest(bundle, 0);
}, "materialId:mismatch"));
attacks.push(expectRejected("shuffled shard order", (bundle) => {
  bundle.shards.reverse();
}, "shardIndex:mismatch"));
attacks.push(expectRejected("wrong shard id", (bundle) => {
  bundle.shards[0].shardId = "0".repeat(64);
  refreshResponseDigest(bundle, 0);
}, "shardId:mismatch"));
attacks.push(expectRejected("wrong requested model", (bundle) => {
  bundle.shards[0].requestedModel = "gpt-5.6-luna-other" as typeof WINDDOWN_LUNA_REQUESTED_MODEL;
}, "requestedModel:mismatch"));
attacks.push(expectRejected("wrong response model", (bundle) => {
  bundle.shards[0].responseModel = "gpt-5.6-sol";
}, "responseModel:mismatch"));
attacks.push(expectRejected("wrong input material digest", (bundle) => {
  bundle.shards[0].items[0].inputMaterialDigest = "f".repeat(64);
  refreshResponseDigest(bundle, 0);
}, "inputMaterialDigest:mismatch"));
attacks.push(expectRejected("source truth mutation field", (bundle) => {
  Object.assign(bundle.shards[0].items[0], { en: "Mutated source truth" });
  refreshResponseDigest(bundle, 0);
}, "en:forbidden_field"));
attacks.push(expectRejected("ungrounded chunk", (bundle) => {
  bundle.shards[0].items[0].enrichment.chunks = ["invented phrase"];
  refreshResponseDigest(bundle, 0);
}, "not_grounded_in_source"));
attacks.push(expectRejected("accepted answer as distractor", (bundle) => {
  const material = artifact.materials.find(
    (entry) => entry.id === bundle.shards[0].items[0].materialId,
  );
  assert(material);
  bundle.shards[0].items[0].enrichment.distractors = [material.en];
  refreshResponseDigest(bundle, 0);
}, "matches_accepted_answer"));
attacks.push(expectRejected("unknown scenario tag", (bundle) => {
  bundle.shards[0].items[0].enrichment.scenarioTags = ["secret-provider"] as never;
  refreshResponseDigest(bundle, 0);
}, "scenarioTags[0]:unknown"));
attacks.push(expectRejected("contradictory naturalness", (bundle) => {
  bundle.shards[0].items[0].enrichment.naturalnessFlags = ["natural", "awkward"];
  refreshResponseDigest(bundle, 0);
}, "naturalnessFlags:contradictory"));
attacks.push(expectRejected("provider metadata field", (bundle) => {
  Object.assign(bundle.shards[0], { providerAccount: "slot-1" });
}, "providerAccount:forbidden_field"));
attacks.push(expectRejected("secret-like evidence", (bundle) => {
  bundle.shards[0].items[0].evidence = ["Bearer abcdefghijklmnopqrstuvwxyz"];
  refreshResponseDigest(bundle, 0);
}, "secret_like_text"));
attacks.push(expectRejected("response digest mismatch", (bundle) => {
  bundle.shards[0].responseDigest = "a".repeat(64);
}, "responseDigest:mismatch"));

const badMac = clone(validBundle);
badMac.auth.mac = "0".repeat(64);
const badMacResult = validate(badMac);
assert.equal(badMacResult.ok, false);
assert(badMacResult.errors.includes("bundle.auth.mac:mismatch"));
attacks.push("invalid HMAC");

const nonApproveBundle = clone(validBundle);
nonApproveBundle.shards[0].items[0].verdict = "needs_human_review";
refreshResponseDigest(nonApproveBundle, 0);
const nonApproveResult = validate(resign(nonApproveBundle));
assert.equal(nonApproveResult.ok, true);
assert.equal(nonApproveResult.allItemsApproved, false);
assert(
  nonApproveResult.nonApproveItems.some((item) => item.endsWith(":needs_human_review")),
);
attacks.push("non-approve classified for quarantine");

const promptMismatch = validate(validBundle, { promptTemplate: Buffer.from("different prompt") });
assert.equal(promptMismatch.ok, false);
assert(promptMismatch.errors.includes("bundle.promptTemplateDigest:mismatch"));
attacks.push("prompt digest mismatch");

const manifestMismatch = clone(manifest);
manifestMismatch.items.reverse();
const manifestMismatchResult = validate(validBundle, { manifest: manifestMismatch });
assert.equal(manifestMismatchResult.ok, false);
assert(manifestMismatchResult.errors.some((error) => error.includes("manifest_material_order_or_coverage_mismatch")));
attacks.push("manifest order mismatch");

const bytesMismatch = validate(validBundle, {
  artifactBytes: Buffer.from(canonicalWindDownJson({ ...artifact, generatedAt: "changed" })),
});
assert.equal(bytesMismatch.ok, false);
assert(bytesMismatch.errors.some((error) => error.includes("artifact_bytes_content_mismatch")));
attacks.push("artifact bytes mismatch");

const notApplicableAliasArtifact = buildWindDownMaterialArtifactV2({
  source: SOURCE,
  mode: "steady-state",
  generatedAt: "2026-07-31T00:00:00.000Z",
  rows: [
    sourceRow(1, { legacyV1Id: undefined, sourceLocator: "steady-state:1" }),
  ],
});
assert.throws(
  () =>
    buildWindDownLunaShardPlan({
      artifact: notApplicableAliasArtifact,
      artifactBytes: canonicalWindDownJson(notApplicableAliasArtifact),
      manifest: buildWindDownLunaBatchManifest(notApplicableAliasArtifact),
      promptTemplate,
    }),
  /legacy_alias_coverage_incomplete/,
);
attacks.push("incomplete alias coverage");

console.log(
  JSON.stringify(
    {
      status: "PASS",
      activeMaterials: artifact.materials.length,
      quarantinedMaterials: artifact.quarantine.length,
      aliasCoverage: `${artifact.migration.legacyAliasCoverage.mappedCount}/${artifact.migration.legacyAliasCoverage.expectedCount}`,
      shardCount: plan.shardCount,
      deterministicPlanDigest: plan.digest,
      attacksRejected: attacks.length,
      attacks,
    },
    null,
    2,
  ),
);
