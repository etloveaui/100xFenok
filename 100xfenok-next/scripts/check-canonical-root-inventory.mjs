#!/usr/bin/env node
/**
 * #296 canonical-root inventory gate.
 *
 * Measures the current Next app route surface, legacy public HTML footprint,
 * bridge consumers, deploy wiring, and old-domain consumers without redirect,
 * deletion, deployment, or network calls.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_IFRAME_SRC_BY_ROUTE } from "./qa-route-catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".py",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml",
]);

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".open-next",
  ".qa-artifacts",
  ".wrangler",
  "coverage",
  "node_modules",
]);

const OLD_URL_PATTERNS = [
  { id: "github_pages_100x", pattern: /etloveaui\.github\.io\/100x/i },
  { id: "cloudflare_pages", pattern: /100xfenok\.pages\.dev/i },
  { id: "cloudflare_worker", pattern: /100xfenok\.etloveaui\.workers\.dev/i },
  { id: "generic_pages_dev", pattern: /pages\.dev/i },
  { id: "generic_workers_dev", pattern: /workers\.dev/i },
];

const TRIAGED_OLD_URL_OWNER_POLICY_BY_FILE = new Map([
  [
    "100xfenok-next/scripts/check-macro-chart-contract.mjs",
    {
      class: "source_qa_contract",
      owner_area: "macro_chart_worker_contract",
      source_vs_public_owner: "source_contract_owner_first",
      runtime_impact: "qa-only allowlist and contract fixture; no public mirror mutation",
      owner_gate: "owner approval required before changing the Stooq Worker contract",
      first_action: "preserve current owner Worker proxy contract; migrate only with macro-chart owner approval and QA update",
    },
  ],
  [
    "100xfenok-next/scripts/check-macro-chart-stooq-loader.ts",
    {
      class: "source_qa_contract",
      owner_area: "macro_chart_worker_contract",
      source_vs_public_owner: "source_contract_owner_first",
      runtime_impact: "qa-only loader fixture; no public mirror mutation",
      owner_gate: "owner approval required before changing the Stooq Worker contract",
      first_action: "preserve current owner Worker proxy assertion; update only with the runtime loader source",
    },
  ],
  [
    "100xfenok-next/scripts/check-quote-contract.mjs",
    {
      class: "source_qa_contract",
      owner_area: "quote_gateway_contract",
      source_vs_public_owner: "source_contract_owner_first_then_public_mirror",
      runtime_impact: "qa contract for admin quote source and mirrored public copies",
      owner_gate: "owner approval required before changing quote gateway URL or mirrored GAS outputs",
      first_action: "preserve current Worker quote gateway contract; triage source and public mirrors together",
    },
  ],
  [
    "100xfenok-next/src/lib/macro-chart/stooq.ts",
    {
      class: "source_runtime_endpoint",
      owner_area: "macro_chart_worker_runtime",
      source_vs_public_owner: "source_runtime_owner_first",
      runtime_impact: "runtime data endpoint for Stooq proxy; no public mirror mutation by this file",
      owner_gate: "owner approval required before endpoint migration",
      first_action: "preserve current owner Worker proxy until a replacement endpoint and contract QA are approved",
    },
  ],
  [
    "100xfenok-next/src/lib/server/ticker.ts",
    {
      class: "source_runtime_endpoint",
      owner_area: "ticker_worker_runtime",
      source_vs_public_owner: "source_runtime_owner_first",
      runtime_impact: "runtime quote endpoint fallback; no public mirror mutation by this file",
      owner_gate: "owner approval required before endpoint migration",
      first_action: "preserve current ticker Worker endpoint until quote gateway migration is approved",
    },
  ],
  [
    "docs/planning/CONTRACT_macro_chart_stooq_fusion_20260624.md",
    {
      class: "planning_policy_doc",
      owner_area: "macro_chart_worker_contract",
      source_vs_public_owner: "docs_reference_no_public_mirror",
      runtime_impact: "planning contract reference only",
      owner_gate: "update with owner-approved macro-chart policy change; do not rewrite as cleanup",
      first_action: "preserve as active contract evidence for the Stooq Worker decision",
    },
  ],
  [
    "docs/planning/DEC_multichart_stooq_worker_20260624.md",
    {
      class: "planning_policy_doc",
      owner_area: "macro_chart_worker_decision",
      source_vs_public_owner: "docs_reference_no_public_mirror",
      runtime_impact: "decision record only",
      owner_gate: "update only if the Stooq Worker decision changes",
      first_action: "preserve as decision evidence for the allowed owner Worker proxy",
    },
  ],
  [
    "docs/planning/DESIGN_data_spine_program_20260619.md",
    {
      class: "planning_policy_doc",
      owner_area: "data_spine_bridge_policy",
      source_vs_public_owner: "docs_reference_no_public_mirror",
      runtime_impact: "design inventory reference only",
      owner_gate: "update only with owner-approved bridge/indexing policy",
      first_action: "preserve as bridge-hosting policy evidence until canonical root policy is final",
    },
  ],
  [
    "docs/planning/FORGE_market_valuation_ledger_20260613.md",
    {
      class: "historical_planning_doc",
      owner_area: "market_valuation_delivery_ledger",
      source_vs_public_owner: "docs_reference_no_public_mirror",
      runtime_impact: "historical implementation ledger only",
      owner_gate: "do not rewrite historical live evidence as URL cleanup",
      first_action: "preserve historical deployment evidence unless the owner asks for a retrospective note",
    },
  ],
  [
    "docs/planning/PLAN_design_system_remodel_20260625.md",
    {
      class: "historical_planning_doc",
      owner_area: "design_system_delivery_ledger",
      source_vs_public_owner: "docs_reference_no_public_mirror",
      runtime_impact: "historical deployment ledger only",
      owner_gate: "do not rewrite historical live evidence as URL cleanup",
      first_action: "preserve historical deployment evidence unless the owner asks for a retrospective note",
    },
  ],
  [
    "docs/planning/PLAN_public_surface_cleanup_20260623.md",
    {
      class: "planning_policy_doc",
      owner_area: "public_surface_canonical_policy",
      source_vs_public_owner: "docs_reference_no_public_mirror",
      runtime_impact: "planning policy reference only",
      owner_gate: "update only with owner-approved canonical origin decision",
      first_action: "preserve because it already records the Pages host as non-canonical until host migration",
    },
  ],
]);

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
  };
}

function exists(absPath) {
  return fs.existsSync(absPath);
}

function walk(root, predicate = () => true) {
  if (!exists(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(absPath);
        continue;
      }
      if (entry.isFile() && predicate(absPath)) files.push(absPath);
    }
  }
  return files.sort();
}

function rel(absPath, root = repoRoot) {
  return path.relative(root, absPath).split(path.sep).join("/");
}

function fileSize(absPath) {
  try {
    return fs.statSync(absPath).size;
  } catch {
    return 0;
  }
}

function publicPathFromFile(file) {
  return `/${file.replace(/^100xfenok-next\/public\//, "").replace(/^public\//, "")}`;
}

function localSmokeCommand(smokePath) {
  return `curl -L -sS -o /dev/null -w 'status=%{http_code}\\n' http://127.0.0.1:3105${smokePath}`;
}

function legacyHtmlClassification(legacyHtml) {
  const iframeTargets = new Map(
    Object.entries(EXPECTED_IFRAME_SRC_BY_ROUTE).map(([route, target]) => [target, route]),
  );
  const rows = legacyHtml.map((item) => {
    const publicPath = publicPathFromFile(item.file);
    const baseItem = { ...item, public_path: publicPath };
    const route = iframeTargets.get(publicPath) ?? null;
    if (publicPath === "/tools/stock_analyzer/CLEAR_CACHE.html") {
      return {
        ...baseItem,
        class: "low_risk_retire_candidate",
        route: "/tools/stock-analyzer",
        reason: "cache helper page is not an iframe target; smoke stock-analyzer direct URL before redirect/delete",
      };
    }
    if (route) {
      return {
        ...baseItem,
        class: "route_backed_preserve_until_equivalence",
        route,
        reason: "expected iframe target for a live Next route",
      };
    }
    if (publicPath === "/100x/100x-main.html") {
      return {
        ...baseItem,
        class: "legacy_market_archive_high_risk",
        route: "/market",
        reason: "/market is a legacy bookmark route to the native market screen; preserve this archive until owner-approved retirement",
      };
    }
    if (
      publicPath.startsWith("/admin/")
      || publicPath.startsWith("/alpha-scout/")
      || publicPath.startsWith("/posts-raw/")
      || publicPath.startsWith("/tools/macro-monitor/")
      || publicPath.startsWith("/vr/")
    ) {
      return {
        ...baseItem,
        class: "dynamic_bridge_reachable_high_risk",
        route: null,
        reason: "legacyPublicFileExists or dynamic bridge route can still resolve this path family",
      };
    }
    if (publicPath.startsWith("/100x/daily-wrap/") && publicPath !== "/100x/daily-wrap/daily-wrap-viewer.html") {
      return {
        ...baseItem,
        class: "daily_wrap_archive_high_risk",
        route: "/100x/daily-wrap",
        reason: "daily-wrap route uses viewer/data path; dated legacy HTML needs equivalence proof before redirect",
      };
    }
    return {
      ...baseItem,
      class: "unclassified_high_risk",
      route: null,
      reason: "no safe redirect/delete proof in the canonical inventory gate",
    };
  });

  const byClass = rows.reduce((acc, row) => {
    acc[row.class] = (acc[row.class] ?? 0) + 1;
    return acc;
  }, {});
  return {
    by_class: Object.fromEntries(Object.entries(byClass).sort(([a], [b]) => a.localeCompare(b))),
    safe_first_candidates: rows.filter((row) => row.class === "low_risk_retire_candidate"),
    route_backed: rows.filter((row) => row.class === "route_backed_preserve_until_equivalence"),
    high_risk_count: rows.filter((row) => row.class.endsWith("_high_risk")).length,
    rows,
  };
}

function routeBackedEquivalenceMatrix(legacyHtml, legacyClassification) {
  const legacyByPublicPath = new Map(legacyHtml.map((item) => [publicPathFromFile(item.file), item]));
  const routesByTarget = new Map();
  for (const [route, targetPath] of Object.entries(EXPECTED_IFRAME_SRC_BY_ROUTE)) {
    const routes = routesByTarget.get(targetPath) ?? [];
    routes.push(route);
    routesByTarget.set(targetPath, routes);
  }

  const catalogRows = Object.entries(EXPECTED_IFRAME_SRC_BY_ROUTE)
    .map(([route, targetPath]) => {
      const targetFile = legacyByPublicPath.get(targetPath) ?? null;
      const sharedRoutes = routesByTarget.get(targetPath) ?? [];
      return {
        route,
        target_path: targetPath,
        target_file: targetFile?.file ?? null,
        target_exists: Boolean(targetFile),
        shared_target_routes: sharedRoutes,
        live_equivalence_required: true,
        first_action: "run qa:route-iframe-contract locally; preserve until owner-approved redirect/delete and soak",
      };
    })
    .sort((left, right) => left.route.localeCompare(right.route));

  const routeBackedPublicPaths = new Set(legacyClassification.route_backed.map((row) => row.public_path));
  const catalogTargetPaths = new Set(Object.values(EXPECTED_IFRAME_SRC_BY_ROUTE));
  const rowsWithoutCatalogTarget = legacyClassification.route_backed
    .filter((row) => !catalogTargetPaths.has(row.public_path))
    .map((row) => row.public_path)
    .sort();
  const missingTargetAssets = catalogRows
    .filter((row) => !row.target_exists)
    .map((row) => row.target_path)
    .sort();
  const catalogTargetsMissingRouteBackedClass = [...catalogTargetPaths]
    .filter((targetPath) => !routeBackedPublicPaths.has(targetPath))
    .sort();
  const sharedTargets = [...routesByTarget.entries()]
    .filter(([, routes]) => routes.length > 1)
    .map(([targetPath, routes]) => ({ target_path: targetPath, routes: routes.sort() }))
    .sort((left, right) => left.target_path.localeCompare(right.target_path));

  return {
    schema_version: "route-backed-equivalence/v0.1",
    catalog_route_count: Object.keys(EXPECTED_IFRAME_SRC_BY_ROUTE).length,
    catalog_unique_target_count: catalogTargetPaths.size,
    inventory_route_backed_target_count: legacyClassification.route_backed.length,
    shared_targets: sharedTargets,
    missing_target_assets: missingTargetAssets,
    catalog_targets_missing_route_backed_class: catalogTargetsMissingRouteBackedClass,
    route_backed_rows_without_catalog_target: rowsWithoutCatalogTarget,
    rows: catalogRows,
  };
}

function lowRiskRetireReadiness(legacyClassification, appRoutes, routeBackedEquivalence) {
  const appRouteSet = new Set(appRoutes.map((item) => item.route));
  const targetByRoute = new Map(routeBackedEquivalence.rows.map((row) => [row.route, row]));
  const candidates = legacyClassification.safe_first_candidates.map((candidate) => {
    const routeBackedTarget = targetByRoute.get(candidate.route) ?? null;
    const replacementRoutePresent = appRouteSet.has(candidate.route);
    const replacementAssetPresent = Boolean(routeBackedTarget?.target_exists);
    const staticReadyForOwnerReview = replacementRoutePresent && replacementAssetPresent;
    const replacementRouteSmokePath = `${candidate.route}/`;
    const replacementTargetSmokePath = routeBackedTarget?.target_path ?? "/tools/stock_analyzer/stock_analyzer.html";
    const ownerApprovalPacket = {
      schema_version: "owner-approval-packet/v0.1",
      approval_packet_ready: staticReadyForOwnerReview,
      proposed_action: "retire legacy helper after owner approval and soak",
      mutation_status: "not_executed",
      blocked_actions: ["delete", "redirect", "deploy"],
      approval_required: true,
      owner_decision_required_before_mutation: true,
      proposed_delete_scope: [candidate.public_path],
      rollback_restore_source: `public${candidate.public_path}`,
      rollback_restore_command: `git restore -- public${candidate.public_path}`,
      soak_plan_required_before_delete: true,
      post_delete_soak_required: true,
      pre_approval_local_commands: [
        "npm run qa:canonical-root-inventory",
        "npm run qa:route-iframe-contract",
        localSmokeCommand(replacementRouteSmokePath),
        localSmokeCommand(replacementTargetSmokePath),
        localSmokeCommand(candidate.public_path),
      ],
      post_delete_required_smoke: [
        "npm run qa:canonical-root-inventory",
        "npm run qa:route-iframe-contract",
        localSmokeCommand(replacementRouteSmokePath),
        localSmokeCommand(replacementTargetSmokePath),
      ],
    };
    return {
      file: candidate.file,
      public_path: candidate.public_path,
      size_bytes: candidate.size_bytes,
      class: candidate.class,
      replacement_route: candidate.route,
      replacement_route_present: replacementRoutePresent,
      replacement_route_backed_target: routeBackedTarget?.target_path ?? null,
      replacement_target_exists: replacementAssetPresent,
      delete_authorized: false,
      static_ready_for_owner_review: staticReadyForOwnerReview,
      approval_packet_ready: ownerApprovalPacket.approval_packet_ready,
      owner_gate: "explicit owner approval required before deleting this legacy helper",
      required_local_smoke: [
        replacementRouteSmokePath,
        replacementTargetSmokePath,
        candidate.public_path,
      ],
      required_before_delete: [
        "local direct route smoke passes",
        "route-backed iframe target smoke passes",
        "owner approves helper retirement",
        "post-delete soak window is defined",
        "rollback path keeps the original helper file available until soak clears",
      ],
      first_action: "prepare owner-review packet only; do not delete without explicit owner approval",
      owner_approval_packet: ownerApprovalPacket,
    };
  });

  return {
    schema_version: "low-risk-retire-readiness/v0.1",
    candidate_count: candidates.length,
    static_ready_for_owner_review_count: candidates.filter((candidate) => candidate.static_ready_for_owner_review).length,
    approval_packet_ready_count: candidates.filter((candidate) => candidate.approval_packet_ready).length,
    delete_authorized_count: candidates.filter((candidate) => candidate.delete_authorized).length,
    candidates,
  };
}

function ownerFamilyForHighRisk(row) {
  const pathName = row.public_path;
  const sharedGate = {
    blocked_actions: ["delete", "redirect", "deploy"],
    owner_gate: "explicit owner approval required before redirect/delete/deploy",
    mutation_status: "not_executed",
    pro_route_ia_acceptance: "legacy HTML must stay behind its owner route; it must not become a Home primary module or mobile primary tab",
    required_before_redirect_or_delete: [
      "owner route smoke passes",
      "legacy path smoke passes",
      "PRO route IA owner accepts the destination",
      "live-equivalence proof is recorded",
      "soak and rollback plan are defined",
    ],
  };
  const family = (config) => ({
    ...sharedGate,
    ...config,
    owner_route_required: config.owner_route_required ?? true,
  });

  if (pathName === "/100x/100x-main.html") {
    return family({
      id: "market_legacy_archive",
      owner_route: "/market-valuation",
      compatibility_route: "/market",
      owner_area: "market_native_screen",
      first_action: "preserve archive; review only after native market route live-equivalence and bookmark smoke",
    });
  }
  if (pathName.startsWith("/100x/daily-wrap/")) {
    return family({
      id: "daily_wrap_archive",
      owner_route: "/100x/daily-wrap",
      owner_area: "daily_wrap_archive_viewer",
      first_action: "prove viewer/data equivalence before any dated wrap redirect or retirement proposal",
    });
  }
  if (pathName.startsWith("/admin/design-lab/")) {
    return family({
      id: "admin_design_lab_prototypes",
      owner_route: "/admin/design-lab",
      owner_area: "admin_design_lab",
      first_action: "preserve prototype gallery behind admin owner route; do not promote to product IA",
    });
  }
  if (pathName.startsWith("/admin/data-lab/")) {
    return family({
      id: "admin_data_lab_legacy",
      owner_route: "/admin/data-lab",
      owner_area: "admin_data_lab",
      first_action: "preserve behind data-lab owner route until admin replacement equivalence is proven",
    });
  }
  if (pathName.startsWith("/admin/market-radar/")) {
    return family({
      id: "admin_market_radar_legacy",
      owner_route: "/admin/market-radar",
      owner_area: "admin_market_radar",
      first_action: "preserve behind market-radar admin route until route-backed equivalence and owner approval",
    });
  }
  if (pathName.startsWith("/admin/valuation-lab/")) {
    return family({
      id: "admin_valuation_lab_legacy",
      owner_route: "/admin/valuation-lab",
      owner_area: "admin_valuation_lab",
      first_action: "preserve valuation-lab expansion pages behind admin owner route until replacement mapping exists",
    });
  }
  if (pathName.startsWith("/admin/ib-helper/")) {
    return family({
      id: "admin_ib_helper_legacy",
      owner_route: "/admin/ib-helper",
      owner_area: "admin_ib_helper",
      first_action: "preserve admin helper route; compare with /ib before any retirement proposal",
    });
  }
  if (pathName === "/admin/index.html") {
    return family({
      id: "admin_root_legacy",
      owner_route: "/admin",
      owner_area: "admin_root",
      first_action: "preserve admin root legacy shell until admin route smoke and owner approval",
    });
  }
  if (pathName.startsWith("/admin/personal/")) {
    return family({
      id: "admin_personal_legacy",
      owner_route: "/admin/personal",
      owner_area: "admin_personal",
      first_action: "preserve personal admin content behind admin owner route; do not expose in product IA",
    });
  }
  if (pathName.startsWith("/alpha-scout/")) {
    return family({
      id: "alpha_scout_archive",
      owner_route: "/alpha-scout",
      owner_area: "alpha_scout",
      first_action: "preserve report archive until alpha-scout route equivalence and report deep-link smoke are proven",
    });
  }
  if (pathName.startsWith("/posts-raw/")) {
    return family({
      id: "posts_raw_archive",
      owner_route: "/posts",
      owner_area: "posts_archive",
      first_action: "preserve raw post archive until posts route and deep-link smoke prove equivalence",
    });
  }
  if (pathName.startsWith("/tools/macro-monitor/")) {
    return family({
      id: "macro_monitor_legacy_tools",
      owner_route: "/macro-chart",
      compatibility_route: "/admin/macro-monitor",
      owner_area: "macro_chart_workbench",
      first_action: "preserve macro-monitor legacy tools until native macro-chart owner accepts route equivalence",
    });
  }
  if (pathName.startsWith("/vr/")) {
    return family({
      id: "vr_legacy_tools",
      owner_route: "/vr",
      owner_area: "vr_tools",
      first_action: "preserve VR tools behind VR route until route-backed smoke and owner approval",
    });
  }
  if (pathName === "/404.html") {
    return family({
      id: "system_fallback_page",
      owner_route: null,
      owner_route_required: false,
      owner_area: "system_fallback",
      pro_route_ia_acceptance: "fallback HTML is deployment infrastructure, not product navigation; do not redirect/delete without deploy-owner approval",
      first_action: "preserve fallback page until deployment fallback behavior is owner-approved and smoke-tested",
    });
  }
  if (pathName === "/ib-helper/index.html" || pathName === "/ib/ib-total-guide-calculator.html") {
    return family({
      id: "ib_legacy_tools",
      owner_route: "/ib",
      owner_area: "ib_helper",
      first_action: "preserve IB helper legacy assets until /ib replacement route and guide equivalence are proven",
    });
  }
  if (pathName === "/llm-guide.html") {
    return family({
      id: "workbench_orphan_guide",
      owner_route: "/workbench",
      owner_area: "workbench_secondary_entry",
      first_action: "review as a secondary workbench guide; do not surface on Home or mobile primary IA",
    });
  }
  if (pathName === "/tools/asset/multichart.html") {
    return family({
      id: "multichart_legacy_tool",
      owner_route: "/multichart",
      compatibility_route: "/macro-chart",
      owner_area: "macro_chart_workbench",
      first_action: "compare legacy multichart tool with macro/multichart owners before any redirect proposal",
    });
  }
  return null;
}

function routeResolutionFor(route, appRouteSet) {
  if (!route) return "not_required";
  if (appRouteSet.has(route)) return "exact_app_route";
  if (route.startsWith("/admin/") && appRouteSet.has("/admin/[...slug]")) return "admin_catch_all";
  if (route.startsWith("/posts/") && appRouteSet.has("/posts/[...slug]")) return "posts_catch_all";
  return "missing";
}

function ownerRouteEquivalencePacketForFamily(family) {
  const localSmokePaths = [
    family.owner_route,
    family.compatibility_route,
    ...family.sample_public_paths.slice(0, 3),
  ].filter(Boolean);
  const packetReady = (!family.owner_route_required || family.owner_route_present)
    && family.sample_public_paths.length > 0
    && family.mutation_status === "not_executed";

  return {
    schema_version: "owner-route-equivalence-packet/v0.1",
    packet_ready: packetReady,
    family_id: family.id,
    owner_area: family.owner_area,
    owner_route: family.owner_route,
    owner_route_resolution: family.owner_route_resolution,
    compatibility_route: family.compatibility_route,
    legacy_row_count: family.row_count,
    mutation_status: "not_executed",
    blocked_actions: ["delete", "redirect", "deploy"],
    owner_decision_required_before_mutation: true,
    pro_route_ia_acceptance: family.pro_route_ia_acceptance,
    local_smoke_paths: localSmokePaths,
    legacy_sample_paths: family.sample_public_paths.slice(0, 3),
    pre_approval_local_commands: [
      "npm run qa:canonical-root-inventory",
      "npm run qa:routes",
      ...localSmokePaths.map((smokePath) => localSmokeCommand(smokePath)),
    ],
    required_before_redirect_or_delete: family.required_before_redirect_or_delete,
    first_action: family.first_action,
    next_gate: "owner reviews this packet and chooses preserve, remap, or retire; no mutation before approval",
  };
}

function highRiskOwnerMatrix(legacyClassification, appRoutes) {
  const appRouteSet = new Set(appRoutes.map((item) => item.route));
  const highRiskRows = legacyClassification.rows.filter((row) => row.class.endsWith("_high_risk"));
  const rows = highRiskRows.map((row) => {
    const ownerFamily = ownerFamilyForHighRisk(row);
    const ownerRouteResolution = routeResolutionFor(ownerFamily?.owner_route ?? null, appRouteSet);
    return {
      public_path: row.public_path,
      file: row.file,
      class: row.class,
      owner_family: ownerFamily?.id ?? null,
      owner_area: ownerFamily?.owner_area ?? null,
      owner_route: ownerFamily?.owner_route ?? null,
      owner_route_resolution: ownerRouteResolution,
      owner_route_present: ownerRouteResolution !== "missing",
      owner_route_required: ownerFamily?.owner_route_required ?? true,
      compatibility_route: ownerFamily?.compatibility_route ?? null,
      pro_route_ia_acceptance: ownerFamily?.pro_route_ia_acceptance ?? null,
      blocked_actions: ownerFamily?.blocked_actions ?? [],
      owner_gate: ownerFamily?.owner_gate ?? null,
      mutation_status: ownerFamily?.mutation_status ?? "not_executed",
      required_before_redirect_or_delete: ownerFamily?.required_before_redirect_or_delete ?? [],
      first_action: ownerFamily?.first_action ?? "add an explicit owner family before any redirect/delete/deploy proposal",
    };
  });
  const familiesById = new Map();
  for (const row of rows) {
    if (!row.owner_family) continue;
    const current = familiesById.get(row.owner_family) ?? {
      id: row.owner_family,
      owner_area: row.owner_area,
      owner_route: row.owner_route,
      owner_route_resolution: row.owner_route_resolution,
      owner_route_present: row.owner_route_present,
      owner_route_required: row.owner_route_required,
      compatibility_route: row.compatibility_route,
      pro_route_ia_acceptance: row.pro_route_ia_acceptance,
      blocked_actions: row.blocked_actions,
      owner_gate: row.owner_gate,
      mutation_status: row.mutation_status,
      required_before_redirect_or_delete: row.required_before_redirect_or_delete,
      first_action: row.first_action,
      row_count: 0,
      class_counts: {},
      sample_public_paths: [],
    };
    current.row_count += 1;
    current.class_counts[row.class] = (current.class_counts[row.class] ?? 0) + 1;
    if (current.sample_public_paths.length < 8) current.sample_public_paths.push(row.public_path);
    familiesById.set(row.owner_family, current);
  }
  const families = [...familiesById.values()]
    .map((item) => {
      const packet = ownerRouteEquivalencePacketForFamily(item);
      return {
        ...item,
        owner_route_equivalence_packet: packet,
        owner_route_equivalence_packet_ready: packet.packet_ready,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const unmappedRows = rows.filter((row) => !row.owner_family).map((row) => row.public_path).sort();
  const missingOwnerRouteRows = rows
    .filter((row) => row.owner_route_required && !row.owner_route_present)
    .map((row) => row.public_path)
    .sort();
  const unsafeRows = rows
    .filter((row) => (
      row.mutation_status !== "not_executed"
      || !row.blocked_actions.includes("delete")
      || !row.blocked_actions.includes("redirect")
      || !row.blocked_actions.includes("deploy")
    ))
    .map((row) => row.public_path)
    .sort();
  const packetNotReadyFamilies = families
    .filter((family) => !family.owner_route_equivalence_packet_ready)
    .map((family) => family.id)
    .sort();

  return {
    schema_version: "high-risk-owner-matrix/v0.1",
    high_risk_row_count: highRiskRows.length,
    owner_family_count: families.length,
    owner_route_equivalence_packet_ready_count: families.filter((family) => family.owner_route_equivalence_packet_ready).length,
    owner_route_equivalence_packet_not_ready_count: packetNotReadyFamilies.length,
    unmapped_count: unmappedRows.length,
    missing_owner_route_count: missingOwnerRouteRows.length,
    unsafe_row_count: unsafeRows.length,
    packet_not_ready_families: packetNotReadyFamilies,
    unmapped_rows: unmappedRows,
    missing_owner_route_rows: missingOwnerRouteRows,
    unsafe_rows: unsafeRows,
    families,
    rows,
  };
}

function appRouteFromPage(absPath) {
  const relDir = path.dirname(rel(absPath, path.join(appRoot, "src", "app")));
  if (relDir === ".") return "/";
  const parts = relDir
    .split("/")
    .filter((part) => part && !part.startsWith("(") && !part.endsWith(")"));
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function readText(absPath) {
  return fs.readFileSync(absPath, "utf8");
}

function isTextFile(absPath) {
  return TEXT_EXTENSIONS.has(path.extname(absPath).toLowerCase());
}

function collectTextFiles(roots) {
  return roots.flatMap((root) => walk(root, (absPath) => {
    if (!isTextFile(absPath)) return false;
    const normalized = rel(absPath, repoRoot);
    if (normalized.includes("/public/data/")) return false;
    if (normalized.startsWith("data/")) return false;
    return true;
  }));
}

function grepFiles(files, matcher) {
  const matches = [];
  for (const absPath of files) {
    let text = "";
    try {
      text = readText(absPath);
    } catch {
      continue;
    }
    if (matcher(text)) matches.push(rel(absPath));
  }
  return [...new Set(matches)].sort();
}

function collectOldUrlConsumers(files) {
  const byPattern = {};
  for (const item of OLD_URL_PATTERNS) byPattern[item.id] = [];

  for (const absPath of files) {
    let text = "";
    try {
      text = readText(absPath);
    } catch {
      continue;
    }
    const relative = rel(absPath);
    for (const item of OLD_URL_PATTERNS) {
      if (item.pattern.test(text)) byPattern[item.id].push(relative);
    }
  }

  return Object.fromEntries(
    Object.entries(byPattern).map(([key, values]) => [key, [...new Set(values)].sort()]),
  );
}

function classifyOldUrlConsumer(file, pattern_ids) {
  const triagedOwnerPolicy = TRIAGED_OLD_URL_OWNER_POLICY_BY_FILE.get(file);
  if (triagedOwnerPolicy) return triagedOwnerPolicy;

  const patternSet = new Set(pattern_ids);
  const referencesWorkerOnly = (
    (patternSet.has("cloudflare_worker") || patternSet.has("generic_workers_dev"))
    && !patternSet.has("github_pages_100x")
    && !patternSet.has("cloudflare_pages")
    && !patternSet.has("generic_pages_dev")
  );

  if (referencesWorkerOnly && (
    file === ".github/workflows/deploy-worker.yml"
    || file === "100xfenok-next/public/robots.txt"
    || file === "100xfenok-next/src/app/robots.ts"
    || file === "100xfenok-next/src/lib/site-url.ts"
    || file === "100xfenok-next/scripts/check-seo-surface.mjs"
    || file === "100xfenok-next/scripts/smoke-stockanalysis-routes.mjs"
  )) {
    return {
      class: "current_worker_canonical",
      owner_area: "current_worker_canonical_surface",
      source_vs_public_owner: "source_or_metadata_owner_first",
      runtime_impact: "current Worker canonical-candidate reference",
      owner_gate: "preserve unless the canonical origin decision changes",
      first_action: "preserve; current Worker canonical-candidate reference, not a legacy cleanup target by default",
    };
  }

  if (file.startsWith("100xfenok-next/public/")) {
    return {
      class: "public_mirror_copy",
      owner_area: "public_mirror",
      source_vs_public_owner: "public_mirror_requires_source_owner_first",
      runtime_impact: "public copied output or static mirror",
      owner_gate: "do not edit directly unless this path is the public SSOT",
      first_action: "do not edit directly unless this path is the public SSOT; triage source owner first",
    };
  }

  if (file.startsWith("docs/archive/") || file.includes("/docs/archives/")) {
    return {
      class: "historical_doc",
      owner_area: "historical_docs",
      source_vs_public_owner: "docs_reference_no_public_mirror",
      runtime_impact: "historical reference only",
      owner_gate: "preserve unless owner asks to rewrite active execution docs",
      first_action: "preserve historical context unless the doc is used as an active execution source",
    };
  }

  if (
    file.startsWith(".github/workflows/")
    || file.startsWith("config/")
    || file.startsWith("scripts/")
  ) {
    return {
      class: "source_runtime_template",
      owner_area: "runtime_or_deploy_template",
      source_vs_public_owner: "source_owner_first",
      runtime_impact: "runtime, workflow, or generated-output source template",
      owner_gate: "owner-gated source-level URL migration plan required",
      first_action: "owner-gated source-level URL migration plan required before changing external/runtime output",
    };
  }

  if (
    file.startsWith("admin/")
    || file.startsWith("alpha-scout/")
    || file.startsWith("tools/")
    || file.startsWith("100x/")
  ) {
    return {
      class: "source_admin_tool_config",
      owner_area: "admin_or_tool_source",
      source_vs_public_owner: "source_and_public_mirror_owner_together",
      runtime_impact: "admin/tool source may have generated public mirror consumers",
      owner_gate: "triage source path and generated public mirror together",
      first_action: "triage source path and generated public mirror together before URL edits",
    };
  }

  return {
    class: "unresolved_requires_owner_triage",
    owner_area: "unknown",
    source_vs_public_owner: "unknown_requires_owner_triage",
    runtime_impact: "unknown",
    owner_gate: "classify owner and runtime impact before any URL replacement",
    first_action: "classify owner and runtime impact before any URL replacement",
  };
}

function oldUrlConsumerClassification(oldUrlConsumers) {
  const patternIdsByFile = new Map();
  for (const [patternId, files] of Object.entries(oldUrlConsumers)) {
    for (const file of files) {
      const patternIds = patternIdsByFile.get(file) ?? [];
      patternIds.push(patternId);
      patternIdsByFile.set(file, patternIds);
    }
  }

  const rows = [...patternIdsByFile.entries()].map(([file, patternIds]) => {
    const sortedPatternIds = [...new Set(patternIds)].sort();
    return {
      file,
      pattern_ids: sortedPatternIds,
      ...classifyOldUrlConsumer(file, sortedPatternIds),
    };
  }).sort((left, right) => left.file.localeCompare(right.file));

  const byClass = rows.reduce((acc, row) => {
    acc[row.class] = (acc[row.class] ?? 0) + 1;
    return acc;
  }, {});

  return {
    owner_policy_schema_version: "old-url-owner-policy/v0.1",
    by_class: Object.fromEntries(Object.entries(byClass).sort(([a], [b]) => a.localeCompare(b))),
    unresolved_requires_owner_triage: rows.filter((row) => row.class === "unresolved_requires_owner_triage"),
    owner_approval_required_before_url_change: rows.filter((row) => (
      row.owner_gate.includes("owner approval required")
      || row.owner_gate.includes("owner-approved")
      || row.owner_gate.includes("owner-gated")
    )),
    rows,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const appPages = walk(path.join(appRoot, "src", "app"), (absPath) => absPath.endsWith("/page.tsx"));
  const appRoutes = appPages.map((absPath) => ({
    route: appRouteFromPage(absPath),
    file: rel(absPath),
  })).sort((left, right) => left.route.localeCompare(right.route));

  const legacyHtml = walk(path.join(appRoot, "public"), (absPath) => absPath.endsWith(".html"))
    .map((absPath) => ({
      file: rel(absPath),
      size_bytes: fileSize(absPath),
    }))
    .sort((left, right) => left.file.localeCompare(right.file));

  const textFiles = collectTextFiles([
    path.join(appRoot, "src"),
    path.join(appRoot, "scripts"),
    path.join(appRoot, "public"),
    path.join(repoRoot, ".github"),
    path.join(repoRoot, "admin"),
    path.join(repoRoot, "alpha-scout"),
    path.join(repoRoot, "config"),
    path.join(repoRoot, "docs"),
    path.join(repoRoot, "scripts"),
    path.join(repoRoot, "tools"),
    path.join(repoRoot, "100x"),
  ]);

  const routeEmbedConsumers = grepFiles(textFiles, (text) => (
    text.includes("RouteEmbedFrame") && !text.includes("export default function RouteEmbedFrame")
  ));
  const legacyExistsConsumers = grepFiles(textFiles, (text) => text.includes("legacyPublicFileExists"));
  const oldUrlConsumers = collectOldUrlConsumers(textFiles);
  const oldUrlConsumerFiles = [...new Set(Object.values(oldUrlConsumers).flat())].sort();
  const legacyClassification = legacyHtmlClassification(legacyHtml);
  const routeBackedEquivalence = routeBackedEquivalenceMatrix(legacyHtml, legacyClassification);
  const retireReadiness = lowRiskRetireReadiness(legacyClassification, appRoutes, routeBackedEquivalence);
  const highRiskOwners = highRiskOwnerMatrix(legacyClassification, appRoutes);
  const oldUrlClassification = oldUrlConsumerClassification(oldUrlConsumers);

  const workflowDir = path.join(repoRoot, ".github", "workflows");
  const workflows = walk(workflowDir, (absPath) => /\.(ya?ml)$/i.test(absPath))
    .map((absPath) => rel(absPath))
    .sort();
  const deployInventory = {
    workflows,
    deploy_worker_workflow: workflows.find((file) => file.endsWith("/deploy-worker.yml")) ?? null,
    github_pages_workflow: workflows.find((file) => file.endsWith("/deploy.yml")) ?? null,
    update_manifest_workflow: workflows.find((file) => file.endsWith("/update-manifest.yml")) ?? null,
    stockanalysis_workflow: workflows.find((file) => file.endsWith("/fetch-stockanalysis.yml")) ?? null,
    wrangler_config: exists(path.join(appRoot, "wrangler.jsonc")) ? rel(path.join(appRoot, "wrangler.jsonc")) : null,
    next_config: exists(path.join(appRoot, "next.config.mjs")) ? rel(path.join(appRoot, "next.config.mjs")) : null,
  };

  const errors = [];
  if (appRoutes.length < 20) errors.push(`app route inventory unexpectedly small: ${appRoutes.length}`);
  if (legacyHtml.length === 0) errors.push("legacy HTML inventory is empty; re-check sync-static/public root before #296 decisions");
  if (routeEmbedConsumers.length === 0) errors.push("bridge consumer inventory is empty; #296 cannot prove current iframe surface");
  if (!deployInventory.deploy_worker_workflow) errors.push("deploy-worker workflow missing");
  if (!deployInventory.github_pages_workflow) errors.push("GitHub Pages workflow missing");
  if (!deployInventory.wrangler_config) errors.push("wrangler config missing");
  if (Object.hasOwn(EXPECTED_IFRAME_SRC_BY_ROUTE, "/market")) {
    errors.push("/market must not be in the route-backed iframe catalog; it is a native /market-valuation bookmark route");
  }
  if (routeBackedEquivalence.missing_target_assets.length > 0) {
    errors.push(`route-backed catalog targets missing public assets: ${routeBackedEquivalence.missing_target_assets.join(", ")}`);
  }
  if (routeBackedEquivalence.catalog_targets_missing_route_backed_class.length > 0) {
    errors.push(`route-backed catalog targets missing inventory class: ${routeBackedEquivalence.catalog_targets_missing_route_backed_class.join(", ")}`);
  }
  if (routeBackedEquivalence.route_backed_rows_without_catalog_target.length > 0) {
    errors.push(`inventory route-backed rows missing catalog target: ${routeBackedEquivalence.route_backed_rows_without_catalog_target.join(", ")}`);
  }
  const retireCandidatesMissingProof = retireReadiness.candidates.filter((candidate) => !candidate.static_ready_for_owner_review);
  if (retireCandidatesMissingProof.length > 0) {
    errors.push(`low-risk retire candidates missing static replacement proof: ${retireCandidatesMissingProof.map((candidate) => candidate.public_path).join(", ")}`);
  }
  if (retireReadiness.delete_authorized_count > 0) {
    errors.push("low-risk retire readiness must not authorize deletion; owner approval is required outside this gate");
  }
  const unsafeApprovalPackets = retireReadiness.candidates.filter((candidate) => (
    !candidate.owner_approval_packet
    || candidate.owner_approval_packet.mutation_status !== "not_executed"
    || candidate.owner_approval_packet.approval_required !== true
    || candidate.owner_approval_packet.owner_decision_required_before_mutation !== true
    || !candidate.owner_approval_packet.blocked_actions.includes("delete")
    || !candidate.owner_approval_packet.blocked_actions.includes("redirect")
    || !candidate.owner_approval_packet.blocked_actions.includes("deploy")
  ));
  if (unsafeApprovalPackets.length > 0) {
    errors.push(`low-risk retire approval packets must remain owner-gated and non-mutating: ${unsafeApprovalPackets.map((candidate) => candidate.public_path).join(", ")}`);
  }
  if (highRiskOwners.unmapped_count > 0) {
    errors.push(`high-risk legacy HTML rows missing owner family: ${highRiskOwners.unmapped_rows.join(", ")}`);
  }
  if (highRiskOwners.missing_owner_route_count > 0) {
    errors.push(`high-risk legacy HTML rows missing owner route proof: ${highRiskOwners.missing_owner_route_rows.join(", ")}`);
  }
  if (highRiskOwners.unsafe_row_count > 0) {
    errors.push(`high-risk legacy owner rows must remain owner-gated and non-mutating: ${highRiskOwners.unsafe_rows.join(", ")}`);
  }
  if (highRiskOwners.owner_route_equivalence_packet_not_ready_count > 0) {
    errors.push(`high-risk owner-route equivalence packets are not ready: ${highRiskOwners.packet_not_ready_families.join(", ")}`);
  }

  const report = {
    schema_version: "canonical-root-inventory/v0.1",
    generated_at: new Date().toISOString(),
    issue: "#296 legacy 100x -> Next canonical-root cleanup",
    network: "none",
    mutation: "none",
    counts: {
      app_routes: appRoutes.length,
      legacy_html_files: legacyHtml.length,
      legacy_html_bytes: legacyHtml.reduce((sum, file) => sum + file.size_bytes, 0),
      route_embed_consumer_files: routeEmbedConsumers.length,
      legacy_public_file_exists_consumer_files: legacyExistsConsumers.length,
      workflow_files: workflows.length,
      old_url_consumer_files: oldUrlConsumerFiles.length,
      old_url_unresolved_requires_owner_triage: oldUrlClassification.unresolved_requires_owner_triage.length,
      old_url_owner_approval_required_before_url_change: oldUrlClassification.owner_approval_required_before_url_change.length,
      legacy_html_low_risk_candidates: legacyClassification.safe_first_candidates.length,
      legacy_html_low_risk_ready_for_owner_review: retireReadiness.static_ready_for_owner_review_count,
      legacy_html_low_risk_approval_packets_ready: retireReadiness.approval_packet_ready_count,
      route_backed_catalog_routes: routeBackedEquivalence.catalog_route_count,
      route_backed_catalog_unique_targets: routeBackedEquivalence.catalog_unique_target_count,
      legacy_html_route_backed: legacyClassification.route_backed.length,
      legacy_html_high_risk: legacyClassification.high_risk_count,
      legacy_html_high_risk_owner_families: highRiskOwners.owner_family_count,
      legacy_html_high_risk_owner_equivalence_packets_ready: highRiskOwners.owner_route_equivalence_packet_ready_count,
      legacy_html_high_risk_unmapped: highRiskOwners.unmapped_count,
      legacy_html_high_risk_owner_route_missing: highRiskOwners.missing_owner_route_count,
    },
    samples: {
      app_routes: appRoutes.slice(0, 12),
      legacy_html: legacyHtml.slice(0, 12),
      route_embed_consumers: routeEmbedConsumers.slice(0, 20),
      legacy_public_file_exists_consumers: legacyExistsConsumers.slice(0, 20),
      legacy_html_safe_first_candidates: legacyClassification.safe_first_candidates,
      legacy_html_route_backed: legacyClassification.route_backed.slice(0, 20),
    },
    legacy_html_classification: legacyClassification,
    route_backed_equivalence: routeBackedEquivalence,
    low_risk_retire_readiness: retireReadiness,
    high_risk_owner_matrix: highRiskOwners,
    deploy_inventory: deployInventory,
    old_url_consumers: oldUrlConsumers,
    old_url_consumer_classification: oldUrlClassification,
    owner_gates: {
      redirect: "blocked_without_explicit_owner_approval",
      legacy_delete: "blocked_without_explicit_owner_approval",
      deploy: "blocked_without_explicit_owner_approval",
      live_equivalence_matrix_required: true,
      soak_required_before_delete: true,
    },
    ok: errors.length === 0,
    errors,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok) {
    console.log(
      `[canonical-root-inventory] ok app_routes=${report.counts.app_routes} legacy_html=${report.counts.legacy_html_files} bridge_files=${report.counts.route_embed_consumer_files} old_url_files=${report.counts.old_url_consumer_files}`,
    );
  } else {
    console.error("[canonical-root-inventory] FAIL");
    for (const error of errors) console.error(`- ${error}`);
  }

  process.exitCode = report.ok ? 0 : 1;
}

main();
