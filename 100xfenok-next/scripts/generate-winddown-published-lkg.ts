import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertWindDownRuntimeProjection,
  assertWindDownMaterialLkg,
  assertWindDownMaterialLkgPointer,
  canonicalWindDownLkgJson,
  makeWindDownRuntimeProjectionPointer,
  windDownLkgBlobPath,
  windDownLkgBody,
  windDownLkgPointerPath,
  windDownRuntimeProjectionBody,
  windDownRuntimeProjectionText,
  type WindDownMaterialLkg,
  type WindDownRuntimeProjection,
  type WindDownRuntimeQuarantineEntry,
} from "../src/features/winddown/content/lkgContract";

export type WindDownPublishedLkgGeneration = {
  status: "published" | "noop";
  lkg: WindDownMaterialLkg;
  runtimeProjection: WindDownRuntimeProjection;
  lkgRoot: string;
  outputPath: string;
  artifactOutputRoot: string;
  publicRoot: string;
  runtimeAssetOutputPath: string;
};

type VerifiedCurrentLkg = {
  lkg: WindDownMaterialLkg;
  pointerText: string;
  blobText: string;
  blobPath: string;
};

let temporarySequence = 0;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}_json_invalid`);
  }
}

function pathInside(rootPath: string, childPath: string): string {
  const root = resolve(rootPath);
  const child = resolve(childPath);
  const relation = relative(root, child);
  if (!relation || relation.startsWith("..") || relation.includes("../")) {
    throw new Error("published_lkg_path_outside_root");
  }
  return child;
}

function readVerifiedCurrentLkg(args: { lkgRoot: string }): VerifiedCurrentLkg {
  const lkgRoot = resolve(args.lkgRoot);
  const pointerPath = join(lkgRoot, windDownLkgPointerPath());
  if (!existsSync(pointerPath))
    throw new Error("published_lkg_current_missing");
  const pointerText = readFileSync(pointerPath, "utf8");
  const pointer = parseJson(pointerText, "published_lkg_current");
  assertWindDownMaterialLkgPointer(pointer);
  if (pointer.blobPath !== windDownLkgBlobPath(pointer.contentDigest)) {
    throw new Error("published_lkg_pointer_blob_path_invalid");
  }
  const blobPath = pathInside(lkgRoot, join(lkgRoot, pointer.blobPath));
  if (!existsSync(blobPath)) throw new Error("published_lkg_blob_missing");
  const blobText = readFileSync(blobPath, "utf8");
  const lkg = parseJson(blobText, "published_lkg_blob");
  assertWindDownMaterialLkg(lkg);
  if (lkg.contentDigest !== pointer.contentDigest) {
    throw new Error("published_lkg_pointer_digest_mismatch");
  }
  if (
    sha256(canonicalWindDownLkgJson(windDownLkgBody(lkg))) !== lkg.contentDigest
  ) {
    throw new Error("published_lkg_content_digest_invalid");
  }
  return { lkg, pointerText, blobText, blobPath: pointer.blobPath };
}

export function readCurrentWindDownPublishedLkg(args: {
  lkgRoot: string;
}): WindDownMaterialLkg {
  return readVerifiedCurrentLkg(args).lkg;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function projectQuarantine(values: unknown[]): WindDownRuntimeQuarantineEntry[] {
  return values.flatMap((value) => {
    const source = record(value);
    if (!source) return [];
    const canonicalId =
      typeof source.canonicalId === "string" && source.canonicalId.trim()
        ? source.canonicalId.trim()
        : null;
    const legacyAliases = Array.isArray(source.legacyAliases)
      ? uniqueStrings(
          source.legacyAliases.filter(
            (item): item is string => typeof item === "string",
          ),
        )
      : [];
    return canonicalId || legacyAliases.length > 0
      ? [{ canonicalId, legacyAliases }]
      : [];
  });
}

export function buildWindDownRuntimeProjection(
  lkg: WindDownMaterialLkg,
): WindDownRuntimeProjection {
  assertWindDownMaterialLkg(lkg);
  const quarantine = projectQuarantine(lkg.quarantine);
  if (quarantine.length !== lkg.quarantine.length) {
    throw new Error("published_runtime_quarantine_identity_incomplete");
  }
  const body = {
    schemaVersion: 1 as const,
    kind: "winddown-material-runtime-projection" as const,
    sourceContentDigest: lkg.contentDigest,
    sourceArtifactDigest: lkg.artifactDigest,
    materials: lkg.materials.map((material) => ({
      id: material.id,
      ko: material.ko,
      en: material.en,
      acceptedVariants: [...material.acceptedVariants],
    })),
    aliases: lkg.migration.legacyAliasMap.map((entry) => ({ ...entry })),
    quarantine,
    lunaQuarantinedMaterialIds: lkg.lunaQuarantine.map(
      (entry) => entry.materialId,
    ),
    advisorOverlay: lkg.advisorOverlay.map((entry) => ({
      ...entry,
      evidence: [...entry.evidence],
      enrichment: {
        chunks: [...entry.enrichment.chunks],
        distractors: [...entry.enrichment.distractors],
        difficultyNote: entry.enrichment.difficultyNote,
        scenarioTags: [...entry.enrichment.scenarioTags],
        naturalnessFlags: [...entry.enrichment.naturalnessFlags],
      },
    })),
    advisorGate: { ...lkg.advisorGate },
  };
  const runtimeProjection: WindDownRuntimeProjection = {
    ...body,
    projectionDigest: sha256(canonicalWindDownLkgJson(body)),
  };
  assertWindDownRuntimeProjection(runtimeProjection);
  if (
    sha256(
      canonicalWindDownLkgJson(
        windDownRuntimeProjectionBody(runtimeProjection),
      ),
    ) !== runtimeProjection.projectionDigest
  ) {
    throw new Error("published_runtime_projection_digest_invalid");
  }
  return runtimeProjection;
}

export function renderWindDownPublishedLkgModule(
  runtimeProjection: WindDownRuntimeProjection,
): string {
  const pointer = makeWindDownRuntimeProjectionPointer(runtimeProjection);
  const pointerText = canonicalWindDownLkgJson(pointer);
  return [
    "// Generated by scripts/generate-winddown-published-lkg.ts from a verified current LKG.",
    "// Do not edit by hand.",
    "",
    'import type { WindDownRuntimeProjectionPointer } from "@/features/winddown/content/lkgContract";',
    "",
    'export type WindDownPublishedLkgBuild = { status: "absent" | "published"; contentDigest: string | null; artifactDigest: string | null; runtimeProjection: WindDownRuntimeProjectionPointer | null; };',
    "",
    `export const WINDDOWN_PUBLISHED_LKG_BUILD: WindDownPublishedLkgBuild = { status: "published", contentDigest: "${runtimeProjection.sourceContentDigest}", artifactDigest: "${runtimeProjection.sourceArtifactDigest}", runtimeProjection: ${pointerText} };`,
    "",
  ].join("\n");
}

function writeAtomically(
  targetPath: string,
  text: string,
  options: { immutable?: boolean } = {},
): "published" | "noop" {
  const target = resolve(targetPath);
  const fsyncPath = (path: string): void => {
    const descriptor = openSync(path, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  };
  const fsyncContainingDirectory = (): void => fsyncPath(dirname(target));
  if (existsSync(target) && readFileSync(target, "utf8") === text) {
    fsyncPath(target);
    fsyncContainingDirectory();
    return "noop";
  }
  if (options.immutable && existsSync(target)) {
    throw new Error("published_lkg_immutable_collision");
  }
  mkdirSync(dirname(target), { recursive: true });
  temporarySequence += 1;
  const staged = `${target}.tmp-${process.pid}-${temporarySequence}`;
  try {
    writeFileSync(staged, text, { encoding: "utf8", flag: "wx" });
    fsyncPath(staged);
    renameSync(staged, target);
    fsyncContainingDirectory();
    if (readFileSync(target, "utf8") !== text) {
      throw new Error("published_lkg_atomic_write_verify_failed");
    }
    return "published";
  } catch (error) {
    try {
      rmSync(staged, { force: true });
    } catch {
      // A staging cleanup failure must not mask the generation error.
    }
    throw error;
  }
}

function writeAuditArtifact(args: {
  artifactOutputRoot: string;
  pointerText: string;
  blobText: string;
  blobPath: string;
}): "published" | "noop" {
  const root = resolve(args.artifactOutputRoot);
  const blobTarget = pathInside(root, join(root, args.blobPath));
  const blobStatus = writeAtomically(blobTarget, args.blobText, {
    immutable: true,
  });
  const pointerStatus = writeAtomically(
    join(root, windDownLkgPointerPath()),
    args.pointerText,
  );
  return pointerStatus === "published" || blobStatus === "published"
    ? "published"
    : "noop";
}

export function generateWindDownPublishedLkgModule(args: {
  lkgRoot: string;
  outputPath?: string;
  artifactOutputRoot?: string;
  publicRoot?: string;
}): WindDownPublishedLkgGeneration {
  const lkgRoot = resolve(args.lkgRoot);
  const verified = readVerifiedCurrentLkg({ lkgRoot });
  const runtimeProjection = buildWindDownRuntimeProjection(verified.lkg);
  const runtimePointer =
    makeWindDownRuntimeProjectionPointer(runtimeProjection);
  const outputPath = resolve(
    args.outputPath ??
      join(process.cwd(), "src/generated/winddown-published-lkg.ts"),
  );
  const artifactOutputRoot = resolve(
    args.artifactOutputRoot ??
      join(dirname(outputPath), "winddown-published-lkg.audit"),
  );
  const publicRoot = resolve(args.publicRoot ?? join(process.cwd(), "public"));
  const runtimeAssetOutputPath = pathInside(
    publicRoot,
    join(publicRoot, runtimePointer.assetPath.slice(1)),
  );
  const artifactStatus = writeAuditArtifact({
    artifactOutputRoot,
    pointerText: verified.pointerText,
    blobText: verified.blobText,
    blobPath: verified.blobPath,
  });
  const runtimeAssetStatus = writeAtomically(
    runtimeAssetOutputPath,
    windDownRuntimeProjectionText(runtimeProjection),
    { immutable: true },
  );
  const moduleStatus = writeAtomically(
    outputPath,
    renderWindDownPublishedLkgModule(runtimeProjection),
  );
  return {
    status:
      moduleStatus === "published" ||
      artifactStatus === "published" ||
      runtimeAssetStatus === "published"
        ? "published"
        : "noop",
    lkg: verified.lkg,
    runtimeProjection,
    lkgRoot,
    outputPath,
    artifactOutputRoot,
    publicRoot,
    runtimeAssetOutputPath,
  };
}

function parseCli(argv: string[]): {
  lkgRoot: string;
  outputPath?: string;
  artifactOutputRoot?: string;
  publicRoot?: string;
} {
  const values: Record<string, string> = {};
  const names = new Map([
    ["--lkg-root", "lkgRoot"],
    ["--output", "outputPath"],
    ["--artifact-output-root", "artifactOutputRoot"],
    ["--public-root", "publicRoot"],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const name = names.get(argv[index]);
    const value = argv[index + 1];
    if (!name || !value) {
      throw new Error(`unknown_or_incomplete_argument:${argv[index]}`);
    }
    values[name] = value;
  }
  if (!values.lkgRoot) {
    throw new Error(
      "usage: --lkg-root <path> [--output <path>] [--artifact-output-root <path>] [--public-root <path>]",
    );
  }
  return {
    lkgRoot: values.lkgRoot,
    outputPath: values.outputPath,
    artifactOutputRoot: values.artifactOutputRoot,
    publicRoot: values.publicRoot,
  };
}

function main(): void {
  const result = generateWindDownPublishedLkgModule(
    parseCli(process.argv.slice(2)),
  );
  console.log(
    JSON.stringify({
      status: result.status,
      lkgContentDigest: result.lkg.contentDigest,
      artifactDigest: result.lkg.artifactDigest,
      outputPath: result.outputPath,
      artifactOutputRoot: result.artifactOutputRoot,
      runtimeProjectionDigest: result.runtimeProjection.projectionDigest,
      runtimeAssetOutputPath: result.runtimeAssetOutputPath,
    }),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
