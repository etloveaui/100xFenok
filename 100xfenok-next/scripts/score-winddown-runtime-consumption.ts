import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { WINDDOWN_PUBLISHED_LKG_BUILD } from "../src/generated/winddown-published-lkg";
import {
  assertWindDownMaterialLkg,
  assertWindDownMaterialLkgPointer,
  assertWindDownRuntimeProjection,
  assertWindDownRuntimeProjectionPointer,
  canonicalWindDownLkgJson,
  makeWindDownLkgPointer,
  windDownLkgBlobPath,
  windDownLkgBlobText,
  windDownLkgBody,
  windDownLkgPointerPath,
  windDownLkgPointerText,
  windDownRuntimeProjectionBody,
  windDownRuntimeProjectionText,
  type WindDownLkgMaterial,
  type WindDownMaterialLkg,
  type WindDownMaterialLkgBody,
  type WindDownRuntimeProjection,
} from "../src/features/winddown/content/lkgContract";
import {
  buildWindDownStudyMaterialFromRuntimeProjection,
  loadWindDownStudyMaterial,
} from "../src/features/winddown/server/publishedMaterialAdapter";
import {
  buildWindDownRuntimeProjection,
  generateWindDownPublishedLkgModule,
} from "./generate-winddown-published-lkg";

function resolveProjectImport(
  fromFile: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return null;
  const unresolved = specifier.startsWith("@/")
    ? path.join(process.cwd(), "src", specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const withoutExtension = unresolved.replace(/\.(?:mjs|cjs|js|jsx)$/, "");
  const candidates = [
    unresolved,
    withoutExtension,
    `${withoutExtension}.ts`,
    `${withoutExtension}.tsx`,
    path.join(withoutExtension, "index.ts"),
    path.join(withoutExtension, "index.tsx"),
  ];
  return (
    candidates.find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    ) ?? null
  );
}

function importSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function collectRuntimeGraph(
  entryFiles: string[],
): Array<{ file: string; specifier: string }> {
  const queue = [...entryFiles];
  const visited = new Set<string>();
  const graph: Array<{ file: string; specifier: string }> = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    if (
      file.endsWith(
        path.join("src", "lib", "server", "public-assets.ts"),
      )
    ) {
      continue;
    }
    for (const specifier of importSpecifiers(file)) {
      graph.push({ file, specifier });
      const dependency = resolveProjectImport(file, specifier);
      if (dependency && !visited.has(dependency)) queue.push(dependency);
    }
  }
  return graph;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function fixtureMaterial(args: {
  id: string;
  ko: string;
  en: string;
  acceptedVariants: string[];
}): WindDownLkgMaterial {
  return {
    id: args.id,
    sourceLocator: `fixture:${args.id}`,
    legacyAliases: [],
    ko: args.ko,
    en: args.en,
    acceptedVariants: args.acceptedVariants,
    difficulty: 1,
    grounded: true,
    verifiedInSource: true,
    provenance: {
      namespace: "winddown-runtime-fixture",
      source: "deterministic-test",
      sourcePath: "scripts/score-winddown-runtime-consumption.ts",
    },
    sourceMetadata: {
      wordCount: args.en.trim().split(/\s+/).length,
      pattern: null,
      variationsEn: args.acceptedVariants,
      theme: null,
      register: null,
      note: null,
      enrichment: {
        upstreamSourceId: null,
        addedAt: null,
        extractedAt: null,
        enrichedAt: null,
        enrichVersion: null,
        upstreamVerifiedInSource: true,
        sibling: null,
      },
    },
    materialWarnings: [],
    staticQaStatus: "passed",
  };
}

