import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  WindDownLunaBatchManifest,
  WindDownMaterialArtifactV2,
} from "../src/features/winddown/content/materialIdentity";
import {
  promoteWindDownMaterialLkg,
  type WindDownLkgPromotionResult,
} from "./promote-winddown-material-lkg";
import {
  WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION,
  WINDDOWN_LUNA_REQUESTED_MODEL,
  buildWindDownLunaReceiptContent,
  buildWindDownLunaShardPlan,
  canonicalWindDownJson,
  signWindDownLunaReceiptBundle,
  validateWindDownLunaReceiptBundle,
  type SignedWindDownLunaReceiptBundle,
  type WindDownLunaReceiptContent,
  type WindDownLunaShardPlan,
  type WindDownLunaShardReceipt,
} from "./winddown-luna-contract";
import { windDownLunaPromptPath } from "./prepare-winddown-luna-run";

const UNSIGNED_CONTENT_KEYS = [
  "schemaVersion",
  "kind",
  "planDigest",
  "artifactDigest",
  "artifactBytesDigest",
  "manifestDigest",
  "promptTemplateDigest",
  "requestedModel",
  "materialCount",
  "shardCount",
  "shards",
] as const;
const SHARD_KEYS = [
  "schemaVersion",
  "kind",
  "shardIndex",
  "shardId",
  "requestedModel",
  "responseModel",
  "responseDigest",
  "items",
] as const;
const ITEM_KEYS = [
  "materialId",
  "inputMaterialDigest",
  "verdict",
  "evidence",
  "enrichment",
] as const;

type Environment = Record<string, string | undefined>;

export type WindDownSignedReceiptFilesystem = {
  exists(path: string): boolean;
  readText(path: string): string;
  mkdir(path: string): void;
  writeTextExclusive(path: string, text: string): void;
  fsync(path: string): void;
  link(fromPath: string, toPath: string): void;
  remove(path: string): void;
};

export type FinalizedWindDownLunaRun = {
  receiptBundle: SignedWindDownLunaReceiptBundle;
  promotion: WindDownLkgPromotionResult;
  signedReceiptPath: string;
};

