#!/usr/bin/env node
/**
 * check-yf-finance-mirror-gap.mjs — exact YF canonical vs served public-mirror gap.
 *
 * Owned by the YF fetch lane (#285A debt closeout). Read-only: compares the
 * canonical Yahoo finance tree (data/yf/finance) with the served public mirror
 * (100xfenok-next/public/data/yf/finance) file-by-file by content hash.
 *
 * Gap classes (distinguished in the report):
 *   - missing : canonical file absent from the mirror (would 404 when served)
 *   - stale   : both exist but mirror bytes differ from canonical (mirror lags)
 *   - extra   : mirror file absent from canonical (retired canonical row still served)
 * The publication-delay vs defect split is anchored to git: files whose last
 * canonical change is newer than the last commit touching the mirror are the
 * expected boundary-sync delay (#377: the mirror is owned by the merge
 * boundary, never lane-staged); files missing or stale with no such newer
 * change are an unexplained gap and need owner attention.
 *
 * This file is NOT a mirror ownership file: it never writes, stages, or syncs.
 * The mirror itself stays owned by the generic boundary (sync-public-data.mjs,
 * update-manifest materialize routes, fetch-stockanalysis full sync).
 *
 * Exit codes: 0 = report produced; 2 = prerequisite error (dirs missing).
 * Tree-state only; no network, no writes.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const CANONICAL_DIR = path.join(REPO_ROOT, "data", "yf", "finance");
const MIRROR_DIR = path.join(REPO_ROOT, "100xfenok-next", "public", "data", "yf", "finance");

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function listJson(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
}

function lastCommitAnchor(dir) {
  try {
    const line = execFileSync(
      "git",
      ["-C", REPO_ROOT, "log", "-1", "--format=%h %cI", "--", dir],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (!line) return null;
    const [sha, date] = line.split(" ");
    return { sha, date: date ?? null, dir };
  } catch {
    return null;
  }
}

function canonicalChangeAnchor(fileName) {
  try {
    const line = execFileSync(
      "git",
      ["-C", REPO_ROOT, "log", "-1", "--format=%h %cI", "--", path.join("data", "yf", "finance", fileName)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (!line) return null;
    const [sha, date] = line.split(" ");
    return { sha, date: date ?? null };
  } catch {
    return null;
  }
}

function summaryStamp(dir) {
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(dir, "_summary.json"), "utf8"));
    return {
      generated_at: payload.generated_at ?? null,
      count: payload.count ?? null,
      ok: payload.ok ?? null,
      failed: payload.failed ?? null,
    };
  } catch {
    return null;
  }
}

function symbolRows(canonicalDir, mirrorDir, symbols) {
  const rows = [];
  for (const symbol of symbols) {
    const name = `${symbol}.json`;
    const canonicalPath = path.join(canonicalDir, name);
    const mirrorPath = path.join(mirrorDir, name);
    const canonical = fs.existsSync(canonicalPath);
    const mirror = fs.existsSync(mirrorPath);
    let canonicalSha = null;
    let mirrorSha = null;
    let stale = null;
    let fetchedAt = null;
    if (canonical) {
      canonicalSha = sha256File(canonicalPath);
      try {
        const payload = JSON.parse(fs.readFileSync(canonicalPath, "utf8"));
        fetchedAt = payload.fetched_at ?? null;
      } catch {
        fetchedAt = null;
      }
    }
    if (mirror) {
      mirrorSha = sha256File(mirrorPath);
    }
    if (canonical && mirror) {
      stale = canonicalSha !== mirrorSha;
    }
    rows.push({
      symbol,
      canonical,
      mirror,
      stale,
      fetched_at: fetchedAt,
      canonical_sha256: canonicalSha,
      mirror_sha256: mirrorSha,
      verdict: !canonical
        ? "absent_canonical"
        : !mirror
          ? "missing_on_mirror"
          : stale
            ? "stale_twin"
            : "in_sync",
    });
  }
  return rows;
}

export function computeYfFinanceMirrorGap({
  canonicalDir = CANONICAL_DIR,
  mirrorDir = MIRROR_DIR,
  symbols = [],
  withGitAnchors = true,
} = {}) {
  if (!fs.existsSync(canonicalDir) || !fs.existsSync(mirrorDir)) {
    throw new Error(`YF mirror gap prerequisites missing: canonical=${canonicalDir} mirror=${mirrorDir}`);
  }
  const canonicalFiles = listJson(canonicalDir);
  const mirrorFiles = listJson(mirrorDir);
  const canonicalSet = new Set(canonicalFiles);
  const mirrorSet = new Set(mirrorFiles);
  const missing = canonicalFiles.filter((name) => !mirrorSet.has(name));
  const extra = mirrorFiles.filter((name) => !canonicalSet.has(name));
  const overlap = canonicalFiles.filter((name) => mirrorSet.has(name));
  const stale = [];
  const identical = [];
  for (const name of overlap) {
    if (sha256File(path.join(canonicalDir, name)) !== sha256File(path.join(mirrorDir, name))) {
      stale.push(name);
    } else {
      identical.push(name);
    }
  }

  const mirrorAnchor = withGitAnchors ? lastCommitAnchor("100xfenok-next/public/data/yf/finance") : null;
  const canonicalAnchor = withGitAnchors ? lastCommitAnchor("data/yf/finance") : null;

  const classify = (names, staleOnly = false) => {
    let expected = 0;
    const unexplained = [];
    if (!withGitAnchors || !mirrorAnchor) {
      return { expected: null, unexplained: names };
    }
    for (const name of names) {
      const change = canonicalChangeAnchor(name);
      if (change && mirrorAnchor.date && change.date && change.date > mirrorAnchor.date) {
        expected += 1;
      } else {
        unexplained.push(name);
      }
    }
    return { expected, unexplained };
  };

  const missingSplit = classify(missing);
  const staleSplit = classify(stale);
  const splitReady = missingSplit.expected !== null && staleSplit.expected !== null;

  return {
    schema_version: "yf-finance-mirror-gap/v1",
    generated_at: new Date().toISOString(),
    canonical_dir: canonicalDir,
    mirror_dir: mirrorDir,
    counts: {
      canonical: canonicalFiles.length,
      mirror: mirrorFiles.length,
      missing_on_mirror: missing.length,
      stale_twins: stale.length,
      identical: identical.length,
      extra_on_mirror: extra.length,
    },
    classification: splitReady
      ? {
          expected_publication_delay: missingSplit.expected + staleSplit.expected,
          missing_expected_delay: missingSplit.expected,
          stale_expected_delay: staleSplit.expected,
          unexplained_missing: missingSplit.unexplained,
          unexplained_stale: staleSplit.unexplained,
        }
      : {
          expected_publication_delay: null,
          unexplained_missing: missingSplit.unexplained,
          unexplained_stale: staleSplit.unexplained,
        },
    summary_stamps: {
      canonical: summaryStamp(canonicalDir),
      mirror: summaryStamp(mirrorDir),
    },
    git_anchors: {
      mirror_last_sync: mirrorAnchor,
      canonical_last_change: canonicalAnchor,
    },
    symbols: symbolRows(canonicalDir, mirrorDir, symbols),
  };
}

function render(report) {
  const lines = [];
  const c = report.counts;
  lines.push(`YF canonical vs served mirror gap (${report.generated_at})`);
  lines.push(`  canonical: ${c.canonical} files  mirror: ${c.mirror} files`);
  lines.push(`  missing on mirror: ${c.missing_on_mirror}  stale twins: ${c.stale_twins}  identical: ${c.identical}  extra on mirror: ${c.extra_on_mirror}`);
  const cls = report.classification;
  if (cls.expected_publication_delay !== null) {
    lines.push(`  expected boundary-sync delay: ${cls.expected_publication_delay} (missing ${cls.missing_expected_delay} + stale ${cls.stale_expected_delay})`);
    if (cls.unexplained_missing.length || cls.unexplained_stale.length) {
      lines.push(`  UNEXPLAINED missing: ${cls.unexplained_missing.join(", ") || "none"}`);
      lines.push(`  UNEXPLAINED stale: ${cls.unexplained_stale.join(", ") || "none"}`);
    } else {
      lines.push("  unexplained gap: none — every gap row is newer than the last mirror sync");
    }
  } else {
    lines.push("  sync-anchor classification unavailable (no git anchor)");
    if (cls.unexplained_missing.length) lines.push(`  missing: ${cls.unexplained_missing.join(", ")}`);
    if (cls.unexplained_stale.length) lines.push(`  stale: ${cls.unexplained_stale.join(", ")}`);
  }
  if (report.git_anchors.mirror_last_sync) {
    lines.push(`  mirror last sync: ${report.git_anchors.mirror_last_sync.sha} ${report.git_anchors.mirror_last_sync.date}`);
  }
  if (report.git_anchors.canonical_last_change) {
    lines.push(`  canonical last change: ${report.git_anchors.canonical_last_change.sha} ${report.git_anchors.canonical_last_change.date}`);
  }
  const stamps = report.summary_stamps;
  lines.push(`  _summary: canonical ${stamps.canonical?.generated_at ?? "missing"} / mirror ${stamps.mirror?.generated_at ?? "missing"}`);
  for (const row of report.symbols) {
    lines.push(`  ${row.symbol}: ${row.verdict}${row.fetched_at ? ` (canonical fetched_at ${row.fetched_at})` : ""}`);
  }
  return lines.join("\n");
}

function main(argv) {
  const json = argv.includes("--json");
  const symbolsArg = argv.find((arg) => arg.startsWith("--symbols="));
  const symbols = symbolsArg ? symbolsArg.split("=")[1].split(",").filter(Boolean).map((s) => s.trim()) : [];
  try {
    const report = computeYfFinanceMirrorGap({ symbols });
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${render(report)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`yf mirror gap check failed: ${error.message}\n`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
