#!/usr/bin/env node
// Lane Registry tests (BACKLOG #366 step 1):
//   (a) loader validation is fail-closed on malformed records/exceptions,
//   (b) the registry digest is pinned exact-value (conscious-edit pin, DEC-266),
//   (c) the shadow checker reports declared/undeclared/absent correctly and
//       never fails the build,
//   (d) registry stays consistent with the detection config (ids/enforcement)
//       and with on-disk workflow files.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LANE_REGISTRY,
  LANE_REGISTRY_SCHEMA,
  declaredAdminRoots,
  declaredExceptionPaths,
  providerBlastRadius,
  registryDigest,
  registryLaneById,
  registryProviderById,
  validateLaneRegistry,
} from "./lib/lane-registry.mjs";
import { checkLaneRegistryCompleteness } from "./check-lane-registry-completeness.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_PATH = path.join(REPO_ROOT, "scripts", "fixtures", "lane-registry", "registry.expected.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// --- (b) digest pin ------------------------------------------------------------
{
  const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, "utf8"));
  assert.equal(expected.schema_version, "lane-registry-expected/v1");
  assert.equal(
    registryDigest(),
    expected.registry_digest,
    "registry drifted: bump scripts/fixtures/lane-registry/registry.expected.json consciously",
  );
}

// --- (a) loader validation ------------------------------------------------------
{
  // the shipped registry itself validates
  assert.equal(validateLaneRegistry(LANE_REGISTRY), true);

  const base = clone(LANE_REGISTRY);
  const cases = [
    ["duplicate lane id", (draft) => { draft.lanes.push(clone(draft.lanes[0])); }],
    ["duplicate provider id", (draft) => { draft.providers.push(clone(draft.providers[0])); }],
    ["unknown provider class", (draft) => { draft.providers[0].class = "mystery"; }],
    ["duplicate provider reference", (draft) => {
      draft.lanes[0].provider_refs.push(clone(draft.lanes[0].provider_refs[0]));
    }],
    ["unknown provider reference", (draft) => {
      draft.lanes[0].provider_refs[0].provider_id = "missing_provider";
    }],
    ["empty provider references", (draft) => { draft.lanes[0].provider_refs = []; }],
    ["invalid provider role", (draft) => { draft.lanes[0].provider_refs[0].role = "backup"; }],
    ["provider class and role mismatch", (draft) => { draft.lanes[0].provider_refs[0].role = "transport"; }],
    ["duplicate provider members", (draft) => {
      draft.lanes.find((row) => row.id === "sentiment").provider_refs[0].members = ["cnn", "cnn"];
    }],
    ["undeclared provider member", (draft) => {
      draft.lanes.find((row) => row.id === "sentiment").provider_refs[3].members = ["vixx", "move"];
    }],
    ["missing provider member coverage", (draft) => {
      draft.lanes.find((row) => row.id === "sentiment").provider_refs[3].members = ["vix"];
    }],
    ["unreferenced provider", (draft) => {
      draft.providers.push({ id: "unused_provider", label: "Unused provider", class: "external_data" });
    }],
    ["unknown key on a record", (draft) => { draft.lanes[0].surprise = true; }],
    ["bad lane id", (draft) => { draft.lanes[0].id = "Bad Id"; }],
    ["impossible activation date", (draft) => {
      draft.lanes.find((row) => row.id === "damodaran").activated_at = "2026-02-31T00:00:00Z";
    }],
    ["absolute store path", (draft) => { draft.lanes[0].roots.admin_store = "/etc/passwd"; }],
    ["path escape", (draft) => { draft.lanes[0].roots.admin_store = "data/admin/../secret"; }],
    ["artifact_only with a store", (draft) => {
      const lane = draft.lanes.find((row) => row.store_kind === "artifact_only");
      lane.roots.admin_store = "data/admin/sneaky";
    }],
    ["recovery store outside admin root", (draft) => {
      const lane = draft.lanes.find((row) => row.store_kind === "marker");
      lane.recovery_store = "data/admin/other/index.json";
    }],
    ["wrong schema_version", (draft) => { draft.schema_version = "lane-registry/v0"; }],
    ["undeclared exception kind", (draft) => { draft.declared_exceptions[0].kind = "directory"; }],
    ["duplicate exception", (draft) => { draft.declared_exceptions.push(clone(draft.declared_exceptions[0])); }],
    ["invalid cadence", (draft) => { draft.lanes[0].cadence.kind = "fortnightly"; }],
    ["legacy cadence provider text", (draft) => { draft.lanes[0].cadence.provider = "fred"; }],
    ["invalid privacy class", (draft) => { draft.lanes[0].privacy_class = "publicish"; }],
    ["non-boolean public mirror flag", (draft) => {
      draft.lanes.find((row) => row.id === "finra_ats_weekly").public_mirror_allowed = "false";
    }],
    ["false public mirror flag with a mirror", (draft) => {
      draft.lanes.find((row) => row.id === "finra_ats_weekly").roots.public_mirror = ["100xfenok-next/public/leak.json"];
    }],
    ["public canonical outside canonical outputs", (draft) => {
      draft.lanes.find((row) => row.id === "yahoo_etf_fallback").public_canonical_outputs = ["data/yf/not-canonical"];
    }],
    ["public canonical on a public lane", (draft) => {
      const lane = draft.lanes.find((row) => row.id === "stockanalysis_etf_universe");
      lane.public_canonical_outputs = [lane.roots.canonical_outputs[0]];
    }],
    ["missing lane_class", (draft) => { delete draft.lanes[0].lane_class; }],
    ["invalid lane_class", (draft) => { draft.lanes[0].lane_class = "sometimes"; }],
    ["recovery store without shape", (draft) => {
      const lane = draft.lanes.find((row) => row.recovery_store !== null);
      delete lane.kpi_recovery_shape;
    }],
    ["shape without recovery store", (draft) => {
      const lane = draft.lanes.find((row) => row.recovery_store === null);
      lane.kpi_recovery_shape = "general";
    }],
    ["direct bucket conflict", (draft) => {
      const lane = draft.lanes.find((row) => row.kpi_recovery_shape === "direct"
        && row.roots.admin_store === "data/admin/stockanalysis-recovery");
      lane.recovery_store = "data/admin/stockanalysis-recovery/other-index.json";
    }],
    ["owner workflow outside workflows dir", (draft) => { draft.lanes[0].owner_workflow = "scripts/x.yml"; }],
    ["duplicate commit shard", (draft) => {
      const lane = draft.lanes.find((row) => row.commit_shards.length > 1);
      lane.commit_shards.push(lane.commit_shards[0]);
    }],
    // Completeness, both directions. Until 2026-08-14 a policy was checked only
    // for lanes it DID list — nothing asserted that a workflow lists every lane
    // the registry says it owns, or that it can commit those lanes' evidence.
    // Both gaps were real in the shipped registry: fetch-stockanalysis.yml
    // omitted stockanalysis_etf_detail from its lane list while hand-patching
    // that lane's shard into its specs after run 31794068491 failed to pack it,
    // and fetch-yf-finance.yml owned yahoo_batch_quote_history without owning
    // the attempt shard the lane declares, so that shard has never been
    // committed once.
    ["workflow policy omits a lane it owns", (draft) => {
      const lane = draft.lanes.find((row) => row.owner_workflow);
      const policyValue = draft.workflow_policies[lane.owner_workflow];
      policyValue.lanes = policyValue.lanes.filter((id) => id !== lane.id);
    }],
    ["workflow policy cannot commit an owned lane's attempt shard", (draft) => {
      const prefix = "data/admin/data-supply-state/detection-attempts/";
      const lane = draft.lanes.find((row) => row.owner_workflow
        && row.commit_shards.some((shard) => shard.startsWith(prefix)));
      const shard = lane.commit_shards.find((entry) => entry.startsWith(prefix));
      const policyValue = draft.workflow_policies[lane.owner_workflow];
      for (const stage of Object.keys(policyValue.stages)) {
        policyValue.stages[stage] = policyValue.stages[stage]
          .filter((spec) => spec.path !== shard && !shard.startsWith(`${spec.path}/`));
      }
    }],
  ];
  for (const [label, mutate] of cases) {
    const draft = clone(base);
    mutate(draft);
    assert.throws(() => validateLaneRegistry(draft), /lane-registry/, `validation must reject: ${label}`);
  }
}

