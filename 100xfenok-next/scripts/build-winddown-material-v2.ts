import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildWindDownMaterialArtifactV2,
  type WindDownMaterialArtifactV2,
  type WindDownMaterialSourceRow,
} from "../src/features/winddown/content/materialIdentity";

export const WINDDOWN_LEGACY_V1_EXPECTED_ENTRY_COUNT = 722;

type LegacyV1Artifact = {
  source?: unknown;
  updatedAt?: unknown;
  sourcePath?: unknown;
  sourceEntryCount?: unknown;
  eligibleEntryCount?: unknown;
  entries?: unknown;
};

type LegacyV1ArtifactEntry = {
  id?: unknown;
  ko?: unknown;
  en?: unknown;
};

type BootstrapReceipt = {
  schemaVersion: 1;
  kind: "winddown-material-v2-bootstrap-receipt";
  source: {
    digest: string;
    entryCount: number;
    namespace: string;
    source: string;
    sourcePath: string;
    sourceRevision: string | null;
  };
  legacyV1: {
    artifactDigest: string;
    expectedEligibleCount: number;
    recomputedEligibleCount: number;
    generatedEligibleCount: number;
    matchedCount: number;
    missingLegacyIds: string[];
    unexpectedLegacyIds: string[];
    mismatchReasons: string[];
    upstreamVerifiedInSourceCount: number;
    staticVerification: "exact-legacy-v1-join";
    status: "complete" | "blocked";
  };
  artifact: {
    digest: string;
    staticCandidateCount: number;
    quarantineCount: number;
    aliasCoverage: WindDownMaterialArtifactV2["migration"]["legacyAliasCoverage"];
  };
};

export type WindDownMaterialBootstrapCandidate = {
  schemaVersion: 1;
  artifact: WindDownMaterialArtifactV2;
  receipt: BootstrapReceipt;
};

export type WindDownMaterialBootstrapResult = {
  candidate: WindDownMaterialBootstrapCandidate;
  passed: boolean;
};

function asText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function isLegacyV1Eligible(entry: unknown) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const record = entry as Record<string, unknown>;
  const ko = asText(record.ko);
  const en = asText(record.en);
  return record.grounded === true
    && ko.length > 0
    && en.length > 0
    && ko.length <= 80
    && en.length <= 140
    && typeof record.difficulty === "number"
    && record.difficulty >= 1
    && record.difficulty <= 2
    && typeof record.word_count === "number"
    && record.word_count >= 2
    && record.word_count <= 10;
}

export function legacyV1ExpressionId(entry: unknown, index: number) {
  const record = entry && typeof entry === "object" && !Array.isArray(entry)
    ? entry as Record<string, unknown>
    : {};
  const basis = [
    record.source_id ?? "",
    String(index),
    asText(record.ko),
    asText(record.en),
  ].join("|");
  return `mona-life-${createHash("sha1").update(basis).digest("hex").slice(0, 12)}`;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function variationsEn(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((variation) => asText(asRecord(variation).en)).filter(Boolean)));
}

function upstreamRow(args: {
  entry: unknown;
  index: number;
  legacyV1Id: string;
  source: { namespace: string; source: string; sourcePath: string; sourceRevision: string | null };
}): WindDownMaterialSourceRow {
  const entry = asRecord(args.entry);
  const sibling = asRecord(entry.sibling);
  return {
    legacyV1Id: args.legacyV1Id,
    ko: asText(entry.ko),
    en: asText(entry.en),
    acceptedVariants: variationsEn(entry.variations),
    difficulty: entry.difficulty,
    grounded: entry.grounded,
    verifiedInSource: entry.verifiedInSource === true,
    wordCount: entry.word_count,
    pattern: entry.pattern,
    variationsEn: variationsEn(entry.variations),
    theme: entry.theme,
    register: entry.register,
    note: entry.note,
    provenance: {
      namespace: args.source.namespace,
      source: args.source.source,
      sourcePath: args.source.sourcePath,
      sourceRecordId: `legacy-v1:${args.legacyV1Id}`,
      sourceRevision: args.source.sourceRevision,
    },
    enrichment: {
      upstreamSourceId: asText(entry.source_id) || null,
      addedAt: entry.addedAt,
      extractedAt: entry.extractedAt,
      enrichedAt: entry.enrichedAt,
      enrichVersion: entry.enrichVersion,
      upstreamVerifiedInSource: entry.verifiedInSource === true,
      sibling: {
        ko: asText(sibling.ko),
        en: asText(sibling.en),
      },
    },
    materialWarnings: [],
  };
}

function asLegacyEntries(raw: unknown) {
  const entries = Array.isArray(asRecord(raw).entries) ? asRecord(raw).entries as unknown[] : [];
  return entries
    .map((entry, index) => ({ entry, index, id: legacyV1ExpressionId(entry, index) }))
    .filter(({ entry }) => isLegacyV1Eligible(entry));
}

function asGeneratedEntries(raw: unknown) {
  const artifact = asRecord(raw) as LegacyV1Artifact;
  return Array.isArray(artifact.entries) ? artifact.entries.map((entry) => asRecord(entry) as LegacyV1ArtifactEntry) : [];
}

