#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_ROOT = join(ROOT, "src");
const RAW_COLOR_ALLOWLIST_PATH = join(ROOT, "scripts/raw-color-allowlist.json");
const RAW_COLOR_ALLOWLIST_SCHEMA = "raw-color-allowlist/v2";
const ALLOWED_RAW_COLOR_CATEGORIES = new Set([
  "token-source",
  "style-island",
  "metadata-color",
  "admin-internal",
  "chart-exception",
  "p4-delete",
]);
const CSS_TARGETS = [
  "src/app/globals.css",
  "src/styles/theme-c.css",
  "src/styles/app-shell.css",
];
const W1_CSS_TARGETS = [
  "src/styles/design-v2.css",
  "src/styles/footer.css",
  "src/styles/overview-widgets.css",
  "src/styles/market-wrap-v2.css",
];
const W2_COMPONENT_TARGETS = [
  "src/lib/market-valuation/charts/ledgerChartPanels.tsx",
  "src/lib/market-valuation/charts/marketStructurePanelComponents.tsx",
  "src/app/screener/StockDetailPanel.tsx",
  "src/lib/screener/deterministicRules.ts",
  "src/lib/estimate-completeness.ts",
];
const SCAN_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);
const REQUIRED_THEME_ALIASES = [
  "background",
  "foreground",
  "card",
  "popover",
  "muted",
  "accent",
  "border",
  "input",
  "ring",
  "destructive",
  "gain",
  "loss",
  "flat",
  "warn",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-muted",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
];
const REQUIRED_SPACING_TOKENS = [
  "s0",
  "s-px",
  "s0-5",
  "s0-75",
  "s1",
  "s1-25",
  "s1-5",
  "s1-75",
  "s2",
  "s2-25",
  "s2-5",
  "s2-75",
  "s3",
  "s3-25",
  "s3-5",
  "s3-75",
  "s4",
  "s4-25",
  "s4-5",
  "s4-75",
  "s5",
  "s5-5",
  "s6",
  "s6-5",
  "s7",
  "s7-5",
  "s8",
  "s8-5",
  "s9",
  "s9-5",
  "s10",
  "s10-5",
  "s11",
  "s11-5",
  "s12",
  "s12-5",
  "s13",
  "s13-5",
  "s13-75",
  "s14",
  "s15",
  "s16",
  "s20",
  "s24",
  "s25",
  "s30",
];
const SPACING_PROPERTY_PATTERN =
  "(?:padding(?:-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end))?|margin(?:-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end))?|gap|row-gap|column-gap|top|right|bottom|left|inset(?:-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end))?)";
const spacingDeclaration = new RegExp(
  `(^|[;{]\\s*)(${SPACING_PROPERTY_PATTERN})\\s*:\\s*([^;{}]+)`,
  "gm",
);
const rawColorPattern = /#[0-9A-Fa-f]{3,8}|rgba?\(|(?<!-)\b(?:white|black)\b(?!-)/g;
const rawColorGovernancePattern =
  /(?<![&\w-])#(?:[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?|(?=[0-9A-Fa-f]{3,4}\b)(?=[0-9A-Fa-f]*[A-Fa-f])[0-9A-Fa-f]{3,4})\b|rgba?\([^)]*\)|(?<!-)\b(?:white|black)\b(?!-)/g;
const namedTailwindColorPattern =
  /(?:text|bg|border|fill|stroke|hover:bg|hover:border)-(?:slate|emerald|rose|amber|purple|sky|violet|brand)-/g;

