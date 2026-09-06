import assert from "node:assert/strict";

import {
  applyWindDownPracticeAction,
  createWindDownPracticeSession,
  isWindDownPracticeResponse,
  parseWindDownPracticeQuery,
  windDownPracticeListeningTexts,
  type WindDownPracticeMaterial,
  type WindDownPracticeQuery,
} from "../src/features/winddown/drill/practice";

const material: WindDownPracticeMaterial = {
  id: "winddown-material-ready",
  ko: "나는 준비됐어.",
  en: "I am ready.",
  acceptedVariants: ["I'm ready."],
  practice: {
    pattern: "I am [state].",
    variationsEn: ["I'm [state].", "I am ready."],
    theme: "self-talk",
  },
};

function query(values: Record<string, string | string[]>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item);
    }
  }
  return params;
}

const none = parseWindDownPracticeQuery(new URLSearchParams());
assert.deepEqual(none, { kind: "none" } satisfies WindDownPracticeQuery);

const generic = parseWindDownPracticeQuery(query({ practice: "1" }));
assert.deepEqual(generic, { kind: "generic" } satisfies WindDownPracticeQuery);

const canonical = parseWindDownPracticeQuery(
  query({ material: material.id }),
);
assert.deepEqual(canonical, {
  kind: "canonical-material",
  materialId: material.id,
} satisfies WindDownPracticeQuery);

const conversation = parseWindDownPracticeQuery(
  query({
    conversation: "winddown-product-session-1",
    turn: "7",
    source: "winddown-source-conversation-2",
  }),
);
assert.deepEqual(conversation, {
  kind: "voice-correction",
  citation: {
    productSessionId: "winddown-product-session-1",
    sourceConversationId: "winddown-source-conversation-2",
    turnSeq: 7,
  },
} satisfies WindDownPracticeQuery);

for (const [label, params] of [
  ["mixed generic and material", query({ practice: "1", material: material.id })],
  [
    "mixed canonical and conversation",
    query({ material: material.id, conversation: "winddown-session-001", turn: "1", source: "winddown-conversation-001" }),
  ],
  ["unknown key", query({ material: material.id, extra: "value" })],
  ["duplicate material", query({ material: [material.id, "other"] })],
  ["duplicate turn", query({ conversation: "winddown-session-001", turn: ["1", "2"], source: "winddown-conversation-001" })],
  ["unsafe turn", query({ conversation: "winddown-session-001", turn: "0", source: "winddown-conversation-001" })],
  ["unsafe integer", query({ conversation: "winddown-session-001", turn: "9007199254740992", source: "winddown-conversation-001" })],
  ["fractional turn", query({ conversation: "winddown-session-001", turn: "1.5", source: "winddown-conversation-001" })],
  ["unsafe material", query({ material: "../../private" })],
  ["missing citation field", query({ conversation: "winddown-session-001", turn: "1" })],
] as const) {
  const parsed = parseWindDownPracticeQuery(params);
  assert.equal(parsed.kind, "error", `${label} must fail closed`);
}

const canonicalSession = createWindDownPracticeSession({
  material,
  method: "recall-reveal",
  seed: "practice-contract",
});
assert.equal(canonicalSession.phase, "recall");
assert.equal(canonicalSession.material?.en, material.en);
assert.equal(canonicalSession.revealed, false);
assert.equal(canonicalSession.creditPolicy, "practice-only");
assert.equal(canonicalSession.attempt, null);

const submitted = applyWindDownPracticeAction(canonicalSession, {
  type: "submit-response",
  text: "I am ready",
});
assert.equal(submitted.phase, "awaiting-reveal");
assert.equal(submitted.revealed, false, "written target stays hidden after attempt");
assert.deepEqual(submitted.attempt, {
  text: "I am ready",
  verdict: "practice-only",
  reward: 0,
});
assert.equal(submitted.score, 0);
assert.equal(submitted.xp, 0);
assert.deepEqual(
  applyWindDownPracticeAction(submitted, {
    type: "submit-response",
    text: "another attempt",
  }),
  submitted,
  "one practice attempt is recorded before reveal",
);

const revealed = applyWindDownPracticeAction(submitted, { type: "reveal" });
assert.equal(revealed.phase, "revealed");
assert.equal(revealed.revealed, true);
assert.equal(revealed.revealText, material.en);
assert.equal(revealed.creditPolicy, "practice-only");
assert.equal(revealed.score, 0);
assert.equal(revealed.xp, 0);

const complete = applyWindDownPracticeAction(revealed, { type: "complete" });
assert.equal(complete.phase, "complete");
assert.equal(complete.score, 0);
assert.equal(complete.xp, 0);