function fixtureLkg(): WindDownMaterialLkg {
  const body: WindDownMaterialLkgBody = {
    schemaVersion: 1,
    kind: "winddown-material-lkg",
    artifactDigest: "b".repeat(64),
    materials: [
      fixtureMaterial({
        id: "winddown-material-a",
        ko: "나는 준비가 됐어.",
        en: "I am ready.",
        acceptedVariants: ["I'm ready."],
      }),
      fixtureMaterial({
        id: "winddown-material-b",
        ko: "다시 한번 말해 줄래?",
        en: "Could you say that again?",
        acceptedVariants: ["Can you say that again?"],
      }),
    ],
    quarantine: [
      {
        canonicalId: "winddown-material-static-quarantined",
        legacyAliases: ["legacy-static-quarantined"],
      },
    ],
    migration: {
      legacyAliasBootstrap: { policy: "record-v1-aliases-once" },
      legacyAliasMap: [
        { legacyV1Id: "legacy-material-a", canonicalId: "winddown-material-a" },
        {
          legacyV1Id: "legacy-static-quarantined",
          canonicalId: "winddown-material-static-quarantined",
        },
        {
          legacyV1Id: "legacy-luna-quarantined",
          canonicalId: "winddown-material-luna-quarantined",
        },
      ],
      legacyAliasCoverage: { status: "complete" },
    },
    advisorOverlay: [
      {
        materialId: "winddown-material-a",
        receiptDigest: "c".repeat(64),
        requestedModel: "gpt-5.6-luna",
        responseModel: "gpt-5.6-luna-2026-07-31",
        evidence: ["Grounded in the approved English source."],
        enrichment: {
          chunks: ["I am"],
          distractors: ["I am not ready."],
          difficultyNote: "Short first-person present sentence.",
          scenarioTags: ["daily-life"],
          naturalnessFlags: ["natural"],
        },
      },
      {
        materialId: "winddown-material-b",
        receiptDigest: "c".repeat(64),
        requestedModel: "gpt-5.6-luna",
        responseModel: "gpt-5.6-luna-2026-07-31",
        evidence: ["Grounded in the approved English source."],
        enrichment: {
          chunks: ["Could you"],
          distractors: ["Could you stop?"],
          difficultyNote: "Short request for repetition.",
          scenarioTags: ["social"],
          naturalnessFlags: ["natural"],
        },
      },
    ],
    lunaQuarantine: [
      {
        materialId: "winddown-material-luna-quarantined",
        verdict: "needs_human_review",
        receiptDigest: "c".repeat(64),
        requestedModel: "gpt-5.6-luna",
        responseModel: "gpt-5.6-luna-2026-07-31",
        evidence: ["Requires human review before product exposure."],
      },
    ],
    advisorGate: {
      sourceActiveCount: 3,
      approvedCount: 2,
      needsHumanReviewCount: 1,
      rejectCount: 0,
      quarantinedCount: 1,
    },
  };
  return {
    ...body,
    contentDigest: sha256(canonicalWindDownLkgJson(body)),
  };
}

function writeFixtureCurrentLkg(args: {
  lkgRoot: string;
  lkg: WindDownMaterialLkg;
}): { pointerText: string; blobText: string; blobPath: string } {
  const pointer = makeWindDownLkgPointer(args.lkg.contentDigest);
  const pointerText = windDownLkgPointerText(pointer);
  const blobText = windDownLkgBlobText(args.lkg);
  const blobPath = windDownLkgBlobPath(args.lkg.contentDigest);
  mkdirSync(path.dirname(path.join(args.lkgRoot, blobPath)), {
    recursive: true,
  });
  writeFileSync(path.join(args.lkgRoot, windDownLkgPointerPath()), pointerText);
  writeFileSync(path.join(args.lkgRoot, blobPath), blobText);
  return { pointerText, blobText, blobPath };
}