const W3_COLOR_ALIAS_EXPECTATIONS = buildW3ColorAliasExpectations();
const W3_SPACING_ALIAS_EXPECTATIONS = {
  "--spacing-s6-5": "var(--s6-5)",
  "--spacing-s7-5": "var(--s7-5)",
  "--spacing-s10-5": "var(--s10-5)",
  "--spacing-s11-5": "var(--s11-5)",
  "--spacing-s12-5": "var(--s12-5)",
  "--spacing-s13": "var(--s13)",
  "--spacing-s13-5": "var(--s13-5)",
  "--spacing-s13-75": "var(--s13-75)",
};
const W3_CONTEXT_EXCEPTION_RULES = [
  [".bg-slate-900", "background-color: var(--fnk-fixed-slate-900);"],
  [".bg-slate-950", "background-color: var(--fnk-fixed-slate-950);"],
  [".bg-slate-950\\/90", "background-color: color-mix(in srgb, var(--fnk-fixed-slate-950) 90%, transparent);"],
  [".border-slate-900", "border-color: var(--fnk-fixed-slate-900);"],
  [".bg-emerald-400", "background-color: var(--fnk-emerald-400);"],
  [".bg-emerald-400\\/10", "background-color: color-mix(in srgb, var(--fnk-emerald-400) 10%, transparent);"],
  [".bg-emerald-400\\/12", "background-color: color-mix(in srgb, var(--fnk-emerald-400) 12%, transparent);"],
  [".border-emerald-400\\/30", "border-color: color-mix(in srgb, var(--fnk-emerald-400) 30%, transparent);"],
  [".border-emerald-300\\/20", "border-color: color-mix(in srgb, var(--fnk-gain-300) 20%, transparent);"],
  [".border-emerald-300\\/25", "border-color: color-mix(in srgb, var(--fnk-gain-300) 25%, transparent);"],
  [".text-emerald-200", "color: var(--fnk-gain-200);"],
  [".text-emerald-300", "color: var(--fnk-gain-300);"],
];

function buildW3ColorAliasExpectations() {
  const entries = {};
  const neutral = {
    50: "var(--paper-0)",
    100: "var(--paper-2)",
    200: "var(--stroke-light)",
    300: "var(--stroke-light-2)",
    400: "var(--ink-4)",
    500: "var(--ink-3)",
    600: "var(--fnk-neutral-600)",
    700: "var(--ink-2)",
    800: "var(--foreground)",
    900: "var(--ink-1)",
    950: "var(--foreground)",
  };
  for (const family of ["slate", "gray", "zinc", "neutral", "stone"]) {
    for (const [shade, value] of Object.entries(neutral)) {
      entries[`--color-${family}-${shade}`] =
        family === "slate" ? value : `var(--color-slate-${shade})`;
    }
  }

  const semanticFamilies = [
    {
      families: ["emerald", "green", "teal"],
      base: "emerald",
      shades: {
        50: "var(--c-up-soft)",
        100: "var(--c-up-soft)",
        200: "var(--c-up-soft)",
        300: "var(--c-up)",
        400: "var(--c-up)",
        500: "var(--c-up)",
        600: "var(--c-up)",
        700: "var(--c-up)",
        800: "var(--c-up)",
        900: "var(--c-up)",
      },
    },
    {
      families: ["rose", "red", "pink"],
      base: "rose",
      shades: {
        50: "var(--c-down-soft)",
        100: "var(--c-down-soft)",
        200: "var(--c-down-soft)",
        300: "var(--c-down)",
        400: "var(--c-down)",
        500: "var(--c-down)",
        600: "var(--c-down)",
        700: "var(--c-down)",
        800: "var(--c-down)",
        900: "var(--c-down)",
      },
    },
    {
      families: ["amber", "yellow", "orange"],
      base: "amber",
      shades: {
        50: "var(--c-warn-soft)",
        100: "var(--c-warn-soft)",
        200: "var(--c-warn-soft)",
        300: "var(--c-warn)",
        400: "var(--c-warn)",
        500: "var(--c-warn)",
        600: "var(--c-warn)",
        700: "var(--c-warn)",
        800: "var(--c-warn-ink)",
        900: "var(--c-warn-ink)",
      },
    },
    {
      families: ["blue", "indigo"],
      base: "blue",
      shades: {
        50: "var(--c-brand-soft)",
        100: "var(--c-brand-soft)",
        200: "var(--c-brand-soft)",
        300: "var(--c-brand)",
        400: "var(--c-brand)",
        500: "var(--c-brand)",
        600: "var(--c-brand)",
        700: "var(--c-brand)",
        800: "var(--c-brand)",
        900: "var(--c-brand)",
      },
    },
    {
      families: ["sky", "cyan"],
      base: "sky",
      shades: {
        50: "var(--c-info-soft)",
        100: "var(--c-info-soft)",
        200: "var(--c-info-soft)",
        300: "var(--c-info)",
        400: "var(--c-info)",
        500: "var(--c-info)",
        600: "var(--c-info-ink)",
        700: "var(--c-info-ink)",
        800: "var(--c-info-ink-strong)",
      },
    },
    {
      families: ["violet", "purple"],
      base: "violet",
      shades: {
        50: "var(--c-recovery-soft)",
        100: "var(--c-recovery-soft)",
        200: "var(--c-recovery-soft)",
        300: "var(--c-recovery)",
        400: "var(--c-recovery)",
        500: "var(--c-recovery)",
        600: "var(--c-recovery)",
        700: "var(--c-recovery)",
        800: "var(--c-recovery)",
      },
    },
  ];

  for (const group of semanticFamilies) {
    for (const family of group.families) {
      for (const [shade, value] of Object.entries(group.shades)) {
        entries[`--color-${family}-${shade}`] =
          family === group.base ? value : `var(--color-${group.base}-${shade})`;
      }
    }
  }

  return entries;
}

