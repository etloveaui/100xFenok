import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import {
  WINDDOWN_PUBLISHED_LKG,
  WINDDOWN_PUBLISHED_LKG_BUILD,
} from "../src/generated/winddown-published-lkg";
import {
  assertWindDownMaterialLkg,
  canonicalWindDownLkgJson,
  makeWindDownLkgPointer,
  windDownLkgBlobPath,
  windDownLkgBlobText,
  windDownLkgBody,
  windDownLkgPointerPath,
  windDownLkgPointerText,
  type WindDownLkgMaterial,
  type WindDownMaterialLkg,
  type WindDownMaterialLkgBody,
} from "../src/features/winddown/content/lkgContract";
import {
  buildWindDownStudyMaterialFromPublishedLkg,
  loadWindDownStudyMaterial,
} from "../src/features/winddown/server/publishedMaterialAdapter";
import { generateWindDownPublishedLkgModule } from "./generate-winddown-published-lkg";

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

if (WINDDOWN_PUBLISHED_LKG_BUILD.status === "absent") {
  assert.equal(WINDDOWN_PUBLISHED_LKG, null);
  const fallback = loadWindDownStudyMaterial({
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
  const fallbackResolved = loadWindDownStudyMaterial({
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
  const checkedInLkg = WINDDOWN_PUBLISHED_LKG;
  assert(checkedInLkg, "a published build must export an LKG payload");
  assertWindDownMaterialLkg(checkedInLkg);
  assert.equal(
    WINDDOWN_PUBLISHED_LKG_BUILD.contentDigest,
    checkedInLkg.contentDigest,
  );
  assert.equal(
    WINDDOWN_PUBLISHED_LKG_BUILD.artifactDigest,
    checkedInLkg.artifactDigest,
  );
  assert.equal(
    sha256(canonicalWindDownLkgJson(windDownLkgBody(checkedInLkg))),
    checkedInLkg.contentDigest,
  );
  const active = loadWindDownStudyMaterial({
    dueExpressionIds: [],
    deferredExpressionIds: [],
  });
  assert.equal(active.metadata.source, "published-lkg");
  assert.equal(active.metadata.publicationStatus, "active");
  assert.equal(active.metadata.contentDigest, checkedInLkg.contentDigest);
  assert.equal(active.metadata.artifactDigest, checkedInLkg.artifactDigest);
}

const published = buildWindDownStudyMaterialFromPublishedLkg({
  publishedLkg: fixtureLkg(),
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
  const sourceArtifact = writeFixtureCurrentLkg({ lkgRoot, lkg });

  const firstPublication = generateWindDownPublishedLkgModule({
    lkgRoot,
    outputPath,
    artifactOutputRoot,
  });
  assert.equal(firstPublication.status, "published");
  assert.equal(firstPublication.lkg.contentDigest, lkg.contentDigest);
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
    }).status,
    "noop",
    "a second identical build must not rewrite the generated module or audit artifact",
  );

  const orderedAuditFailureRoot = path.join(
    publicationScratch,
    "audit-pointer-failure",
  );
  const orderedFailureOutput = path.join(
    publicationScratch,
    "generated-after-audit-failure.ts",
  );
  mkdirSync(path.join(orderedAuditFailureRoot, windDownLkgPointerPath()), {
    recursive: true,
  });
  assert.throws(() =>
    generateWindDownPublishedLkgModule({
      lkgRoot,
      outputPath: orderedFailureOutput,
      artifactOutputRoot: orderedAuditFailureRoot,
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
  const generatedLkg = generatedModule.exports
    .WINDDOWN_PUBLISHED_LKG as WindDownMaterialLkg;
  const generatedBuild = generatedModule.exports
    .WINDDOWN_PUBLISHED_LKG_BUILD as {
    status: string;
    contentDigest: string | null;
    artifactDigest: string | null;
  };
  assert.equal(generatedBuild.status, "published");
  assert.equal(generatedBuild.contentDigest, lkg.contentDigest);
  assert.equal(generatedBuild.artifactDigest, lkg.artifactDigest);
  assert.equal(
    sha256(canonicalWindDownLkgJson(windDownLkgBody(generatedLkg))),
    generatedLkg.contentDigest,
    "the emitted static module must retain the verified content digest",
  );
  const generatedSelection = buildWindDownStudyMaterialFromPublishedLkg({
    publishedLkg: generatedLkg,
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
    () => generateWindDownPublishedLkgModule({ lkgRoot, outputPath }),
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
    () => generateWindDownPublishedLkgModule({ lkgRoot, outputPath }),
    /published_lkg_content_digest_invalid/,
    "a blob whose payload no longer matches its digest must never be published",
  );
} finally {
  rmSync(publicationScratch, { recursive: true, force: true });
}

const invalid = buildWindDownStudyMaterialFromPublishedLkg({
  publishedLkg: { ...fixtureLkg(), advisorOverlay: [] },
  dueExpressionIds: [],
  deferredExpressionIds: [],
});
assert.equal(invalid.metadata.source, "legacy-fallback");
assert.equal(invalid.metadata.publicationStatus, "invalid");

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
  "adapter must consume the build-time static publication module",
);
const generatedSource = readFileSync(generatedPath, "utf8");
if (WINDDOWN_PUBLISHED_LKG_BUILD.status === "absent") {
  assert.equal(
    generatedSource.includes(
      "WINDDOWN_PUBLISHED_LKG: WindDownMaterialLkg | null = null",
    ),
    true,
  );
} else {
  assert.equal(
    generatedSource.includes("WINDDOWN_PUBLISHED_LKG: WindDownMaterialLkg ="),
    true,
  );
  assert.equal(generatedSource.includes('status: "published"'), true);
}
assert.equal(generatedSource.includes("promote-winddown-material-lkg"), false);
assert.equal(generatedSource.includes("winddown-luna"), false);
const routeSource = readFileSync(routePath, "utf8");
assert.equal(routeSource.includes("loadWindDownStudyMaterial"), true);
assert.equal(
  routeSource.includes("listTeacherApprovedMonaVnextExpressionEntries"),
  false,
);

console.log(
  JSON.stringify(
    {
      status: "PASS",
      checkedInStaticPublication:
        WINDDOWN_PUBLISHED_LKG_BUILD.status === "absent"
          ? "absent_uses_explicit_legacy_fallback"
          : "published_lkg_metadata_contract_digest_and_runtime_selection_verified",
      generatedPublication:
        "verified_current_pointer_blob_to_static_module_and_exact_audit_artifact",
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
        "candidate_luna_provider_prompt_fs_unsigned_receipt_unreachable",
    },
    null,
    2,
  ),
);
