import {
  createHash,
  randomBytes,
} from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  MAX_DATA_SHARD_BYTES,
  MAX_DATA_SHARD_INDEX_BYTES,
  PUBLIC_DATA_SHARD_FAMILIES,
  encodeDataShardHeader,
} from "../src/lib/public-data-binary-shard.mjs";

const projectRoot = path.resolve(process.cwd());
const assetRoot = path.join(projectRoot, ".open-next", "assets", "data");
const MAX_BUCKET_COUNT = 256;
const HEADER_PREFIX_BYTES = 8;

function fail(message) {
  throw new Error(message);
}

function lstatOrNull(target) {
  try {
    return lstatSync(target, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sameFingerprint(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size;
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function assertRegularFile(target, expected, label) {
  const stat = lstatOrNull(target);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    fail(`${label} must be an ordinary file: ${target}`);
  }
  if (expected && !sameFingerprint(stat, expected)) {
    fail(`${label} changed during packing: ${target}`);
  }
  return stat;
}

function assertSameRegularIdentity(target, expected, label) {
  const stat = lstatOrNull(target);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || !sameIdentity(stat, expected)) {
    fail(`${label} changed identity during packing: ${target}`);
  }
  return stat;
}

function assertDirectory(target, label) {
  const stat = lstatOrNull(target);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(`${label} must be an existing ordinary directory: ${target}`);
  }
  return stat;
}

function assertOutputRoot() {
  assertDirectory(projectRoot, "Project root");
  let current = projectRoot;
  for (const component of [".open-next", "assets", "data"]) {
    current = path.join(current, component);
    assertDirectory(current, "Emitted asset path component");
  }
  if (path.resolve(current) !== assetRoot) {
    fail("Refusing an unexpected emitted asset root");
  }
}

function normalizedName(name) {
  return name.normalize("NFC").toLowerCase();
}

function assertNoNameCollisions(entries, label) {
  const names = new Map();
  for (const entry of entries) {
    const normalized = normalizedName(entry.name);
    const prior = names.get(normalized);
    if (prior !== undefined && prior !== entry.name) {
      fail(`${label} contains filenames that collide after NFC/case folding: ${prior} and ${entry.name}`);
    }
    names.set(normalized, entry.name);
  }
}

function validateFamilyDescriptor(family) {
  if (!family || typeof family.root !== "string" || family.root.length === 0) {
    fail("Shared public-data family table contains an invalid root");
  }
  if (family.root.startsWith("/") || family.root.includes("\\")) {
    fail(`Unsafe public-data family root: ${family.root}`);
  }
  const components = family.root.split("/");
  if (components.some((part) => !part || part === "." || part === "..")) {
    fail(`Unsafe public-data family root: ${family.root}`);
  }
  if (!Number.isSafeInteger(family.bucketCount)
    || family.bucketCount < 1
    || family.bucketCount > MAX_BUCKET_COUNT) {
    fail(`Unsupported bucket count for public-data family ${family.root}`);
  }
  if (family.excludedNames !== undefined
    && (!Array.isArray(family.excludedNames)
      || family.excludedNames.some((name) => typeof name !== "string" || name.includes("/")))) {
    fail(`Invalid excluded-name list for public-data family ${family.root}`);
  }
  return components;
}

function assertFamilyAncestry(family, expectedRoot) {
  let current = assetRoot;
  for (const component of validateFamilyDescriptor(family)) {
    current = path.join(current, component);
    const stat = lstatOrNull(current);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(`Unsafe public-data family ancestry for ${family.root}: ${current}`);
    }
  }
  if (expectedRoot && current !== expectedRoot) {
    fail(`Public-data family root changed during packing: ${family.root}`);
  }
  return current;
}

