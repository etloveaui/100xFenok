#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_ROOT = join(ROOT, "src");
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
  "s7",
  "s8",
  "s8-5",
  "s9",
  "s9-5",
  "s10",
  "s11",
  "s12",
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

const globals = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const themeC = readFileSync(join(ROOT, "src/styles/theme-c.css"), "utf8");
const appShell = readFileSync(join(ROOT, "src/styles/app-shell.css"), "utf8");
const failures = [];

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
    "--shell-background": "#f2f4f6",
    "--shell-panel": "#fff",
    "--shell-surface-muted": "#f7f9fb",
    "--shell-foreground": "#1a1d21",
    "--shell-foreground-muted": "#4e5968",
    "--shell-foreground-subtle": "#667085",
    "--shell-border": "#e8ebee",
    "--shell-brand": "#1d4ed8",
    "--shell-gain": "#047857",
    "--shell-loss": "#c5303f",
    "--shell-warn": "#b45309",
    "--shell-flat": "#667085",
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

if (!globals.includes('[data-theme="dark"]')) {
  failures.push('missing [data-theme="dark"] block');
}
if (!globals.includes("--fnk-neutral-50: oklch(0.205 0 0);")) {
  failures.push("missing Agent-A dark neutral-50 token");
}
if (!globals.includes("--fnk-neutral-950: oklch(0.985 0 0);")) {
  failures.push("missing Agent-A dark neutral-950 token");
}
if (/oklch\(\s*(?:100|[1-9]\d{2,})/.test(globals)) {
  failures.push("out-of-gamut OKLCH lightness detected");
}
if (!/body\s*\{\s*[^}]*background:\s*var\(--background\)/s.test(globals)) {
  failures.push("body background no longer uses --background");
}

const cssText = CSS_TARGETS.map((path) => readFileSync(join(ROOT, path), "utf8")).join("\n");
const definedTokens = new Set([...cssText.matchAll(/(--c-[A-Za-z0-9_-]+)\s*:/g)].map((match) => match[1]));
const scannedFiles = walk(SRC_ROOT);
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

for (const target of W1_CSS_TARGETS) {
  const text = readFileSync(join(ROOT, target), "utf8");
  const colorMatches = [];
  for (const match of text.matchAll(/#[0-9A-Fa-f]{3,8}|rgba?\(/g)) {
    colorMatches.push(`${target}:${text.slice(0, match.index).split("\n").length}`);
  }
  for (const match of text.matchAll(/(?<!-)\b(?:white|black)\b(?!-)/g)) {
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

if (failures.length > 0) {
  fail("token foundation contract failed", failures);
}

console.log(
  `[qa:tokens] token foundation OK (${REQUIRED_THEME_ALIASES.length} theme aliases, ${REQUIRED_SPACING_TOKENS.length} spacing tokens, ${definedTokens.size} --c-* definitions, ${referencedTokens.size} --c-* references)`,
);
