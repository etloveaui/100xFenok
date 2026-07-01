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

function legacyHtmlClassification(legacyHtml) {
  const iframeTargets = new Map(
    Object.entries(EXPECTED_IFRAME_SRC_BY_ROUTE).map(([route, target]) => [target, route]),
  );
  const rows = legacyHtml.map((item) => {
    const publicPath = publicPathFromFile(item.file);
    const route = iframeTargets.get(publicPath) ?? null;
    if (publicPath === "/tools/stock_analyzer/CLEAR_CACHE.html") {
      return {
        ...item,
        class: "low_risk_retire_candidate",
        route: "/tools/stock-analyzer",
        reason: "cache helper page is not an iframe target; smoke stock-analyzer direct URL before redirect/delete",
      };
    }
    if (route) {
      return {
        ...item,
        class: "route_backed_preserve_until_equivalence",
        route,
        reason: "expected iframe target for a live Next route",
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
        ...item,
        class: "dynamic_bridge_reachable_high_risk",
        route: null,
        reason: "legacyPublicFileExists or dynamic bridge route can still resolve this path family",
      };
    }
    if (publicPath.startsWith("/100x/daily-wrap/") && publicPath !== "/100x/daily-wrap/daily-wrap-viewer.html") {
      return {
        ...item,
        class: "daily_wrap_archive_high_risk",
        route: "/100x/daily-wrap",
        reason: "daily-wrap route uses viewer/data path; dated legacy HTML needs equivalence proof before redirect",
      };
    }
    return {
      ...item,
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
      legacy_html_route_backed: legacyClassification.route_backed.length,
      legacy_html_high_risk: legacyClassification.high_risk_count,
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