const voiceCitation = {
  productSessionId: "winddown-product-session-1",
  sourceConversationId: "winddown-source-conversation-2",
  turnSeq: 7,
} as const;
const voiceResponse = {
  ok: true,
  schemaVersion: 1,
  mode: "practice",
  modelOpened: false,
  material: {
    source: "published-lkg",
    publicationStatus: "active",
    contentDigest: "a".repeat(64),
  },
  materials: [material],
  target: { kind: "voice-correction", citation: voiceCitation },
  voiceCorrection: {
    citation: voiceCitation,
    learnerText: "I am ready",
    modelCorrection: "A received correction, never a canonical answer.",
  },
} as const;
assert.equal(isWindDownPracticeResponse(voiceResponse), true);
assert.equal(
  isWindDownPracticeResponse({
    ...voiceResponse,
    voiceCorrection: {
      ...voiceResponse.voiceCorrection,
      citation: { ...voiceCitation, sourceConversationId: "another-source" },
    },
  }),
  false,
  "a correction receipt must match the requested citation exactly",
);
assert.equal(
  isWindDownPracticeResponse({
    ...voiceResponse,
    materials: [{ ...material, practice: { ...material.practice!, variationsEn: ["same", "same"] } }],
  }),
  false,
  "authored variation references must be unique",
);
const legacyMaterial = { ...material };
delete legacyMaterial.practice;
assert.equal(
  isWindDownPracticeResponse({ ...voiceResponse, materials: [legacyMaterial] }),
  true,
  "legacy four-field materials remain valid",
);

const voiceCorrectionSession = createWindDownPracticeSession({
  method: "recall-reveal",
  seed: "voice-correction",
  voiceCorrection: {
    citation: {
      productSessionId: "winddown-product-session-1",
      sourceConversationId: "winddown-source-conversation-2",
      turnSeq: 7,
    },
    learnerText: "I am ready",
    modelCorrection: "A received correction, never a canonical answer.",
  },
});
assert.equal(voiceCorrectionSession.material, null);
assert.equal(voiceCorrectionSession.canonicalGrading, false);
assert.equal(voiceCorrectionSession.revealText, null);
const voiceCorrectionSubmitted = applyWindDownPracticeAction(
  voiceCorrectionSession,
  { type: "submit-response", text: "I am ready" },
);
assert.equal(voiceCorrectionSubmitted.attempt?.verdict, "practice-only");
assert.equal(voiceCorrectionSubmitted.score, 0);
assert.equal(voiceCorrectionSubmitted.xp, 0);
const voiceCorrectionRevealed = applyWindDownPracticeAction(
  voiceCorrectionSubmitted,
  { type: "reveal" },
);
assert.equal(voiceCorrectionRevealed.revealText, voiceCorrectionSession.voiceCorrection?.modelCorrection);
assert.equal(voiceCorrectionRevealed.canonicalGrading, false);

const linked = createWindDownPracticeSession({
  material,
  method: "linked-recall-listen-response",
  seed: "linked-contract",
});
assert.deepEqual(linked.steps.map((step) => step.method), [
  "recall-reveal",
  "listening-variants",
  "audio-first-response",
]);
assert.equal(linked.steps.every((step) => step.materialId === material.id), true);
assert.equal(linked.steps.every((step) => step.creditPolicy === "practice-only"), true);
assert.equal(linked.phase, "recall");
assert.equal(linked.stepIndex, 0);
assert.equal(linked.currentStep?.method, "recall-reveal");

const linkedListening = applyWindDownPracticeAction(
  applyWindDownPracticeAction(
    applyWindDownPracticeAction(linked, { type: "submit-response", text: "I am ready" }),
    { type: "reveal" },
  ),
  { type: "complete" },
);
assert.equal(linkedListening.phase, "listening");
assert.equal(linkedListening.stepIndex, 1);
assert.equal(linkedListening.currentStep?.method, "listening-variants");
assert.equal(
  applyWindDownPracticeAction(linkedListening, { type: "complete" }),
  linkedListening,
  "linked practice cannot skip the listening stage",
);

const linkedResponse = applyWindDownPracticeAction(linkedListening, { type: "advance" });
assert.equal(linkedResponse.phase, "response");
assert.equal(linkedResponse.stepIndex, 2);
assert.equal(linkedResponse.currentStep?.method, "audio-first-response");
const linkedFinal = applyWindDownPracticeAction(
  applyWindDownPracticeAction(
    applyWindDownPracticeAction(linkedResponse, { type: "submit-response", text: "I am ready" }),
    { type: "reveal" },
  ),
  { type: "complete" },
);
assert.equal(linkedFinal.phase, "complete");
assert.equal(linkedFinal.stepIndex, 3);
assert.equal(linkedFinal.score, 0);
assert.equal(linkedFinal.xp, 0);

const listening = createWindDownPracticeSession({
  material,
  method: "listening-variants",
  seed: "listening-contract",
});
assert.equal(listening.phase, "listening", "listening starts with audio controls available");
assert.equal(applyWindDownPracticeAction(listening, { type: "advance" }).phase, "complete");
assert.deepEqual(windDownPracticeListeningTexts(material), ["I am ready.", "I'm ready.", "I'm [state]."]);

const patternSession = createWindDownPracticeSession({
  material,
  method: "pattern-transform",
  seed: "pattern-contract",
});
assert.equal(patternSession.phase, "response");
const patternRevealed = applyWindDownPracticeAction(
  applyWindDownPracticeAction(patternSession, { type: "submit-response", text: "I am calm" }),
  { type: "reveal" },
);
assert.equal(patternRevealed.revealText, material.practice?.pattern);
assert.equal(patternRevealed.score, 0);
assert.equal(patternRevealed.xp, 0);

console.log(
  "PASS winddown-practice - disjoint targets, hidden reveal order, and practice-only semantics",
);