function canonicalSourcePath(value: unknown) {
  return asText(value) || "mona-life/data/english/expression-bank.json";
}

function sourceMetadata(rawSource: unknown, legacyArtifact: unknown) {
  const source = asRecord(rawSource);
  const v1 = asRecord(legacyArtifact) as LegacyV1Artifact;
  const sourceName = asText(source.source) || asText(v1.source) || "unknown";
  const sourcePath = canonicalSourcePath(v1.sourcePath);
  const sourceRevision = asText(source.updatedAt) || asText(v1.updatedAt) || null;
  return {
    namespace: "mona-life",
    source: sourceName,
    sourcePath,
    sourceRevision,
  };
}

function compareGeneratedToLegacy(args: {
  legacyEntries: Array<{ entry: unknown; index: number; id: string }>;
  generatedEntries: LegacyV1ArtifactEntry[];
}) {
  const legacyById = new Map(args.legacyEntries.map((entry) => [entry.id, entry]));
  const generatedById = new Map<string, LegacyV1ArtifactEntry>();
  const mismatchReasons: string[] = [];
  for (const entry of args.generatedEntries) {
    const id = asText(entry.id);
    if (!id) {
      mismatchReasons.push("generated_entry_missing_id");
      continue;
    }
    if (generatedById.has(id)) mismatchReasons.push(`duplicate_generated_id:${id}`);
    generatedById.set(id, entry);
  }
  const missingLegacyIds = args.legacyEntries
    .filter((entry) => !generatedById.has(entry.id))
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));
  const unexpectedLegacyIds = [...generatedById.keys()]
    .filter((id) => !legacyById.has(id))
    .sort((a, b) => a.localeCompare(b));
  for (const legacy of args.legacyEntries) {
    const generated = generatedById.get(legacy.id);
    if (!generated) continue;
    const upstream = asRecord(legacy.entry);
    if (asText(generated.ko) !== asText(upstream.ko) || asText(generated.en) !== asText(upstream.en)) {
      mismatchReasons.push(`generated_content_mismatch:${legacy.id}`);
    }
  }
  if (args.generatedEntries.length !== args.legacyEntries.length) {
    mismatchReasons.push("generated_eligible_count_mismatch");
  }
  return { missingLegacyIds, unexpectedLegacyIds, mismatchReasons: mismatchReasons.sort((a, b) => a.localeCompare(b)) };
}

export function buildWindDownMaterialBootstrap(args: {
  sourcePath: string;
  legacyArtifactPath: string;
  expectedLegacyEntryCount?: number;
}): WindDownMaterialBootstrapResult {
  const sourceBytes = readFileSync(args.sourcePath);
  const legacyArtifactBytes = readFileSync(args.legacyArtifactPath);
  const rawSource = JSON.parse(sourceBytes.toString("utf8")) as unknown;
  const legacyArtifact = JSON.parse(legacyArtifactBytes.toString("utf8")) as unknown;
  const legacyEntries = asLegacyEntries(rawSource);
  const generatedEntries = asGeneratedEntries(legacyArtifact);
  const source = sourceMetadata(rawSource, legacyArtifact);
  const expectedLegacyEntryCount = args.expectedLegacyEntryCount ?? WINDDOWN_LEGACY_V1_EXPECTED_ENTRY_COUNT;
  const compared = compareGeneratedToLegacy({ legacyEntries, generatedEntries });
  const artifact = buildWindDownMaterialArtifactV2({
    source,
    mode: "legacy-v1-bootstrap",
    generatedAt: source.sourceRevision ?? "1970-01-01T00:00:00.000Z",
    rows: legacyEntries.map((entry) => upstreamRow({
      entry: entry.entry,
      index: entry.index,
      legacyV1Id: entry.id,
      source,
    })),
  });
  const mismatchReasons = [
    ...compared.mismatchReasons,
    ...(compared.missingLegacyIds.length === 0 ? [] : ["missing_legacy_v1_entries"]),
    ...(compared.unexpectedLegacyIds.length === 0 ? [] : ["unexpected_legacy_v1_entries"]),
    ...(legacyEntries.length === expectedLegacyEntryCount ? [] : ["recomputed_eligible_count_not_expected"]),
    ...(generatedEntries.length === expectedLegacyEntryCount ? [] : ["generated_eligible_count_not_expected"]),
    ...(artifact.migration.legacyAliasCoverage.expectedCount === expectedLegacyEntryCount ? [] : ["alias_coverage_expected_count_not_expected"]),
    ...(artifact.migration.legacyAliasCoverage.mappedCount === expectedLegacyEntryCount ? [] : ["alias_coverage_mapped_count_not_expected"]),
    ...(artifact.migration.legacyAliasCoverage.missingCount === 0 ? [] : ["alias_coverage_missing_aliases"]),
    ...(artifact.migration.legacyAliasCoverage.unaliasedRowCount === 0 ? [] : ["alias_coverage_unaliased_rows"]),
    ...(artifact.migration.legacyAliasCoverage.status === "complete" ? [] : ["alias_coverage_not_complete"]),
  ].sort((a, b) => a.localeCompare(b));
  const receipt: BootstrapReceipt = {
    schemaVersion: 1,
    kind: "winddown-material-v2-bootstrap-receipt",
    source: {
      digest: sha256(sourceBytes),
      entryCount: Array.isArray(asRecord(rawSource).entries) ? asRecord(rawSource).entries.length : 0,
      namespace: source.namespace,
      source: source.source,
      sourcePath: source.sourcePath,
      sourceRevision: source.sourceRevision,
    },
    legacyV1: {
      artifactDigest: sha256(legacyArtifactBytes),
      expectedEligibleCount: expectedLegacyEntryCount,
      recomputedEligibleCount: legacyEntries.length,
      generatedEligibleCount: generatedEntries.length,
      matchedCount: legacyEntries.length - compared.missingLegacyIds.length,
      missingLegacyIds: compared.missingLegacyIds,
      unexpectedLegacyIds: compared.unexpectedLegacyIds,
      mismatchReasons,
      upstreamVerifiedInSourceCount: legacyEntries.filter((entry) => asRecord(entry.entry).verifiedInSource === true).length,
      staticVerification: "exact-legacy-v1-join",
      status: mismatchReasons.length === 0 && compared.unexpectedLegacyIds.length === 0 ? "complete" : "blocked",
    },
    artifact: {
      digest: artifact.digest,
      staticCandidateCount: artifact.summary.staticCandidateCount,
      quarantineCount: artifact.summary.quarantinedCount,
      aliasCoverage: artifact.migration.legacyAliasCoverage,
    },
  };
  return {
    candidate: { schemaVersion: 1, artifact, receipt },
    passed: receipt.legacyV1.status === "complete",
  };
}

