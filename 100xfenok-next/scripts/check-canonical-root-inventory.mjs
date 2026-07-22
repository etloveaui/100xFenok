#!/usr/bin/env node
/**
 * #296 canonical-root inventory gate.
 *
 * Measures the current Next app route surface, legacy public HTML footprint,
 * bridge consumers, deploy wiring, and old-domain consumers without redirect,
 * deployment, or network calls.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_IFRAME_SRC_BY_ROUTE } from "./qa-route-catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");

const RETIRED_LEGACY_FILES = [
  path.join(repoRoot, "admin", "data-lab", "index-legacy.html"),
  path.join(appRoot, "public", "admin", "data-lab", "index-legacy.html"),
];

// Retired admin surfaces. Source and public mirror are guarded together because
// sync-static copies ../admin into public, so guarding only one side is not
// durable. Any path under these roots is a reintroduction.
const RETIRED_LEGACY_DIRS = [
  path.join(repoRoot, "admin", "stark-lab"),
  path.join(appRoot, "public", "admin", "stark-lab"),
];

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

const PRO_SCREEN_MODEL_SOURCE_REFS = [
  "docs/design-handoff/100x-ux-redesign/04-deep-research-2026-standards.md:13",
  "docs/design-handoff/100x-ux-redesign/04-deep-research-2026-standards.md:115",
  "docs/planning/PLAN_100x_integrated_service_completion_20260630.md:249",
  "docs/planning/PLAN_100x_integrated_service_completion_20260630.md:254",
  "docs/planning/PLAN_100x_integrated_service_completion_20260630.md:563",
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
        class: "daily_wrap_landing_archive_high_risk",
        route: "/100x/daily-wrap",
        reason: "100x Market Wrap report archive landing page; preserve behind the Daily Wrap owner route until owner-approved retirement",
      };
    }
    if (publicPath === "/llm-guide.html") {
      return {
        ...baseItem,
        class: "llm_site_guide_current_facts_preserve",
        route: "/",
        reason: "machine-readable LLM site guide has been replaced with current DEC-256/Next.js route facts; preserve at root unless owner-approved redirect/delete supersedes it",
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
      owner_route: "/100x/daily-wrap",
      owner_area: "daily_wrap_archive_viewer",
      first_action: "preserve Market Wrap archive landing; review only after Daily Wrap owner route and legacy landing smoke",
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
      first_action: "retired 2026-07-08; do not restore the static admin root shell unless owner re-approves",
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
      id: "llm_site_guide_current_facts",
      owner_route: "/",
      owner_area: "site_metadata",
      pro_route_ia_acceptance: "DEC-256 replace satisfied the current-facts owner review; future redirect/delete still requires owner and deploy approval",
      first_action: "preserve the current-facts LLM guide at /llm-guide.html; re-verify route facts before any future replacement",
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

function proScreenModelAcceptanceForFamily(family) {
  const mutationBlocked = ["delete", "redirect", "deploy"].every((action) => family.blocked_actions.includes(action));
  const dedicatedRouteOwner = family.owner_route_required
    ? family.owner_route_resolution !== "missing"
    : family.owner_area === "system_fallback";
  const secondaryWorkbenchOnly = family.owner_route === "/workbench"
    ? "Workbench-owned legacy content stays a secondary gateway concern, never the Home entry model."
    : "Non-Workbench legacy content must not be routed through Workbench as a cleanup shortcut.";
  const macroChartPolicy = family.owner_route === "/macro-chart" || family.compatibility_route === "/macro-chart"
    ? "Macro/chart legacy content remains under the native macro-chart owner; Chart stays outside mobile primary tabs."
    : null;

  return {
    schema_version: "pro-screen-model-acceptance/v0.1",
    acceptance_ready: Boolean(family.owner_area && family.pro_route_ia_acceptance && mutationBlocked && dedicatedRouteOwner),
    source_refs: PRO_SCREEN_MODEL_SOURCE_REFS,
    owner_family: family.id,
    owner_area: family.owner_area,
    owner_route: family.owner_route,
    owner_route_resolution: family.owner_route_resolution,
    compatibility_route: family.compatibility_route,
    pro_route_ia_acceptance: family.pro_route_ia_acceptance,
    screen_model_contract: [
      "Home remains the search-first entry surface; legacy HTML cannot become the above-fold primary model.",
      "Depth owners stay dedicated routes: Market, Sectors, ETF, Screener, Portfolio, Stock, Filings, Admin, or the explicit owner route.",
      "Workbench remains a secondary dashboard/gateway; it is not a cleanup catch-all for unrelated legacy pages.",
      "Mobile primary IA remains Home / Market / Screener / Portfolio / More; legacy HTML cannot create a new primary tab.",
      "Dense legacy/detail content may remain behind owner routes only after local equivalence proof and owner decision.",
    ],
    owner_packet_required_checks: [
      "owner-route equivalence packet is ready",
      "packet local QA/smoke commands pass",
      "PRO screen-model contract above is accepted by the owner",
      "owner records preserve, remap, or retire before any redirect/delete/deploy",
    ],
    home_primary_allowed: false,
    mobile_primary_allowed: false,
    mutation_blocked_without_owner_decision: mutationBlocked,
    dedicated_route_owner_required: family.owner_route_required,
    dedicated_route_owner_present: dedicatedRouteOwner,
    secondary_workbench_policy: secondaryWorkbenchOnly,
    macro_chart_policy: macroChartPolicy,
  };
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
    pro_screen_model_acceptance: proScreenModelAcceptanceForFamily(family),
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

function legacyBridgeSmokePathsForFamily(family) {
  const samplePaths = family.owner_route_equivalence_packet.legacy_sample_paths;
  if (family.id !== "macro_monitor_legacy_tools") return [];
  return samplePaths.map((samplePath) => (
    `/radar?path=${encodeURIComponent(samplePath.replace(/^\/+/, ""))}`
  ));
}

function ownerReviewPriority(family) {
  const priorityByFamily = new Map([
    ["macro_monitor_legacy_tools", [10, "route-ia convergence: legacy macro-monitor tools must converge under the native macro-chart owner"]],
    ["market_legacy_archive", [20, "route-ia convergence: legacy Market Wrap landing must stay tied to the Daily Wrap archive owner"]],
    ["daily_wrap_archive", [30, "large public archive with an exact owner route and dated legacy pages"]],
    ["admin_design_lab_prototypes", [40, "largest admin prototype family; preserve behind admin owner route and keep out of product IA"]],
    ["admin_valuation_lab_legacy", [50, "large admin valuation-lab family; requires owner mapping before any retirement proposal"]],
    ["alpha_scout_archive", [60, "public report archive with exact product owner route and deep-link samples"]],
    ["admin_market_radar_legacy", [70, "admin market-radar family shares route-backed context with macro-monitor"]],
    ["posts_raw_archive", [80, "public raw post archive with exact posts owner route"]],
    ["ib_legacy_tools", [90, "legacy IB tools need /ib owner comparison before proposal"]],
    ["vr_legacy_tools", [100, "legacy VR tools need /vr owner comparison before proposal"]],
    ["multichart_legacy_tool", [110, "legacy multichart asset needs macro/multichart owner decision"]],
    ["llm_site_guide_current_facts", [120, "current-facts machine-readable LLM site guide stays rooted at /llm-guide.html unless owner-approved redirect/delete supersedes it"]],
    ["admin_data_lab_legacy", [130, "single admin data-lab legacy row with exact owner route"]],
    ["admin_ib_helper_legacy", [140, "admin helper catch-all route requires admin owner confirmation"]],
    ["admin_personal_legacy", [150, "personal admin content must stay outside product IA"]],
    ["admin_root_legacy", [160, "admin root shell requires admin owner confirmation"]],
    ["system_fallback_page", [170, "deployment fallback page requires deploy-owner review, not product IA review"]],
  ]);
  return priorityByFamily.get(family.id) ?? [900, "explicit owner review required before any proposal"];
}

function highRiskOwnerReviewQueue(families) {
  return families
    .map((family) => {
      const [priority, priorityReason] = ownerReviewPriority(family);
      const legacyBridgeSmokePaths = legacyBridgeSmokePathsForFamily(family);
      return {
        rank: 0,
        priority,
        family_id: family.id,
        owner_area: family.owner_area,
        owner_route: family.owner_route,
        compatibility_route: family.compatibility_route,
        legacy_row_count: family.row_count,
        packet_ready: family.owner_route_equivalence_packet_ready,
        mutation_status: "not_executed",
        blocked_actions: ["delete", "redirect", "deploy"],
        no_mutation_before_owner_approval: true,
        priority_reason: priorityReason,
        recommended_slice: "run the packet's local commands, compare the owner route against PRO IA intent, then ask owner to preserve, remap, or retire",
        legacy_bridge_smoke_paths: legacyBridgeSmokePaths,
        legacy_bridge_local_commands: legacyBridgeSmokePaths.map((smokePath) => localSmokeCommand(smokePath)),
        pro_screen_model_acceptance: family.owner_route_equivalence_packet.pro_screen_model_acceptance,
        acceptance_checks: [
          "owner_route_equivalence_packet.packet_ready is true",
          "packet local QA/smoke commands pass",
          "PRO screen-model acceptance is structured and ready",
          "legacy bridge smoke commands pass where provided",
          "legacy content stays behind the owner route and out of Home/mobile primary IA",
          "owner decision is explicit before redirect/delete/deploy",
        ],
        packet: family.owner_route_equivalence_packet,
      };
    })
    .sort((left, right) => left.priority - right.priority || right.legacy_row_count - left.legacy_row_count || left.family_id.localeCompare(right.family_id))
    .map((item, index) => ({ ...item, rank: index + 1 }));
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
  const proScreenModelNotReadyFamilies = families
    .filter((family) => !family.owner_route_equivalence_packet.pro_screen_model_acceptance?.acceptance_ready)
    .map((family) => family.id)
    .sort();
  const ownerReviewQueue = highRiskOwnerReviewQueue(families);
  const ownerReviewBridgeSmokePathCount = ownerReviewQueue.reduce((sum, item) => sum + item.legacy_bridge_smoke_paths.length, 0);

  return {
    schema_version: "high-risk-owner-matrix/v0.1",
    high_risk_row_count: highRiskRows.length,
    owner_family_count: families.length,
    owner_route_equivalence_packet_ready_count: families.filter((family) => family.owner_route_equivalence_packet_ready).length,
    owner_route_equivalence_packet_not_ready_count: packetNotReadyFamilies.length,
    pro_screen_model_acceptance_ready_count: families.filter((family) => family.owner_route_equivalence_packet.pro_screen_model_acceptance?.acceptance_ready).length,
    pro_screen_model_acceptance_not_ready_count: proScreenModelNotReadyFamilies.length,
    owner_review_queue_count: ownerReviewQueue.length,
    owner_review_bridge_smoke_path_count: ownerReviewBridgeSmokePathCount,
    unmapped_count: unmappedRows.length,
    missing_owner_route_count: missingOwnerRouteRows.length,
    unsafe_row_count: unsafeRows.length,
    packet_not_ready_families: packetNotReadyFamilies,
    pro_screen_model_not_ready_families: proScreenModelNotReadyFamilies,
    unmapped_rows: unmappedRows,
    missing_owner_route_rows: missingOwnerRouteRows,
    unsafe_rows: unsafeRows,
    next_owner_review_slice: ownerReviewQueue[0] ?? null,
    owner_review_queue: ownerReviewQueue,
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

function grepLineMatches(files, tokens) {
  const activeTokens = tokens.filter(Boolean);
  const matches = [];
  for (const absPath of files) {
    let text = "";
    try {
      text = readText(absPath);
    } catch {
      continue;
    }
    const file = rel(absPath);
    const lines = text.split(/\r?\n/);
    lines.forEach((lineText, index) => {
      const matched_tokens = activeTokens.filter((token) => lineText.includes(token));
      if (matched_tokens.length === 0) return;
      matches.push({ file, line: index + 1, matched_tokens });
    });
  }
  return matches;
}

function classifyMacroMonitorSourceEntrypoint(file) {
  if (file.startsWith("100xfenok-next/src/components/dashboard/")) return "home_dashboard_legacy_bridge_entrypoint";
  if (file === "100xfenok-next/src/app/radar/page.tsx") return "compatibility_bridge_route";
  if (file.startsWith("100xfenok-next/src/app/admin/")) return "admin_route_entrypoint";
  if (file.startsWith("100xfenok-next/src/app/")) return "app_route_source_reference";
  return "src_reference";
}

function macroMonitorLiveEquivalencePrep(nextSlice, samplePaths, bridgeSmokePaths) {
  const active = nextSlice?.family_id === "macro_monitor_legacy_tools";
  if (!active) {
    return {
      schema_version: "macro-monitor-live-equivalence-prep/v0.1",
      active: false,
      matrix_ready: false,
      proof_status: "not_active",
      row_count: 0,
      rows: [],
    };
  }

  const rows = [
    {
      role: "native_owner_route",
      path: nextSlice.owner_route,
      expected_http_status: 200,
      smoke_command: localSmokeCommand(nextSlice.owner_route),
      proof_status: "pending_local_runtime_smoke",
      mutation_status: "not_executed",
    },
    {
      role: "compatibility_route",
      path: nextSlice.compatibility_route,
      expected_http_status: 200,
      smoke_command: localSmokeCommand(nextSlice.compatibility_route),
      proof_status: "pending_local_runtime_smoke",
      mutation_status: "not_executed",
    },
  ];

  samplePaths.forEach((samplePath, index) => {
    const equivalenceGroup = `macro_monitor_sample_${index + 1}`;
    const bridgePath = bridgeSmokePaths[index] ?? null;
    rows.push({
      role: "legacy_direct_sample",
      equivalence_group: equivalenceGroup,
      path: samplePath,
      paired_path: bridgePath,
      expected_http_status: 200,
      smoke_command: localSmokeCommand(samplePath),
      proof_status: "pending_local_runtime_smoke",
      mutation_status: "not_executed",
    });
    if (!bridgePath) return;
    rows.push({
      role: "radar_bridge_sample",
      equivalence_group: equivalenceGroup,
      path: bridgePath,
      paired_path: samplePath,
      expected_http_status: 200,
      smoke_command: localSmokeCommand(bridgePath),
      proof_status: "pending_local_runtime_smoke",
      mutation_status: "not_executed",
    });
  });

  const requiredRowsReady = rows.every((row) => row.path && row.smoke_command && row.mutation_status === "not_executed");
  const matrixReady = samplePaths.length > 0
    && samplePaths.length === bridgeSmokePaths.length
    && nextSlice.owner_route === "/macro-chart"
    && nextSlice.compatibility_route === "/admin/macro-monitor"
    && requiredRowsReady;

  return {
    schema_version: "macro-monitor-live-equivalence-prep/v0.1",
    active: true,
    matrix_ready: matrixReady,
    proof_status: "prep_only_pending_local_runtime_smoke",
    inventory_network: "none",
    inventory_mutation: "none",
    owner_route: nextSlice.owner_route,
    compatibility_route: nextSlice.compatibility_route,
    legacy_sample_count: samplePaths.length,
    radar_bridge_sample_count: bridgeSmokePaths.length,
    row_count: rows.length,
    required_before_owner_decision: [
      "npm run qa:macro-owner-live-equivalence",
      "run every local smoke command in this matrix against an approved local Next server",
      "record owner route, compatibility route, legacy direct sample, and Radar bridge sample results",
      "compare Home/dashboard legacy entrypoints against native /macro-chart PRO IA",
      "keep owner decision pending until preserve, remap, or retire is explicitly recorded",
    ],
    rows,
  };
}

function macroMonitorRank1ReviewEvidence(highRiskOwners, textFiles) {
  const nextSlice = highRiskOwners.next_owner_review_slice;
  const active = nextSlice?.family_id === "macro_monitor_legacy_tools";
  const samplePaths = active ? nextSlice.packet.legacy_sample_paths : [];
  const bridgeSmokePaths = active ? nextSlice.legacy_bridge_smoke_paths : [];
  const liveEquivalencePrep = macroMonitorLiveEquivalencePrep(nextSlice, samplePaths, bridgeSmokePaths);
  const nextQueueCandidate = active
    ? highRiskOwners.owner_review_queue.find((item) => item.rank === nextSlice.rank + 1) ?? null
    : null;
  const sourceFiles = textFiles.filter((absPath) => rel(absPath).startsWith("100xfenok-next/src/"));
  const sourceReferenceRows = grepLineMatches(sourceFiles, [
    "/radar?path=tools%2Fmacro-monitor",
    "tools%2Fmacro-monitor",
    "tools/macro-monitor/",
  ]).map((row) => ({
    ...row,
    class: classifyMacroMonitorSourceEntrypoint(row.file),
    owner_gate: "owner must approve preserve, remap to native /macro-chart, or retire before redirect/delete/deploy",
  }));
  const homeEntrypoints = sourceReferenceRows.filter((row) => row.class === "home_dashboard_legacy_bridge_entrypoint");

  return {
    schema_version: "macro-monitor-rank1-owner-review/v0.1",
    active,
    family_id: nextSlice?.family_id ?? null,
    owner_route: nextSlice?.owner_route ?? null,
    compatibility_route: nextSlice?.compatibility_route ?? null,
    mutation_status: nextSlice?.mutation_status ?? null,
    blocked_actions: nextSlice?.blocked_actions ?? [],
    owner_decision_status: active ? "pending_owner_decision" : "not_active",
    queue_advance_allowed_without_owner_decision: false,
    queue_blocker: active
      ? "rank 1 macro-monitor owner must choose preserve, remap, or retire before rank 2 can become the active review slice"
      : null,
    next_queue_candidate_after_owner_decision: nextQueueCandidate ? {
      rank: nextQueueCandidate.rank,
      family_id: nextQueueCandidate.family_id,
      owner_route: nextQueueCandidate.owner_route,
      compatibility_route: nextQueueCandidate.compatibility_route,
      legacy_row_count: nextQueueCandidate.legacy_row_count,
      packet_ready: nextQueueCandidate.packet_ready,
      blocked_actions: nextQueueCandidate.blocked_actions,
    } : null,
    owner_decision_options: [
      "preserve legacy macro-monitor bridge behind current owner route; no redirect/delete/deploy",
      "remap Home/dashboard links to native /macro-chart only after owner-approved route IA and QA evidence",
      "retire legacy paths only after owner-approved live-equivalence proof, soak, rollback, and explicit mutation approval",
    ],
    rank1_release_requirements: [
      "owner decision recorded as preserve, remap, or retire",
      "live-equivalence proof recorded for direct legacy paths and Radar bridge paths",
      "Home/dashboard entrypoint decision recorded against native /macro-chart PRO IA",
      "soak and rollback plan recorded before any redirect/delete/deploy",
      "redirect/delete/deploy approval recorded explicitly if mutation is requested",
    ],
    pro_route_ia_acceptance: nextSlice?.packet?.pro_route_ia_acceptance ?? null,
    pro_screen_model_acceptance: nextSlice?.packet?.pro_screen_model_acceptance ?? null,
    live_equivalence_prep: liveEquivalencePrep,
    legacy_sample_paths: samplePaths,
    legacy_bridge_smoke_paths: bridgeSmokePaths,
    public_home_legacy_bridge_entrypoint_count: homeEntrypoints.length,
    public_home_legacy_bridge_entrypoints: homeEntrypoints,
    src_legacy_reference_count: sourceReferenceRows.length,
    src_legacy_references: sourceReferenceRows,
    owner_review_findings: homeEntrypoints.length > 0 ? [
      "Home/dashboard source still links primary tiles to legacy macro-monitor bridge paths; owner must compare those links with native /macro-chart before any href remap or legacy retirement proposal.",
    ] : [],
    recommended_next_gate: "run owner/compat/sample/bridge smokes, compare Home/dashboard legacy entrypoints against /macro-chart PRO IA, then request explicit owner preserve/remap/retire decision",
  };
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
  const macroMonitorRank1Review = macroMonitorRank1ReviewEvidence(highRiskOwners, textFiles);
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
  for (const retiredPath of RETIRED_LEGACY_FILES) {
    if (exists(retiredPath)) {
      errors.push(`retired Data Lab legacy backup was reintroduced: ${rel(retiredPath)}`);
    }
  }
  for (const retiredDir of RETIRED_LEGACY_DIRS) {
    if (exists(retiredDir)) {
      errors.push(`retired admin surface was reintroduced: ${rel(retiredDir)}`);
    }
  }
  if (appRoutes.length < 20) errors.push(`app route inventory unexpectedly small: ${appRoutes.length}`);
  if (legacyHtml.length === 0) errors.push("legacy HTML inventory is empty; re-check sync-static/public root before #296 decisions");
  if (routeEmbedConsumers.length === 0) errors.push("bridge consumer inventory is empty; #296 cannot prove current iframe surface");
  if (!deployInventory.deploy_worker_workflow) errors.push("deploy-worker workflow missing");
  if (deployInventory.github_pages_workflow) errors.push("GitHub Pages workflow still present after root SPA retirement");
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
  if (highRiskOwners.pro_screen_model_acceptance_not_ready_count > 0) {
    errors.push(`high-risk PRO screen-model acceptance packets are not ready: ${highRiskOwners.pro_screen_model_not_ready_families.join(", ")}`);
  }
  if (highRiskOwners.owner_review_queue_count !== highRiskOwners.owner_family_count) {
    errors.push(`high-risk owner review queue must cover every owner family: queue=${highRiskOwners.owner_review_queue_count} families=${highRiskOwners.owner_family_count}`);
  }
  if (highRiskOwners.owner_family_count > 0 && !highRiskOwners.next_owner_review_slice) {
    errors.push("high-risk owner review queue is missing the next owner-review slice");
  }
  if (macroMonitorRank1Review.active && macroMonitorRank1Review.owner_route !== "/macro-chart") {
    errors.push(`macro-monitor rank-1 review must stay tied to /macro-chart owner route: ${macroMonitorRank1Review.owner_route}`);
  }
  if (macroMonitorRank1Review.active && macroMonitorRank1Review.compatibility_route !== "/admin/macro-monitor") {
    errors.push(`macro-monitor rank-1 review must keep /admin/macro-monitor compatibility route: ${macroMonitorRank1Review.compatibility_route}`);
  }
  if (
    macroMonitorRank1Review.active
    && macroMonitorRank1Review.legacy_bridge_smoke_paths.length !== macroMonitorRank1Review.legacy_sample_paths.length
  ) {
    errors.push(`macro-monitor rank-1 bridge smoke coverage mismatch: bridge=${macroMonitorRank1Review.legacy_bridge_smoke_paths.length} samples=${macroMonitorRank1Review.legacy_sample_paths.length}`);
  }
  if (macroMonitorRank1Review.active && macroMonitorRank1Review.owner_decision_status !== "pending_owner_decision") {
    errors.push(`macro-monitor rank-1 owner decision must remain pending until owner records preserve/remap/retire: ${macroMonitorRank1Review.owner_decision_status}`);
  }
  if (macroMonitorRank1Review.active && macroMonitorRank1Review.queue_advance_allowed_without_owner_decision !== false) {
    errors.push("macro-monitor rank-1 queue advance must stay blocked without owner decision");
  }
  if (macroMonitorRank1Review.active && !macroMonitorRank1Review.next_queue_candidate_after_owner_decision) {
    errors.push("macro-monitor rank-1 review must expose the next queue candidate for after owner decision");
  }
  if (macroMonitorRank1Review.active && !macroMonitorRank1Review.pro_screen_model_acceptance?.acceptance_ready) {
    errors.push("macro-monitor rank-1 review must expose ready PRO screen-model acceptance before owner decision");
  }
  if (macroMonitorRank1Review.active && macroMonitorRank1Review.pro_screen_model_acceptance?.home_primary_allowed !== false) {
    errors.push("macro-monitor rank-1 legacy content must not be allowed as the Home primary model");
  }
  if (macroMonitorRank1Review.active && macroMonitorRank1Review.pro_screen_model_acceptance?.mobile_primary_allowed !== false) {
    errors.push("macro-monitor rank-1 legacy content must not be allowed as mobile primary IA");
  }
  if (macroMonitorRank1Review.active && !macroMonitorRank1Review.live_equivalence_prep?.matrix_ready) {
    errors.push("macro-monitor rank-1 live-equivalence prep matrix must be ready before owner decision");
  }
  if (
    macroMonitorRank1Review.active
    && macroMonitorRank1Review.live_equivalence_prep?.row_count !== 2 + (macroMonitorRank1Review.legacy_sample_paths.length * 2)
  ) {
    errors.push(`macro-monitor rank-1 live-equivalence matrix row count mismatch: rows=${macroMonitorRank1Review.live_equivalence_prep?.row_count}`);
  }

  const report = {
    schema_version: "canonical-root-inventory/v0.2",
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
      github_pages_workflow_retired: deployInventory.github_pages_workflow === null,
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
      legacy_html_high_risk_pro_screen_model_acceptance_ready: highRiskOwners.pro_screen_model_acceptance_ready_count,
      legacy_html_high_risk_owner_review_queue: highRiskOwners.owner_review_queue_count,
      macro_monitor_rank1_legacy_bridge_smoke_paths: macroMonitorRank1Review.legacy_bridge_smoke_paths.length,
      macro_monitor_rank1_public_home_legacy_bridge_entrypoints: macroMonitorRank1Review.public_home_legacy_bridge_entrypoint_count,
      macro_monitor_rank1_src_legacy_references: macroMonitorRank1Review.src_legacy_reference_count,
      macro_monitor_rank1_owner_decision_pending: macroMonitorRank1Review.owner_decision_status === "pending_owner_decision" ? 1 : 0,
      macro_monitor_rank1_pro_screen_model_acceptance_ready: macroMonitorRank1Review.pro_screen_model_acceptance?.acceptance_ready ? 1 : 0,
      macro_monitor_rank1_live_equivalence_matrix_ready: macroMonitorRank1Review.live_equivalence_prep?.matrix_ready ? 1 : 0,
      macro_monitor_rank1_live_equivalence_matrix_rows: macroMonitorRank1Review.live_equivalence_prep?.row_count ?? 0,
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
    macro_monitor_rank1_owner_review: macroMonitorRank1Review,
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
      `[canonical-root-inventory] ok app_routes=${report.counts.app_routes} legacy_html=${report.counts.legacy_html_files} bridge_files=${report.counts.route_embed_consumer_files} pages_workflow=retired old_url_files=${report.counts.old_url_consumer_files}`,
    );
  } else {
    console.error("[canonical-root-inventory] FAIL");
    for (const error of errors) console.error(`- ${error}`);
  }

  process.exitCode = report.ok ? 0 : 1;
}

main();
