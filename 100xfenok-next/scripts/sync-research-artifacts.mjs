#!/usr/bin/env node
/**
 * sync-research-artifacts.mjs — AA canvas _deploy -> public/research sync (research-tab v1).
 *
 * Spec: docs/planning/20260916_research-tab-spec.md §3 (parsing) §6 (sync) §8 (products).
 * Usage:
 *   node scripts/sync-research-artifacts.mjs --source <AA .../canvas/_deploy> [--apply|--dry-run] [--only id,id]
 * Defaults to --dry-run. --apply copies sample artifacts and regenerates
 * public/research/catalog.json atomically (per-file tmp+rename after full
 * validation, so a failure never leaves a partial tree).
 * Idempotent: catalog generated_at derives from the newest source mtime, so
 * the same inputs always produce the same bytes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST_ROOT = path.join(APP_ROOT, "public", "research");
const SOURCE_PREFIX = "Asset_Allocator/docs/outputs/canvas/_deploy";

const SAMPLE_IDS = [
  "valuation-card-nvda-20260709",
  "valuation-card-mu-20260705",
  "valuation-card-pltr-20260706",
];

const SAMPLE_TITLES = {
  "valuation-card-nvda-20260709": "NVDA 밸류에이션 카드",
  "valuation-card-mu-20260705": "MU 밸류에이션 카드",
  "valuation-card-pltr-20260706": "PLTR 밸류에이션 카드",
};

const PRODUCTS = [
  { id: "product-morning-brief", title: "모닝 브리프", detail: "매일 아침 여는 시장 브리프" },
  { id: "product-premarket-brief", title: "프리마켓 브리프", detail: "장 시작 전 프리마켓 점검" },
  { id: "product-daily-digest", title: "데일리 다이제스트", detail: "하루 시장 흐름 한 장 요약" },
  { id: "product-weekly-recap", title: "위클리 리캡", detail: "한 주 마감 정리" },
  { id: "product-weekly-brief", title: "위클리 브리프", detail: "다음 주를 여는 주간 브리프" },
  { id: "product-monthly-review", title: "월간 리뷰", detail: "한 달 복기와 다음 달 관전점" },
  { id: "product-analyst-opinion", title: "애널리스트 오피니언", detail: "종목·업종 애널리스트 시각" },
  { id: "product-topic-spotlight", title: "토픽 스포트라이트", detail: "이슈 토픽 집중 조명" },
];

function fail(message) {
  console.error(`[sync-research] ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { source: null, apply: false, only: [...SAMPLE_IDS] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source") {
      args.source = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith("--source=")) {
      args.source = arg.slice("--source=".length);
    } else if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--dry-run") {
      args.apply = false;
    } else if (arg === "--only") {
      args.only = String(argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (arg.startsWith("--only=")) {
      args.only = arg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  if (!args.source) fail("--source <AA .../canvas/_deploy> is required (no default)");
  if (args.only.length === 0) fail("--only must list at least one artifact id");
  return args;
}

function parseDateToken(token) {
  if (!/^\d{8}$/.test(token)) return null;
  const year = Number(token.slice(0, 4));
  const month = Number(token.slice(4, 6));
  const day = Number(token.slice(6, 8));
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${token.slice(0, 4)}-${token.slice(4, 6)}-${token.slice(6, 8)}`;
  const check = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

function humanize(slug) {
  return slug
    .split("-")
    .filter((part) => !/^(20\d{6}|\d{8})$/.test(part))
    .join(" ")
    .trim() || slug;
}

/* Spec §3, applied top to bottom. Returns { id, kind, title, ticker, date }. */
function parseArtifactDir(dirname) {
  let rest = dirname;
  let date = null;
  let match = rest.match(/^(\d{8})-(.+)$/);
  if (match) {
    date = parseDateToken(match[1]);
    rest = match[2];
  } else {
    match = rest.match(/^(.*?)[-_](20\d{6})$/);
    if (match) {
      date = parseDateToken(match[2]);
      rest = match[1];
    }
  }
  const slug = rest;
  let kind = "other";
  let ticker = null;
  match = slug.match(/^valuation-card-([a-z]+)(-.*)?$/);
  if (match) {
    kind = "valuation-card";
    ticker = match[1].toUpperCase();
  } else if (/^coverage/.test(slug)) {
    kind = "coverage";
  } else if (/^(weekly-market-note|market-note|weekly-note|market-weekly-note|weekly-market-checkpoint)/.test(slug)) {
    kind = "market-note";
  } else if (/^weekly-armament/.test(slug)) {
    kind = "weekly-armament";
  } else if (/^(feno-)?macro-signal/.test(slug)) {
    kind = "macro-signal";
  } else if (/^(feno-)?canvas|^design|canvas-/.test(slug)) {
    kind = "design";
  } else if (/^rim_index|workbench$|workbench-/.test(slug)) {
    kind = "workbench";
  }
  return { id: dirname, kind, title: SAMPLE_TITLES[dirname] ?? humanize(slug), ticker, date };
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.title.localeCompare(b.title, "ko");
  });
}

