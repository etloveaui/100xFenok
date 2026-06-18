import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const defaultSourcePath = path.resolve(
  appRoot,
  "../../../../../../02_For_Mona/00_Project/mona-life/data/english/expression-bank.json",
);
const outputPath = path.join(
  appRoot,
  "src/features/mona-vnext/coach/expressionBank.generated.json",
);

const sourcePath = process.env.MONA_LIFE_EXPRESSION_BANK_SOURCE || defaultSourcePath;
const raw = JSON.parse(readFileSync(sourcePath, "utf8"));
const entries = Array.isArray(raw.entries) ? raw.entries : [];

function asText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function isEligible(entry) {
  const ko = asText(entry?.ko);
  const en = asText(entry?.en);
  return entry?.grounded === true
    && ko.length > 0
    && en.length > 0
    && ko.length <= 80
    && en.length <= 140
    && typeof entry?.difficulty === "number"
    && entry.difficulty >= 1
    && entry.difficulty <= 2
    && typeof entry?.word_count === "number"
    && entry.word_count >= 2
    && entry.word_count <= 10;
}

function expressionId(entry, index) {
  const basis = [
    entry?.source_id ?? "",
    String(index),
    asText(entry?.ko),
    asText(entry?.en),
  ].join("|");
  return `mona-life-${createHash("sha1").update(basis).digest("hex").slice(0, 12)}`;
}

const normalized = entries
  .map((entry, index) => ({ entry, index }))
  .filter(({ entry }) => isEligible(entry))
  .map(({ entry, index }) => ({
    id: expressionId(entry, index),
    ko: asText(entry.ko),
    en: asText(entry.en),
    state: "prompt",
  }));

const duplicateIds = normalized
  .map((entry) => entry.id)
  .filter((id, index, ids) => ids.indexOf(id) !== index);

if (duplicateIds.length > 0) {
  throw new Error(`duplicate normalized ids: ${duplicateIds.slice(0, 5).join(", ")}`);
}

const artifact = {
  schemaVersion: 1,
  source: typeof raw.source === "string" ? raw.source : "unknown",
  updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  generatedAt: new Date().toISOString(),
  sourcePath: "mona-life/data/english/expression-bank.json",
  filters: {
    grounded: true,
    difficultyMin: 1,
    difficultyMax: 2,
    wordCountMin: 2,
    wordCountMax: 10,
    koMaxChars: 80,
    enMaxChars: 140,
  },
  sourceEntryCount: entries.length,
  eligibleEntryCount: normalized.length,
  entries: normalized,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${normalized.length} Mona vNext expressions -> ${path.relative(appRoot, outputPath)}`);
