import assert from "node:assert/strict";
import {
  applyProductVerdict,
  createProductQuest,
  PRODUCT_QUEST_TARGET,
} from "../src/features/mona-vnext/product/gameSession";

const initial = createProductQuest();
assert.equal(initial.completedSteps, 0);
assert.equal(initial.xp, 0);
assert.equal(initial.isComplete, false);
assert.equal(initial.targetSteps, PRODUCT_QUEST_TARGET);

const ignored = applyProductVerdict(initial, "garbage");
assert.deepEqual(ignored, initial, "unclear microphone input must not spend a quest step");

const canonical = applyProductVerdict(initial, "canonical");
assert.equal(canonical.completedSteps, 1);
assert.equal(canonical.xp, 25);
assert.equal(canonical.lastReward, 25);

const close = applyProductVerdict(canonical, "close");
assert.equal(close.completedSteps, 2);
assert.equal(close.xp, 43);
assert.equal(close.lastReward, 18);

let completed = close;
completed = applyProductVerdict(completed, "miss");
completed = applyProductVerdict(completed, "variant");
completed = applyProductVerdict(completed, "canonical");
assert.equal(completed.completedSteps, PRODUCT_QUEST_TARGET);
assert.equal(completed.isComplete, true);

const capped = applyProductVerdict(completed, "canonical");
assert.deepEqual(capped, completed, "a completed quest must not award duplicate XP");

console.log("PASS product-game - five real attempts complete one bounded quest");