// --- (d) consistency with the detection config and the tree --------------------
{
  const detectionIds = DATA_SUPPLY_DETECTION_CONFIG.lanes.map((lane) => lane.id).sort();
  const registryIds = LANE_REGISTRY.lanes.map((lane) => lane.id).sort();
  assert.equal(registryProviderById("fred")?.label, "FRED");
  assert.throws(
    () => providerBlastRadius("missing_provider"),
    /unknown provider/,
    "unknown provider lookups must not silently report an empty blast radius",
  );
  assert.deepEqual(
    providerBlastRadius("fred"),
    [
      { lane_id: "fred_macro", role: "source", members: null },
      { lane_id: "fred_banking", role: "source", members: null },
      { lane_id: "fred_yardeni", role: "source", members: null },
    ],
    "all FRED lanes must share one stable provider identity",
  );
  assert.deepEqual(
    providerBlastRadius("yahoo_finance").map((entry) => entry.lane_id),
    [
      "yahoo_etf_fallback",
      "yahoo_ticker_macro",
      "sentiment",
      "us_indices_daily",
      "yahoo_private_options",
      "yahoo_batch_quote_history",
    ],
    "Yahoo blast radius must be queryable without cadence free-text parsing",
  );
  assert.equal(registryProviderById("open_dart"), null, "retired OpenDART must not remain an active registry provider");
  assert.throws(
    () => providerBlastRadius("open_dart"),
    /unknown provider/,
    "retired OpenDART must not expose an active blast radius",
  );
  assert.equal(registryLaneById("kospi_dart_payout"), null, "retired KOSPI DART must not remain an active lane");
  assert.deepEqual(
    registryLaneById("sentiment").provider_members,
    ["cnn", "cftc", "vix", "move", "crypto"],
    "the sentiment lane member universe is an explicit closed set",
  );
  assert.deepEqual(
    registryLaneById("sentiment").provider_refs,
    [
      { provider_id: "cnn_fear_and_greed", role: "source", members: ["cnn"] },
      { provider_id: "fenok_cnn_proxy", role: "transport", members: ["cnn"] },
      { provider_id: "cftc", role: "source", members: ["cftc"] },
      { provider_id: "yahoo_finance", role: "source", members: ["vix", "move"] },
      { provider_id: "alternative_me", role: "source", members: ["crypto"] },
    ],
    "the multi-source sentiment lane must declare direct sources and its proxy boundary",
  );
  for (const id of detectionIds) {
    assert.ok(registryIds.includes(id), `detection lane ${id} is missing from the registry`);
  }
  for (const lane of DATA_SUPPLY_DETECTION_CONFIG.lanes) {
    const record = registryLaneById(lane.id);
    assert.equal(
      record.enforcement,
      lane.enforcement,
      `enforcement disagreement for ${lane.id}: registry=${record.enforcement} config=${lane.enforcement}`,
    );
  }
  for (const lane of LANE_REGISTRY.lanes) {
    if (lane.owner_workflow !== null) {
      assert.equal(
        fs.existsSync(path.join(REPO_ROOT, lane.owner_workflow)),
        true,
        `owner workflow missing on disk: ${lane.owner_workflow}`,
      );
    }
    if (lane.roots.detection_attempt !== null) {
      assert.equal(
        lane.roots.detection_attempt.startsWith("data/admin/data-supply-state/detection-attempts/"),
        true,
        `detection attempt shard must live under the shared root: ${lane.id}`,
      );
    }
  }
  // shared stores declare every claimant
  const roots = declaredAdminRoots();
  assert.deepEqual(
    [...(roots.get("data/admin/stockanalysis-recovery") ?? [])].sort(),
    ["stockanalysis_etf_detail", "stockanalysis_etf_universe", "stockanalysis_stock_financial", "stockanalysis_surfaces"].sort(),
    "the StockAnalysis recovery store must list every claimant lane",
  );
  assert.deepEqual(
    [...(roots.get("data/admin/yahoo_etf_fallback") ?? [])],
    ["yahoo_etf_fallback"],
    "the private Yahoo ETF fallback store must have exactly its own lane claimant",
  );
  assert.deepEqual(
    registryLaneById("yahoo_etf_fallback").public_canonical_outputs,
    ["data/yf/finance"],
    "the shared Yahoo finance namespace must remain explicitly public while ETF details stay private",
  );
  // every recovery_store-bearing lane's index lives under its admin root
  for (const lane of LANE_REGISTRY.lanes) {
    if (lane.recovery_store !== null && lane.roots.admin_store !== null) {
      assert.ok(lane.recovery_store.startsWith(`${lane.roots.admin_store}/`), `${lane.id} recovery store escapes its admin root`);
    }
  }
  // declared exception paths exist today (the shadow checker would warn otherwise);
  // may_be_absent entries are declared-ephemeral and exempt by contract.
  for (const entry of LANE_REGISTRY.declared_exceptions) {
    if (entry.may_be_absent === true) continue;
    assert.equal(fs.existsSync(path.join(REPO_ROOT, entry.path)), true, `stale declared exception: ${entry.path}`);
  }
  // lane_class: financial-source detection floor stays fixed while owned and
  // private/runtime domains are registered as auxiliary lanes.
  {
    const byClass = LANE_REGISTRY.lanes.reduce((acc, lane) => {
      acc[lane.lane_class] = (acc[lane.lane_class] ?? 0) + 1;
      return acc;
    }, {});
    assert.deepEqual(byClass, { detection_floor: 30, auxiliary: 3 }, "lane_class partition drifted");
    assert.equal(registryLaneById("yahoo_batch_quote_history").lane_class, "detection_floor",
      "yahoo_batch_quote_history is a standard detection-floor producer");
    assert.equal(
      registryLaneById("yahoo_batch_quote_history").roots.detection_attempt,
      "data/admin/data-supply-state/detection-attempts/yahoo_batch_quote_history.json",
      "Yahoo batch attempt evidence uses the standard detection shard root",
    );
    for (const id of ["benchmarks", "global_scouter"]) {
      const converterLane = registryLaneById(id);
      assert.ok(converterLane, `${id} converter lane is registered`);
      assert.equal(converterLane.lane_class, "detection_floor", `${id} belongs to the detection floor`);
      assert.equal(converterLane.cadence.kind, "weekly", `${id} carries its declared weekly cadence`);
      assert.equal(converterLane.enforcement, "shadow", `${id} remains shadow until separately promoted`);
    }
    assert.equal(registryLaneById("damodaran").enforcement, "live",
      "Damodaran is live after the emitted healthy bundle/history/public parity run");
    assert.equal(registryLaneById("benchmarks").owner_workflow, null,
      "Benchmark cadence is declared by the external converter payload, not a fabricated workflow");
    assert.equal(registryLaneById("global_scouter").owner_workflow, null,
      "Global Scouter cadence is declared by the external converter payload, not a fabricated workflow");
    assert.equal(registryLaneById("damodaran").owner_workflow, ".github/workflows/fetch-damodaran-shadow.yml",
      "Damodaran keeps its measured in-repo owner workflow");
    assert.equal(registryLaneById("stockanalysis_stock_financial").enforcement, "live",
      "the bounded StockAnalysis pair lane is live after its first committed natural 8-pair attempt");
    assert.equal(registryLaneById("yahoo_private_options").enforcement, "live",
      "the targeted Yahoo options lane is live after its first committed natural schedule attempt");
    for (const {
      id,
      enforcement,
      recoveryStore,
      lkgShard,
      kpiRequired,
    } of [
      {
        id: "apewisdom_attention",
        enforcement: "live",
        recoveryStore: "data/admin/apewisdom_attention/index.json",
        lkgShard: "data/admin/apewisdom_attention/lkg/social_attention_proxy.json",
        kpiRequired: true,
      },
      {
        id: "gdelt_news_tone",
        enforcement: "live",
        recoveryStore: "data/admin/gdelt_news_tone/index.json",
        lkgShard: "data/admin/gdelt_news_tone/lkg/news_tone_proxy.json",
        kpiRequired: true,
      },
    ]) {
      const recoveryLane = registryLaneById(id);
      const detectionLane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === id);
      assert.equal(recoveryLane.enforcement, enforcement, `${id} enforcement must not drift`);
      assert.equal(recoveryLane.recovery_store, recoveryStore, `${id} recovery index is registry-owned`);
      assert.equal(recoveryLane.kpi_recovery_shape, "general", `${id} uses the generic LaneLkgStore KPI adapter`);
      assert.ok(recoveryLane.commit_shards.includes(recoveryStore), `${id} recovery index must be committed`);
      assert.ok(recoveryLane.commit_shards.includes(lkgShard), `${id} retained LKG must be committed`);
      assert.equal(detectionLane?.kpi_required, kpiRequired, `${id} KPI requirement follows enforcement`);
    }
    assert.deepEqual(
      registryLaneById("finra_ats_weekly"),
      {
        id: "finra_ats_weekly",
        label: "FINRA delayed ATS/OTC weekly summary",
        owner_workflow: ".github/workflows/fetch-finra-ats-weekly.yml",
        provider_members: null,
        provider_refs: [{ provider_id: "finra", role: "source", members: null }],
        store_kind: "payload",
        lane_class: "detection_floor",
        cadence: { kind: "weekly" },
        enforcement: "shadow",
        privacy_class: "private",
        public_mirror_allowed: false,
        roots: {
          admin_store: "data/admin/finra-ats",
          detection_attempt: "data/admin/data-supply-state/detection-attempts/finra_ats.json",
          canonical_outputs: ["data/admin/finra-ats/current/weekly-summary.json"],
          public_mirror: [],
        },
    commit_shards: [
      "data/admin/data-supply-state/detection-attempts/finra_ats.json",
      "data/admin/data-supply-state/publish-outcomes/finra-ats-weekly.json",
      "data/admin/finra-ats/index.json",
      "data/admin/finra-ats/current/weekly-summary.json",
      "data/admin/finra-ats/lkg/weekly-summary.json",
          "data/admin/finra-ats/weeks",
        ],
        recovery_store: "data/admin/finra-ats/index.json",
        declared_exception: null,
        script_sources: ["scripts/fetch-finra-ats-weekly.mjs"],
        kpi_recovery_shape: "general",
      },
      "FINRA ATS weekly registry contract must remain exact",
    );
    for (const id of ["admin_live_voice_logs", "mona_production_study_state", "mona_vnext_kv"]) {
      const lane = registryLaneById(id);
      assert.ok(lane, `private/runtime denominator lane missing: ${id}`);
      assert.equal(detectionIds.includes(id), false, `${id} must not enter the financial detection floor`);
      assert.deepEqual(
        {
          owner_workflow: lane.owner_workflow,
          provider_members: lane.provider_members,
          provider_refs: lane.provider_refs,
          store_kind: lane.store_kind,
          lane_class: lane.lane_class,
          cadence: lane.cadence,
          enforcement: lane.enforcement,
          privacy_class: lane.privacy_class,
          roots: lane.roots,
          commit_shards: lane.commit_shards,
          recovery_store: lane.recovery_store,
        },
        {
          owner_workflow: null,
          provider_members: null,
          provider_refs: id === "admin_live_voice_logs"
            ? [{ provider_id: "local_mac_bridge", role: "runtime", members: null }]
            : id === "mona_production_study_state"
              ? [
                  { provider_id: "mona_life_ssot", role: "source", members: null },
                  { provider_id: "local_mac_bridge", role: "runtime", members: null },
                ]
              : [{ provider_id: "cloudflare_kv", role: "storage", members: null }],
          store_kind: "artifact_only",
          lane_class: "auxiliary",
          cadence: { kind: "unknown" },
          enforcement: "shadow",
          privacy_class: "private",
          roots: {
            admin_store: null,
            detection_attempt: null,
            canonical_outputs: [],
            public_mirror: [],
          },
          commit_shards: [],
          recovery_store: null,
        },
        `${id} must remain an honest repo/CI-unobservable auxiliary artifact lane`,
      );
      assert.ok(lane.declared_exception?.length > 0, `${id} must explain its observability exception`);
    }
    const indices = registryLaneById("us_indices_daily");
    assert.equal(indices.enforcement, "live", "Yahoo owns US indices after the atomic GAS cutover");
    assert.equal(indices.label, "US index daily close (S&P 500 / NASDAQ Composite / Nasdaq 100 / SOX)");
    assert.deepEqual(indices.roots.canonical_outputs, [
      "data/indices/sp500.json",
      "data/indices/nasdaq.json",
      "data/indices/nasdaq100.json",
      "data/indices/sox.json",
    ]);
    assert.deepEqual(indices.roots.public_mirror, []);
    assert.deepEqual(indices.commit_shards, [
      "data/admin/data-supply-state/detection-attempts/us_indices_daily.json",
      "data/admin/data-supply-state/publish-outcomes/us-indices-daily.json",
      "data/admin/us-indices-daily",
      "data/indices/sp500.json",
      "data/indices/nasdaq.json",
      "data/indices/nasdaq100.json",
      "data/indices/sox.json",
    ]);
    assert.equal(indices.declared_exception, null, "the retired shadow qualification exception must be removed");
    assert.deepEqual(indices.script_sources, ["scripts/fetch-us-indices-daily.mjs", "scripts/check-us-indices-parity.mjs"],
      "the live producer imports shared tolerance helpers from the dormant comparator module");
    const paritySource = fs.readFileSync(path.join(REPO_ROOT, "scripts", "check-us-indices-parity.mjs"), "utf8");
    assert.doesNotMatch(paritySource, /QUALIFICATION_SCHEMA|advanceQualification|REQUIRED_CONSECUTIVE_TRADING_DAYS/,
      "the retired 10-day qualification state machine must be deleted");
    const workflowSource = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-us-indices-daily.yml"), "utf8");
    assert.doesNotMatch(workflowSource, /check-us-indices-parity|parity-report|upload-artifact/,
      "the live workflow must not invoke or upload the dormant historical comparator");
    assert.match(workflowSource, /--stage\s+success_if_exists/,
      "the live workflow must stage canonical/public outputs only after producer success");
    assert.match(workflowSource, /atomic (?:cutover|GAS ownership cutover)/,
      "the workflow must document the atomic GAS-to-Yahoo ownership cutover");
    assert.equal(
      Object.keys(LANE_REGISTRY.workflow_policies).some((workflow) => workflow.endsWith("fetch-kospi-dart-payout.yml")),
      false,
      "retired KOSPI DART must not retain an automatic workflow policy",
    );
    const oecd = registryLaneById("oecd_cli");
    assert.equal(oecd.enforcement, "live",
      "OECD is live after its complete bounded private attempt was committed");
    assert.deepEqual(oecd.roots.canonical_outputs, ["data/admin/oecd_cli/shadow/oecd-cli.json"]);
    assert.deepEqual(oecd.roots.public_mirror, []);
    const krx = registryLaneById("krx");
    assert.equal(krx.enforcement, "live", "KRX is live after natural run 30270187601 committed valid attempt evidence");
    assert.equal(krx.roots.detection_attempt, "data/admin/data-supply-state/detection-attempts/krx.json");
    assert.deepEqual(krx.roots.canonical_outputs, [
      "data/admin/fenok-edge-korea-krx-daily-index.json",
      "data/computed/fenok-edge-korea-krx-bridge-history.json",
      "data/computed/fenok-edge-korea-krx-index-daily.json",
      "data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json",
    ]);
    assert.deepEqual(krx.roots.public_mirror, [
      "100xfenok-next/public/data/admin/fenok-edge-korea-krx-daily-index.json",
      "100xfenok-next/public/data/computed/fenok-edge-korea-krx-bridge-history.json",
    ]);
  }
  const floorException = LANE_REGISTRY.declared_exceptions
    .find((entry) => entry.path === "data/admin/data-supply-detection-floor.json");
  assert.equal(floorException?.may_be_absent, true,
    "the ephemeral detection-floor report must be declared may_be_absent (intentionally not committed)");
}