export function writeWindDownMaterialBootstrapCandidate(args: {
  targetPath: string;
  candidate: WindDownMaterialBootstrapCandidate;
}) {
  const targetPath = path.resolve(args.targetPath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(args.candidate, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, targetPath);
}

function defaultSourcePath() {
  const siblingSourcePath = path.resolve(
    process.cwd(),
    "../../../../../../02_For_Mona/00_Project/mona-life/data/english/expression-bank.json",
  );
  if (existsSync(siblingSourcePath)) return siblingSourcePath;
  throw new Error(
    "MONA_LIFE_EXPRESSION_BANK_SOURCE is required outside the canonical agents-workspace checkout",
  );
}

function parseCliArguments(argv: string[]) {
  let check = false;
  let writeCandidate: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      check = true;
      continue;
    }
    if (argument === "--write-candidate") {
      const target = argv[index + 1];
      if (!target) throw new Error("--write-candidate requires a path");
      writeCandidate = target;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (check && writeCandidate) throw new Error("--check and --write-candidate cannot be combined");
  return { check: check || !writeCandidate, writeCandidate };
}

export function runWindDownMaterialBootstrapCommand(args: {
  sourcePath: string;
  legacyArtifactPath: string;
  check: boolean;
  writeCandidate: string | null;
  expectedLegacyEntryCount?: number;
}) {
  if (args.check && args.writeCandidate) throw new Error("check mode must not write a candidate");
  const result = buildWindDownMaterialBootstrap({
    sourcePath: args.sourcePath,
    legacyArtifactPath: args.legacyArtifactPath,
    expectedLegacyEntryCount: args.expectedLegacyEntryCount,
  });
  if (!result.passed) throw new Error(`bootstrap validation failed: ${result.candidate.receipt.legacyV1.mismatchReasons.join(", ")}`);
  if (args.writeCandidate) writeWindDownMaterialBootstrapCandidate({ targetPath: args.writeCandidate, candidate: result.candidate });
  return result;
}

function main() {
  const cli = parseCliArguments(process.argv.slice(2));
  const sourcePath = process.env.MONA_LIFE_EXPRESSION_BANK_SOURCE?.trim() || defaultSourcePath();
  const legacyArtifactPath = process.env.WINDDOWN_LEGACY_V1_ARTIFACT?.trim()
    || path.join(process.cwd(), "src/features/mona-vnext/coach/expressionBank.generated.json");
  const result = runWindDownMaterialBootstrapCommand({
    sourcePath,
    legacyArtifactPath,
    check: cli.check,
    writeCandidate: cli.writeCandidate,
  });
  console.log(JSON.stringify({
    status: "PASS",
    recomputedEligibleCount: result.candidate.receipt.legacyV1.recomputedEligibleCount,
    generatedEligibleCount: result.candidate.receipt.legacyV1.generatedEligibleCount,
    mappedCount: result.candidate.receipt.artifact.aliasCoverage.mappedCount,
    staticCandidateCount: result.candidate.receipt.artifact.staticCandidateCount,
    quarantineCount: result.candidate.receipt.artifact.quarantineCount,
    sourceDigest: result.candidate.receipt.source.digest,
    artifactDigest: result.candidate.receipt.artifact.digest,
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