function assertResolverSafeFilename(name, label) {
  if (/[\\/?#\u0000-\u001f\u007f]/u.test(name)) {
    fail(`${label} cannot be resolved through the public-data URL path: ${name}`);
  }
  try {
    if (decodeURIComponent(encodeURIComponent(name)) !== name) {
      fail(`${label} does not round-trip through the public-data URL path: ${name}`);
    }
  } catch {
    fail(`${label} does not round-trip through the public-data URL path: ${name}`);
  }
}

function inspectFamilyDirectory(family) {
  const components = validateFamilyDescriptor(family);
  let current = assetRoot;
  for (const component of components) {
    current = path.join(current, component);
    const stat = lstatOrNull(current);
    if (!stat) return { root: current, exists: false, files: [], shardDir: path.join(current, "_shards"), existingShards: [] };
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(`Unsafe public-data family ancestry for ${family.root}: ${current}`);
    }
  }

  const entries = readdirSync(current, { withFileTypes: true });
  assertNoNameCollisions(entries, `Public-data family ${family.root}`);
  const excluded = new Set(family.excludedNames ?? []);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    const stat = lstatOrNull(fullPath);
    if (!stat) fail(`Family entry disappeared during inspection: ${fullPath}`);
    if (entry.name.endsWith(".json") && !excluded.has(entry.name)) {
      if (stat.isSymbolicLink() || !stat.isFile()) {
        fail(`Candidate JSON record must be an ordinary file: ${fullPath}`);
      }
      assertResolverSafeFilename(entry.name, `Candidate JSON record in ${family.root}`);
      const stem = entry.name.slice(0, -5);
      if (!stem) fail(`Candidate JSON record has an empty stem: ${fullPath}`);
      files.push({ name: entry.name, stem, fullPath, fingerprint: stat });
      continue;
    }
    if (stat.isSymbolicLink()) {
      fail(`Symbolic links are not allowed in public-data family ${family.root}: ${fullPath}`);
    }
    if (!stat.isFile() && !stat.isDirectory()) {
      fail(`Special filesystem entries are not allowed in public-data family ${family.root}: ${fullPath}`);
    }
  }
  files.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  const shardDir = path.join(current, "_shards");
  const shardStat = lstatOrNull(shardDir);
  let existingShards = [];
  if (shardStat) {
    if (shardStat.isSymbolicLink() || !shardStat.isDirectory()) {
      fail(`Unsafe _shards directory for ${family.root}: ${shardDir}`);
    }
    const shardEntries = readdirSync(shardDir, { withFileTypes: true });
    assertNoNameCollisions(shardEntries, `Shard directory ${family.root}`);
    existingShards = shardEntries.map((entry) => {
      const fullPath = path.join(shardDir, entry.name);
      const stat = lstatOrNull(fullPath);
      if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
        fail(`Shard directory may contain only ordinary files: ${fullPath}`);
      }
      if (entry.name.toLowerCase().endsWith(".bin") && !/^[0-9a-f]{2}\.bin$/.test(entry.name)) {
        fail(`Unsafe shard filename for ${family.root}: ${entry.name}`);
      }
      return { name: entry.name, fullPath, fingerprint: stat };
    });
  }
  return { root: current, exists: true, files, shardDir, shardStat, existingShards };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bucketFor(stem, bucketCount) {
  const digest = createHash("sha256").update(stem, "utf8").digest();
  return digest.readUInt32BE(0) % bucketCount;
}

function readStableRecord(record, label) {
  const before = assertRegularFile(record.fullPath, record.fingerprint, label);
  if (before.size > BigInt(MAX_DATA_SHARD_BYTES)) {
    fail(`Public-data record is larger than one shard: ${record.fullPath}`);
  }
  const bytes = readFileSync(record.fullPath);
  const after = assertRegularFile(record.fullPath, before, label);
  if (BigInt(bytes.byteLength) !== after.size) {
    fail(`Public-data record length changed while being read: ${record.fullPath}`);
  }
  return { bytes, fingerprint: after, hash: sha256(bytes) };
}

function verifyRecordStillMatches(record, label) {
  const before = assertRegularFile(record.fullPath, record.fingerprint, label);
  const bytes = readFileSync(record.fullPath);
  assertRegularFile(record.fullPath, before, label);
  if (sha256(bytes) !== record.hash) {
    fail(`${label} contents changed during packing: ${record.fullPath}`);
  }
}

