#!/usr/bin/env node
// A workflow that checks out part of the tree must declare every directory the
// scripts it runs actually import. Nothing enforced this, so 2026-08-17
// e1f7c9f072 colocated the cloud-data-plane read runtime under 100xfenok-next
// and silently disarmed several lanes at once: the data-plane serving probe
// died at module load on 15 consecutive runs, the SEC 13F private-route smoke
// died the same way and left its alarm issue stuck open because a
// continue-on-error step reports success, and fetch-oecd-cli was left primed to
// die on its next run. Each failure looked like a different incident.
//
// The requirement is derived from the real module graph rather than maintained
// by hand, so the next move of a shared module fails here instead of in
// production.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");

// Directories that exist only at build time or are produced by an earlier step
// are not import targets and never need declaring.
const IMPORT_PATTERN = /from\s+["'](\.[^"']+)["']/g;
const SCRIPT_INVOCATION = /node\s+((?:100xfenok-next\/)?scripts\/[\w./-]+\.mjs)/g;

export function importedDirectories(entryRelativePath, repoRoot = REPO_ROOT) {
  const seen = new Set();
  const directories = new Set();
  const visit = (absolutePath) => {
    if (seen.has(absolutePath) || !fs.existsSync(absolutePath)) return;
    seen.add(absolutePath);
    directories.add(path.relative(repoRoot, path.dirname(absolutePath)));
    for (const match of fs.readFileSync(absolutePath, "utf8").matchAll(IMPORT_PATTERN)) {
      visit(path.resolve(path.dirname(absolutePath), match[1]));
    }
  };
  visit(path.join(repoRoot, entryRelativePath));
  return [...directories].sort();
}

// Cone mode takes bare directories; non-cone mode takes leading-slash patterns
// and may name a single file. Normalise both to a comparable prefix.
export function declaredPrefixes(workflowSource) {
  const block = /sparse-checkout:\s*\|\n([\s\S]*?)\n(?=\s{0,10}[a-z-]+:|\s*- )/.exec(workflowSource);
  if (!block) return null;
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[a-z-]+:/.test(line))
    .map((line) => line.replace(/^\/+/, "").replace(/\/+$/, ""));
}

// Cone mode materialises the files sitting directly in each selected path's
// leading directories, so declaring 100xfenok-next/scripts also brings the
// files in 100xfenok-next itself. Non-cone mode has no such implication and
// takes only what it is given.
export function coversDirectory(prefixes, directory, coneMode = true) {
  return prefixes.some((prefix) => {
    if (prefix === "" || directory === prefix || directory.startsWith(`${prefix}/`)) return true;
    // A single declared file implies its own directory is present.
    if (prefix.endsWith(".mjs") && path.dirname(prefix) === directory) return true;
    return coneMode && `${prefix}/`.startsWith(`${directory}/`);
  });
}

const violations = [];
for (const file of fs.readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith(".yml")).sort()) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, file), "utf8");
  const prefixes = declaredPrefixes(source);
  if (!prefixes) continue;
  const coneMode = !/sparse-checkout-cone-mode:\s*false/.test(source);
  const entries = [...new Set([...source.matchAll(SCRIPT_INVOCATION)].map((match) => match[1]))];
  for (const entry of entries) {
    if (!fs.existsSync(path.join(REPO_ROOT, entry))) continue;
    for (const directory of importedDirectories(entry)) {
      if (!coversDirectory(prefixes, directory, coneMode)) {
        violations.push(`${file}: runs ${entry} which imports ${directory}, not in its sparse-checkout`);
      }
    }
  }
}

assert.deepEqual(
  [...new Set(violations)].sort(),
  [],
  `sparse-checkout must cover every imported directory:\n  ${[...new Set(violations)].sort().join("\n  ")}`,
);

// The recogniser must be able to fail, or it silently green-lights everything.
assert.equal(coversDirectory(["scripts/ops"], "100xfenok-next/scripts/cloud-data-plane"), false);
assert.equal(coversDirectory(["scripts"], "scripts/lib"), true);
assert.equal(coversDirectory(["scripts/test-x.mjs"], "scripts"), true);
assert.equal(coversDirectory(["100xfenok-next/scripts"], "100xfenok-next", true), true);
assert.equal(coversDirectory(["100xfenok-next/scripts"], "100xfenok-next", false), false);

console.log("sparse-checkout import coverage: ok");
