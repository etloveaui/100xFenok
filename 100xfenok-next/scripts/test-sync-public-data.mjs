#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXCLUDED_PUBLIC_DATA_FILES,
  EXCLUDED_PUBLIC_DATA_ROOTS,
  RESTRICTED_DERIVED_PUBLIC_DATA_ROOTS,
  RESTRICTED_DERIVED_PUBLIC_DATA_FILES,
  deriveRestrictedDerivedPublicDataRoots,
  deriveRestrictedDerivedPublicDataFiles,
  syncPublicData,
  syncStockanalysisEtfShardProjection,
} from "./sync-public-data.mjs";
import { inspectCloudflareAssetBudget } from "./check-cloudflare-asset-budget.mjs";
import {
  MARKET_FACTS_SHARD_COUNT,
  fetchMarketFactsFromShard,
  marketFactsFromShard,
  marketFactsShardFileName,
  marketFactsShardUrl,
} from "../src/lib/market-facts-shard.mjs";
import {
  STOCKANALYSIS_ETF_SHARD_COUNT,
  STOCKANALYSIS_ETF_SHARD_MAX_BYTES,
  sha256Text,
  stockanalysisEtfManifestSha256,
  stockanalysisEtfPayloadDocumentFromShard,
  stockanalysisEtfPayloadFromShard,
  stockanalysisEtfShardFileName,
  stockanalysisEtfShardId,
} from "../src/lib/stockanalysis-etf-shard.mjs";
import { checkPublicMirror } from "./check-fenok-public-mirror-guard.mjs";
import { checkSyncExclusionsAgainstRegistry } from "../../scripts/check-lane-registry-sync.mjs";
import { LANE_REGISTRY } from "../../scripts/lib/lane-registry.mjs";
import {
  deriveExcludedPublicDataFiles,
  deriveExcludedPublicDataRoots,
  deriveForbiddenPrivateDataSupplyRoots,
} from "../../scripts/lib/lane-routing.mjs";
import { derivedPrivateFileOutputs } from "../../scripts/lib/derived-asset-registry.mjs";
import { FORBIDDEN_PRIVATE_DATA_SUPPLY_ROOTS } from "./check-fenok-public-mirror-guard.mjs";
import { PRIVATE_DATA_SUPPLY_ROOTS } from "../../scripts/build-phase2-closeout-indexes.mjs";