async function main(): Promise<void> {
if (WINDDOWN_PUBLISHED_LKG_BUILD.status === "absent") {
  assert.equal(WINDDOWN_PUBLISHED_LKG_BUILD.runtimeProjection, null);
  const fallback = await loadWindDownStudyMaterial({
    dueExpressionIds: [],
    deferredExpressionIds: [],
  });
  assert.equal(fallback.metadata.source, "legacy-fallback");
  assert.equal(fallback.metadata.publicationStatus, "absent");
  assert.equal(fallback.metadata.advisor.available, false);
  assert(
    fallback.entries.length > 0,
    "legacy teacher-approved fallback must remain usable",
  );
  const fallbackResolved = await loadWindDownStudyMaterial({
    dueExpressionIds: [fallback.entries[0]!.id, "unknown-legacy-id"],
    deferredExpressionIds: [],
  });
  assert.deepEqual(fallbackResolved.dueExpressionIds, [
    fallback.entries[0]!.id,
  ]);
  assert.equal(fallbackResolved.resolution.due.directResolvedCount, 1);
  assert.equal(fallbackResolved.resolution.due.unresolvedCount, 1);
} else {
  assert.equal(WINDDOWN_PUBLISHED_LKG_BUILD.status, "published");
  const checkedInPointer = WINDDOWN_PUBLISHED_LKG_BUILD.runtimeProjection;
  assert(checkedInPointer, "a published build must export a runtime pointer");
  assertWindDownRuntimeProjectionPointer(checkedInPointer);
  const checkedInRuntimeAsset = path.join(
    process.cwd(),
    "public",
    checkedInPointer.assetPath.slice(1),
  );
  const checkedInRuntimeText = readFileSync(checkedInRuntimeAsset, "utf8");
  const checkedInProjection = JSON.parse(
    checkedInRuntimeText,
  ) as WindDownRuntimeProjection;
  assertWindDownRuntimeProjection(checkedInProjection);
  const checkedInAuditRoot = path.join(
    process.cwd(),
    "src/generated/winddown-published-lkg.audit",
  );
  const checkedInAuditPointer = JSON.parse(
    readFileSync(
      path.join(checkedInAuditRoot, windDownLkgPointerPath()),
      "utf8",
    ),
  ) as unknown;
  assertWindDownMaterialLkgPointer(checkedInAuditPointer);
  const checkedInFullLkg = JSON.parse(
    readFileSync(
      path.join(checkedInAuditRoot, checkedInAuditPointer.blobPath),
      "utf8",
    ),
  ) as WindDownMaterialLkg;
  assertWindDownMaterialLkg(checkedInFullLkg);
  assert.equal(
    sha256(canonicalWindDownLkgJson(windDownLkgBody(checkedInFullLkg))),
    checkedInAuditPointer.contentDigest,
    "the retained full audit LKG must still match its immutable pointer",
  );
  assert.deepEqual(
    checkedInProjection,
    buildWindDownRuntimeProjection(checkedInFullLkg),
    "the committed public projection must exactly match the retained signed full LKG",
  );
  const signedReceiptDigests = new Set([
    ...checkedInFullLkg.advisorOverlay.map((entry) => entry.receiptDigest),
    ...checkedInFullLkg.lunaQuarantine.map((entry) => entry.receiptDigest),
  ]);
  const retainedReceipts = readdirSync(
    path.join(checkedInAuditRoot, "receipts"),
  )
    .filter((name) => name.endsWith(".signed.json"))
    .map((name) =>
      JSON.parse(
        readFileSync(
          path.join(checkedInAuditRoot, "receipts", name),
          "utf8",
        ),
      ) as { receiptDigest?: unknown },
    );
  for (const receiptDigest of signedReceiptDigests) {
    const matchingReceipt = retainedReceipts.find(
      (receipt) => receipt.receiptDigest === receiptDigest,
    );
    assert(
      matchingReceipt,
      `missing retained signed receipt ${receiptDigest}`,
    );
  }
  assert.equal(
    WINDDOWN_PUBLISHED_LKG_BUILD.contentDigest,
    checkedInProjection.sourceContentDigest,
  );
  assert.equal(
    WINDDOWN_PUBLISHED_LKG_BUILD.artifactDigest,
    checkedInProjection.sourceArtifactDigest,
  );
  assert.equal(
    sha256(
      canonicalWindDownLkgJson(
        windDownRuntimeProjectionBody(checkedInProjection),
      ),
    ),
    checkedInPointer.projectionDigest,
  );
  assert.equal(checkedInProjection.materials.length, 423);
  assert.equal(checkedInProjection.aliases.length, 722);
  assert.equal(checkedInProjection.quarantine.length, 63);
  assert.equal(checkedInProjection.lunaQuarantinedMaterialIds.length, 236);
  const active = await loadWindDownStudyMaterial({
    dueExpressionIds: [],
    deferredExpressionIds: [],
  });
  assert.equal(active.metadata.source, "published-lkg");
  assert.equal(active.metadata.publicationStatus, "active");
  assert.equal(
    active.metadata.contentDigest,
    checkedInProjection.sourceContentDigest,
  );
  assert.equal(
    active.metadata.artifactDigest,
    checkedInProjection.sourceArtifactDigest,
  );
  assert.equal(active.entries.length, 423);
}

const fixtureProjection = buildWindDownRuntimeProjection(fixtureLkg());
const published = buildWindDownStudyMaterialFromRuntimeProjection({
  runtimeProjection: fixtureProjection,
  dueExpressionIds: [
    "legacy-material-a",
    "winddown-material-b",
    "legacy-luna-quarantined",
    "unresolved-due",
  ],
  deferredExpressionIds: [
    "legacy-material-a",
    "legacy-luna-quarantined",
    "unresolved-deferred",
  ],
});
assert.equal(published.metadata.source, "published-lkg");
assert.equal(published.metadata.publicationStatus, "active");
assert.deepEqual(
  published.entries.map((entry) => entry.id),
  ["winddown-material-a", "winddown-material-b"],
);
assert.deepEqual(published.dueExpressionIds, [
  "winddown-material-a",
  "winddown-material-b",
]);
assert.deepEqual(published.deferredExpressionIds, ["winddown-material-a"]);
assert.deepEqual(published.resolution.due, {
  inputCount: 4,
  resolvedCount: 2,
  directResolvedCount: 1,
  aliasResolvedCount: 1,
  unresolvedCount: 1,
  quarantinedCount: 1,
});
assert.deepEqual(published.resolution.deferred, {
  inputCount: 3,
  resolvedCount: 1,
  directResolvedCount: 0,
  aliasResolvedCount: 1,
  unresolvedCount: 1,
  quarantinedCount: 1,
});
assert.deepEqual(
  published
    .advisorForExpressionIds(["winddown-material-a"])
    .map((entry) => entry.materialId),
  ["winddown-material-a"],
);
assert.equal(published.metadata.advisor.overlayCount, 2);
assert.equal(published.metadata.advisor.receiptDigests.length, 1);
assert.equal(published.metadata.lunaQuarantinedMaterialCount, 1);
assert.equal(published.metadata.advisorGate?.needsHumanReviewCount, 1);

const publicationScratch = mkdtempSync(
  path.join(tmpdir(), "winddown-published-lkg-"),
);
try {
  const lkg = fixtureLkg();
  assert.equal(
    lkg.contentDigest,
    sha256(canonicalWindDownLkgJson(windDownLkgBody(lkg))),
    "the generated publication must start from a recomputed LKG content digest",
  );
  const lkgRoot = path.join(publicationScratch, "lkg");
  const outputPath = path.join(
    publicationScratch,
    "generated",
    "winddown-published-lkg.ts",
  );
  const artifactOutputRoot = path.join(publicationScratch, "audit");
  const publicRoot = path.join(publicationScratch, "public");
  const sourceArtifact = writeFixtureCurrentLkg({ lkgRoot, lkg });

  const firstPublication = generateWindDownPublishedLkgModule({
    lkgRoot,
    outputPath,
    artifactOutputRoot,
    publicRoot,
  });
  assert.equal(firstPublication.status, "published");
  assert.equal(firstPublication.lkg.contentDigest, lkg.contentDigest);
  assert.equal(firstPublication.runtimeProjection.materials.length, 2);
  assert.equal(firstPublication.runtimeProjection.aliases.length, 3);
  assert.equal(firstPublication.runtimeProjection.quarantine.length, 1);
  assert.equal(
    firstPublication.runtimeProjection.lunaQuarantinedMaterialIds.length,
    1,
  );
  assert.equal(
    readFileSync(firstPublication.runtimeAssetOutputPath, "utf8"),
    windDownRuntimeProjectionText(firstPublication.runtimeProjection),
    "the committed public projection must exactly match the verified signed LKG projection",
  );
  assert.equal(
    readFileSync(
      path.join(artifactOutputRoot, windDownLkgPointerPath()),
      "utf8",
    ),
    sourceArtifact.pointerText,
    "the audit artifact must preserve the exact current pointer bytes",
  );
  assert.equal(
    readFileSync(
      path.join(artifactOutputRoot, sourceArtifact.blobPath),
      "utf8",
    ),
    sourceArtifact.blobText,
    "the audit artifact must preserve the exact immutable blob bytes",
  );
  assert.equal(
    generateWindDownPublishedLkgModule({
      lkgRoot,
      outputPath,
      artifactOutputRoot,
      publicRoot,
    }).status,
    "noop",
    "a second identical build must not rewrite the module, public projection, or audit artifact",
  );

  const collisionPublicRoot = path.join(
    publicationScratch,
    "public-immutable-collision",
  );
  const collisionAssetPath = path.join(
    collisionPublicRoot,
    path.relative(publicRoot, firstPublication.runtimeAssetOutputPath),
  );
  mkdirSync(path.dirname(collisionAssetPath), { recursive: true });
  writeFileSync(collisionAssetPath, '{"tampered":true}');
  const collisionOutputPath = path.join(
    publicationScratch,
    "generated-after-immutable-collision.ts",
  );
  assert.throws(
    () =>
      generateWindDownPublishedLkgModule({
        lkgRoot,
        outputPath: collisionOutputPath,
        artifactOutputRoot,
        publicRoot: collisionPublicRoot,
      }),
    /published_lkg_immutable_collision/,
  );
  assert.equal(
    existsSync(collisionOutputPath),
    false,
    "an immutable public asset collision must block pointer module publication",
  );

  const orderedAuditFailureRoot = path.join(
    publicationScratch,
    "audit-pointer-failure",
  );
  const orderedFailureOutput = path.join(
    publicationScratch,
    "generated-after-audit-failure.ts",
  );
  const orderedFailurePublicRoot = path.join(
    publicationScratch,
    "public-after-audit-failure",
  );
  mkdirSync(path.join(orderedAuditFailureRoot, windDownLkgPointerPath()), {
    recursive: true,
  });
  assert.throws(() =>
    generateWindDownPublishedLkgModule({
      lkgRoot,
      outputPath: orderedFailureOutput,
      artifactOutputRoot: orderedAuditFailureRoot,
      publicRoot: orderedFailurePublicRoot,
    }),
  );
  assert.equal(
    readFileSync(
      path.join(orderedAuditFailureRoot, sourceArtifact.blobPath),
      "utf8",
    ),
    sourceArtifact.blobText,
    "the immutable audit blob must be written before the audit pointer",
  );
  assert.equal(
    existsSync(orderedFailureOutput),
    false,
    "the generated runtime module must be last and stay absent after audit failure",
  );
  assert.equal(
    existsSync(orderedFailurePublicRoot),
    false,
    "the public runtime projection must stay absent after audit failure",
  );

  const generatedPublicationSource = readFileSync(outputPath, "utf8");
  assert.deepEqual(importSpecifiers(outputPath), [
    "@/features/winddown/content/lkgContract",
  ]);
  const generatedCommonJs = ts.transpileModule(generatedPublicationSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const generatedModule = { exports: {} as Record<string, unknown> };
  new Function("exports", "module", generatedCommonJs)(
    generatedModule.exports,
    generatedModule,
  );
  const generatedBuild = generatedModule.exports
    .WINDDOWN_PUBLISHED_LKG_BUILD as {
    status: string;
    contentDigest: string | null;
    artifactDigest: string | null;
    runtimeProjection: unknown;
  };
  assert.equal(
    "WINDDOWN_PUBLISHED_LKG" in generatedModule.exports,
    false,
    "generated TypeScript must never embed or export material payloads",
  );
  assert.equal(
    generatedPublicationSource.includes('"materials"'),
    false,
    "generated TypeScript must contain pointer metadata only",
  );
  assert(
    Buffer.byteLength(generatedPublicationSource, "utf8") < 2_048,
    "generated pointer module must stay below 2 KiB",
  );
  assert.equal(generatedBuild.status, "published");
  assert.equal(generatedBuild.contentDigest, lkg.contentDigest);
  assert.equal(generatedBuild.artifactDigest, lkg.artifactDigest);
  assertWindDownRuntimeProjectionPointer(generatedBuild.runtimeProjection);
  const generatedRuntimeText = readFileSync(
    firstPublication.runtimeAssetOutputPath,
    "utf8",
  );
  const generatedProjection = JSON.parse(
    generatedRuntimeText,
  ) as WindDownRuntimeProjection;
  assertWindDownRuntimeProjection(generatedProjection);
  assert.equal(
    sha256(
      canonicalWindDownLkgJson(
        windDownRuntimeProjectionBody(generatedProjection),
      ),
    ),
    generatedBuild.runtimeProjection.projectionDigest,
    "the emitted pointer must retain the verified runtime projection digest",
  );
  assert.deepEqual(
    generatedProjection,
    buildWindDownRuntimeProjection(lkg),
    "the public runtime projection must be a deterministic projection of the signed full LKG",
  );
  const generatedSelection = buildWindDownStudyMaterialFromRuntimeProjection({
    runtimeProjection: generatedProjection,
    dueExpressionIds: ["legacy-material-a"],
    deferredExpressionIds: [],
  });
  assert.equal(generatedSelection.metadata.source, "published-lkg");
  assert.equal(generatedSelection.metadata.publicationStatus, "active");
  assert.deepEqual(generatedSelection.dueExpressionIds, [
    "winddown-material-a",
  ]);

  writeFileSync(
    path.join(lkgRoot, windDownLkgPointerPath()),
    JSON.stringify({
      ...makeWindDownLkgPointer(lkg.contentDigest),
      blobPath: "blobs/not-the-immutable-digest.json",
    }),
  );
  assert.throws(
    () =>
      generateWindDownPublishedLkgModule({
        lkgRoot,
        outputPath,
        artifactOutputRoot,
        publicRoot,
      }),
    /lkg_pointer_blob_path_invalid/,
    "a pointer may only reference the immutable blob derived from its digest",
  );
  writeFileSync(
    path.join(lkgRoot, windDownLkgPointerPath()),
    sourceArtifact.pointerText,
  );
  writeFileSync(
    path.join(lkgRoot, sourceArtifact.blobPath),
    sourceArtifact.blobText.replace("I am ready.", "I am readier."),
  );
  assert.throws(
    () =>
      generateWindDownPublishedLkgModule({
        lkgRoot,
        outputPath,
        artifactOutputRoot,
        publicRoot,
      }),
    /published_lkg_content_digest_invalid/,
    "a blob whose payload no longer matches its digest must never be published",
  );
} finally {
  rmSync(publicationScratch, { recursive: true, force: true });
}

const invalid = buildWindDownStudyMaterialFromRuntimeProjection({
  runtimeProjection: { ...fixtureProjection, advisorOverlay: [] },
  dueExpressionIds: [],
  deferredExpressionIds: [],
});
assert.equal(invalid.metadata.source, "legacy-fallback");
assert.equal(invalid.metadata.publicationStatus, "invalid");

if (
  WINDDOWN_PUBLISHED_LKG_BUILD.status === "published" &&
  WINDDOWN_PUBLISHED_LKG_BUILD.runtimeProjection
) {
  const checkedInPath = path.join(
    process.cwd(),
    "public",
    WINDDOWN_PUBLISHED_LKG_BUILD.runtimeProjection.assetPath.slice(1),
  );
  const tampered = JSON.parse(
    readFileSync(checkedInPath, "utf8"),
  ) as WindDownRuntimeProjection;
  tampered.materials[0] = {
    ...tampered.materials[0]!,
    en: `${tampered.materials[0]!.en} tampered`,
  };
  const tamperedFallback = await loadWindDownStudyMaterial(
    { dueExpressionIds: [], deferredExpressionIds: [] },
    {
      readAssetText: async () => JSON.stringify(tampered),
      sha256: async (text) => sha256(text),
    },
  );
  assert.equal(tamperedFallback.metadata.source, "legacy-fallback");
  assert.equal(tamperedFallback.metadata.publicationStatus, "invalid");

  const missingFallback = await loadWindDownStudyMaterial(
    { dueExpressionIds: [], deferredExpressionIds: [] },
    {
      readAssetText: async () => {
        throw new Error("asset_unavailable");
      },
      sha256: async (text) => sha256(text),
    },
  );
  assert.equal(missingFallback.metadata.source, "legacy-fallback");
  assert.equal(missingFallback.metadata.publicationStatus, "invalid");
}

const projectRoot = process.cwd();
const adapterPath = path.join(
  projectRoot,
  "src/features/winddown/server/publishedMaterialAdapter.ts",
);
const generatedPath = path.join(
  projectRoot,
  "src/generated/winddown-published-lkg.ts",
);
const routePath = path.join(projectRoot, "src/app/api/winddown/study/route.ts");
const progressRoutePath = path.join(
  projectRoot,
  "src/app/api/winddown/progress/route.ts",
);
const graph = collectRuntimeGraph([adapterPath, generatedPath]);
const forbiddenImport =
  /(?:^node:fs$|^fs$|(?:^|\/)(?:candidate|candidates|provider|providers|prompt|prompts)(?:\/|$)|winddown-luna|unsigned.*receipt|receipt.*unsigned)/i;
for (const edge of graph) {
  assert.equal(
    forbiddenImport.test(edge.specifier),
    false,
    `runtime material graph reaches forbidden import ${edge.specifier} from ${path.relative(projectRoot, edge.file)}`,
  );
}
assert(
  graph.some((edge) => edge.specifier === "@/generated/winddown-published-lkg"),
  "adapter must consume the build-time publication pointer",
);
assert(
  graph.some((edge) => edge.specifier === "@/lib/server/public-assets"),
  "adapter must load the immutable projection through the public asset helper",
);
const generatedSource = readFileSync(generatedPath, "utf8");
assert.equal(generatedSource.includes("WINDDOWN_PUBLISHED_LKG ="), false);
assert.equal(generatedSource.includes('"materials"'), false);
assert(Buffer.byteLength(generatedSource, "utf8") < 2_048);
assert.equal(
  generatedSource.includes('kind":"winddown-material-runtime-projection-pointer"'),
  WINDDOWN_PUBLISHED_LKG_BUILD.status === "published",
);
assert.equal(generatedSource.includes("promote-winddown-material-lkg"), false);
assert.equal(generatedSource.includes("winddown-luna"), false);
assert.equal(generatedSource.includes("candidate"), false);
assert.equal(generatedSource.includes("provider"), false);
assert.equal(generatedSource.includes("receipt"), false);
const routeSource = readFileSync(routePath, "utf8");
assert.equal(routeSource.includes("loadWindDownStudyMaterial"), true);
assert.equal(routeSource.includes("await loadWindDownStudyMaterial"), true);
assert.equal(
  routeSource.includes("listTeacherApprovedMonaVnextExpressionEntries"),
  false,
);
const progressRouteSource = readFileSync(progressRoutePath, "utf8");
assert.equal(
  progressRouteSource.includes("await loadWindDownStudyMaterial"),
  true,
);

console.log(
  JSON.stringify(
    {
      status: "PASS",
      checkedInStaticPublication:
        WINDDOWN_PUBLISHED_LKG_BUILD.status === "absent"
          ? "absent_uses_explicit_legacy_fallback"
          : "immutable_public_projection_digest_and_runtime_selection_verified",
      generatedPublication:
        "verified_full_lkg_to_small_pointer_public_projection_and_exact_audit_artifact",
      publishedFixture: {
        activeMaterials: published.entries.length,
        aliasResolved:
          published.resolution.due.aliasResolvedCount +
          published.resolution.deferred.aliasResolvedCount,
        unresolved:
          published.resolution.due.unresolvedCount +
          published.resolution.deferred.unresolvedCount,
        quarantined:
          published.resolution.due.quarantinedCount +
          published.resolution.deferred.quarantinedCount,
        advisorEntries: published.metadata.advisor.overlayCount,
      },
      runtimeImportBoundary:
        "public_asset_helper_only_candidate_provider_prompt_audit_receipt_unreachable",
    },
    null,
    2,
  ),
);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
