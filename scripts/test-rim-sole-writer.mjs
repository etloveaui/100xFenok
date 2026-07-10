#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(new URL("..", import.meta.url).pathname);
const workflows = path.join(root, ".github", "workflows");
const offenders = [];
for (const file of fs.readdirSync(workflows).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
  const text = fs.readFileSync(path.join(workflows, file), "utf8");
  if (/cp\s+[^\n]*rim-index\/inputs\.json/.test(text)) offenders.push(file);
}
if (offenders.length) { console.error(`rim sole-writer violation: ${offenders.join(", ")}`); process.exit(1); }
console.log("test-rim-sole-writer: ok");