// Lane-routing parity gate (#366 item 4): directory roots AND exact-file
// exclusions are registry-derived in the sync consumer (one fail-closed
// SSOT); mirror-guard roots retain exact parity checks.
// Equality is TRUE SET equality (both sides deduped, then compared order-free).
{
  const setEqual = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
  // equality semantics pinned: deduped both sides, order-free (sol fh-155 B1)
  assert.equal(setEqual(["x"], ["x", "x"]), true, "set equality must be duplicate-insensitive");
  assert.equal(setEqual(["x"], ["y"]), false);

  // registry-parameter honored end to end (sol fh-155 B2): an injected
  // registry with NO declared exceptions must derive accordingly.
  const derivedRoots = deriveExcludedPublicDataRoots();
  const derivedLaneFiles = deriveExcludedPublicDataFiles();
  const derivedAssetFiles = deriveRestrictedDerivedPublicDataFiles();
  const derivedFiles = [...new Set([...derivedLaneFiles, ...derivedAssetFiles])].sort();
  const derivedGuardRoots = deriveForbiddenPrivateDataSupplyRoots();
  const withoutExceptions = { ...LANE_REGISTRY, declared_exceptions: [] };
  assert.equal(deriveExcludedPublicDataRoots(withoutExceptions).includes("admin/data-supply-state"), false,
    "deriveExcludedPublicDataRoots must honor the injected registry's declared_exceptions");
  assert.equal(deriveForbiddenPrivateDataSupplyRoots(withoutExceptions).includes("yf/migration-evidence"), false,
    "deriveForbiddenPrivateDataSupplyRoots must honor the injected registry's declared_exceptions");
  assert.equal(setEqual(derivedRoots, EXCLUDED_PUBLIC_DATA_ROOTS), true,
    `registry-derived sync roots diverge from the consumer exclusion set: derived=${JSON.stringify(derivedRoots)} consumer=${JSON.stringify(EXCLUDED_PUBLIC_DATA_ROOTS)}`);
  assert.equal(setEqual(derivedFiles, EXCLUDED_PUBLIC_DATA_FILES), true,
    `registry-derived sync files diverge from the consumer exclusion set: lane=${JSON.stringify(derivedLaneFiles)} asset=${JSON.stringify(derivedAssetFiles)} consumer=${JSON.stringify(EXCLUDED_PUBLIC_DATA_FILES)}`);
  assert.equal(setEqual(derivedGuardRoots, FORBIDDEN_PRIVATE_DATA_SUPPLY_ROOTS), true,
    `registry-derived guard roots diverge from the hand list: derived=${JSON.stringify(derivedGuardRoots)} hand=${JSON.stringify(FORBIDDEN_PRIVATE_DATA_SUPPLY_ROOTS)}`);
  // Semantic invariant (no tautology): a canonical of a public/public_mirror
  // plane lane or of a plane-enrolled lane (declared public_mirror) must never
  // land in the exact-file deletion set — a temporarily empty public_mirror
  // list (mirror ownership moved to the merge boundary) is not a privacy
  // declaration, so tracked LKG mirror fallbacks stay copyable.
  for (const lane of LANE_REGISTRY.lanes) {
    const planeEnrolled = lane.privacy_class !== "private" || lane.roots.public_mirror.length > 0;
    if (!planeEnrolled) continue;
    for (const canonical of lane.roots.canonical_outputs) {
      assert.equal(
        derivedLaneFiles.includes(canonical.replace(/^data\//, "")),
        false,
        `public or plane-enrolled canonical must never derive into exact-file deletion: ${canonical} (lane ${lane.id})`,
      );
    }
  }
  for (const derived of [derivedRoots, derivedGuardRoots]) {
    assert.equal(derived.includes("admin/yahoo-batch-quote-history"), true,
      "the raw Yahoo batch quote/history admin store must stay withheld from the public mirror (Cloudflare asset-budget regression guard)");
    assert.equal(derived.includes("yf/finance"), false,
      "the shared public Yahoo finance namespace must not derive as private");
    assert.equal(derived.includes("yf/etf-details"), true,
      "the private Yahoo ETF detail namespace must remain withheld");
  }
  assert.deepEqual(
    deriveRestrictedDerivedPublicDataRoots(),
    [
      {
        assetId: "feno_rim_recovery_research",
        relativeRoot: "computed/feno-rim-recovery",
        allowedFiles: [],
      },
      {
        assetId: "feno_rim_v2_research",
        relativeRoot: "computed/feno-rim-v2",
        allowedFiles: [],
      },
      {
        assetId: "fenok_rim",
        relativeRoot: "computed/fenok-rim",
        allowedFiles: [
          "computed/fenok-rim/fair-values.json",
          "computed/fenok-rim/payout-history.json",
          "computed/fenok-rim/sustainable-index-ranges.public.json",
        ],
      },
      {
        assetId: "rim_index",
        relativeRoot: "computed/rim-index",
        allowedFiles: ["computed/rim-index/inputs.json"],
      },
    ],
    "derived directory allowlists must come from the derived-asset registry",
  );
  assert.deepEqual(
    RESTRICTED_DERIVED_PUBLIC_DATA_ROOTS,
    deriveRestrictedDerivedPublicDataRoots(),
    "the active restricted-root policy must equal its registry derivation",
  );
  assert.deepEqual(
    RESTRICTED_DERIVED_PUBLIC_DATA_FILES,
    deriveRestrictedDerivedPublicDataFiles(),
    "the active restricted-file policy must equal its derived-asset registry derivation",
  );
  assert.deepEqual(
    RESTRICTED_DERIVED_PUBLIC_DATA_FILES,
    derivedPrivateFileOutputs().map((relativePath) => relativePath.replace(/^data\//u, "")),
    "every private single-file derived output must be withheld from the generic public walk",
  );

  // materialize.py coverage: every derived private root must be covered by the
  // Python private-token lists (either path form) — the third consumer of the
  // same fact family (#21). Content-level tokens stay hand-authored by design.
  const materializeSource = fs.readFileSync(
    fileURLToPath(new URL("../../scripts/materialize_data_supply_public.py", import.meta.url)),
    "utf8",
  );
  for (const root of derivedGuardRoots) {
    const bareForm = `${root}/`;
    const dataForm = root.startsWith("admin/") ? `data/${root}/` : null;
    const covered = materializeSource.includes(bareForm) || (dataForm !== null && materializeSource.includes(dataForm));
    assert.equal(covered, true, `materialize_data_supply_public.py does not cover private root ${root} (#21 parity)`);
  }
  assert.equal(
    setEqual(
      PRIVATE_DATA_SUPPLY_ROOTS,
      derivedGuardRoots.map((root) => root.endsWith(".json") ? root : `${root}/`),
    ),
    true,
    "data-usage manifest private roots must derive exactly from the lane registry",
  );
}

const DETECTION_FLOOR_REPORT = "admin/data-supply-detection-floor.json";
const EXPECTED_PRIVATE_PROXY_FILES = Object.freeze([
  "computed/fenok_news_tone_proxy.json",
  "computed/fenok_news_tone_proxy_history.json",
  "computed/fenok_social_attention_proxy.json",
  "computed/fenok_social_attention_proxy_history.json",
]);
const EXPECTED_PRIVATE_DERIVED_FILES = Object.freeze([
  "computed/etf_action_index.json",
  "computed/fenok_etf_signals.json",
  "computed/fenok_flow_proxies.json",
  "computed/fenok_flow_proxies_history.json",
  "computed/fenok_news_tone_proxy.json",
  "computed/fenok_news_tone_proxy_history.json",
  "computed/fenok_occ_options_volume.json",
  "computed/fenok_occ_options_volume_history.json",
  "computed/fenok_signal_lens_proxies.json",
  "computed/fenok_signal_lens_proxies_history.json",
  "computed/fenok_signal_lens_proxies_summary.json",
  "computed/fenok_signals.json",
  "computed/fenok_social_attention_proxy.json",
  "computed/fenok_social_attention_proxy_history.json",
]);
const EXPECTED_PRIVATE_EXACT_FILES = Object.freeze([
  ...EXPECTED_PRIVATE_DERIVED_FILES,
  "admin/fenok-edge-proxy-coverage-review.json",
  "sec-13f/investors/griffin.json",
]);

// Lane Registry ⇄ exclusion cross-check (BACKLOG #366 step 2): roots derive
// from the registry, and the gate still fails closed if a consumer drops one.
{
  const gate = checkSyncExclusionsAgainstRegistry({ excludedRoots: EXCLUDED_PUBLIC_DATA_ROOTS });
  assert.equal(
    gate.ok,
    true,
    `registry/sync exclusion mismatch: ${JSON.stringify({
      missing_exclusions: gate.missing_exclusions,
      undeclared_exclusions: gate.undeclared_exclusions,
    })}`,
  );
  assert.equal(EXCLUDED_PUBLIC_DATA_ROOTS.includes("admin/finra-ats"), true,
    "FINRA ATS raw admin root must be registry-derived into the public-sync exclusion");
  const missingFinra = checkSyncExclusionsAgainstRegistry({
    excludedRoots: EXCLUDED_PUBLIC_DATA_ROOTS.filter((root) => root !== "admin/finra-ats"),
  });
  assert.deepEqual(
    missingFinra.missing_exclusions,
    [{ lane: "finra_ats_weekly", root: "admin/finra-ats" }],
    "removing the FINRA ATS exclusion must fail with the exact lane/root pair",
  );
}

// Root/file shape split (2026-07-19 deploy-crash class): sync-public-data's
// visit() hard-requires every EXCLUDED_PUBLIC_DATA_ROOTS entry that exists on
// disk to be a directory. A file-shaped entry stays latent until its lane's
// first successful run commits the artifact, then every build crashes
// ("excluded source root must be a directory" — the apewisdom
// fenok_social_attention_proxy.json firing). File-shaped private canonicals
// must therefore live in the FILES list, on the registry derivation (and
// therefore the consumer constant).
{
  for (const [label, list] of [
    ["EXCLUDED_PUBLIC_DATA_ROOTS", EXCLUDED_PUBLIC_DATA_ROOTS],
    ["deriveExcludedPublicDataRoots()", deriveExcludedPublicDataRoots()],
  ]) {
    for (const entry of list) {
      assert.equal(entry.endsWith(".json"), false, `${label} carries a file-shaped path: ${entry}`);
    }
  }
  for (const expectedFile of EXPECTED_PRIVATE_PROXY_FILES) {
    assert.equal(
      EXCLUDED_PUBLIC_DATA_FILES.includes(expectedFile),
      true,
      `private proxy file missing from EXCLUDED_PUBLIC_DATA_FILES: ${expectedFile}`,
    );
  }
  assert.deepEqual(
    RESTRICTED_DERIVED_PUBLIC_DATA_FILES,
    EXPECTED_PRIVATE_DERIVED_FILES,
    "private derived single-file outputs changed without updating the boundary contract",
  );

  // Value-changing derivation case: a mirrorless private lane with one
  // file-shaped and one directory-shaped canonical must split across the two
  // derived lists instead of both landing in roots.
  const probe = JSON.parse(JSON.stringify(LANE_REGISTRY.lanes.find((lane) => lane.id === "apewisdom_attention")));
  probe.id = "zz_shape_split_probe";
  probe.roots.canonical_outputs = [
    "data/computed/zz_shape_split_probe.json",
    "data/computed/zz_shape_split_probe_store",
  ];
  const probeRegistry = { ...LANE_REGISTRY, lanes: [...LANE_REGISTRY.lanes, probe] };
  assert.equal(deriveExcludedPublicDataRoots(probeRegistry).includes("computed/zz_shape_split_probe.json"), false,
    "file-shaped canonical must NOT derive into the sync roots list");
  assert.equal(deriveExcludedPublicDataFiles(probeRegistry).includes("computed/zz_shape_split_probe.json"), true,
    "file-shaped canonical must derive into the sync files list");
  assert.equal(deriveExcludedPublicDataRoots(probeRegistry).includes("computed/zz_shape_split_probe_store"), true,
    "directory-shaped canonical must stay in the sync roots list");
  // The mirror guard is a shape-agnostic presence check, so file-shaped
  // canonicals stay in its forbidden list unchanged.
  assert.equal(deriveForbiddenPrivateDataSupplyRoots(probeRegistry).includes("computed/zz_shape_split_probe.json"), true,
    "mirror-guard derivation must keep forbidding file-shaped private canonicals");

  // public_canonical_outputs stay copyable: a lane that explicitly names a
  // file-shaped canonical as public must not derive it into the exact-file
  // exclusion, so the boundary may still copy it.
  const publicCanonicalProbe = JSON.parse(JSON.stringify(probe));
  publicCanonicalProbe.id = "zz_public_canonical_probe";
  publicCanonicalProbe.roots.canonical_outputs = [
    "data/computed/zz_public_canonical_probe_private.json",
    "data/computed/zz_public_canonical_probe_public.json",
  ];
  // public_canonical_outputs is a top-level lane field (record() shape), and
  // the derivation reads it from there — the probe must mirror that shape.
  publicCanonicalProbe.public_canonical_outputs = ["data/computed/zz_public_canonical_probe_public.json"];
  const publicCanonicalRegistry = { ...LANE_REGISTRY, lanes: [...LANE_REGISTRY.lanes, publicCanonicalProbe] };
  assert.equal(deriveExcludedPublicDataFiles(publicCanonicalRegistry).includes("computed/zz_public_canonical_probe_private.json"), true,
    "unnamed file-shaped canonical must derive into the sync files list");
  assert.equal(deriveExcludedPublicDataFiles(publicCanonicalRegistry).includes("computed/zz_public_canonical_probe_public.json"), false,
    "explicit public_canonical_outputs must stay copyable (not derived into the sync files list)");
  assert.equal(deriveExcludedPublicDataRoots(publicCanonicalRegistry).includes("computed/zz_public_canonical_probe_public.json"), false,
    "explicit public_canonical_outputs must not derive into the sync roots list either");

  // Plane-enrolled probe: declaring public_mirror (mirror ownership moved to
  // the merge boundary) must keep the canonical out of the exact-file
  // deletion, even for a private-class lane.
  const planeEnrolledProbe = JSON.parse(JSON.stringify(probe));
  planeEnrolledProbe.id = "zz_plane_enrolled_probe";
  planeEnrolledProbe.roots.public_mirror = ["100xfenok-next/public/data/computed/zz_plane_enrolled_probe.json"];
  const planeEnrolledRegistry = { ...LANE_REGISTRY, lanes: [...LANE_REGISTRY.lanes, planeEnrolledProbe] };
  assert.equal(deriveExcludedPublicDataFiles(planeEnrolledRegistry).includes("computed/zz_shape_split_probe.json"), false,
    "plane-enrolled canonical must not derive into the exact-file exclusion");
  assert.equal(deriveExcludedPublicDataRoots(planeEnrolledRegistry).includes("computed/zz_shape_split_probe_store"), false,
    "plane-enrolled canonical must not derive into the sync roots list either");

  // Public-plane probe: a public_mirror-class lane with a temporarily empty
  // public_mirror list must never derive into exact-file deletion — the
  // privacy_class gate, not the mirror list, decides withholding.
  const publicPlaneProbe = JSON.parse(JSON.stringify(probe));
  publicPlaneProbe.id = "zz_public_plane_probe";
  publicPlaneProbe.privacy_class = "public_mirror";
  publicPlaneProbe.roots.public_mirror = [];
  const publicPlaneRegistry = { ...LANE_REGISTRY, lanes: [...LANE_REGISTRY.lanes, publicPlaneProbe] };
  assert.equal(deriveExcludedPublicDataFiles(publicPlaneRegistry).includes("computed/zz_shape_split_probe.json"), false,
    "public_mirror-plane canonical must never derive into exact-file deletion merely because public_mirror is temporarily empty");
  assert.equal(deriveExcludedPublicDataRoots(publicPlaneRegistry).includes("computed/zz_shape_split_probe_store"), false,
    "public_mirror-plane canonical must never derive into the sync roots list either");
}

function realBaselineRootArg() {
  const index = process.argv.indexOf("--real-baseline-root");
  if (index < 0) return null;
  if (!process.argv[index + 1]) throw new Error("--real-baseline-root requires a path");
  return path.resolve(process.argv[index + 1]);
}

function copyRealBaselineFixture(targetRoot) {
  const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const repoRoot = path.resolve(appRoot, "..");
  if (fs.readdirSync(targetRoot).length !== 0) {
    throw new Error(`real baseline fixture root must be empty: ${targetRoot}`);
  }
  const copies = [
    ["data/admin/data-supply-state/v1", "data/admin/data-supply-state/v1"],
    ["data/admin/data-usage-manifest.json", "data/admin/data-usage-manifest.json"],
    ["data/computed/data-supply/etf-detail", "data/computed/data-supply/etf-detail"],
    ["data/stockanalysis/etfs", "data/stockanalysis/etfs"],
    ["data/admin/data-usage-manifest.json", "100xfenok-next/public/data/admin/data-usage-manifest.json"],
    ["data/computed/data-supply/etf-detail", "100xfenok-next/public/data/computed/data-supply/etf-detail"],
    ["100xfenok-next/public/data/stockanalysis/etfs", "100xfenok-next/public/data/stockanalysis/etfs"],
  ];
  for (const [sourceRel, targetRel] of copies) {
    const source = path.join(repoRoot, sourceRel);
    const target = path.join(targetRoot, targetRel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, preserveTimestamps: true, errorOnExist: true });
  }
  console.log(`test-sync-public-data real baseline fixture ready: ${targetRoot}`);
}

const requestedRealBaselineRoot = realBaselineRootArg();
if (requestedRealBaselineRoot) {
  copyRealBaselineFixture(requestedRealBaselineRoot);
  process.exit(0);
}

function write(root, relativePath, body = "{}\n") {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
  return target;
}

function lstatIfPresent(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function snapshotNode(target) {
  const stat = lstatIfPresent(target);
  if (!stat) return { type: "missing" };
  if (stat.isSymbolicLink()) return { type: "symlink", target: fs.readlinkSync(target) };
  if (stat.isDirectory()) {
    return {
      type: "directory",
      entries: fs.readdirSync(target).sort().map((entry) => [entry, snapshotNode(path.join(target, entry))]),
    };
  }
  if (stat.isFile()) {
    return {
      type: "file",
      mode: stat.mode & 0o777,
      body: fs.readFileSync(target).toString("base64"),
    };
  }
  if (stat.isFIFO()) return { type: "fifo", mode: stat.mode & 0o777 };
  return { type: "special", mode: stat.mode & 0o777 };
}

function snapshotPaths(paths) {
  return paths.map((target) => [target, snapshotNode(target)]);
}

function seedPrivateRoots(sourceRoot, destinationRoot) {
  for (const relativeRoot of EXCLUDED_PUBLIC_DATA_ROOTS) {
    write(sourceRoot, `${relativeRoot}/private.json`, '{"secret":true}\n');
    write(destinationRoot, `${relativeRoot}/stale.json`, '{"stale":true}\n');
  }
  // File-shaped private proxies are seeded as REGULAR FILES so the fixture
  // exercises the root/file split (2026-07-19 deploy-crash class): on the
  // source side they must be withheld as excluded exact files, and stale
  // destination copies must be removed as exact files.
  for (const relativeFile of EXPECTED_PRIVATE_EXACT_FILES) {
    write(sourceRoot, relativeFile, '{"secret":true}\n');
    write(destinationRoot, relativeFile, '{"stale":true}\n');
  }
}

function makeSyncCase(parentRoot, label) {
  const root = fs.mkdtempSync(path.join(parentRoot, `${label}-`));
  const sourceRoot = path.join(root, "data");
  const destinationRoot = path.join(root, "100xfenok-next", "public", "data");
  write(sourceRoot, "safe/keep.json", '{"safe":true}\n');
  write(destinationRoot, "admin/safe-sibling.json", '{"sibling":true}\n');
  seedPrivateRoots(sourceRoot, destinationRoot);
  return { root, sourceRoot, destinationRoot };
}

function assertFenokRimRestrictedProjection(parentRoot) {
  const root = fs.mkdtempSync(path.join(parentRoot, "fenok-rim-restricted-"));
  const sourceRoot = path.join(root, "data");
  const destinationRoot = path.join(root, "100xfenok-next", "public", "data");
  const allowed = new Map([
    ["computed/fenok-rim/fair-values.json", '{"public":"fair-values"}\n'],
    ["computed/fenok-rim/payout-history.json", '{"public":"payout-history"}\n'],
    ["computed/fenok-rim/sustainable-index-ranges.public.json", '{"public":"redacted-range"}\n'],
  ]);
  const privateFiles = [
    "computed/fenok-rim/sustainable-index-ranges.json",
    "computed/fenok-rim/identification-receipt.json",
    "computed/fenok-rim/input-diagnostics.json",
    "computed/fenok-rim/index-residual-roe-diagnostic.json",
    "computed/fenok-rim/membership-sensitivity-2026.json",
    "computed/fenok-rim/russell2000-official-fundamentals.json",
    "computed/fenok-rim/new-secret.json",
  ];
  const privateRoot = "computed/fenok-rim/russell2000-history";
  for (const [relativePath, body] of allowed) {
    write(sourceRoot, relativePath, body);
    write(destinationRoot, relativePath, '{"stale":true}\n');
  }
  for (const relativePath of privateFiles) {
    write(sourceRoot, relativePath, '{"secret":true}\n');
    write(destinationRoot, relativePath, '{"stale-secret":true}\n');
  }
  write(sourceRoot, `${privateRoot}/latest.json`, '{"secret":true}\n');
  write(sourceRoot, `${privateRoot}/factsheet.pdf`, "%PDF-private\n");
  write(destinationRoot, `${privateRoot}/latest.json`, '{"stale-secret":true}\n');
  write(destinationRoot, `${privateRoot}/factsheet.pdf`, "%PDF-stale-private\n");

  const sourceBefore = snapshotNode(sourceRoot);
  const destinationBefore = snapshotNode(destinationRoot);
  const rehearsal = syncPublicData({ sourceRoot, destinationRoot, dryRun: true, logger: () => {} });
  assert.equal(rehearsal.filesCopied, 3, "only the three registry-allowlisted RIM files may copy");
  assert.deepEqual([...rehearsal.restrictedSourceFilePaths].sort(), [...privateFiles].sort());
  assert.deepEqual(rehearsal.restrictedSourceRootPaths, [privateRoot]);
  assert.equal(rehearsal.removedRestrictedDestinationExactFiles, privateFiles.length);
  assert.equal(rehearsal.removedRestrictedDestinationRoots, 1);
  assert.deepEqual(
    [...rehearsal.removedRestrictedDestinationPaths].sort(),
    [...privateFiles, privateRoot].sort(),
  );
  assert.deepEqual(snapshotNode(sourceRoot), sourceBefore, "restricted dry-run must not mutate canonical data");
  assert.deepEqual(snapshotNode(destinationRoot), destinationBefore, "restricted dry-run must not mutate public data");

  const result = syncPublicData({ sourceRoot, destinationRoot, logger: () => {} });
  assert.equal(result.filesCopied, 3);
  for (const [relativePath, body] of allowed) {
    assert.equal(fs.readFileSync(path.join(destinationRoot, relativePath), "utf8"), body);
  }
  for (const relativePath of [...privateFiles, privateRoot]) {
    assert.equal(fs.existsSync(path.join(destinationRoot, relativePath)), false, `private RIM path survived: ${relativePath}`);
  }
  const firstWrite = snapshotNode(destinationRoot);
  const rerun = syncPublicData({ sourceRoot, destinationRoot, logger: () => {} });
  assert.equal(rerun.removedRestrictedDestinationExactFiles, 0);
  assert.equal(rerun.removedRestrictedDestinationRoots, 0);
  assert.deepEqual(snapshotNode(destinationRoot), firstWrite, "restricted sync must be byte-idempotent");

  const outside = write(root, "outside.json", "outside\n");
  fs.symlinkSync(outside, path.join(destinationRoot, "computed/fenok-rim/new-link.json"));
  assert.throws(
    () => syncPublicData({ sourceRoot, destinationRoot, logger: () => {} }),
    /restricted derived tree contains a symlink/i,
  );
  fs.unlinkSync(path.join(destinationRoot, "computed/fenok-rim/new-link.json"));

  const drifting = write(destinationRoot, privateFiles[0], '{"stale-secret":true}\n');
  const publicBeforeDrift = new Map(
    [...allowed.keys()].map((relativePath) => [relativePath, fs.readFileSync(path.join(destinationRoot, relativePath), "utf8")]),
  );
  assert.throws(
    () => syncPublicData({
      sourceRoot,
      destinationRoot,
      logger: () => {},
      beforeMutation: () => fs.appendFileSync(drifting, " "),
    }),
    /identity drift/i,
  );
  for (const [relativePath, body] of publicBeforeDrift) {
    assert.equal(fs.readFileSync(path.join(destinationRoot, relativePath), "utf8"), body);
  }
}

async function assertRimIndexRestrictedProjection(parentRoot) {
  const root = fs.mkdtempSync(path.join(parentRoot, "rim-index-restricted-"));
  const sourceRoot = path.join(root, "data");
  const destinationRoot = path.join(root, "100xfenok-next", "public", "data");
  const allowedPath = "computed/rim-index/inputs.json";
  const deniedPaths = [
    "computed/rim-index/FENO_RIM_FIVE_CANONICAL_CURRENT.json",
    "computed/rim-index/feno-index-rim-five-canonical-criteria.json",
    "computed/rim-index/arbitrary-sibling.json",
  ];

  write(sourceRoot, allowedPath, '{"public":"inputs"}\n');
  write(destinationRoot, allowedPath, '{"stale":"inputs"}\n');
  for (const relativePath of deniedPaths) {
    write(sourceRoot, relativePath, '{"private":true}\n');
    write(destinationRoot, relativePath, '{"stale-private":true}\n');
  }

  const sourceBefore = snapshotNode(sourceRoot);
  const destinationBefore = snapshotNode(destinationRoot);
  const rehearsal = syncPublicData({ sourceRoot, destinationRoot, dryRun: true, logger: () => {} });
  assert.equal(rehearsal.filesCopied, 1, "RIM index sync may copy only exact inputs.json");
  assert.deepEqual([...rehearsal.restrictedSourceFilePaths].sort(), [...deniedPaths].sort());
  assert.equal(rehearsal.restrictedSourceFiles, deniedPaths.length);
  assert.equal(rehearsal.removedRestrictedDestinationExactFiles, deniedPaths.length);
  assert.deepEqual(
    [...rehearsal.removedRestrictedDestinationPaths].sort(),
    [...deniedPaths].sort(),
    "pre-existing RIM index siblings must be planned for removal",
  );
  assert.deepEqual(snapshotNode(sourceRoot), sourceBefore, "RIM index dry-run must not mutate canonical data");
  assert.deepEqual(snapshotNode(destinationRoot), destinationBefore, "RIM index dry-run must not mutate public data");

  const result = syncPublicData({ sourceRoot, destinationRoot, logger: () => {} });
  assert.equal(result.filesCopied, 1);
  assert.equal(fs.readFileSync(path.join(destinationRoot, allowedPath), "utf8"), '{"public":"inputs"}\n');
  for (const relativePath of deniedPaths) {
    assert.equal(
      fs.existsSync(path.join(destinationRoot, relativePath)),
      false,
      `quarantined RIM index sibling survived public sync: ${relativePath}`,
    );
    assert.equal(fs.existsSync(path.join(sourceRoot, relativePath)), true, "sync must not delete canonical inputs");
  }

  const appRoot = path.dirname(path.dirname(destinationRoot));
  const cleanGuard = await checkPublicMirror({ appRoot, repoRoot: root });
  assert.equal(cleanGuard.ok, true, cleanGuard.violations.join("\n"));
  for (const relativePath of deniedPaths) {
    write(destinationRoot, relativePath, '{"leaked":true}\n');
    const leakedGuard = await checkPublicMirror({ appRoot, repoRoot: root });
    assert.equal(leakedGuard.ok, false, `mirror guard must reject pre-existing public leak: ${relativePath}`);
    assert.equal(
      leakedGuard.violations.some((violation) => (
        violation === `public/data/${relativePath}: forbidden public file`
      )),
      true,
      `mirror guard must identify the leaked RIM index sibling: ${relativePath}`,
    );
    fs.rmSync(path.join(destinationRoot, relativePath));
  }
}

async function assertMarketFactsShardProjection(parentRoot) {
  assert.equal(MARKET_FACTS_SHARD_COUNT, 1024);
  assert.equal(marketFactsShardFileName("AAPL"), "0779.json");
  assert.equal(marketFactsShardFileName("NVDA"), "0470.json");
  assert.equal(marketFactsShardFileName("SPY"), "0509.json");
  assert.equal(marketFactsShardFileName("BRK.B"), "0570.json");
  assert.equal(marketFactsShardFileName("BF-B"), "0474.json");
  assert.equal(marketFactsShardFileName("230360.KQ"), "0153.json");
  assert.equal(marketFactsShardUrl(" spy "), "/data/computed/market_facts/shards/0509.json");

  const fixture = makeSyncCase(parentRoot, "market-facts-shards");
  const payloads = {
    NVDA: {
      schema_version: "market-facts/v1",
      ticker: "NVDA",
      asset_type: "stock",
      generated_at: "2026-07-13T00:00:00Z",
      identity: { name: "NVIDIA", exchange: "Nasdaq" },
      facts: { beta: { value: 1.71, source: "yf", as_of: "2026-07-11" } },
      financials: { revenue: { value: 130_000_000_000, source: "stockanalysis" } },
      resolver: { selected_sources: ["yf", "stockanalysis"] },
    },
    SPY: {
      schema_version: "market-facts/v1",
      ticker: "SPY",
      asset_type: "etf",
      generated_at: "2026-07-13T00:00:00Z",
      identity: { name: "SPDR S&P 500 ETF Trust", exchange: "NYSE Arca" },
      facts: { beta: { value: 1, source: "stockanalysis.overview" } },
      etf: { holdings_count: 503, sectors: [{ name: "Technology", weight: 0.3 }] },
      resolver: { selected_sources: ["stockanalysis.overview"] },
    },
    "BRK.B": {
      schema_version: "market-facts/v1",
      ticker: "BRK.B",
      asset_type: "stock",
      generated_at: "2026-07-13T00:00:00Z",
      facts: { beta: { value: 0.87, source: "yf" } },
      resolver: { selected_sources: ["yf"] },
    },
    "BF-B": {
      schema_version: "market-facts/v1",
      ticker: "BF-B",
      asset_type: "stock",
      generated_at: "2026-07-13T00:00:00Z",
      facts: { beta: { value: 0.68, source: "yf" } },
      resolver: { selected_sources: ["yf"] },
    },
  };
  const indexBody = `${JSON.stringify({ count: Object.keys(payloads).length, rows: Object.keys(payloads) }, null, 2)}\n`;
  write(fixture.sourceRoot, "computed/market_facts/index.json", indexBody);
  for (const [ticker, payload] of Object.entries(payloads)) {
    write(fixture.sourceRoot, `computed/market_facts/tickers/${ticker}.json`, `${JSON.stringify(payload, null, 2)}\n`);
  }
  write(fixture.destinationRoot, "computed/market_facts/tickers/NVDA.json", '{"stale":true}\n');
  write(fixture.destinationRoot, "computed/market_facts/shards/stale.json", '{"stale":true}\n');

  const sourceBefore = snapshotNode(fixture.sourceRoot);
  const destinationBefore = snapshotNode(fixture.destinationRoot);
  const rehearsal = syncPublicData({
    sourceRoot: fixture.sourceRoot,
    destinationRoot: fixture.destinationRoot,
    dryRun: true,
    logger: () => {},
  });
  assert.equal(rehearsal.filesCopied, 2, "index and safe fixture file remain ordinary mirror files");
  assert.equal(rehearsal.marketFactsTickerFiles, 4);
  assert.equal(rehearsal.marketFactsShardFiles, 1024);
  assert.equal(rehearsal.removedTransformedDestinationRoots, 2);
  assert.deepEqual(snapshotNode(fixture.sourceRoot), sourceBefore, "sharding must never mutate canonical ticker files");
  assert.deepEqual(snapshotNode(fixture.destinationRoot), destinationBefore, "dry-run must not mutate the public mirror");

  const result = syncPublicData({
    sourceRoot: fixture.sourceRoot,
    destinationRoot: fixture.destinationRoot,
    logger: () => {},
  });
  assert.equal(result.marketFactsTickerFiles, 4);
  assert.equal(result.marketFactsShardFiles, 1024);
  assert.equal(fs.existsSync(path.join(fixture.destinationRoot, "computed/market_facts/tickers")), false);
  assert.equal(fs.readFileSync(path.join(fixture.destinationRoot, "computed/market_facts/index.json"), "utf8"), indexBody);
  const shardRoot = path.join(fixture.destinationRoot, "computed/market_facts/shards");
  const shardFiles = fs.readdirSync(shardRoot).filter((name) => /^\d{4}\.json$/.test(name)).sort();
  assert.equal(shardFiles.length, 1024);
  assert.equal(fs.existsSync(path.join(shardRoot, "stale.json")), false);

  for (const [ticker, payload] of Object.entries(payloads)) {
    const shard = JSON.parse(fs.readFileSync(path.join(shardRoot, marketFactsShardFileName(ticker)), "utf8"));
    assert.deepEqual(shard[ticker], payload, `${ticker} must retain every source field in its deterministic shard`);
    assert.deepEqual(marketFactsFromShard(shard, ticker), payload);
  }
  assert.equal(marketFactsFromShard({}, "NVDA"), null);

  let fetchedUrl = null;
  let fetchedInit = null;
  const fetched = await fetchMarketFactsFromShard("nvda", {
    requestInit: { cache: "no-store" },
    fetchImpl: async (url, init) => {
      fetchedUrl = url;
      fetchedInit = init;
      const shard = JSON.parse(fs.readFileSync(path.join(shardRoot, marketFactsShardFileName("NVDA")), "utf8"));
      return { ok: true, status: 200, json: async () => shard };
    },
  });
  assert.equal(fetchedUrl, "/data/computed/market_facts/shards/0470.json");
  assert.deepEqual(fetchedInit, { cache: "no-store" });
  assert.deepEqual(fetched, payloads.NVDA);
  assert.equal(fetched.facts.beta.value, 1.71, "beta must survive the public projection unchanged");
  assert.equal(await fetchMarketFactsFromShard("NVDA", {
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => null }),
  }), null);
  await assert.rejects(
    () => fetchMarketFactsFromShard("NVDA", {
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => null }),
    }),
    /status 503/i,
  );

  const destinationAfter = snapshotNode(fixture.destinationRoot);
  syncPublicData({ sourceRoot: fixture.sourceRoot, destinationRoot: fixture.destinationRoot, logger: () => {} });
  assert.deepEqual(snapshotNode(fixture.destinationRoot), destinationAfter, "market-facts projection must be byte-idempotent");
  assert.deepEqual(snapshotNode(fixture.sourceRoot), sourceBefore, "canonical ticker files must remain byte-identical");
}

