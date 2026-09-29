import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("runtime and publication verification commands reference existing scripts", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const { scripts } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const pending = ["build:runtime", "reconcile:verify", "qa:fenok-edge-public-bundle"];
  const visited = new Set<string>();
  const missing: string[] = [];
  // Inspect source targets only. Do not run collectors or generate public data.
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (visited.has(name)) continue;
    visited.add(name);
    const command = scripts[name];
    if (typeof command !== "string") {
      missing.push(`${name}: npm script is missing`);
      continue;
    }
    for (const match of command.matchAll(/\bnpm run ([\w:.-]+)/g)) pending.push(match[1]);
    for (const match of command.matchAll(/\b(?:node|python3|bash)\s+((?:\.\.?\/|scripts\/)[^\s;&|()]+\.(?:mjs|js|py|sh))/g)) {
      if (!fs.existsSync(path.resolve(root, match[1]))) missing.push(`${name}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, [], "missing source targets must fail before the expensive build starts");
});
