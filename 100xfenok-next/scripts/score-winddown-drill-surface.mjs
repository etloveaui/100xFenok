import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (relativePath) => readFileSync(path.join(process.cwd(), relativePath), "utf8");
const route = read("src/app/api/winddown/drill/route.ts");
const page = read("src/app/winddown/drill/page.tsx");
const client = read("src/features/winddown/drill/ui/WindDownDrillClient.tsx");
const contract = read("src/features/winddown/model/productContract.ts");
const home = read("src/features/winddown/habit/ui/WindDownHabitHomeClient.tsx");

assert.ok(route.includes("verifyAdminSessionToken"));
assert.ok(route.includes("loadWindDownStudyMaterial"));
assert.ok(route.includes('source !== "published-lkg"'));
assert.ok(route.includes('publicationStatus !== "active"'));
assert.ok(route.includes("material.entries.length < 3"));
assert.ok(route.includes('headers: { "Cache-Control": "no-store" }'));
assert.ok(page.includes("AdminAccessGate") && page.includes("WindDownDrillClient"));
for (const forbidden of ["Gemini", "WebSocket", "getUserMedia", "SpeechRecognition", "microphone", "/api/winddown/progress", "/api/winddown/review"]) {
  assert.equal(`${route}\n${client}`.includes(forbidden), false, `Drill must not reference ${forbidden}`);
}
assert.ok(client.includes('fetch("/api/winddown/drill"'));
assert.ok(client.includes("isWindDownDrillResponsePayload"));
assert.ok(client.includes("applyWindDownDrillAction"));
assert.ok(client.includes("replayWindDownDrillSession"));
assert.ok(client.includes("점수") && client.includes("콤보"));
assert.ok(client.includes("motion-reduce:"));
assert.ok((client.match(/min-h-\[44px\]/g) ?? []).length >= 6);
assert.equal(client.includes("min-h-11"), false);
assert.equal(client.includes("min-h-12"), false);
assert.ok(contract.includes('"drill"'));
assert.ok(contract.includes('engine: "deterministic-drill"'));
assert.ok(home.includes('href: "/winddown/drill"'));
assert.ok(home.includes('label: "Quick Drill"'));
assert.ok(route.includes("SHA256_HEX"));
assert.ok(route.includes("new Set(material.entries.map"));

console.log("PASS winddown-drill-surface - authenticated read-only mobile contract");