function stockanalysisEtfFixturePayload(ticker) {
  return {
    schema_version: "stockanalysis/v1",
    source: "stockanalysis",
    asset_type: "etf",
    ticker,
    source_as_of: "2026-07-28T20:00:00Z",
    fetched_at: "2026-07-29T01:19:39Z",
    overview: { name: `${ticker} ETF`, expense_ratio: 0.12 },
  };
}

function assertStockanalysisEtfShardProjection(parentRoot) {
  assert.equal(STOCKANALYSIS_ETF_SHARD_COUNT, 1024);
  assert.equal(stockanalysisEtfShardFileName("SPY"), "509.json");
  assert.equal(stockanalysisEtfShardFileName("brk.b"), "570.json");
  assert.equal(stockanalysisEtfShardFileName("$bf-b"), "474.json");

  const fixture = makeSyncCase(parentRoot, "stockanalysis-etf-shards");
  const payloads = Object.fromEntries(["SPY", "BRK.B", "BF-B", "IEFA"].map((ticker) => [
    ticker,
    stockanalysisEtfFixturePayload(ticker),
  ]));
  for (const [ticker, payload] of Object.entries(payloads)) {
    write(fixture.sourceRoot, `stockanalysis/etfs/${ticker}.json`, `${JSON.stringify(payload, null, 2)}\n`);
  }
  write(fixture.destinationRoot, "stockanalysis/etfs/SPY.json", '{"stale":true}\n');
  write(fixture.destinationRoot, "stockanalysis/etfs/shards/stale.json", '{"stale":true}\n');
  const sourceBefore = snapshotNode(fixture.sourceRoot);

  const rehearsal = syncPublicData({
    sourceRoot: fixture.sourceRoot,
    destinationRoot: fixture.destinationRoot,
    dryRun: true,
    logger: () => {},
  });
  assert.equal(rehearsal.stockanalysisEtfTickerFiles, 4);
  assert.equal(rehearsal.stockanalysisEtfShardFiles, STOCKANALYSIS_ETF_SHARD_COUNT);
  assert.equal(rehearsal.stockanalysisEtfManifestFiles, 1);
  assert.deepEqual(snapshotNode(fixture.sourceRoot), sourceBefore, "ETF sharding must not mutate canonical payloads");

  const result = syncStockanalysisEtfShardProjection({
    sourceRoot: fixture.sourceRoot,
    destinationRoot: fixture.destinationRoot,
    logger: () => {},
  });
  assert.equal(result.stockanalysisEtfTickerFiles, 4);
  assert.equal(result.stockanalysisEtfShardFiles, STOCKANALYSIS_ETF_SHARD_COUNT);
  assert.equal(result.stockanalysisEtfManifestFiles, 1);
  assert.deepEqual(snapshotNode(fixture.sourceRoot), sourceBefore, "canonical ETF bytes must remain unchanged");
  assert.equal(
    fs.readdirSync(path.join(fixture.destinationRoot, "stockanalysis", "etfs"))
      .filter((name) => name.endsWith(".json")).length,
    0,
    "shard-only ETF projection must emit no public top-level JSON files",
  );

  const shardRoot = path.join(fixture.destinationRoot, "stockanalysis", "etfs", "shards");
  const manifest = JSON.parse(fs.readFileSync(path.join(shardRoot, "index.json"), "utf8"));
  assert.equal(manifest.compatibility_mode, "shard-only");
  assert.equal(manifest.payload_count, 4);
  assert.equal(manifest.shards.length, STOCKANALYSIS_ETF_SHARD_COUNT);
  assert.equal(
    manifest.shards.every((entry) => entry.byte_length <= STOCKANALYSIS_ETF_SHARD_MAX_BYTES),
    true,
  );
  assert.equal(fs.existsSync(path.join(shardRoot, "stale.json")), false);
  for (const [ticker, payload] of Object.entries(payloads)) {
    const selected = { entry: manifest.shards[stockanalysisEtfShardId(ticker)] };
    assert.ok(selected, `${ticker} must resolve through the manifest`);
    const shard = JSON.parse(fs.readFileSync(path.join(shardRoot, selected.entry.path), "utf8"));
    const document = stockanalysisEtfPayloadDocumentFromShard(shard, ticker);
    const expectedRaw = fs.readFileSync(path.join(fixture.sourceRoot, "stockanalysis", "etfs", `${ticker}.json`), "utf8");
    assert.equal(document?.raw, expectedRaw, `${ticker} shard entry must retain the exact source bytes`);
    assert.equal(sha256Text(document?.raw ?? ""), sha256Text(expectedRaw), `${ticker} shard entry must retain the source SHA-256`);
    assert.deepEqual(document?.value, JSON.parse(expectedRaw), `${ticker} shard entry must parse the source bytes`);
    assert.deepEqual(stockanalysisEtfPayloadFromShard(shard, ticker), payload, `${ticker} must retain every source field`);
  }

  const destinationAfter = snapshotNode(fixture.destinationRoot);
  syncStockanalysisEtfShardProjection({ sourceRoot: fixture.sourceRoot, destinationRoot: fixture.destinationRoot, logger: () => {} });
  assert.deepEqual(snapshotNode(fixture.destinationRoot), destinationAfter, "ETF shard projection must be byte-idempotent");
  syncPublicData({ sourceRoot: fixture.sourceRoot, destinationRoot: fixture.destinationRoot, logger: () => {} });
  assert.equal(
    fs.readdirSync(path.join(fixture.destinationRoot, "stockanalysis", "etfs"))
      .filter((name) => name.endsWith(".json")).length,
    0,
    "second full sync must not recreate direct ETF files",
  );
  const activeSnapshotRoot = path.join(shardRoot, "snapshots", manifest.snapshot_id);
  write(activeSnapshotRoot, "unlisted.json", "{}\n");
  assert.throws(
    () => syncStockanalysisEtfShardProjection({
      sourceRoot: fixture.sourceRoot,
      destinationRoot: fixture.destinationRoot,
      logger: () => {},
    }),
    /immutable snapshot contains an unlisted or unsafe node/,
  );

  const identityMismatch = makeSyncCase(parentRoot, "stockanalysis-etf-identity-mismatch");
  write(
    identityMismatch.sourceRoot,
    "stockanalysis/etfs/SPY.json",
    `${JSON.stringify(stockanalysisEtfFixturePayload("spy"), null, 2)}\n`,
  );
  assert.throws(
    () => syncStockanalysisEtfShardProjection({
      sourceRoot: identityMismatch.sourceRoot,
      destinationRoot: identityMismatch.destinationRoot,
      logger: () => {},
    }),
    /strict StockAnalysis ETF identity\/timestamp mismatch/,
  );

  const unsafeParent = makeSyncCase(parentRoot, "stockanalysis-etf-unsafe-parent");
  write(
    unsafeParent.sourceRoot,
    "stockanalysis/etfs/SPY.json",
    `${JSON.stringify(stockanalysisEtfFixturePayload("SPY"), null, 2)}\n`,
  );
  const outside = path.join(parentRoot, "stockanalysis-etf-unsafe-parent-outside");
  fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, path.join(unsafeParent.destinationRoot, "stockanalysis"));
  assert.throws(
    () => syncStockanalysisEtfShardProjection({
      sourceRoot: unsafeParent.sourceRoot,
      destinationRoot: unsafeParent.destinationRoot,
      logger: () => {},
    }),
    /destination parent must be a real directory/,
  );
  assert.deepEqual(fs.readdirSync(outside), [], "standalone shard publication must not follow destination symlinks");
}

