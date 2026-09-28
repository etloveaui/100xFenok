#!/usr/bin/env node
// A small, nonblocking view of the dates currently served by each data set.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANE_REGISTRY } from "./lib/lane-registry.mjs";
import {
  DETECTION_CALENDARS,
  HEALTH_SET_EXCLUSIONS,
  publicServedPath,
  readDetectionFloorRows,
  summarizeDataSetFreshness,
} from "./lib/fenok-data-health-freshness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "fenok-data-health-kpi/v4";
const KPI_REL_PATH = "admin/fenok-data-health-kpi.json";
export const COMMITTED_KPI_PATH = path.join(ROOT, "data", KPI_REL_PATH);
export const PUBLIC_KPI_PATH = path.join(ROOT, "100xfenok-next", "public", "data", KPI_REL_PATH);

function getArg(flag) {
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function resolveNow() {
  const value = process.env.KPI_FAKE_NOW;
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString();
}

function readOptionalJson(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  // A present but corrupt input is never silently treated as a missing source.
  return JSON.parse(text);
}

function dataPath(dataRoot, repoRelativePath) {
  if (typeof repoRelativePath !== "string" || !repoRelativePath.startsWith("data/")) return null;
  const relativePath = repoRelativePath.slice("data/".length);
  if (relativePath.split("/").includes("..")) return null;
  return path.join(dataRoot, relativePath);
}

function servingLkg(lane, dataRoot) {
  const storePath = dataPath(dataRoot, lane.recovery_store);
  if (!storePath) return null;
  let state;
  try {
    state = readOptionalJson(storePath);
  } catch {
    // This is an optional, cheap signal; an unreadable recovery index does not
    // make the age-based data-health document unavailable.
    return null;
  }
  if (state === null) return false;
  if (!state || typeof state !== "object" || Array.isArray(state)
    || !state.items || typeof state.items !== "object" || Array.isArray(state.items)) return null;
  return Object.values(state.items).some((item) => item?.resolution_state === "lkg_primary");
}

function buildSet(lane, floor, dataRoot, nowIso) {
  const freshness = summarizeDataSetFreshness(lane, floor, nowIso, DETECTION_CALENDARS, dataRoot);
  const row = {
    set: lane.id,
    served_path: publicServedPath(lane),
    newest_source_date: freshness.newest_source_date,
    max_age: freshness.max_age,
    status: freshness.status,
  };
  if (freshness.date_basis && freshness.date_basis !== "source") row.date_basis = freshness.date_basis;
  if (Number.isInteger(freshness.fresh_members) && Number.isInteger(freshness.total_members)) {
    row.oldest_source_date = freshness.oldest_source_date;
    row.oldest_source_member = freshness.oldest_source_member;
    row.fresh_members = freshness.fresh_members;
    row.total_members = freshness.total_members;
  }
  const lkg = servingLkg(lane, dataRoot);
  if (lkg !== null) row.serving_lkg = lkg;
  return row;
}

export function buildKpiDocuments(nowIso = resolveNow(), {
  dataRoot = path.join(ROOT, "data"),
  publicDataRoot = path.join(ROOT, "100xfenok-next", "public", "data"),
} = {}) {
  if (!Number.isFinite(Date.parse(nowIso))) throw new Error("invalid KPI clock");
  // The public root is an output boundary, never an alternate source of facts.
  void publicDataRoot;
  const rows = readDetectionFloorRows(dataRoot);
  const sets = LANE_REGISTRY.lanes
    .filter((lane) => lane.lane_class === "detection_floor" && !HEALTH_SET_EXCLUSIONS.has(lane.id))
    .map((lane) => buildSet(lane, rows.get(lane.id), dataRoot, nowIso));
  const rootDoc = { schema_version: SCHEMA_VERSION, generated_at: nowIso, sets };
  // Paths are public-safe before projection, so both mirrors carry one contract.
  const publicDoc = structuredClone(rootDoc);
  return { rootDoc, publicDoc };
}

function writeJsonAtomic(filePath, document) {
  const body = `${JSON.stringify(document, null, 2)}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, body, "utf8");
    JSON.parse(fs.readFileSync(temporary, "utf8"));
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function executeKpiBuild({
  dataRoot: rootArg = getArg("--data-root"),
  nowIso = resolveNow(),
} = {}) {
  const root = rootArg ? path.resolve(rootArg) : ROOT;
  const dataRoot = path.join(root, "data");
  const publicDataRoot = rootArg
    ? path.join(root, "public", "data")
    : path.join(root, "100xfenok-next", "public", "data");
  const { rootDoc, publicDoc } = buildKpiDocuments(nowIso, { dataRoot, publicDataRoot });
  writeJsonAtomic(path.join(dataRoot, KPI_REL_PATH), rootDoc);
  writeJsonAtomic(path.join(publicDataRoot, KPI_REL_PATH), publicDoc);
  return {
    rootDoc,
    publicDoc,
    summary: {
      ok: true,
      schema_version: SCHEMA_VERSION,
      generated_at: nowIso,
      sets: rootDoc.sets.length,
      stopped: rootDoc.sets.filter((set) => set.status === "stopped").length,
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(executeKpiBuild().summary, null, 2));
}