const args = parseArgs(process.argv.slice(2));
const sourceRoot = path.resolve(args.source);
if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
  fail(`source is not a directory: ${sourceRoot}`);
}

/* Phase 1: validate everything before touching the destination. */
const staged = [];
let newestMtimeMs = 0;
for (const id of args.only) {
  const parsed = parseArtifactDir(id);
  const srcFile = path.join(sourceRoot, id, "index.html");
  if (!fs.existsSync(srcFile)) fail(`missing artifact file: ${srcFile}`);
  const stat = fs.statSync(srcFile);
  newestMtimeMs = Math.max(newestMtimeMs, stat.mtimeMs);
  staged.push({
    ...parsed,
    status: "live",
    href: `/research/companies/${id}/`,
    source: `${SOURCE_PREFIX}/${id}`,
    size_bytes: stat.size,
    srcFile,
  });
}

const generatedAt = new Date(newestMtimeMs).toISOString();
const liveItems = sortItems(staged.map(({ srcFile: _omit, ...item }) => item));
const productItems = PRODUCTS.map((product) => ({
  id: product.id,
  kind: "product",
  title: `${product.title} — ${product.detail}`,
  ticker: null,
  date: null,
  status: "coming-soon",
  href: null,
  source: null,
  size_bytes: null,
}));
const catalog = {
  schema_version: "research-catalog/v1",
  generated_at: generatedAt,
  items: [...liveItems, ...productItems],
};
const catalogJson = `${JSON.stringify(catalog, null, 2)}\n`;

if (!args.apply) {
  console.log(`[sync-research] dry-run: source=${sourceRoot}`);
  for (const item of liveItems) {
    console.log(`[sync-research] copy ${item.source}/index.html -> public/research/companies/${item.id}/index.html (${item.size_bytes} bytes)`);
  }
  console.log(`[sync-research] catalog: ${liveItems.length} live + ${productItems.length} products, generated_at=${generatedAt}`);
  console.log("[sync-research] re-run with --apply to write. No files changed.");
  process.exit(0);
}

/* Phase 2: atomic writes (tmp file + rename per file). */
function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}

for (const item of staged) {
  const destFile = path.join(DEST_ROOT, "companies", item.id, "index.html");
  const tmpPath = `${destFile}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.copyFileSync(item.srcFile, tmpPath);
  fs.renameSync(tmpPath, destFile);
}
writeAtomic(path.join(DEST_ROOT, "catalog.json"), catalogJson);

console.log(`[sync-research] applied: ${liveItems.length} artifacts + catalog.json (generated_at=${generatedAt})`);
for (const item of liveItems) {
  console.log(`[sync-research] wrote public/research/companies/${item.id}/index.html (${item.size_bytes} bytes)`);
}