async function assertStockanalysisEtfShardPublicGuard(parentRoot) {
  const fixture = makeSyncCase(parentRoot, "stockanalysis-etf-shard-guard");
  const payload = stockanalysisEtfFixturePayload("SPY");
  write(fixture.sourceRoot, "stockanalysis/etfs/SPY.json", `${JSON.stringify(payload, null, 2)}\n`);
  syncPublicData({ sourceRoot: fixture.sourceRoot, destinationRoot: fixture.destinationRoot, logger: () => {} });
  const appRoot = path.dirname(path.dirname(fixture.destinationRoot));
  const valid = await checkPublicMirror({ appRoot, repoRoot: fixture.root });
  assert.equal(valid.ok, true, valid.violations.join("\n"));

  write(
    fixture.destinationRoot,
    "stockanalysis/etfs/SPY.json",
    `${JSON.stringify(payload, null, 2)}\n`,
  );
  const mixedMode = await checkPublicMirror({ appRoot, repoRoot: fixture.root });
  assert.equal(mixedMode.ok, false);
  assert.equal(
    mixedMode.violations.some((violation) => /shard-only projection must contain zero/.test(violation)),
    true,
  );
  fs.rmSync(path.join(fixture.destinationRoot, "stockanalysis", "etfs", "SPY.json"));

  const manifestPath = path.join(fixture.destinationRoot, "stockanalysis", "etfs", "shards", "index.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const provenanceMismatch = structuredClone(manifest);
  provenanceMismatch.provenance.source_payload_sha256 = "0".repeat(64);
  provenanceMismatch.manifest_sha256 = stockanalysisEtfManifestSha256(provenanceMismatch);
  fs.writeFileSync(manifestPath, `${JSON.stringify(provenanceMismatch)}\n`);
  const invalidProvenance = await checkPublicMirror({ appRoot, repoRoot: fixture.root });
  assert.equal(invalidProvenance.ok, false);
  assert.equal(
    invalidProvenance.violations.some((violation) => /canonical provenance digest mismatch/.test(violation)),
    true,
  );
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

  const firstShard = manifest.shards.find((entry) => entry.member_count > 0);
  const shardPath = path.join(fixture.destinationRoot, "stockanalysis", "etfs", "shards", firstShard.path);
  fs.appendFileSync(shardPath, " ");
  const invalid = await checkPublicMirror({ appRoot, repoRoot: fixture.root });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.violations.some((violation) => /hash\/byte-length mismatch/.test(violation)), true);

  fs.rmSync(path.join(fixture.destinationRoot, "stockanalysis", "etfs", "shards"), { recursive: true });
  const missing = await checkPublicMirror({ appRoot, repoRoot: fixture.root });
  assert.equal(missing.ok, false);
  assert.equal(missing.violations.some((violation) => /shard projection is missing while canonical ETF payloads exist/.test(violation)), true);

  fs.mkdirSync(path.join(fixture.sourceRoot, "stockanalysis", "etfs", "empty-directory"));
  const nestedCanonical = await checkPublicMirror({ appRoot, repoRoot: fixture.root });
  assert.equal(nestedCanonical.ok, false);
  assert.equal(nestedCanonical.violations.some((violation) => /canonical ETF root may contain only top-level JSON files/.test(violation)), true);
}

