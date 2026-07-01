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