function ensureOwnedDirectory(target) {
  if (lstatOrNull(target)) fail(`Refusing to reuse an existing staging path: ${target}`);
  mkdirSync(target, { mode: 0o700 });
  return lstatSync(target, { bigint: true });
}

function ensureStageSubdirectory(stageRoot, relative) {
  const target = path.join(stageRoot, relative);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const relativePath = path.relative(stageRoot, target);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    fail(`Unsafe staging path: ${target}`);
  }
  let current = stageRoot;
  for (const part of relativePath.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    assertDirectory(current, "Owned staging path");
  }
  return target;
}

function buildFamilyBucketPlan(family, inspected) {
  const bucketMap = new Map();
  for (const record of inspected.files) {
    const { bytes, fingerprint, hash } = readStableRecord(record, `Public-data record ${family.root}`);
    record.fingerprint = fingerprint;
    record.hash = hash;
    record.byteLength = bytes.byteLength;
    record.bucket = bucketFor(record.stem, family.bucketCount);
    const members = bucketMap.get(record.bucket) ?? [];
    members.push(record);
    bucketMap.set(record.bucket, members);
  }
  for (const [bucket, members] of bucketMap) {
    const stems = new Set();
    let bodyBytes = 0;
    for (const member of members) {
      if (stems.has(member.stem)) fail(`Duplicate record stem in ${family.root}: ${member.stem}`);
      stems.add(member.stem);
      bodyBytes += member.byteLength;
      if (bodyBytes + HEADER_PREFIX_BYTES > MAX_DATA_SHARD_BYTES) {
        fail(`Shard body exceeds ${MAX_DATA_SHARD_BYTES} bytes for ${family.root}/${bucket.toString(16).padStart(2, "0")}`);
      }
    }
    members.sort((left, right) => (left.stem < right.stem ? -1 : left.stem > right.stem ? 1 : 0));
    bucketMap.set(bucket, members);
  }
  return [...bucketMap.entries()].sort(([left], [right]) => left - right);
}

function encodeBucket(family, bucket, members, stageRoot, familyIndex) {
  const index = Object.create(null);
  const payloads = [];
  let bodyBytes = 0;
  for (const record of members) {
    const { bytes, hash } = readStableRecord(record, `Public-data record ${family.root}`);
    if (hash !== record.hash || bytes.byteLength !== record.byteLength) {
      fail(`Public-data record changed after bucket assignment: ${record.fullPath}`);
    }
    index[record.stem] = [bodyBytes, bytes.byteLength, hash];
    payloads.push(bytes);
    bodyBytes += bytes.byteLength;
  }

  const indexBytes = Buffer.from(JSON.stringify(index), "utf8");
  if (indexBytes.byteLength > MAX_DATA_SHARD_INDEX_BYTES) {
    fail(`Shard index exceeds ${MAX_DATA_SHARD_INDEX_BYTES} bytes for ${family.root}/${bucket.toString(16).padStart(2, "0")}`);
  }
  const header = Buffer.from(encodeDataShardHeader(index));
  if (header.byteLength !== HEADER_PREFIX_BYTES + indexBytes.byteLength
    || header.subarray(0, 4).toString("ascii") !== "FNPK"
    || header.readUInt32BE(4) !== indexBytes.byteLength
    || !header.subarray(HEADER_PREFIX_BYTES).equals(indexBytes)) {
    fail(`Shared shard codec returned an unexpected header for ${family.root}`);
  }
  const totalBytes = header.byteLength + bodyBytes;
  if (totalBytes > MAX_DATA_SHARD_BYTES) {
    fail(`Shard exceeds ${MAX_DATA_SHARD_BYTES} bytes for ${family.root}/${bucket.toString(16).padStart(2, "0")}`);
  }
  const output = Buffer.concat([header, ...payloads], totalBytes);
  const name = `${bucket.toString(16).padStart(2, "0")}.bin`;
  const stagedPath = path.join(ensureStageSubdirectory(stageRoot, path.join("new", String(familyIndex))), name);
  writeFileSync(stagedPath, output, { flag: "wx", mode: 0o644 });
  const stagedStat = assertRegularFile(stagedPath, null, "Staged shard");
  if (stagedStat.size !== BigInt(totalBytes) || sha256(readFileSync(stagedPath)) !== sha256(output)) {
    fail(`Staged shard failed validation: ${stagedPath}`);
  }
  return { name, stagedPath, fingerprint: stagedStat, hash: sha256(output), byteLength: totalBytes };
}