function marketFactsFixturePayload(ticker = "AAPL") {
  return `${JSON.stringify({
    schema_version: "market-facts/v1",
    ticker,
    asset_type: "stock",
    facts: { beta: { value: 1.23, source: "yf" } },
  })}\n`;
}

function assertCanonicalShardSourceFailsClosed(parentRoot) {
  const fixture = makeSyncCase(parentRoot, "canonical-shards-forbidden");
  write(fixture.sourceRoot, "computed/market_facts/index.json", "{}\n");
  write(fixture.sourceRoot, "computed/market_facts/tickers/AAPL.json", marketFactsFixturePayload());
  write(fixture.sourceRoot, "computed/market_facts/shards/stale.json", '{"must_not_publish":true}\n');
  const destinationBefore = snapshotNode(fixture.destinationRoot);
  assert.throws(
    () => syncPublicData({
      sourceRoot: fixture.sourceRoot,
      destinationRoot: fixture.destinationRoot,
      logger: () => {},
    }),
    /public-only market-facts shards/i,
  );
  assert.deepEqual(
    snapshotNode(fixture.destinationRoot),
    destinationBefore,
    "canonical shard input refusal must precede every destination mutation",
  );
}

function assertMissingCanonicalTickerSourceFailsClosed(parentRoot) {
  const fixture = makeSyncCase(parentRoot, "missing-canonical-tickers");
  write(fixture.sourceRoot, "computed/market_facts/index.json", "{}\n");
  const destinationBefore = snapshotNode(fixture.destinationRoot);
  assert.throws(
    () => syncPublicData({
      sourceRoot: fixture.sourceRoot,
      destinationRoot: fixture.destinationRoot,
      logger: () => {},
    }),
    /market-facts root exists without its ticker source root/i,
  );
  assert.deepEqual(
    snapshotNode(fixture.destinationRoot),
    destinationBefore,
    "missing canonical ticker source must fail before destination mutation",
  );
}

