import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildTeacherRealtimeTextInput,
  serializeTeacherEffectForLive,
} from "../src/features/mona-vnext/teacher/effectEmitter";
import {
  createTeacherSession,
  teacherTransition,
} from "../src/features/mona-vnext/teacher/teacherMachine";
import type {
  TeacherEffect,
  TeacherMaterialCandidate,
  TeacherSessionCard,
} from "../src/features/mona-vnext/teacher/teacherSession";
import { validateTeacherMaterial } from "../src/features/mona-vnext/teacher/materialGate";

type FixtureData = {
  cards: TeacherSessionCard[];
  materialGate: TeacherMaterialCandidate[];
};

type Result = {
  id: string;
  ok: boolean;
  detail: string;
};

function pass(id: string, detail: string): Result {
  return { id, ok: true, detail };
}

function fail(id: string, detail: string): Result {
  return { id, ok: false, detail };
}

function loadFixtures(): FixtureData {
  const fixturePath = path.join(process.cwd(), "scripts/fixtures/mona-tsm-s0-fixtures.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureData;
}

function baseSession(cards: TeacherSessionCard[]) {
  return createTeacherSession({
    mode: "drill",
    cards,
    seed: "s0-fixture",
  });
}

function firstEffectOfType(effects: TeacherEffect[], type: TeacherEffect["type"]) {
  return effects.find((effect) => effect.type === type);
}

function checkNextIgnored(cards: TeacherSessionCard[]): Result {
  let session = baseSession(cards).session;
  session = teacherTransition(session, { type: "SESSION_READY" }).session;
  const before = session.card?.expressionId;
  const modelComplete = teacherTransition(session, { type: "MODEL_TURN_COMPLETE" });
  const afterModel = modelComplete.session.card?.expressionId;
  const next = teacherTransition(modelComplete.session, { type: "LEARNER_NEXT" });
  const nextEffect = firstEffectOfType(next.effects, "present_card");

  try {
    assert.equal(before, "rain-heavy");
    assert.equal(afterModel, "rain-heavy");
    assert.equal(next.session.card?.expressionId, "still-raining");
    assert.equal(next.session.visibility.english, false);
    assert.equal(nextEffect?.expressionId, "still-raining");
    assert.equal(nextEffect?.expectedModelAction, "present_card");
    return pass("next-ignored", "MODEL_TURN_COMPLETE holds card; LEARNER_NEXT advances app state");
  } catch (error) {
    return fail("next-ignored", error instanceof Error ? error.message : String(error));
  }
}

function checkRevealDeliversTarget(cards: TeacherSessionCard[]): Result {
  const ready = teacherTransition(baseSession(cards).session, { type: "SESSION_READY" });
  const revealed = teacherTransition(ready.session, { type: "LEARNER_REVEAL" });
  const effect = firstEffectOfType(revealed.effects, "reveal_target");

  try {
    assert.equal(revealed.session.phase, "revealed");
    assert.equal(revealed.session.visibility.english, true);
    assert.equal(effect?.targetEn, "It's raining heavily.");
    assert.equal(effect?.expectedModelAction, "reveal_target");
    assert.ok(revealed.effects.indexOf(effect as TeacherEffect) <= 0);
    return pass("reveal-target", "LEARNER_REVEAL emits canonical target in the first effect");
  } catch (error) {
    return fail("reveal-target", error instanceof Error ? error.message : String(error));
  }
}

function checkGhostPraise(cards: TeacherSessionCard[]): Result {
  const ready = teacherTransition(baseSession(cards).session, { type: "SESSION_READY" });
  const attempted = teacherTransition(ready.session, { type: "LEARNER_ATTEMPT", text: "아" });
  const evaluated = teacherTransition(attempted.session, { type: "EVAL_RESULT", verdict: "garbage" });
  const praise = evaluated.effects.some((effect) => effect.type === "praise");
  const repair = firstEffectOfType(evaluated.effects, "repair_attempt");

  try {
    assert.equal(evaluated.session.praiseArmed, false);
    assert.equal(evaluated.session.attempt.verdict, "garbage");
    assert.equal(praise, false);
    assert.equal(repair?.expectedModelAction, "repair_no_praise");
    return pass("ghost-praise", "garbage verdict repairs and never arms praise");
  } catch (error) {
    return fail("ghost-praise", error instanceof Error ? error.message : String(error));
  }
}

function checkVariantAccepted(cards: TeacherSessionCard[]): Result {
  const ready = teacherTransition(baseSession(cards).session, { type: "SESSION_READY" });
  const attempted = teacherTransition(ready.session, { type: "LEARNER_ATTEMPT", text: "It's raining cats and dogs." });
  const evaluated = teacherTransition(attempted.session, { type: "EVAL_RESULT", verdict: "variant" });
  const effect = firstEffectOfType(evaluated.effects, "acknowledge_variant");

  try {
    assert.equal(evaluated.session.praiseArmed, true);
    assert.equal(evaluated.session.attempt.verdict, "variant");
    assert.equal(effect?.expectedModelAction, "acknowledge_variant");
    assert.equal(effect?.targetEn, "It's raining heavily.");
    return pass("variant-rejected", "accepted variant is acknowledged as correct with canonical as alternative");
  } catch (error) {
    return fail("variant-rejected", error instanceof Error ? error.message : String(error));
  }
}

function checkWordDrop(cards: TeacherSessionCard[]): Result {
  const ready = teacherTransition(baseSession(cards).session, { type: "SESSION_READY" });
  const drift = teacherTransition(ready.session, {
    type: "MODEL_DRIFT",
    kind: "word_drop",
    observedText: "It's raining.",
  });
  const correction = firstEffectOfType(drift.effects, "corrective_respeak");
  const secondDrift = teacherTransition(drift.session, {
    type: "MODEL_DRIFT",
    kind: "word_drop",
    observedText: "It's raining.",
  });
  const secondCorrection = firstEffectOfType(secondDrift.effects, "corrective_respeak");
  const logged = firstEffectOfType(secondDrift.effects, "model_drift_logged");

  try {
    assert.equal(correction?.targetEn, "It's raining heavily.");
    assert.equal(correction?.expectedModelAction, "speak_target");
    assert.equal(secondCorrection, undefined);
    assert.equal(logged?.expectedModelAction, "log_only");
    return pass("word-drop", "first target drift re-speaks once; repeat drift logs only");
  } catch (error) {
    return fail("word-drop", error instanceof Error ? error.message : String(error));
  }
}

function checkEffectEmitter(cards: TeacherSessionCard[]): Result {
  const ready = teacherTransition(baseSession(cards).session, { type: "SESSION_READY" });
  const revealed = teacherTransition(ready.session, { type: "LEARNER_REVEAL" });
  const effect = firstEffectOfType(revealed.effects, "reveal_target");
  if (!effect) return fail("effect-emitter", "reveal effect missing");

  try {
    const serialized = JSON.parse(serializeTeacherEffectForLive(effect)) as Record<string, unknown>;
    const realtime = buildTeacherRealtimeTextInput(effect);
    assert.equal(serialized.stateSeq, revealed.session.stateSeq);
    assert.equal(serialized.expressionId, "rain-heavy");
    assert.equal(serialized.targetEn, "It's raining heavily.");
    assert.equal(serialized.expectedModelAction, "reveal_target");
    assert.equal(typeof realtime.realtimeInput.text, "string");
    assert.ok(realtime.realtimeInput.text.includes("\"stateSeq\""));
    return pass("effect-emitter", "Live-bound text has stateSeq/expressionId/target/action envelope");
  } catch (error) {
    return fail("effect-emitter", error instanceof Error ? error.message : String(error));
  }
}

function checkMaterialGate(fixtures: TeacherMaterialCandidate[]): Result {
  const result = validateTeacherMaterial(fixtures);
  const acceptedIds = new Set(result.accepted.map((entry) => entry.expressionId));
  const quarantineIds = new Set(result.quarantine.map((entry) => entry.expressionId));
  const warningById = new Map(result.warnings.map((entry) => [entry.expressionId, entry.reasons]));

  try {
    assert.deepEqual(Array.from(acceptedIds), ["valid-rain", "too-hard"]);
    assert.ok(quarantineIds.has("malformed-register-clash"));
    assert.ok(quarantineIds.has("contaminated-tried"));
    assert.equal(quarantineIds.has("too-hard"), false);
    assert.ok(result.quarantine.some((entry) => entry.reasons.includes("ko_register_clash")));
    assert.ok(result.quarantine.some((entry) => entry.reasons.includes("contaminated_tried")));
    assert.ok(warningById.get("too-hard")?.includes("difficulty_gt_2"));
    assert.ok(warningById.get("too-hard")?.includes("word_count_gt_10"));
    return pass("malformed-ko", "material gate quarantines high-precision blockers and serves warning-only cards");
  } catch (error) {
    return fail("malformed-ko", error instanceof Error ? error.message : String(error));
  }
}

function checkNewBoundarySource(): Result {
  const teacherDir = path.join(process.cwd(), "src/features/mona-vnext/teacher");
  const files = ["teacherSession.ts", "teacherMachine.ts", "effectEmitter.ts", "materialGate.ts"];
  const forbidden = [
    "AdminLiveBench",
    "mona-english",
    "saveStudySession",
    "buildLiveSetup",
    "productionWriteEnabled: true",
    ".sendText(",
  ];
  const violations = files.flatMap((file) => {
    const source = readFileSync(path.join(teacherDir, file), "utf8");
    return forbidden
      .filter((needle) => source.includes(needle))
      .map((needle) => `${file}:${needle}`);
  });
  return violations.length === 0
    ? pass("new-teacher-boundaries", "new teacher files avoid runtime/live/admin/write imports and direct sendText")
    : fail("new-teacher-boundaries", violations.join(", "));
}

const fixtures = loadFixtures();
const results = [
  checkNextIgnored(fixtures.cards),
  checkRevealDeliversTarget(fixtures.cards),
  checkGhostPraise(fixtures.cards),
  checkVariantAccepted(fixtures.cards),
  checkWordDrop(fixtures.cards),
  checkEffectEmitter(fixtures.cards),
  checkMaterialGate(fixtures.materialGate),
  checkNewBoundarySource(),
];

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id} - ${result.detail}`);
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  process.exitCode = 1;
}
