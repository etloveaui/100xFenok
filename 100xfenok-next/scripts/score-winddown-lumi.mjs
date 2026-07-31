import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const lumiPath = path.join(
  root,
  "src/features/winddown/ui/WindDownLumi.tsx",
);
const layoutPath = path.join(root, "src/app/winddown/layout.tsx");
assert.equal(existsSync(layoutPath), true, "WIND DOWN night theme layout must exist");
const layoutSource = readFileSync(layoutPath, "utf8");
for (const token of ["--wd-bg", "--wd-surface", "--wd-border", "--wd-text"]) {
  assert.equal(
    layoutSource.includes(token),
    true,
    `WIND DOWN theme token missing: ${token}`,
  );
}
for (const guard of ['data-wd-theme="night"', "themeColor"]) {
  assert.equal(
    layoutSource.includes(guard),
    true,
    `WIND DOWN layout guard missing: ${guard}`,
  );
}
assert.equal(existsSync(lumiPath), true, "shared Lumi renderer must exist");

const lumiSource = readFileSync(lumiPath, "utf8");
for (const state of [
  "idle",
  "prompt",
  "listening",
  "thinking",
  "correct",
  "retry",
  "rescue",
  "celebrate",
]) {
  assert.equal(
    lumiSource.includes(`"${state}"`),
    true,
    `Lumi state missing: ${state}`,
  );
}
for (const guard of [
  "aria-label",
  "motion-reduce:animate-none",
  "var(--wd-accent)",
  "var(--wd-bg)",
]) {
  assert.equal(
    lumiSource.includes(guard),
    true,
    `Lumi accessibility/theme guard missing: ${guard}`,
  );
}
assert.equal(
  /from ["'](?:motion|framer-motion)["']/.test(lumiSource),
  false,
  "Lumi must not add a motion runtime",
);

const clients = [
  {
    path: "src/features/winddown/habit/ui/WindDownHabitHomeClient.tsx",
    states: ["idle", "prompt", "thinking", "rescue", "celebrate"],
  },
  {
    path: "src/features/winddown/ui/WindDownLearnClient.tsx",
    states: ["prompt", "thinking", "correct", "retry", "rescue", "celebrate"],
  },
  {
    path: "src/features/winddown/ui/WindDownReviewClient.tsx",
    states: ["idle", "prompt", "thinking", "correct", "retry", "rescue", "celebrate"],
  },
  {
    path: "src/features/winddown/voice/ui/WindDownVoiceClient.tsx",
    states: ["prompt", "listening", "thinking", "rescue", "celebrate"],
  },
];
for (const client of clients) {
  const source = readFileSync(path.join(root, client.path), "utf8");
  assert.equal(
    source.includes("WindDownLumi"),
    true,
    `${client.path} must render shared Lumi`,
  );
  assert.equal(
    source.includes("bg-[var(--wd-bg)]"),
    true,
    `${client.path} must use the shared night surface`,
  );
  assert.equal(
    /bg-\[var\(--fnk-neutral-/.test(source),
    false,
    `${client.path} must not resolve a night background from invertible global neutral tokens`,
  );
  assert.equal(
    /#[0-9a-f]{3,8}\b|rgba?\(/i.test(source),
    false,
    `${client.path} must not reintroduce a route-local raw palette`,
  );
  for (const state of client.states) {
    assert.equal(
      source.includes(`"${state}"`),
      true,
      `${client.path} must map Lumi state: ${state}`,
    );
  }
}

const voiceSource = readFileSync(
  path.join(root, "src/features/winddown/voice/ui/WindDownVoiceClient.tsx"),
  "utf8",
);
for (const identity of ["ROLEPLAY", "LIVE TALK", "SCENE", "OPEN CONVERSATION"]) {
  assert.equal(
    voiceSource.includes(identity),
    true,
    `voice mode identity missing: ${identity}`,
  );
}

const reviewSource = readFileSync(
  path.join(root, "src/features/winddown/ui/WindDownReviewClient.tsx"),
  "utf8",
);
for (const zeroQueueGuard of [
  "initialCount > 0",
  "지금 돌아볼 문장은 없어",
]) {
  assert.equal(
    reviewSource.includes(zeroQueueGuard),
    true,
    `review zero-queue Lumi guard missing: ${zeroQueueGuard}`,
  );
}

console.log("winddown Lumi and shared night surface scorer: PASS");
