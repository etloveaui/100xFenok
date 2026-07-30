import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildWindDownLunaBatchManifest,
  verifyWindDownMaterialArtifactDigest,
  type WindDownLunaBatchManifest,
  type WindDownMaterialArtifactV2,
} from "../src/features/winddown/content/materialIdentity";
import {
  buildWindDownLunaShardPlan,
  type WindDownLunaShardPlan,
} from "./winddown-luna-contract";

export type PreparedWindDownLunaRun = {
  artifact: WindDownMaterialArtifactV2;
  manifest: WindDownLunaBatchManifest;
  plan: WindDownLunaShardPlan;
  outputDirectory: string;
  paths: {
    artifact: string;
    manifest: string;
    shardPlan: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${label}_json_invalid`);
  }
}

function assertBootstrapCandidate(value: unknown): WindDownMaterialArtifactV2 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isRecord(value.artifact) ||
    !isRecord(value.receipt)
  ) {
    throw new Error("bootstrap_candidate_invalid");
  }
  const artifact = value.artifact as WindDownMaterialArtifactV2;
  if (!verifyWindDownMaterialArtifactDigest(artifact)) {
    throw new Error("bootstrap_artifact_digest_invalid");
  }
  const legacyReceipt = isRecord(value.receipt.legacyV1)
    ? value.receipt.legacyV1
    : null;
  const artifactReceipt = isRecord(value.receipt.artifact)
    ? value.receipt.artifact
    : null;
  if (
    value.receipt.schemaVersion !== 1 ||
    value.receipt.kind !== "winddown-material-v2-bootstrap-receipt" ||
    legacyReceipt?.status !== "complete" ||
    artifactReceipt?.digest !== artifact.digest
  ) {
    throw new Error("bootstrap_receipt_incomplete");
  }
  const coverage = artifact.migration?.legacyAliasCoverage;
  if (
    coverage?.status !== "complete" ||
    coverage.expectedCount !== coverage.mappedCount ||
    coverage.missingCount !== 0 ||
    coverage.unaliasedRowCount !== 0
  ) {
    throw new Error("bootstrap_alias_coverage_incomplete");
  }
  if (artifact.materials.length === 0) {
    throw new Error("bootstrap_active_materials_empty");
  }
  return artifact;
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeFsynced(path: string, text: string): void {
  writeFileSync(path, text, { encoding: "utf8", flag: "wx" });
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writePreparedDirectory(input: {
  outputDirectory: string;
  artifactText: string;
  manifestText: string;
  planText: string;
}): PreparedWindDownLunaRun["paths"] {
  const outputDirectory = resolve(input.outputDirectory);
  if (pathExists(outputDirectory)) {
    throw new Error("prepare_output_directory_exists");
  }
  const parent = dirname(outputDirectory);
  if (!existsSync(parent)) throw new Error("prepare_output_parent_missing");
  const stagedDirectory = mkdtempSync(
    join(parent, `.${basename(outputDirectory)}.tmp-`),
  );
  try {
    writeFsynced(join(stagedDirectory, "artifact.json"), input.artifactText);
    writeFsynced(join(stagedDirectory, "manifest.json"), input.manifestText);
    writeFsynced(join(stagedDirectory, "shard-plan.json"), input.planText);
    renameSync(stagedDirectory, outputDirectory);
  } catch (error) {
    rmSync(stagedDirectory, { recursive: true, force: true });
    if (
      (error as NodeJS.ErrnoException).code === "EEXIST" ||
      (error as NodeJS.ErrnoException).code === "ENOTEMPTY"
    ) {
      throw new Error("prepare_output_directory_exists");
    }
    throw error;
  }
  return {
    artifact: join(outputDirectory, "artifact.json"),
    manifest: join(outputDirectory, "manifest.json"),
    shardPlan: join(outputDirectory, "shard-plan.json"),
  };
}

export function windDownLunaPromptPath(): string {
  return fileURLToPath(new URL("./winddown-luna/prompt.v1.txt", import.meta.url));
}

export function prepareWindDownLunaRun(input: {
  bootstrapCandidatePath: string;
  outputDirectory: string;
  shardSize?: number;
  promptPath?: string;
}): PreparedWindDownLunaRun {
  const candidateBytes = readFileSync(resolve(input.bootstrapCandidatePath));
  const artifact = assertBootstrapCandidate(
    parseJson(candidateBytes, "bootstrap_candidate"),
  );
  const promptPath = resolve(input.promptPath ?? windDownLunaPromptPath());
  const promptTemplate = readFileSync(promptPath);
  if (promptTemplate.length === 0) throw new Error("luna_prompt_empty");

  const artifactText = jsonText(artifact);
  const artifactBytes = Buffer.from(artifactText, "utf8");
  const manifest = buildWindDownLunaBatchManifest(artifact);
  if (manifest.items.some((item) => item.status !== "awaiting_luna_receipt")) {
    throw new Error("luna_manifest_blocked");
  }
  const plan = buildWindDownLunaShardPlan({
    artifact,
    artifactBytes,
    manifest,
    promptTemplate,
    shardSize: input.shardSize,
  });
  const outputDirectory = resolve(input.outputDirectory);
  const paths = writePreparedDirectory({
    outputDirectory,
    artifactText,
    manifestText: jsonText(manifest),
    planText: jsonText(plan),
  });
  return { artifact, manifest, plan, outputDirectory, paths };
}

function parseCli(argv: string[]): {
  bootstrapCandidatePath: string;
  outputDirectory: string;
  shardSize?: number;
} {
  let bootstrapCandidatePath = "";
  let outputDirectory = "";
  let shardSize: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--bootstrap-candidate" && value) {
      bootstrapCandidatePath = value;
      index += 1;
    } else if (argument === "--output-dir" && value) {
      outputDirectory = value;
      index += 1;
    } else if (argument === "--shard-size" && value) {
      shardSize = Number(value);
      index += 1;
    } else {
      throw new Error(`unknown_or_incomplete_argument:${argument}`);
    }
  }
  if (!bootstrapCandidatePath || !outputDirectory) {
    throw new Error(
      "usage: --bootstrap-candidate <path> --output-dir <new-directory>",
    );
  }
  return { bootstrapCandidatePath, outputDirectory, shardSize };
}

function main(): void {
  const prepared = prepareWindDownLunaRun(parseCli(process.argv.slice(2)));
  console.log(
    JSON.stringify({
      status: "PASS",
      activeMaterials: prepared.plan.materialCount,
      shardCount: prepared.plan.shardCount,
      planDigest: prepared.plan.digest,
      outputDirectory: prepared.outputDirectory,
    }),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
