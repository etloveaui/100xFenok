#!/usr/bin/env node
// Keep the server-only app imports byte-identical to the canonical health sources.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const canonicalDir = join(repositoryRoot, "scripts/lib");
const generatedDir = join(repositoryRoot, "100xfenok-next/src/generated/family-health");
const sourceNames = ["family-health.mjs", "etf-detail-rotation-policy.json"];

export function materializeFamilyHealth() {
  for (const name of sourceNames) {
    const source = readFileSync(join(canonicalDir, name));
    const target = join(generatedDir, name);
    if (!existsSync(target) || !readFileSync(target).equals(source)) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  materializeFamilyHealth();
}
