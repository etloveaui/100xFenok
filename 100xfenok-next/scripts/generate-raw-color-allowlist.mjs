#!/usr/bin/env node

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_ROOT = join(ROOT, "src");
const ALLOWLIST_PATH = join(ROOT, "scripts/raw-color-allowlist.json");
const SCAN_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);
const RAW_COLOR_SCHEMA = "raw-color-allowlist/v2";
const CATEGORY_DEFINITIONS = {
  "token-source": "Design-token source files where raw literals define the token vocabulary.",
  "style-island": "Legacy or isolated CSS surface pending a later token migration wave.",
  "metadata-color": "Next/browser metadata that still requires literal color values.",
  "admin-internal": "Admin-only route surface, outside the public product migration target.",
  "chart-exception": "Canvas/chart palette code where literals are intentionally bridged separately.",
  "p4-delete": "Retire/preview/Mona winddown surface scheduled for P4 deletion, not migration.",
};
const rawColorGovernancePattern =
  /(?<![&\w-])#(?:[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?|(?=[0-9A-Fa-f]{3,4}\b)(?=[0-9A-Fa-f]*[A-Fa-f])[0-9A-Fa-f]{3,4})\b|rgba?\([^)]*\)|(?<!-)\b(?:white|black)\b(?!-)/g;

function walk(path) {
  const stats = statSync(path);
  if (stats.isFile()) {
    const dot = path.lastIndexOf(".");
    return dot >= 0 && SCAN_EXTENSIONS.has(path.slice(dot)) ? [path] : [];
  }
  if (!stats.isDirectory()) return [];
  return readdirSync(path).flatMap((name) => walk(join(path, name)));
}

function isCommentOnlyLine(line) {
  return /^\s*(?:\/\/|\/\*|\*)/.test(line);
}

function shouldIgnoreRawColorLiteral(literal) {
  return /^rgba?\([^)]*var\(--/.test(literal);
}

function collectRawColorLiterals(text) {
  const literals = new Map();
  const lines = text.split("\n");

  lines.forEach((line) => {
    if (isCommentOnlyLine(line)) return;

    for (const match of line.matchAll(rawColorGovernancePattern)) {
      const literal = match[0];
      if (shouldIgnoreRawColorLiteral(literal)) continue;
      literals.set(literal, (literals.get(literal) ?? 0) + 1);
    }
  });

  return literals;
}

function categoryForPath(relPath) {
  if (relPath === "src/app/globals.css") {
    return {
      category: "token-source",
      note: "Root CSS variables define the canonical raw palette.",
    };
  }

  if (["src/styles/theme-c.css", "src/styles/app-shell.css", "src/styles/canvas-plus.css"].includes(relPath)) {
    return {
      category: "token-source",
      note: "Theme/app-shell CSS source layer keeps bootstrap literal values.",
    };
  }

  if (["src/app/layout.tsx", "src/app/manifest.ts", "src/app/posts/page.tsx"].includes(relPath)) {
    return {
      category: "metadata-color",
      note: "Browser or route metadata literal; active component styling must use tokens.",
    };
  }

  if (relPath === "src/app/admin/page.tsx" || relPath === "src/app/admin/personal/page.tsx") {
    return {
      category: "admin-internal",
      note: "Internal admin route; public product migration excludes this surface.",
    };
  }

  if (
    relPath === "src/app/admin/design-gallery/page.tsx" ||
    relPath.startsWith("src/components/Home") ||
    relPath === "src/components/DesignLabProfilePreview.tsx" ||
    relPath === "src/components/admin-live/MonaWindDown.tsx" ||
    relPath.startsWith("src/features/mona-vnext/") ||
    relPath.startsWith("src/app/winddown")
  ) {
    return {
      category: "p4-delete",
      note: "Retire/preview surface kept on a temporary allowlist until P4 deletion.",
    };
  }

  if (
    relPath.startsWith("src/features/stock-analyzer/charts/") ||
    relPath.startsWith("src/features/stock-analyzer/components/") ||
    relPath.startsWith("src/lib/market-valuation/charts/")
  ) {
    return {
      category: "chart-exception",
      note: "Chart/canvas palette literals require a runtime token bridge before migration.",
    };
  }

  if (
    relPath === "src/app/vr/page.tsx" ||
    relPath === "src/styles/alpha-scout-v2.css" ||
    relPath === "src/styles/heatmap.css" ||
    relPath === "src/styles/ib-light-v2.css" ||
    relPath === "src/styles/legacy-widgets.css" ||
    relPath === "src/styles/navigation.css" ||
    relPath === "src/styles/route-embed.css" ||
    relPath === "src/styles/cp-w4-screener.css" ||
    relPath === "src/styles/cp-w4-chart.css"
  ) {
    return {
      category: "style-island",
      note: "Legacy isolated surface pending a later token migration wave.",
    };
  }

  throw new Error(`Uncategorized raw color file: ${relPath}`);
}

const files = {};
const fileCategories = {};
let totalAllowedOccurrences = 0;

for (const file of walk(SRC_ROOT).sort()) {
  const literals = collectRawColorLiterals(readFileSync(file, "utf8"));
  if (literals.size === 0) continue;

  const relPath = relative(ROOT, file);
  files[relPath] = Object.fromEntries([...literals.entries()].sort(([left], [right]) => left.localeCompare(right)));
  fileCategories[relPath] = categoryForPath(relPath);
  totalAllowedOccurrences += [...literals.values()].reduce((sum, count) => sum + count, 0);
}

const allowlist = {
  schema_version: RAW_COLOR_SCHEMA,
  scope: "src/**/*.{css,ts,tsx}",
  policy:
    "Each listed literal is the current approved occurrence count and each file must carry category metadata. Unknown literals, higher counts, stale counts, or uncategorized files fail qa:tokens; refresh after intentional tokenization.",
  generated_from: "P2 W5 baseline refresh, 2026-06-25",
  category_definitions: CATEGORY_DEFINITIONS,
  total_allowed_occurrences: totalAllowedOccurrences,
  file_count: Object.keys(files).length,
  file_categories: fileCategories,
  files,
};

writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(allowlist, null, 2)}\n`);
console.log(
  `[qa:tokens:update-allowlist] raw color allowlist written (${allowlist.total_allowed_occurrences} occurrences, ${allowlist.file_count} files)`,
);