const defaultSignedReceiptFilesystem: WindDownSignedReceiptFilesystem = {
  exists: existsSync,
  readText: (path) => readFileSync(path, "utf8"),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  writeTextExclusive: (path, text) =>
    writeFileSync(path, text, { encoding: "utf8", flag: "wx" }),
  fsync: (path) => {
    const descriptor = openSync(path, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  },
  link: linkSync,
  remove: (path) => rmSync(path, { force: true }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson<T>(bytes: Buffer, label: string): T {
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    throw new Error(`${label}_json_invalid`);
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function decodeReceiptKey(environment: Environment): {
  keyId: string;
  key: Buffer;
} {
  const encoded = environment.WINDDOWN_LUNA_RECEIPT_HMAC_KEY_B64?.trim();
  const keyId = environment.WINDDOWN_LUNA_RECEIPT_HMAC_KEY_ID?.trim();
  if (!encoded || !keyId) {
    throw new Error("receipt_hmac_configuration_missing");
  }
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(keyId)
  ) {
    throw new Error("receipt_hmac_configuration_invalid");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length < 32 || key.toString("base64") !== encoded) {
    key.fill(0);
    throw new Error("receipt_hmac_configuration_invalid");
  }
  return { keyId, key };
}

function assertUnsignedMatchesPlan(
  value: unknown,
  plan: WindDownLunaShardPlan,
): asserts value is WindDownLunaReceiptContent {
  if (!isRecord(value) || !hasExactKeys(value, UNSIGNED_CONTENT_KEYS)) {
    throw new Error("unsigned_bundle_plan_mismatch");
  }
  const shards = value.shards;
  if (!Array.isArray(shards) || shards.length !== plan.shards.length) {
    throw new Error("unsigned_bundle_plan_mismatch");
  }
  for (const [shardIndex, shardValue] of shards.entries()) {
    const expectedShard = plan.shards[shardIndex];
    if (
      !isRecord(shardValue) ||
      !hasExactKeys(shardValue, SHARD_KEYS) ||
      shardValue.schemaVersion !== WINDDOWN_LUNA_RECEIPT_SCHEMA_VERSION ||
      shardValue.kind !== "winddown-luna-shard-receipt" ||
      shardValue.shardIndex !== expectedShard.shardIndex ||
      shardValue.shardId !== expectedShard.shardId ||
      shardValue.requestedModel !== WINDDOWN_LUNA_REQUESTED_MODEL ||
      !Array.isArray(shardValue.items) ||
      shardValue.items.length !== expectedShard.items.length
    ) {
      throw new Error("unsigned_bundle_plan_mismatch");
    }
    for (const [itemIndex, itemValue] of shardValue.items.entries()) {
      const expectedItem = expectedShard.items[itemIndex];
      if (
        !isRecord(itemValue) ||
        !hasExactKeys(itemValue, ITEM_KEYS) ||
        itemValue.materialId !== expectedItem.materialId ||
        itemValue.inputMaterialDigest !== expectedItem.inputMaterialDigest
      ) {
        throw new Error("unsigned_bundle_plan_mismatch");
      }
    }
  }
  const expectedContent = buildWindDownLunaReceiptContent(
    plan,
    shards as WindDownLunaShardReceipt[],
  );
  if (canonicalWindDownJson(value) !== canonicalWindDownJson(expectedContent)) {
    throw new Error("unsigned_bundle_plan_mismatch");
  }
}

function prepareSignedReceipt(
  targetPath: string,
  text: string,
  filesystem: WindDownSignedReceiptFilesystem,
): { commit(): void; cleanup(): void } {
  const target = resolve(targetPath);
  if (filesystem.exists(target)) {
    if (filesystem.readText(target) !== text) {
      throw new Error("signed_receipt_immutable_collision");
    }
    filesystem.fsync(dirname(target));
    return { commit(): void {}, cleanup(): void {} };
  }
  filesystem.mkdir(dirname(target));
  const staged = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    filesystem.writeTextExclusive(staged, text);
    filesystem.fsync(staged);
  } catch (error) {
    try {
      filesystem.remove(staged);
    } catch {
      // Cleanup must not mask the write/fsync failure.
    }
    throw error;
  }
  return {
    commit(): void {
      let targetReady = false;
      try {
        filesystem.link(staged, target);
        targetReady = true;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code === "EEXIST" &&
          filesystem.exists(target)
        ) {
          if (filesystem.readText(target) !== text) {
            throw new Error("signed_receipt_immutable_collision");
          }
          targetReady = true;
          return;
        }
        throw error;
      } finally {
        try {
          filesystem.remove(staged);
        } finally {
          if (targetReady) filesystem.fsync(dirname(target));
        }
      }
    },
    cleanup(): void {
      filesystem.remove(staged);
    },
  };
}

export function finalizeWindDownLunaRun(input: {
  runDirectory: string;
  unsignedBundlePath: string;
  signedReceiptPath: string;
  lkgRootPath: string;
  environment?: Environment;
  promptPath?: string;
  receiptFilesystem?: WindDownSignedReceiptFilesystem;
  promotionFunction?: typeof promoteWindDownMaterialLkg;
}): FinalizedWindDownLunaRun {
  const signedReceiptPath = resolve(input.signedReceiptPath);

  const runDirectory = resolve(input.runDirectory);
  const artifactBytes = readFileSync(join(runDirectory, "artifact.json"));
  const artifact = parseJson<WindDownMaterialArtifactV2>(
    artifactBytes,
    "prepared_artifact",
  );
  const manifest = parseJson<WindDownLunaBatchManifest>(
    readFileSync(join(runDirectory, "manifest.json")),
    "prepared_manifest",
  );
  const recordedPlan = parseJson<WindDownLunaShardPlan>(
    readFileSync(join(runDirectory, "shard-plan.json")),
    "prepared_plan",
  );
  const promptTemplate = readFileSync(
    resolve(input.promptPath ?? windDownLunaPromptPath()),
  );
  const rebuiltPlan = buildWindDownLunaShardPlan({
    artifact,
    artifactBytes,
    manifest,
    promptTemplate,
    shardSize: recordedPlan.shardSize,
  });
  if (
    canonicalWindDownJson(recordedPlan) !==
    canonicalWindDownJson(rebuiltPlan)
  ) {
    throw new Error("prepared_plan_rebuild_mismatch");
  }

  const unsigned = parseJson<unknown>(
    readFileSync(resolve(input.unsignedBundlePath)),
    "unsigned_bundle",
  );
  assertUnsignedMatchesPlan(unsigned, rebuiltPlan);
  const { keyId, key } = decodeReceiptKey(input.environment ?? process.env);
  try {
    const receiptBundle = signWindDownLunaReceiptBundle(unsigned, keyId, key);
    const validation = validateWindDownLunaReceiptBundle({
      artifact,
      artifactBytes,
      manifest,
      promptTemplate,
      bundle: receiptBundle,
      keyId,
      key,
      shardSize: rebuiltPlan.shardSize,
    });
    if (!validation.ok) {
      throw new Error("signed_receipt_invalid");
    }

    const stagedReceipt = prepareSignedReceipt(
      signedReceiptPath,
      `${JSON.stringify(receiptBundle, null, 2)}\n`,
      input.receiptFilesystem ?? defaultSignedReceiptFilesystem,
    );
    let promotion: WindDownLkgPromotionResult;
    try {
      // The immutable signed receipt is the prerequisite publication record.
      // If promotion fails, retaining it makes the same-byte retry safe.
      stagedReceipt.commit();
      promotion = (input.promotionFunction ?? promoteWindDownMaterialLkg)({
        rootPath: resolve(input.lkgRootPath),
        artifact,
        artifactBytes,
        manifest,
        promptTemplate,
        receiptBundle,
        keyId,
        key,
        shardSize: rebuiltPlan.shardSize,
      });
    } catch (error) {
      stagedReceipt.cleanup();
      throw error;
    }
    return { receiptBundle, promotion, signedReceiptPath };
  } finally {
    key.fill(0);
  }
}

function parseCli(argv: string[]): {
  runDirectory: string;
  unsignedBundlePath: string;
  signedReceiptPath: string;
  lkgRootPath: string;
} {
  const values: Record<string, string> = {};
  const names = new Map([
    ["--run-dir", "runDirectory"],
    ["--unsigned-bundle", "unsignedBundlePath"],
    ["--signed-receipt", "signedReceiptPath"],
    ["--lkg-root", "lkgRootPath"],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = names.get(argv[index]);
    const value = argv[index + 1];
    if (!key || !value) {
      throw new Error(`unknown_or_incomplete_argument:${argv[index]}`);
    }
    values[key] = value;
  }
  for (const required of names.values()) {
    if (!values[required]) {
      throw new Error(
        "usage: --run-dir <path> --unsigned-bundle <path> " +
          "--signed-receipt <new-path> --lkg-root <path>",
      );
    }
  }
  return {
    runDirectory: values.runDirectory,
    unsignedBundlePath: values.unsignedBundlePath,
    signedReceiptPath: values.signedReceiptPath,
    lkgRootPath: values.lkgRootPath,
  };
}

function main(): void {
  const result = finalizeWindDownLunaRun(parseCli(process.argv.slice(2)));
  console.log(
    JSON.stringify({
      status: result.promotion.status,
      receiptDigest: result.receiptBundle.receiptDigest,
      lkgContentDigest: result.promotion.lkg.contentDigest,
      signedReceiptPath: result.signedReceiptPath,
    }),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