function assertOrphanedDestinationProjectionFailsClosed(parentRoot) {
  const fixture = makeSyncCase(parentRoot, "orphaned-destination-market-facts");
  write(fixture.destinationRoot, "computed/market_facts/tickers/AAPL.json", '{"stale":true}\n');
  write(fixture.destinationRoot, "computed/market_facts/shards/stale.json", '{"stale":true}\n');
  const destinationBefore = snapshotNode(fixture.destinationRoot);
  assert.throws(
    () => syncPublicData({
      sourceRoot: fixture.sourceRoot,
      destinationRoot: fixture.destinationRoot,
      logger: () => {},
    }),
    /without the canonical market-facts ticker source/i,
  );
  assert.deepEqual(
    snapshotNode(fixture.destinationRoot),
    destinationBefore,
    "orphaned public projection must fail before destination mutation",
  );
}

function assertMarketFactsSourceDriftFailsBeforeMutation(parentRoot) {
  const fixture = makeSyncCase(parentRoot, "market-facts-source-drift");
  write(fixture.sourceRoot, "computed/market_facts/index.json", "{}\n");
  const tickerPath = write(
    fixture.sourceRoot,
    "computed/market_facts/tickers/AAPL.json",
    marketFactsFixturePayload(),
  );
  write(fixture.destinationRoot, "computed/market_facts/tickers/AAPL.json", '{"stale":true}\n');
  write(fixture.destinationRoot, "computed/market_facts/shards/stale.json", '{"stale":true}\n');
  const outside = path.join(fixture.root, "outside-market-facts.json");
  fs.writeFileSync(outside, marketFactsFixturePayload());
  const destinationBefore = snapshotNode(fixture.destinationRoot);
  let hookRan = false;
  const error = captureSyncError({
    sourceRoot: fixture.sourceRoot,
    destinationRoot: fixture.destinationRoot,
    logger: () => {},
    beforeMutation: () => {
      hookRan = true;
      fs.unlinkSync(tickerPath);
      fs.symlinkSync(outside, tickerPath);
    },
  });
  assert.equal(hookRan, true, "source-drift fixture must reach the pre-mutation hook");
  assert.ok(error, "source ticker replacement must fail closed");
  assert.match(String(error.message), /source identity drift/i);
  assert.deepEqual(
    snapshotNode(fixture.destinationRoot),
    destinationBefore,
    "source ticker drift must be rejected before destination mutation",
  );
  assert.equal(fs.lstatSync(tickerPath).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(outside, "utf8"), marketFactsFixturePayload());
}

function createWrongNode(root, relativePath, kind, label) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (kind === "directory") {
    fs.mkdirSync(target);
    return { supported: true, target };
  }
  if (kind === "symlink") {
    const outside = path.join(path.dirname(root), `${label}-outside.json`);
    fs.writeFileSync(outside, "outside-untouched\n");
    fs.symlinkSync(outside, target);
    return { supported: true, target, outside };
  }
  if (kind === "fifo") {
    const result = spawnSync("mkfifo", [target], { encoding: "utf8" });
    if (result.error?.code === "ENOENT" || result.status !== 0) {
      fs.rmSync(target, { force: true });
      return { supported: false, target };
    }
    return { supported: true, target };
  }
  throw new Error(`unsupported wrong-node kind: ${kind}`);
}

function captureSyncError(options) {
  try {
    syncPublicData(options);
    return null;
  } catch (error) {
    return error;
  }
}

function assertWrongReportNodeFailsClosed(parentRoot, side, kind) {
  const fixture = makeSyncCase(parentRoot, `wrong-${side}-${kind}`);
  const reportRoot = side === "source" ? fixture.sourceRoot : fixture.destinationRoot;
  const wrongNode = createWrongNode(reportRoot, DETECTION_FLOOR_REPORT, kind, `${side}-${kind}`);
  if (!wrongNode.supported) {
    console.log(`test-sync-public-data: skipping unsupported ${side} FIFO fixture`);
    return;
  }
  const protectedPaths = [
    wrongNode.target,
    ...EXCLUDED_PUBLIC_DATA_ROOTS.map((relativeRoot) => path.join(fixture.destinationRoot, ...relativeRoot.split("/"))),
    path.join(fixture.destinationRoot, "admin", "safe-sibling.json"),
  ];
  const before = snapshotPaths(protectedPaths);
  const error = captureSyncError({
    sourceRoot: fixture.sourceRoot,
    destinationRoot: fixture.destinationRoot,
    logger: () => {},
  });
  assert.deepEqual(
    snapshotPaths(protectedPaths),
    before,
    `${side} ${kind} report refusal must not partially remove any destination target`,
  );
  assert.ok(error, `${side} ${kind} report node must fail closed`);
  assert.match(String(error.message), /data-supply-detection-floor|symlink|directory|special|regular|fifo|node/i);
  if (wrongNode.outside) assert.equal(fs.readFileSync(wrongNode.outside, "utf8"), "outside-untouched\n");
}

function assertPrivateRootFailureLeavesReportAndRoots(parentRoot) {
  const fixture = makeSyncCase(parentRoot, "wrong-private-root");
  const reportPath = write(fixture.destinationRoot, DETECTION_FLOOR_REPORT, '{"stale":true}\n');
  const unsafeRoot = path.join(fixture.destinationRoot, "yf", "etf-details");
  fs.rmSync(unsafeRoot, { recursive: true });
  const outside = path.join(fixture.root, "outside-private-root");
  fs.mkdirSync(outside);
  write(outside, "untouched.json", "outside-untouched\n");
  fs.symlinkSync(outside, unsafeRoot, "dir");
  const protectedPaths = [
    reportPath,
    ...EXCLUDED_PUBLIC_DATA_ROOTS.map((relativeRoot) => path.join(fixture.destinationRoot, ...relativeRoot.split("/"))),
  ];
  const before = snapshotPaths(protectedPaths);
  const error = captureSyncError({
    sourceRoot: fixture.sourceRoot,
    destinationRoot: fixture.destinationRoot,
    logger: () => {},
  });
  assert.ok(error, "unsafe private root must fail closed");
  assert.match(String(error.message), /symlink|private|excluded root/i);
  assert.deepEqual(snapshotPaths(protectedPaths), before, "private-root refusal must retain report and all roots");
  assert.equal(fs.readFileSync(path.join(outside, "untouched.json"), "utf8"), "outside-untouched\n");
}

