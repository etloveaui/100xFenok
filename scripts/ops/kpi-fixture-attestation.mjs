#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const KPI_FIXTURE_ATTESTATION_SCHEMA = "fenok-kpi-fixture-attestation/v1";
export const KPI_FIXTURE_SCOPE_VERSION = 1;
export const KPI_FIXTURE_SCOPE_PATHS = Object.freeze([
  ".github/workflows/update-manifest.yml",
  "scripts",
  "100xfenok-next/package.json",
  "100xfenok-next/scripts",
  "100xfenok-next/sync-static-overrides.mjs",
]);

function gitScopeFiles(repoRoot) {
  const result = spawnSync("git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ...KPI_FIXTURE_SCOPE_PATHS,
  ], { cwd: repoRoot, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${String(result.stderr ?? "").trim() || `exit ${result.status}`}`);
  }
  return result.stdout.toString("utf8").split("\0").filter(Boolean).sort();
}

function hashFramed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  hash.update(`${bytes.length}:`);
  hash.update(bytes);
  hash.update("\0");
}

export function computeKpiFixtureDigest({ repoRoot }) {
  const absoluteRoot = path.resolve(repoRoot);
  const files = gitScopeFiles(absoluteRoot);
  if (files.length === 0) throw new Error("KPI fixture digest scope is empty");
  const hash = crypto.createHash("sha256");
  hashFramed(hash, KPI_FIXTURE_ATTESTATION_SCHEMA);
  hashFramed(hash, KPI_FIXTURE_SCOPE_VERSION);
  for (const relative of files) {
    const absolute = path.join(absoluteRoot, relative);
    const stat = fs.lstatSync(absolute);
    let bytes;
    let kind;
    if (stat.isSymbolicLink()) {
      kind = "symlink";
      bytes = Buffer.from(fs.readlinkSync(absolute));
    } else if (stat.isFile()) {
      kind = "file";
      bytes = fs.readFileSync(absolute);
    } else {
      throw new Error(`unsupported KPI fixture digest entry: ${relative}`);
    }
    hashFramed(hash, relative);
    hashFramed(hash, kind);
    hashFramed(hash, stat.mode & 0o777);
    hashFramed(hash, bytes);
  }
  return { algorithm: "sha256", digest: hash.digest("hex"), file_count: files.length };
}

function exactAttestationShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = ["algorithm", "digest", "file_count", "schema_version", "scope_version"].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
    && value.schema_version === KPI_FIXTURE_ATTESTATION_SCHEMA
    && value.scope_version === KPI_FIXTURE_SCOPE_VERSION
    && value.algorithm === "sha256"
    && /^[a-f0-9]{64}$/u.test(value.digest)
    && Number.isSafeInteger(value.file_count)
    && value.file_count > 0;
}

function writeJsonAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function recordKpiFixtureAttestation({ repoRoot, attestationPath }) {
  const computed = computeKpiFixtureDigest({ repoRoot });
  const attestation = {
    schema_version: KPI_FIXTURE_ATTESTATION_SCHEMA,
    scope_version: KPI_FIXTURE_SCOPE_VERSION,
    ...computed,
  };
  writeJsonAtomic(path.resolve(attestationPath), attestation);
  return attestation;
}

export function verifyKpiFixtureAttestation({ repoRoot, attestationPath }) {
  let attestation;
  try {
    attestation = JSON.parse(fs.readFileSync(path.resolve(attestationPath), "utf8"));
  } catch (error) {
    return { hit: false, reason: error?.code === "ENOENT" ? "missing" : "unreadable_or_malformed" };
  }
  if (!exactAttestationShape(attestation)) return { hit: false, reason: "invalid_shape" };
  let computed;
  try {
    computed = computeKpiFixtureDigest({ repoRoot });
  } catch {
    return { hit: false, reason: "digest_unavailable" };
  }
  if (attestation.file_count !== computed.file_count || attestation.digest !== computed.digest) {
    return { hit: false, reason: "digest_mismatch", attestation, computed };
  }
  return { hit: true, reason: "exact_digest_match", attestation, computed };
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

export function main() {
  const command = process.argv[2];
  const repoRoot = path.resolve(argValue("--repo-root") ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
  if (command === "record") {
    const output = argValue("--output");
    if (!output) throw new Error("record requires --output");
    const attestation = recordKpiFixtureAttestation({ repoRoot, attestationPath: output });
    console.log(`KPI fixture attestation recorded: ${attestation.digest} (${attestation.file_count} files)`);
    return 0;
  }
  if (command === "verify") {
    const input = argValue("--input");
    if (!input) throw new Error("verify requires --input");
    const result = verifyKpiFixtureAttestation({ repoRoot, attestationPath: input });
    console.log(`KPI fixture attestation ${result.hit ? "hit" : "miss"}: ${result.reason}`);
    return result.hit ? 0 : 1;
  }
  throw new Error("usage: kpi-fixture-attestation.mjs <record|verify> --repo-root <path> <--output|--input> <path>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`KPI fixture attestation failed closed: ${error.message}`);
    process.exitCode = 2;
  }
}