// --- (c) checker fixtures: declared / undeclared / absent ------------------------
{
  function makeTree(tag, { roots = [], files = [] } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `lane-registry-check-${tag}-`));
    for (const dir of roots) fs.mkdirSync(path.join(root, dir), { recursive: true });
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), "{}\n");
    }
    return root;
  }

  // fully declared tree -> clean, no warnings
  {
    const roots = [...declaredAdminRoots().keys()].filter((root) => !root.includes("fred_yardeni") && !root.includes("edgar_filings") && !root.includes("occ_options_volume"));
    const files = declaredExceptionPaths("file");
    const tree = makeTree("clean", {
      roots: [...roots, ...declaredExceptionPaths("root")],
      files,
    });
    const warnings = [];
    const summary = checkLaneRegistryCompleteness({
      repoRoot: tree,
      warn: (message) => warnings.push(message),
      info: () => {},
    });
    assert.deepEqual(summary.undeclared_roots, []);
    assert.deepEqual(summary.undeclared_files, []);
    assert.deepEqual(summary.stale_exceptions, []);
    assert.equal(warnings.length, summary.absent_store_roots.length, "only absent-store notes remain (pre-launch stores excluded above)");
  }

  // an undeclared root + undeclared file are reported loudly
  {
    const tree = makeTree("undeclared", {
      roots: ["data/admin/data-supply-state", "data/admin/brand_new_lane"],
      files: ["data/admin/brand-new-file.json"],
    });
    const warnings = [];
    const summary = checkLaneRegistryCompleteness({
      repoRoot: tree,
      warn: (message) => warnings.push(message),
      info: () => {},
    });
    assert.deepEqual(summary.undeclared_roots, ["data/admin/brand_new_lane"]);
    assert.deepEqual(summary.undeclared_files, ["data/admin/brand-new-file.json"]);
    assert.equal(summary.clean, false);
    assert.ok(warnings.some((line) => line.includes("undeclared_root")));
    assert.ok(warnings.some((line) => line.includes("undeclared_file")));
    assert.ok(warnings.some((line) => line.includes("stale_exception")), "exceptions for missing paths are reported");
  }

  // a registry store absent from the tree is reported, never fatal
  {
    const tree = makeTree("absent", { roots: ["data/admin/data-supply-state"] });
    const summary = checkLaneRegistryCompleteness({
      repoRoot: tree,
      warn: () => {},
      info: () => {},
    });
    const storeLanes = LANE_REGISTRY.lanes.filter((lane) => lane.roots.admin_store !== null).length;
    assert.equal(summary.absent_store_roots.length, storeLanes, "every store root is absent in a bare tree");
    assert.equal(summary.clean, false);
  }

  // the real tree has no undeclared entries (only pre-launch absent stores)
  {
    const summary = checkLaneRegistryCompleteness({ repoRoot: REPO_ROOT, warn: () => {}, info: () => {} });
    assert.deepEqual(summary.undeclared_roots, [], "no undeclared roots on origin/main");
    assert.deepEqual(summary.undeclared_files, [], "no undeclared files on origin/main");
    assert.deepEqual(summary.stale_exceptions, [], "no stale exceptions on origin/main");
    // Absent stores are time-dependent: each lane's store appears on its first
    // natural run, so assert the pending set is a SUBSET of the known
    // pre-launch lanes rather than an exact list.
    const pendingLanes = new Set([
      "edgar_filings",
      "fred_yardeni",
      "occ_options_volume",
      "yahoo_private_options",
      "yahoo_etf_fallback",
      // #366 proxy-lane wiring (2026-07-19): admin stores are declared but
      // reserved — shard-only producers write nothing there until a future
      // recovery-state slice; they stay pending indefinitely by design.
      "apewisdom_attention",
      "gdelt_news_tone",
      "damodaran",
      "us_indices_daily",
      "oecd_cli",
      "krx",
      "finra_ats_weekly",
      "slickcharts",
    ]);
    for (const row of summary.absent_store_roots) {
      assert.ok(pendingLanes.has(row.lane), `unexpected absent store: ${row.lane} (${row.path})`);
    }
  }
}

console.log("test-lane-registry: ok");