function assertIdentityDriftFailsBeforeMutation(parentRoot) {
  const fixture = makeSyncCase(parentRoot, "identity-drift");
  const reportPath = write(fixture.destinationRoot, DETECTION_FLOOR_REPORT, '{"stale":true}\n');
  const outside = path.join(fixture.root, "drift-outside.json");
  fs.writeFileSync(outside, "outside-untouched\n");
  const protectedPaths = [
    ...EXCLUDED_PUBLIC_DATA_ROOTS.map((relativeRoot) => path.join(fixture.destinationRoot, ...relativeRoot.split("/"))),
    path.join(fixture.destinationRoot, "admin", "safe-sibling.json"),
  ];
  const before = snapshotPaths(protectedPaths);
  const originalLstatSync = fs.lstatSync;
  let driftInjected = false;
  let error = null;
  fs.lstatSync = function patchedLstatSync(target, ...args) {
    const stat = originalLstatSync.call(fs, target, ...args);
    if (!driftInjected && path.resolve(String(target)) === path.resolve(reportPath)) {
      fs.unlinkSync(reportPath);
      fs.symlinkSync(outside, reportPath);
      driftInjected = true;
    }
    return stat;
  };
  try {
    error = captureSyncError({
      sourceRoot: fixture.sourceRoot,
      destinationRoot: fixture.destinationRoot,
      logger: () => {},
    });
  } finally {
    fs.lstatSync = originalLstatSync;
  }
  assert.equal(driftInjected, true, "identity-drift fixture must intercept report preflight");
  assert.ok(error, "report identity drift must fail closed");
  assert.match(String(error.message), /identity|drift|changed|symlink/i);
  assert.equal(fs.lstatSync(reportPath).isSymbolicLink(), true);
  assert.deepEqual(snapshotPaths(protectedPaths), before, "identity drift must precede every destination mutation");
  assert.equal(fs.readFileSync(outside, "utf8"), "outside-untouched\n");
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-sync-public-data-"));

try {
  assert.deepEqual(
    EXCLUDED_PUBLIC_DATA_ROOTS,
    deriveExcludedPublicDataRoots(),
    "the excluded directory roots must remain exact registry derivations",
  );
  assert.deepEqual(
    EXCLUDED_PUBLIC_DATA_FILES,
    [...new Set([
      ...deriveExcludedPublicDataFiles(),
      ...deriveRestrictedDerivedPublicDataFiles(),
    ])].sort(),
    "the exact-file exclusion set must equal the lane plus derived-asset registry derivations",
  );
  assert.equal(
    EXCLUDED_PUBLIC_DATA_FILES.length,
    20,
    `the exact-file exclusion set must cover the six declared exceptions plus all private derived files, got ${EXCLUDED_PUBLIC_DATA_FILES.length}: ${JSON.stringify(EXCLUDED_PUBLIC_DATA_FILES)}`,
  );
  const expectedDerivedExactFiles = [
    DETECTION_FLOOR_REPORT,
    "admin/damodaran-shadow-parity.json",
    "admin/sec-13f-shadow-parity.json",
    "admin/lane-commit-manifest.json",
    ...EXPECTED_PRIVATE_EXACT_FILES,
    ...EXPECTED_PRIVATE_PROXY_FILES,
  ];
  for (const expectedFile of expectedDerivedExactFiles) {
    assert.equal(
      EXCLUDED_PUBLIC_DATA_FILES.includes(expectedFile),
      true,
      `derived exact-file exclusion missing: ${expectedFile}`,
    );
  }
  for (const copyableFile of [
    "macro/yahoo-ticker.json",
    "macro/fred-macro.json",
    "macro/fdic-tier1.json",
    "indices/sp500.json",
    "damodaran/industries.json",
    "stockanalysis/etf_universe.json",
    "stockanalysis/surfaces/index.json",
    "computed/fenok_occ_options_availability.json",
    "computed/market_facts/index.json",
  ]) {
    assert.equal(
      EXCLUDED_PUBLIC_DATA_FILES.includes(copyableFile),
      false,
      `public-copyable file must not derive into the exact-file exclusion: ${copyableFile}`,
    );
  }
  const sourceRoot = path.join(fixtureRoot, "data");
  const destinationRoot = path.join(fixtureRoot, "100xfenok-next", "public", "data");
  write(sourceRoot, "safe/keep.json", '{"safe":true}\n');
  const krxSlice2Body = '{"schema_version":"fenok_krx_public_kosdaq_market_cap_aggregate.v1","aggregate_only":true}\n';
  write(sourceRoot, "computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json", krxSlice2Body);
  const krxHistoryBody = '{"schema_version":"fenok_krx_public_bridge_history.v1","aggregate_only":true,"per_issuer_rows":false,"raw_public":false,"rows":[]}\n';
  write(sourceRoot, "computed/fenok-edge-korea-krx-bridge-history.json", krxHistoryBody);
  const sourceReportPath = write(sourceRoot, DETECTION_FLOOR_REPORT, '{"schema_version":"data-supply-detection-floor/v1"}\n');
  write(sourceRoot, "yf/finance/AAA.json", '{"public":true}\n');
  seedPrivateRoots(sourceRoot, destinationRoot);
  const destinationReportPath = write(destinationRoot, DETECTION_FLOOR_REPORT, '{"stale":true}\n');
  const safeAdminSiblingPath = write(destinationRoot, "admin/safe-sibling.json", '{"sibling":true}\n');
  write(destinationRoot, "destination-only/preserve.json", "{}\n");

  const sourceBeforeDryRun = snapshotNode(sourceRoot);
  const destinationBeforeDryRun = snapshotNode(destinationRoot);
  const rehearsal = syncPublicData({
    sourceRoot,
    destinationRoot,
    dryRun: true,
    logger: () => {},
  });
  assert.equal(rehearsal.dryRun, true);
  assert.equal(
    rehearsal.filesCopied,
    4,
    "public-safe files must copy while the canonical detection-floor report stays excluded",
  );
  // Exact-file exclusion set (order-insensitive contract; membership + count
  // are the pins, traversal order is not).
  const expectedExcludedExactFiles = [DETECTION_FLOOR_REPORT, ...EXPECTED_PRIVATE_EXACT_FILES].sort();
  const expectedDirectExcludedRoots = EXCLUDED_PUBLIC_DATA_ROOTS.filter((root) =>
    !RESTRICTED_DERIVED_PUBLIC_DATA_ROOTS.some((policy) => root.startsWith(`${policy.relativeRoot}/`))
  );
  assert.equal(rehearsal.excludedSourceFiles, 17);
  assert.equal(rehearsal.removedDestinationExactFiles, 17);
  assert.deepEqual([...rehearsal.excludedSourceFilePaths].sort(), expectedExcludedExactFiles);
  assert.deepEqual([...rehearsal.removedDestinationExactFilePaths].sort(), expectedExcludedExactFiles);
  assert.equal(rehearsal.excludedSourceRoots, expectedDirectExcludedRoots.length);
  assert.equal(rehearsal.removedDestinationRoots, EXCLUDED_PUBLIC_DATA_ROOTS.length);
  assert.equal(rehearsal.removedDestinationFiles, EXCLUDED_PUBLIC_DATA_ROOTS.length);
  assert.deepEqual(snapshotNode(sourceRoot), sourceBeforeDryRun, "dry-run must not mutate source bytes");
  assert.deepEqual(snapshotNode(destinationRoot), destinationBeforeDryRun, "dry-run must not mutate destination bytes");
  assert.equal(fs.existsSync(path.join(destinationRoot, "safe/keep.json")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/data-supply-state/stale.json")), true);
  assert.equal(fs.readFileSync(destinationReportPath, "utf8"), '{"stale":true}\n');
  assert.equal(fs.readFileSync(safeAdminSiblingPath, "utf8"), '{"sibling":true}\n');

  const result = syncPublicData({ sourceRoot, destinationRoot, logger: () => {} });
  assert.equal(result.filesCopied, 4);
  assert.equal(result.excludedSourceRoots, expectedDirectExcludedRoots.length);
  assert.equal(result.excludedSourceFiles, 17);
  assert.equal(result.removedDestinationRoots, EXCLUDED_PUBLIC_DATA_ROOTS.length);
  assert.equal(result.removedDestinationFiles, EXCLUDED_PUBLIC_DATA_ROOTS.length);
  assert.equal(result.removedDestinationExactFiles, 17);
  assert.deepEqual([...result.excludedSourceFilePaths].sort(), expectedExcludedExactFiles);
  assert.deepEqual([...result.removedDestinationExactFilePaths].sort(), expectedExcludedExactFiles);
  assert.equal(fs.readFileSync(path.join(destinationRoot, "safe/keep.json"), "utf8"), '{"safe":true}\n');
  assert.equal(
    fs.readFileSync(path.join(destinationRoot, "computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json"), "utf8"),
    krxSlice2Body,
    "Slice 2 canonical aggregate must be copied byte-identically to the public mirror",
  );
  assert.equal(
    fs.readFileSync(path.join(destinationRoot, "computed/fenok-edge-korea-krx-bridge-history.json"), "utf8"),
    krxHistoryBody,
    "bounded KRX history must be copied byte-identically to the public mirror",
  );
  assert.equal(fs.readFileSync(path.join(destinationRoot, "yf/finance/AAA.json"), "utf8"), '{"public":true}\n');
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/data-supply-state")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/finra_short_volume")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/occ_options_volume")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/yahoo_private_options")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/fred_yardeni")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/edgar_filings")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/nasdaq_giw_sox")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/oecd_cli")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "yf/etf-details")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "yf/migration-evidence")), false);
  assert.equal(lstatIfPresent(destinationReportPath), null);
  assert.equal(fs.readFileSync(sourceReportPath, "utf8"), '{"schema_version":"data-supply-detection-floor/v1"}\n');
  assert.equal(fs.readFileSync(safeAdminSiblingPath, "utf8"), '{"sibling":true}\n');
  assert.equal(fs.existsSync(path.join(destinationRoot, "destination-only/preserve.json")), true);

  const destinationBeforeRerun = snapshotNode(destinationRoot);
  const rerun = syncPublicData({ sourceRoot, destinationRoot, logger: () => {} });
  assert.equal(rerun.filesCopied, 4);
  assert.equal(rerun.excludedSourceRoots, expectedDirectExcludedRoots.length);
  assert.equal(rerun.excludedSourceFiles, 17);
  assert.equal(rerun.removedDestinationRoots, 0);
  assert.equal(rerun.removedDestinationFiles, 0);
  assert.equal(rerun.removedDestinationExactFiles, 0);
  assert.deepEqual([...rerun.excludedSourceFilePaths].sort(), expectedExcludedExactFiles);
  assert.deepEqual(rerun.removedDestinationExactFilePaths, []);
  assert.deepEqual(snapshotNode(destinationRoot), destinationBeforeRerun, "second sync must be byte-idempotent");

  const outside = path.join(fixtureRoot, "outside");
  fs.mkdirSync(outside, { recursive: true });
  write(outside, "secret.json", "{}\n");
  fs.rmSync(path.join(sourceRoot, "yf/etf-details"), { recursive: true, force: true });
  fs.symlinkSync(outside, path.join(sourceRoot, "yf/etf-details"), "dir");
  assert.throws(
    () => syncPublicData({ sourceRoot, destinationRoot, logger: () => {} }),
    /symlink/i,
  );
  assert.equal(fs.existsSync(path.join(destinationRoot, "safe/keep.json")), true);

  fs.rmSync(path.join(sourceRoot, "yf/etf-details"));
  fs.mkdirSync(path.join(sourceRoot, "yf/etf-details"));
  const destinationOutside = path.join(fixtureRoot, "destination-outside.json");
  fs.writeFileSync(destinationOutside, "untouched");
  fs.rmSync(path.join(destinationRoot, "safe/keep.json"));
  fs.symlinkSync(destinationOutside, path.join(destinationRoot, "safe/keep.json"));
  assert.throws(
    () => syncPublicData({ sourceRoot, destinationRoot, logger: () => {} }),
    /destination public-data path is a symlink/i,
  );
  assert.equal(fs.readFileSync(destinationOutside, "utf8"), "untouched");

  for (const side of ["source", "destination"]) {
    for (const kind of ["symlink", "directory", "fifo"]) {
      assertWrongReportNodeFailsClosed(fixtureRoot, side, kind);
    }
  }
  assertPrivateRootFailureLeavesReportAndRoots(fixtureRoot);
  assertIdentityDriftFailsBeforeMutation(fixtureRoot);
  assertCanonicalShardSourceFailsClosed(fixtureRoot);
  assertMissingCanonicalTickerSourceFailsClosed(fixtureRoot);
  assertOrphanedDestinationProjectionFailsClosed(fixtureRoot);
  assertMarketFactsSourceDriftFailsBeforeMutation(fixtureRoot);
  assertFenokRimRestrictedProjection(fixtureRoot);
  await assertRimIndexRestrictedProjection(fixtureRoot);
  await assertMarketFactsShardProjection(fixtureRoot);
  assertStockanalysisEtfShardProjection(fixtureRoot);
  await assertStockanalysisEtfShardPublicGuard(fixtureRoot);

  const buildRoot = path.join(fixtureRoot, "100xfenok-next", ".open-next");
  const assetRoot = path.join(buildRoot, "assets");
  const expectedPublicRoot = path.join(fixtureRoot, "100xfenok-next", "public");
  const reportPath = path.join(buildRoot, "asset-budget-report.json");
  write(assetRoot, "index.html", "ok");
  write(assetRoot, "data/computed/data-supply/etf-detail/enrollment.json", "{}\n");
  write(assetRoot, "data/computed/data-supply/etf-detail/index.json", '{"selected_count":1}\n');
  write(assetRoot, "data/computed/data-supply/etf-detail/payloads/AAA.json", "{}\n");

  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath, limit: 5 }),
    /StockAnalysis ETF shard projection is missing/,
  );
  const budgetCanonicalRoot = path.join(fixtureRoot, "budget-canonical");
  fs.mkdirSync(budgetCanonicalRoot, { recursive: true });
  write(
    budgetCanonicalRoot,
    "stockanalysis/etfs/SPY.json",
    `${JSON.stringify(stockanalysisEtfFixturePayload("SPY"), null, 2)}\n`,
  );
  syncStockanalysisEtfShardProjection({
    sourceRoot: budgetCanonicalRoot,
    destinationRoot: path.join(assetRoot, "data"),
    logger: () => {},
  });
  syncStockanalysisEtfShardProjection({
    sourceRoot: budgetCanonicalRoot,
    destinationRoot: path.join(expectedPublicRoot, "data"),
    logger: () => {},
  });
  const budget = inspectCloudflareAssetBudget({ assetRoot, reportPath, expectedPublicRoot, limit: 1031 });
  assert.equal(budget.status, "pass");
  assert.equal(budget.regular_file_count, 1029);
  assert.equal(budget.headroom, 2);
  assert.equal(budget.warning_limit, 1030);
  assert.equal(budget.warning_headroom, 1);
  assert.equal(budget.safety_status, "pass");
  assert.deepEqual(budget.data_supply_projection, {
    enrollment_files: 1,
    index_files: 1,
    payload_files: 1,
    total_files: 3,
  });
  assert.deepEqual(budget.stockanalysis_etf_shards, {
    manifest_files: 1,
    shard_files: STOCKANALYSIS_ETF_SHARD_COUNT,
    total_files: STOCKANALYSIS_ETF_SHARD_COUNT + 1,
    payload_count: 1,
    snapshot_id: budget.stockanalysis_etf_shards.snapshot_id,
    source_manifest_sha256: budget.stockanalysis_etf_shards.source_manifest_sha256,
    legacy_fallback_files: 0,
    largest_shard_bytes: budget.stockanalysis_etf_shards.largest_shard_bytes,
    largest_shard_member_count: budget.stockanalysis_etf_shards.largest_shard_member_count,
    largest_shard_path: budget.stockanalysis_etf_shards.largest_shard_path,
  });
  assert.equal(JSON.parse(fs.readFileSync(reportPath, "utf8")).regular_file_count, 1029);
  assert.equal(path.relative(assetRoot, reportPath).startsWith(".."), true);

  write(assetRoot, "data/stockanalysis/etfs/SPY.json", "{\"stale\":true}\n");
  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath, expectedPublicRoot, limit: 1031 }),
    /shard-only projection requires zero direct/,
  );
  fs.rmSync(path.join(assetRoot, "data/stockanalysis/etfs/SPY.json"));
  fs.appendFileSync(path.join(expectedPublicRoot, "data/stockanalysis/etfs/shards/index.json"), " ");
  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath, expectedPublicRoot, limit: 135 }),
    /emitted shard manifest differs/,
  );
  fs.copyFileSync(
    path.join(assetRoot, "data/stockanalysis/etfs/shards/index.json"),
    path.join(expectedPublicRoot, "data/stockanalysis/etfs/shards/index.json"),
  );

  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath, expectedPublicRoot, limit: 133 }),
    /asset limit/i,
  );
  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath: path.join(assetRoot, "report.json"), expectedPublicRoot, limit: 135 }),
    /outside/i,
  );

  fs.symlinkSync(path.join(assetRoot, "index.html"), path.join(assetRoot, "linked.html"));
  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath, expectedPublicRoot, limit: 135 }),
    /symlink/i,
  );
  fs.rmSync(path.join(assetRoot, "linked.html"));
  write(assetRoot, "generated/data-json-files-manifest.json", JSON.stringify({
    computed: [{ name: "same.json" }, { name: "same.json" }],
  }));
  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath, expectedPublicRoot, limit: 135 }),
    /duplicate manifest path/i,
  );

  // Regression test: reversed source creation order yields identical snapshot bytes & sha256
  {
    const fixture1 = makeSyncCase(fixtureRoot, "stockanalysis-etf-order-a");
    const fixture2 = makeSyncCase(fixtureRoot, "stockanalysis-etf-order-b");
    const spy = stockanalysisEtfFixturePayload("SPY");
    const ivv = stockanalysisEtfFixturePayload("IVV");
    const qqq = stockanalysisEtfFixturePayload("QQQ");

    // Case A: SPY, IVV, QQQ
    write(fixture1.sourceRoot, "stockanalysis/etfs/SPY.json", `${JSON.stringify(spy, null, 2)}\n`);
    write(fixture1.sourceRoot, "stockanalysis/etfs/IVV.json", `${JSON.stringify(ivv, null, 2)}\n`);
    write(fixture1.sourceRoot, "stockanalysis/etfs/QQQ.json", `${JSON.stringify(qqq, null, 2)}\n`);

    // Case B: QQQ, IVV, SPY (reversed order)
    write(fixture2.sourceRoot, "stockanalysis/etfs/QQQ.json", `${JSON.stringify(qqq, null, 2)}\n`);
    write(fixture2.sourceRoot, "stockanalysis/etfs/IVV.json", `${JSON.stringify(ivv, null, 2)}\n`);
    write(fixture2.sourceRoot, "stockanalysis/etfs/SPY.json", `${JSON.stringify(spy, null, 2)}\n`);

    syncStockanalysisEtfShardProjection({ sourceRoot: fixture1.sourceRoot, destinationRoot: fixture1.destinationRoot, logger: () => {} });
    syncStockanalysisEtfShardProjection({ sourceRoot: fixture2.sourceRoot, destinationRoot: fixture2.destinationRoot, logger: () => {} });

    const manifestA = fs.readFileSync(path.join(fixture1.destinationRoot, "stockanalysis/etfs/shards/index.json"), "utf8");
    const manifestB = fs.readFileSync(path.join(fixture2.destinationRoot, "stockanalysis/etfs/shards/index.json"), "utf8");
    assert.equal(manifestA, manifestB, "manifest bytes must be byte-for-byte identical regardless of source creation order");

    const parsedA = JSON.parse(manifestA);
    const snapshotIdA = parsedA.snapshot_id;
    const snapshotDirA = path.join(fixture1.destinationRoot, "stockanalysis/etfs/shards/snapshots", snapshotIdA);
    const snapshotDirB = path.join(fixture2.destinationRoot, "stockanalysis/etfs/shards/snapshots", snapshotIdA);

    const filesA = fs.readdirSync(snapshotDirA).sort();
    const filesB = fs.readdirSync(snapshotDirB).sort();
    assert.deepEqual(filesA, filesB, "snapshot directory contents must be identical");

    for (const filename of filesA) {
      const bytesA = fs.readFileSync(path.join(snapshotDirA, filename), "utf8");
      const bytesB = fs.readFileSync(path.join(snapshotDirB, filename), "utf8");
      assert.equal(bytesA, bytesB, `snapshot file ${filename} must be byte-for-byte identical regardless of source creation order`);
    }
  }

  console.log("test-sync-public-data: ok");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
