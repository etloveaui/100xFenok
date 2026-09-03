#!/usr/bin/env node

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_ROOT = join(ROOT, "src");
const ALLOWLIST_PATH = join(ROOT, "scripts/raw-color-allowlist.json");
const SCAN_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);
const RAW_COLOR_SCHEMA = "raw-color-allowlist/v2";
const GENERATED_KST_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
}).format(new Date());
const CATEGORY_DEFINITIONS = {
  "token-source": "Design-token source files where raw literals define the token vocabulary.",
  "style-island": "Legacy or isolated CSS surface pending a later token migration wave.",
  "metadata-color": "Next/browser metadata that still requires literal color values.",
  "admin-internal": "Admin-only route surface, outside the public product migration target.",
  "chart-exception": "Canvas/chart palette code where literals are intentionally bridged separately.",
  "product-theme": "Current immersive product surface with an intentional self-contained palette.",
  "p4-delete": "Retire or preview surface scheduled for deletion, not migration.",
  "valuation-band": "SPEC-allowed raw literals inside .mv-band selectors only on the market-valuation route; any literal outside a band selector fails regen.",
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

// The valuation-band category covers .mv-band selectors only: any raw literal
// elsewhere in market-valuation.css fails regen instead of being pinned.
const BAND_SELECTOR_PATTERN = /\.mv-band\b/;

function assertValuationBandLiteralsScoped(text) {
  const lines = text.split("\n");
  let selector = "";
  let pendingSelector = "";
  lines.forEach((line, index) => {
    const open = line.indexOf("{");
    const close = line.indexOf("}");
    if (open >= 0) {
      selector = `${pendingSelector} ${line.slice(0, open)}`.trim();
      pendingSelector = "";
    } else if (close < 0) {
      pendingSelector += ` ${line}`;
    }
    if (close >= 0) {
      pendingSelector = line.slice(close + 1);
      if (!pendingSelector.includes("{")) selector = "";
    }
    if (isCommentOnlyLine(line)) return;
    for (const match of line.matchAll(rawColorGovernancePattern)) {
      const literal = match[0];
      if (shouldIgnoreRawColorLiteral(literal)) continue;
      if (!BAND_SELECTOR_PATTERN.test(selector)) {
        throw new Error(
          `valuation-band scope violation: ${literal} on line ${index + 1} sits outside a .mv-band selector (in "${selector || "(global)"}").`,
        );
      }
    }
  });
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

  if (relPath === "src/generated/winddown-published-lkg.ts") {
    return {
      category: "metadata-color",
      note: "Generated language-learning content is data, not component styling; color words remain source text.",
    };
  }

  if (relPath === "src/app/admin/page.tsx" || relPath === "src/app/admin/personal/page.tsx") {
    return {
      category: "admin-internal",
      note: "Internal admin route; public product migration excludes this surface.",
    };
  }

  if (
    relPath.startsWith("src/features/winddown/ui/") ||
    relPath.startsWith("src/features/winddown/habit/ui/")
  ) {
    return {
      category: "product-theme",
      note: "Current WIND DOWN activity palette is intentionally isolated from the finance-app theme.",
    };
  }

  if (relPath.startsWith("src/features/winddown/voice/ui/")) {
    return {
      category: "product-theme",
      note: "Current WIND DOWN voice-product palette is intentionally isolated from the finance-app theme.",
    };
  }

  if (
    relPath === "src/app/winddown/layout.tsx" ||
    relPath === "src/app/winddown/page.tsx"
  ) {
    return {
      category: "metadata-color",
      note: "Current WIND DOWN browser theme color metadata.",
    };
  }

  if (
    relPath === "src/app/admin/design-gallery/page.tsx" ||
    relPath.startsWith("src/components/Home") ||
    relPath === "src/components/DesignLabProfilePreview.tsx"
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
    relPath === "src/styles/route-embed.css" ||
    relPath === "src/styles/cp-w4-screener.css" ||
    relPath === "src/styles/cp-w4-chart.css"
  ) {
    return {
      category: "style-island",
      note: "Legacy isolated surface pending a later token migration wave.",
    };
  }

  if (relPath === "src/styles/light-system.css") {
    return {
      category: "token-source",
      note: "100x Light System token vocabulary (surfaces, radii, spacing, heatmap, chart).",
    };
  }

  if (relPath === "src/lib/chart-theme.ts") {
    return {
      category: "chart-exception",
      note: "Light System chart palette bridge — literals intentionally mapped to lightweight-charts + chart.js.",
    };
  }

  if (relPath.startsWith("src/components/ui/")) {
    return {
      category: "product-theme",
      note: "100x Light System UI primitives (Panel, Pill, etc.) — intentional self-contained palette for wave 1.",
    };
  }

  if (relPath === "src/app/HomeCanvasPlusClient.tsx") {
    return {
      category: "product-theme",
      note: "100x Light System Home canvas surface — intentional self-contained palette for slice 2 (Main/HomeMobile dc).",
    };
  }

  if (relPath === "src/app/market-valuation/market-valuation.css") {
    return {
      category: "valuation-band",
      note: "SPEC-allowed raw literals inside .mv-band selectors only (gradient stops + marker); any literal outside a band selector fails regen.",
    };
  }

  if (relPath === "src/app/stock/[ticker]/StockDetailClient.tsx") {
    return {
      category: "product-theme",
      note: "Slice-4 stock detail light-system surface; slate literals tokenized to slate-* named classes, remaining brand-link (#1B73D3) and filing-status (#1aa86f/#b9791a) literals pending a brand/status token.",
    };
  }

  if (relPath === "src/components/DataStateNotice.tsx") {
    return {
      category: "product-theme",
      note: "Light System data-state notice primitive; retry action uses the brand-link (#1B73D3/#155fae) idiom shared with EvidenceRail/StaleState, pending a brand token.",
    };
  }

  throw new Error(`Uncategorized raw color file: ${relPath}`);
}

const files = {};
const fileCategories = {};
let totalAllowedOccurrences = 0;

for (const file of walk(SRC_ROOT).sort()) {
  const text = readFileSync(file, "utf8");
  const literals = collectRawColorLiterals(text);
  if (literals.size === 0) continue;

  const relPath = relative(ROOT, file);
  if (relPath === "src/app/market-valuation/market-valuation.css") {
    assertValuationBandLiteralsScoped(text);
  }
  files[relPath] = Object.fromEntries([...literals.entries()].sort(([left], [right]) => left.localeCompare(right)));
  fileCategories[relPath] = categoryForPath(relPath);
  totalAllowedOccurrences += [...literals.values()].reduce((sum, count) => sum + count, 0);
}

const allowlist = {
  schema_version: RAW_COLOR_SCHEMA,
  scope: "src/**/*.{css,ts,tsx}",
  policy:
    "Each listed literal is the current approved occurrence count and each file must carry category metadata. Unknown literals, higher counts, stale counts, or uncategorized files fail qa:tokens; refresh after intentional tokenization.",
  generated_from: `Current source scan via scripts/generate-raw-color-allowlist.mjs (${GENERATED_KST_DAY} KST)`,
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