function walk(path) {
  const stats = statSync(path);
  if (stats.isFile()) {
    const dot = path.lastIndexOf(".");
    return dot >= 0 && SCAN_EXTENSIONS.has(path.slice(dot)) ? [path] : [];
  }
  if (!stats.isDirectory()) return [];
  return readdirSync(path).flatMap((name) => walk(join(path, name)));
}

function fail(message, details = []) {
  console.error(`[qa:tokens] ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
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

  lines.forEach((line, index) => {
    if (isCommentOnlyLine(line)) return;

    for (const match of line.matchAll(rawColorGovernancePattern)) {
      const literal = match[0];
      if (shouldIgnoreRawColorLiteral(literal)) continue;

      if (!literals.has(literal)) {
        literals.set(literal, { count: 0, lines: [] });
      }
      const entry = literals.get(literal);
      entry.count += 1;
      entry.lines.push(index + 1);
    }
  });

  return literals;
}

const globals = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const layout = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
const themeC = readFileSync(join(ROOT, "src/styles/theme-c.css"), "utf8");
const appShell = readFileSync(join(ROOT, "src/styles/app-shell.css"), "utf8");
const footer = readFileSync(join(ROOT, "src/styles/footer.css"), "utf8");
const navigation = readFileSync(join(ROOT, "src/styles/navigation.css"), "utf8");
const marketChartFrame = readFileSync(join(ROOT, "src/lib/market-valuation/charts/MarketChartFrame.tsx"), "utf8");
const marketChartEngine = readFileSync(join(ROOT, "src/lib/market-valuation/charts/MarketChartEngineClient.tsx"), "utf8");
const failures = [];
let rawColorAllowlist = { files: {}, file_categories: {}, total_allowed_occurrences: 0 };

try {
  rawColorAllowlist = JSON.parse(readFileSync(RAW_COLOR_ALLOWLIST_PATH, "utf8"));
} catch (error) {
  failures.push(`W5 raw color allowlist unreadable: ${error.message}`);
}

if (rawColorAllowlist.schema_version !== RAW_COLOR_ALLOWLIST_SCHEMA) {
  failures.push(
    `W5 raw color allowlist schema expected ${RAW_COLOR_ALLOWLIST_SCHEMA}, got ${rawColorAllowlist.schema_version ?? "missing"}`,
  );
}
if (!rawColorAllowlist.files || typeof rawColorAllowlist.files !== "object") {
  failures.push("W5 raw color allowlist files map missing");
  rawColorAllowlist.files = {};
}
if (!rawColorAllowlist.file_categories || typeof rawColorAllowlist.file_categories !== "object") {
  failures.push("W5 raw color allowlist file_categories map missing");
  rawColorAllowlist.file_categories = {};
}

function declarationValue(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

function expectDeclarations(text, expected, label) {
  for (const [name, value] of Object.entries(expected)) {
    const actual = declarationValue(text, name);
    if (actual !== value) {
      failures.push(`${label} ${name} expected ${value}, got ${actual ?? "missing"}`);
    }
  }
}

expectDeclarations(
  globals,
  {
    "--fnk-color-background": "#f8fafc",
    "--fnk-color-foreground": "#171717",
    "--fnk-brand-navy": "#010079",
    "--fnk-brand-gold": "#7a5a00",
    "--fnk-brand-gold-bright": "#D5AD36",
    "--fnk-brand-interactive": "#1B73D3",
    "--fnk-color-gain": "#1aa86f",
    "--fnk-color-gain-soft": "#eafaf2",
    "--fnk-color-loss": "#e84a5a",
    "--fnk-color-loss-soft": "#fdebed",
    "--fnk-color-warn": "#f2a93b",
    "--fnk-color-warn-soft": "#fdf3e3",
    "--fnk-color-warn-ink": "#b9791a",
    "--fnk-color-flat": "#8b95a1",
  },
  "globals light snapshot",
);

expectDeclarations(
  themeC,
  {
    "--theme-c-background": "#f2f4f6",
    "--theme-c-surface": "#fff",
    "--theme-c-surface-muted": "#f7f9fb",
    "--theme-c-foreground": "#1a1d21",
    "--theme-c-foreground-muted": "#4e5968",
    "--theme-c-foreground-subtle": "#8b95a1",
    "--theme-c-border": "#e8ebee",
    "--theme-c-brand": "#2f6bff",
    "--theme-c-brand-soft": "#eaf1ff",
    "--theme-c-gain": "#1aa86f",
    "--theme-c-loss": "#e84a5a",
    "--theme-c-warn": "#f2a93b",
  },
  "theme-c light snapshot",
);

expectDeclarations(
  appShell,
  {
    "--shell-background": "#f4f6f9",
    "--shell-panel": "#fff",
    "--shell-surface-muted": "#f8fafc",
    "--shell-foreground": "#0f172a",
    "--shell-foreground-muted": "#475569",
    "--shell-foreground-subtle": "#64748b",
    "--shell-border": "rgba(14,23,38,0.06)",
    "--shell-brand": "#1B73D3",
    "--shell-gain": "#0f8a5f",
    "--shell-loss": "#d1344c",
    "--shell-warn": "#d97706",
    "--shell-flat": "#64748b",
  },
  "app-shell light snapshot",
);

for (const alias of REQUIRED_THEME_ALIASES) {
  if (!globals.includes(`--color-${alias}:`)) {
    failures.push(`missing @theme alias --color-${alias}`);
  }
}

for (const token of REQUIRED_SPACING_TOKENS) {
  if (!globals.includes(`--${token}:`)) {
    failures.push(`missing spacing token --${token}`);
  }
}

for (const [name, value] of Object.entries(W3_COLOR_ALIAS_EXPECTATIONS)) {
  const actual = declarationValue(globals, name);
  if (actual !== value) {
    failures.push(`W3 color alias ${name} expected ${value}, got ${actual ?? "missing"}`);
  }
}

for (const [name, value] of Object.entries(W3_SPACING_ALIAS_EXPECTATIONS)) {
  const actual = declarationValue(globals, name);
  if (actual !== value) {
    failures.push(`W3 spacing alias ${name} expected ${value}, got ${actual ?? "missing"}`);
  }
}

for (const [selector, declaration] of W3_CONTEXT_EXCEPTION_RULES) {
  const rule = `${selector} { ${declaration} }`;
  if (!globals.includes(rule)) {
    failures.push(`W3 context exception rule missing: ${rule}`);
  }
}

if (!globals.includes('[data-theme="dark"]')) {
  failures.push('missing [data-theme="dark"] block');
}
if (!globals.includes("color-scheme: dark;")) {
  failures.push("missing dark color-scheme declaration");
}
if (!globals.includes("--fnk-neutral-50: oklch(0.205 0 0);")) {
  failures.push("missing Agent-A dark neutral-50 token");
}
if (!globals.includes("--fnk-neutral-950: oklch(0.985 0 0);")) {
  failures.push("missing Agent-A dark neutral-950 token");
}
for (const required of [
  "--fnk-brand-interactive: oklch(0.76 0.13 255);",
  "--fnk-brand-navy: oklch(0.76 0.13 255);",
  "--fnk-color-loss: oklch(0.76 0.13 25);",
  "--fnk-color-recovery: oklch(0.78 0.16 305);",
  "--color-emerald-950: var(--c-up);",
  "--color-blue-950: var(--c-brand);",
]) {
  if (!globals.includes(required)) {
    failures.push(`W4 dark root token missing: ${required}`);
  }
}
if (/oklch\(\s*(?:100|[1-9]\d{2,})/.test(globals)) {
  failures.push("out-of-gamut OKLCH lightness detected");
}
if (!/body\s*\{\s*[^}]*background:\s*var\(--background\)/s.test(globals)) {
  failures.push("body background no longer uses --background");
}
if (!layout.includes('<html lang="ko" data-theme="light"')) {
  failures.push("default theme must remain light in RootLayout html");
}
if (!layout.includes('themeColor: "#f8fafc"')) {
  failures.push("light default viewport themeColor missing");
}
if (!layout.includes("bg-background text-foreground")) {
  failures.push("W4 body no longer uses background/foreground utilities");
}
if (!appShell.includes('[data-theme="dark"] .fnk-shell')) {
  failures.push("W4 dark shell override missing");
}
for (const required of [
  "--shell-background:var(--fnk-color-background)",
  "--shell-panel:var(--fnk-color-card)",
  "--shell-gain:oklch(0.72 0.12 155)",
  "--c-brand-active:oklch(0.46 0.16 255)",
  "--shell-loss:oklch(0.76 0.13 25)",
  "--rgb-up:92 210 163",
  "--rgb-brand:145 180 255",
  ".bg-white{background-color:var(--c-panel)}",
  ".data-shell-link{background:var(--c-surface-2); border-color:var(--c-line); color:var(--c-ink)}",
  ".bg-\\[var\\(--c-brand\\)\\]{background-color:var(--c-brand-active)}",
  ".bg-\\[var\\(--c-ink\\)\\]{background-color:var(--c-brand-active)}",
]) {
  if (!appShell.includes(required)) {
    failures.push(`W4 dark shell contract missing: ${required}`);
  }
}
for (const required of [
  '[data-theme="dark"] [data-v1-chrome="footer"] .bg-white\\/95',
  "background-color: color-mix(in srgb, var(--fnk-color-card) 95%, transparent) !important;",
  '[data-theme="dark"] [data-v1-chrome="footer"] .text-slate-800',
]) {
  if (!footer.includes(required)) {
    failures.push(`W4 dark footer contract missing: ${required}`);
  }
}
for (const required of [
  '[data-theme="dark"] #mainNav',
  "background: color-mix(in srgb, var(--fnk-color-card) 94%, transparent) !important;",
  "#mainNav .brand-text",
  "#mainNav .dropdown-menu",
]) {
  if (!navigation.includes(required)) {
    failures.push(`W4 dark navigation contract missing: ${required}`);
  }
}
if (!marketChartFrame.includes("bg-[var(--c-panel)]")) {
  failures.push("W4 MarketChartFrame panel background is not tokenized");
}
for (const required of [
  'backgroundColor: theme.token("panel")',
  'borderColor: theme.token("line")',
  'bodyColor: theme.token("ink")',
  'titleColor: theme.token("ink")',
]) {
  if (!marketChartEngine.includes(required)) {
    failures.push(`W4 chart tooltip contract missing: ${required}`);
  }
}

const cssText = CSS_TARGETS.map((path) => readFileSync(join(ROOT, path), "utf8")).join("\n");
const definedTokens = new Set([...cssText.matchAll(/(--c-[A-Za-z0-9_-]+)\s*:/g)].map((match) => match[1]));
const scannedFiles = walk(SRC_ROOT).sort();
const referencedTokens = new Map();

for (const file of scannedFiles) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/var\((--c-[A-Za-z0-9_-]+)/g)) {
    const token = match[1];
    if (!referencedTokens.has(token)) referencedTokens.set(token, []);
    referencedTokens.get(token).push(relative(ROOT, file));
  }
}

for (const [token, files] of referencedTokens) {
  if (!definedTokens.has(token)) {
    failures.push(`orphaned ${token}: ${[...new Set(files)].slice(0, 5).join(", ")}`);
  }
}

let rawColorCurrentCount = 0;
const currentRawColorsByFile = new Map();
for (const file of scannedFiles) {
  const relPath = relative(ROOT, file);
  const allowed = rawColorAllowlist.files[relPath] ?? {};
  const literals = collectRawColorLiterals(readFileSync(file, "utf8"));
  if (literals.size > 0) {
    currentRawColorsByFile.set(relPath, literals);
    const fileCategory = rawColorAllowlist.file_categories[relPath];
    if (!fileCategory || typeof fileCategory !== "object") {
      failures.push(`W5 raw color file missing category: ${relPath}`);
    } else if (!ALLOWED_RAW_COLOR_CATEGORIES.has(fileCategory.category)) {
      failures.push(`W5 raw color file has unknown category: ${relPath} ${fileCategory.category ?? "missing"}`);
    }
  }

  for (const [literal, { count, lines }] of literals) {
    rawColorCurrentCount += count;
    const maxAllowed = Number(allowed[literal] ?? 0);
    if (count > maxAllowed) {
      failures.push(
        `W5 raw color literal not allowlisted: ${relPath}:${lines.slice(0, 3).join(",")} ${literal} count ${count} > ${maxAllowed}`,
      );
    }
  }
}
for (const [relPath, allowedLiterals] of Object.entries(rawColorAllowlist.files)) {
  const fileCategory = rawColorAllowlist.file_categories[relPath];
  if (!fileCategory || typeof fileCategory !== "object") {
    failures.push(`W5 raw color allowlist entry missing category: ${relPath}`);
  } else if (!ALLOWED_RAW_COLOR_CATEGORIES.has(fileCategory.category)) {
    failures.push(`W5 raw color allowlist entry unknown category: ${relPath} ${fileCategory.category ?? "missing"}`);
  }

  const currentLiterals = currentRawColorsByFile.get(relPath) ?? new Map();
  for (const [literal, allowedCountRaw] of Object.entries(allowedLiterals)) {
    const allowedCount = Number(allowedCountRaw);
    const currentCount = currentLiterals.get(literal)?.count ?? 0;
    if (!Number.isFinite(allowedCount) || allowedCount < 0) {
      failures.push(`W5 raw color allowlist invalid count: ${relPath} ${literal}=${allowedCountRaw}`);
    } else if (currentCount < allowedCount) {
      failures.push(
        `W5 raw color allowlist stale: ${relPath} ${literal} count ${currentCount} < ${allowedCount}; run npm run qa:tokens:update-allowlist`,
      );
    }
  }
}

for (const target of W1_CSS_TARGETS) {
  const text = readFileSync(join(ROOT, target), "utf8");
  const colorMatches = [];
  for (const match of text.matchAll(rawColorPattern)) {
    colorMatches.push(`${target}:${text.slice(0, match.index).split("\n").length}`);
  }
  if (colorMatches.length > 0) {
    failures.push(`W1 raw color literals remain: ${colorMatches.slice(0, 8).join(", ")}`);
  }

  for (const match of text.matchAll(spacingDeclaration)) {
    const property = match[2];
    const value = match[3];
    if (/-?\d+px\b/.test(value)) {
      const line = text.slice(0, match.index).split("\n").length;
      failures.push(`W1 raw spacing px ${target}:${line} ${property}: ${value.trim()}`);
    }
  }
}

for (const target of W2_COMPONENT_TARGETS) {
  const text = readFileSync(join(ROOT, target), "utf8");
  const rawColorMatches = [];
  for (const match of text.matchAll(rawColorPattern)) {
    rawColorMatches.push(`${target}:${text.slice(0, match.index).split("\n").length}`);
  }
  if (rawColorMatches.length > 0) {
    failures.push(`W2 raw color literals remain: ${rawColorMatches.slice(0, 8).join(", ")}`);
  }

  const namedColorMatches = [];
  for (const match of text.matchAll(namedTailwindColorPattern)) {
    namedColorMatches.push(`${target}:${text.slice(0, match.index).split("\n").length}`);
  }
  if (namedColorMatches.length > 0) {
    failures.push(`W2 named Tailwind colors remain: ${namedColorMatches.slice(0, 8).join(", ")}`);
  }
}

if (failures.length > 0) {
  fail("token foundation contract failed", failures);
}

console.log(
  `[qa:tokens] token foundation OK (${REQUIRED_THEME_ALIASES.length} theme aliases, ${REQUIRED_SPACING_TOKENS.length} spacing tokens, ${definedTokens.size} --c-* definitions, ${referencedTokens.size} --c-* references, raw colors ${rawColorCurrentCount}/${rawColorAllowlist.total_allowed_occurrences} baseline)`,
);