function existingShardMetrics(inspected) {
  const bins = inspected.existingShards.filter((entry) => /^[0-9a-f]{2}\.bin$/.test(entry.name));
  const sizes = bins.map((entry) => Number(entry.fingerprint.size));
  return {
    buckets: bins.length,
    bytes: sizes.reduce((sum, size) => sum + size, 0),
    maxAssetBytes: sizes.length ? Math.max(...sizes) : 0,
  };
}

function backupPath(stageRoot, kind, familyIndex, name) {
  return path.join(ensureStageSubdirectory(stageRoot, path.join("rollback", kind, String(familyIndex))), name);
}

function moveToBackup(sourcePath, targetPath, expected, label) {
  assertRegularFile(sourcePath, expected, label);
  if (lstatOrNull(targetPath)) fail(`Refusing to overwrite a staging backup: ${targetPath}`);
  renameSync(sourcePath, targetPath);
  const fingerprint = lstatOrNull(targetPath);
  if (!fingerprint) fail(`${label} disappeared while being backed up: ${sourcePath}`);
  return { sourcePath, targetPath, fingerprint };
}

function rollback(changes, movedRecords) {
  const errors = [];
  for (const move of [...movedRecords].reverse()) {
    try {
      if (lstatOrNull(move.sourcePath)) fail(`Cannot restore raw record over an existing path: ${move.sourcePath}`);
      const backupStat = lstatOrNull(move.targetPath);
      if (!backupStat || !sameFingerprint(backupStat, move.fingerprint)) {
        fail(`Refusing to restore a raw record changed during rollback: ${move.targetPath}`);
      }
      renameSync(move.targetPath, move.sourcePath);
    } catch (error) {
      errors.push(error.message);
    }
  }
  for (const change of [...changes].reverse()) {
    try {
      if (change.published) {
        const current = lstatOrNull(change.finalPath);
        if (current) {
          if (!sameIdentity(current, change.publishedFingerprint)
            || sha256(readFileSync(change.finalPath)) !== change.publishedHash) {
            fail(`Refusing to remove a shard changed by another writer: ${change.finalPath}`);
          }
          unlinkSync(change.finalPath);
        }
      }
      if (change.backupPath && lstatOrNull(change.backupPath)) {
        if (lstatOrNull(change.finalPath)) fail(`Cannot restore prior shard over an existing path: ${change.finalPath}`);
        const backupStat = lstatOrNull(change.backupPath);
        if (!backupStat || !sameFingerprint(backupStat, change.backupFingerprint)) {
          fail(`Refusing to restore a prior shard changed during rollback: ${change.backupPath}`);
        }
        renameSync(change.backupPath, change.finalPath);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  return errors;
}

function cleanupOwnedStage(stageRoot, fingerprint) {
  const current = lstatOrNull(stageRoot);
  if (!current) return;
  if (current.isSymbolicLink() || !current.isDirectory() || !sameInode(current, fingerprint)) {
    fail(`Refusing to remove a staging path that is no longer owned: ${stageRoot}`);
  }
  rmSync(stageRoot, { recursive: true, force: false });
}

function main() {
  if (process.argv.length !== 2) {
    fail("This packer only accepts the fixed .open-next/assets/data output root");
  }
  if (!Array.isArray(PUBLIC_DATA_SHARD_FAMILIES) || PUBLIC_DATA_SHARD_FAMILIES.length === 0) {
    fail("Shared public-data family table is empty");
  }
  assertOutputRoot();

  const inspectedFamilies = PUBLIC_DATA_SHARD_FAMILIES.map((family) => ({
    family,
    inspected: inspectFamilyDirectory(family),
  }));
  const plans = [];
  const metrics = [];
  for (let familyIndex = 0; familyIndex < inspectedFamilies.length; familyIndex += 1) {
    const { family, inspected } = inspectedFamilies[familyIndex];
    if (!inspected.exists) {
      metrics.push({ family: family.root, status: "skipped_missing", records: 0, buckets: 0, bytes: 0, maxAssetBytes: 0 });
      continue;
    }
    if (inspected.files.length === 0) {
      const existing = existingShardMetrics(inspected);
      metrics.push({ family: family.root, status: "skipped_no_raw_records_preserved", records: 0, ...existing });
      continue;
    }
    if (inspected.existingShards.some((entry) => /^[0-9a-f]{2}\.bin$/.test(entry.name))) {
      fail(`Refusing a mixed raw-record and packed-shard family: ${family.root}`);
    }
    const buckets = buildFamilyBucketPlan(family, inspected);
    plans.push({ family, familyIndex, inspected, buckets, staged: [] });
  }

  if (plans.length === 0) {
    console.log(JSON.stringify({ families: metrics }, null, 2));
    return;
  }

  const stageName = `.public-data-pack-${process.pid}-${randomBytes(6).toString("hex")}`;
  const stageRoot = path.join(assetRoot, stageName);
  const stageFingerprint = ensureOwnedDirectory(stageRoot);
  const outputChanges = [];
  const movedRecords = [];
  const createdShardDirs = [];
  let committed = false;

  try {
    for (const plan of plans) {
      for (const [bucket, members] of plan.buckets) {
        plan.staged.push(encodeBucket(plan.family, bucket, members, stageRoot, plan.familyIndex));
      }
    }

    for (const plan of plans) {
      assertFamilyAncestry(plan.family, plan.inspected.root);
      for (const record of plan.inspected.files) {
        verifyRecordStillMatches(record, `Public-data record ${plan.family.root}`);
      }
    }

    for (const plan of plans) {
      assertFamilyAncestry(plan.family, plan.inspected.root);
      let shardStat = lstatOrNull(plan.inspected.shardDir);
      if (!shardStat) {
        mkdirSync(plan.inspected.shardDir, { mode: 0o755 });
        shardStat = assertDirectory(plan.inspected.shardDir, "Created shard directory");
        createdShardDirs.push({ path: plan.inspected.shardDir, fingerprint: shardStat });
      }
      if (shardStat.isSymbolicLink() || !shardStat.isDirectory()) {
        fail(`Unsafe _shards directory for ${plan.family.root}`);
      }
      const existingNames = new Set(readdirSync(plan.inspected.shardDir));
      for (const staged of plan.staged) {
        const normalizedTarget = normalizedName(staged.name);
        for (const existingName of existingNames) {
          if (normalizedName(existingName) === normalizedTarget && existingName !== staged.name) {
            fail(`Existing shard filename collides with target after case folding: ${existingName} and ${staged.name}`);
          }
        }
        const finalPath = path.join(plan.inspected.shardDir, staged.name);
        const prior = lstatOrNull(finalPath);
        if (prior) {
          const backup = backupPath(stageRoot, "shards", plan.familyIndex, staged.name);
          const moved = moveToBackup(finalPath, backup, prior, "Prior shard");
          outputChanges.push({ finalPath, backupPath: moved.targetPath, backupFingerprint: moved.fingerprint, published: false });
          if (!sameIdentity(moved.fingerprint, prior)) fail(`Prior shard changed while being backed up: ${finalPath}`);
        }
        renameSync(staged.stagedPath, finalPath);
        const publishedFingerprint = assertSameRegularIdentity(finalPath, staged.fingerprint, "Published shard");
        outputChanges.push({ finalPath, published: true, publishedFingerprint, publishedHash: staged.hash });
        existingNames.add(staged.name);
      }

      const currentEntries = readdirSync(plan.inspected.shardDir, { withFileTypes: true });
      assertNoNameCollisions(currentEntries, `Published shard directory ${plan.family.root}`);
      const currentNames = new Set(currentEntries.map((entry) => entry.name));
      const desiredNames = new Set(plan.staged.map((entry) => entry.name));
      for (const oldShard of plan.inspected.existingShards) {
        if (!/^[0-9a-f]{2}\.bin$/.test(oldShard.name) || desiredNames.has(oldShard.name)) continue;
        if (!currentNames.has(oldShard.name)) continue;
        const backup = backupPath(stageRoot, "shards", plan.familyIndex, oldShard.name);
        const moved = moveToBackup(oldShard.fullPath, backup, oldShard.fingerprint, "Superseded shard");
        outputChanges.push({ finalPath: oldShard.fullPath, backupPath: moved.targetPath, backupFingerprint: moved.fingerprint, published: false });
        if (!sameIdentity(moved.fingerprint, oldShard.fingerprint)) {
          fail(`Superseded shard changed while being backed up: ${oldShard.fullPath}`);
        }
      }
    }

    for (const plan of plans) {
      assertFamilyAncestry(plan.family, plan.inspected.root);
      for (const staged of plan.staged) {
        const finalPath = path.join(plan.inspected.shardDir, staged.name);
        const bytes = readFileSync(finalPath);
        assertSameRegularIdentity(finalPath, staged.fingerprint, "Published shard");
        if (bytes.byteLength !== staged.byteLength || sha256(bytes) !== staged.hash) {
          fail(`Published shard failed validation: ${finalPath}`);
        }
      }
      for (const record of plan.inspected.files) {
        verifyRecordStillMatches(record, `Public-data record ${plan.family.root}`);
      }
    }

    for (const plan of plans) {
      for (const record of plan.inspected.files) {
        assertFamilyAncestry(plan.family, plan.inspected.root);
        verifyRecordStillMatches(record, `Public-data record ${plan.family.root}`);
        const backup = backupPath(stageRoot, "records", plan.familyIndex, record.name);
        const moved = moveToBackup(record.fullPath, backup, record.fingerprint, `Public-data record ${plan.family.root}`);
        movedRecords.push(moved);
        if (!sameIdentity(moved.fingerprint, record.fingerprint)) {
          fail(`Public-data record changed while being backed up: ${record.fullPath}`);
        }
        assertRegularFile(moved.targetPath, moved.fingerprint, "Backed-up public-data record");
        if (sha256(readFileSync(moved.targetPath)) !== record.hash) {
          fail(`Backed-up public-data record no longer matches its shard: ${record.fullPath}`);
        }
      }
    }

    committed = true;
    for (const plan of plans) {
      const bytes = plan.staged.reduce((sum, item) => sum + item.byteLength, 0);
      const maxAssetBytes = Math.max(...plan.staged.map((item) => item.byteLength));
      metrics.push({
        family: plan.family.root,
        status: "packed",
        records: plan.inspected.files.length,
        buckets: plan.staged.length,
        bytes,
        maxAssetBytes,
      });
    }
    cleanupOwnedStage(stageRoot, stageFingerprint);
  } catch (error) {
    const rollbackErrors = committed ? [] : rollback(outputChanges, movedRecords);
    if (!committed && rollbackErrors.length === 0) {
      for (const created of [...createdShardDirs].reverse()) {
        try {
          const current = lstatOrNull(created.path);
          if (current && current.isDirectory() && sameInode(current, created.fingerprint)) {
            if (readdirSync(created.path).length === 0) rmdirSync(created.path);
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError.message);
        }
      }
    }
    if (rollbackErrors.length > 0) {
      fail(`${error.message}; rollback incomplete; recovery backups retained at ${stageRoot}; ${rollbackErrors.join(" | ")}`);
    }
    try {
      cleanupOwnedStage(stageRoot, stageFingerprint);
    } catch (cleanupError) {
      fail(`${error.message}; recovery stage retained at ${stageRoot}; cleanup failed: ${cleanupError.message}`);
    }
    throw error;
  }

  console.log(JSON.stringify({ families: metrics }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`Public-data packing failed: ${error.stack ?? error.message}`);
  process.exitCode = 1;
}
