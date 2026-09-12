import assert from "node:assert/strict";

const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
}
async function main() {
  await check("finalized signed correction reaches practice; forgery and cancellation do not", async () => {
    const { createWindDownCoachFeedback, verifyWindDownCoachFeedbacks } = await import("../src/features/winddown/server/coachFeedbackProof");
    const { attachWindDownCoachFeedback } = await import("../src/features/winddown/voice/coachFeedback");
    const { summarizeWindDownLiveTalk } = await import("../src/features/winddown/voice/product");
    const { extractWindDownVoicePracticeSeeds } = await import("../src/features/winddown/voice/practiceSeed");
    const decision = { action: "answer" as const, spokenResponse: "You can say I went home.", correction: { was: "I goed home", now: "I went home", why: "go의 과거형은 went야." } };
    const binding = { productSessionId: "winddown-learning-synthetic", conversationId: "conversation-synthetic", learnerText: "I goed home." };
    const feedback = await createWindDownCoachFeedback({ ...binding, decision });
    assert.ok(feedback);
    const turn = { conversationId: binding.conversationId, turnSeq: 1, userText: binding.learnerText, modelText: decision.spokenResponse, finalized: true, sttDrift: false, interrupted: false };
    const attached = attachWindDownCoachFeedback(turn, feedback);
    assert.ok(attached.coachFeedback);
    assert.equal(attachWindDownCoachFeedback({ ...turn, interrupted: true }, feedback).coachFeedback, undefined);
    assert.equal(attachWindDownCoachFeedback({ ...turn, modelText: "Let's talk about lunch." }, feedback).coachFeedback, undefined);
    assert.equal(attachWindDownCoachFeedback({ ...turn, userText: "I like tea." }, feedback).coachFeedback, undefined);
    assert.ok(await verifyWindDownCoachFeedbacks({ productSessionId: binding.productSessionId, turns: [attached] }));
    assert.equal(await verifyWindDownCoachFeedbacks({ productSessionId: "another-product-session", turns: [attached] }), false);
    assert.equal(await verifyWindDownCoachFeedbacks({ productSessionId: binding.productSessionId, turns: [attached, { ...attached, turnSeq: 2 }] }), false);
    assert.equal(await verifyWindDownCoachFeedbacks({ productSessionId: binding.productSessionId, turns: [{ ...attached, coachFeedback: { ...feedback, why: "A forged reason" } }] }), false);
    const outcome = summarizeWindDownLiveTalk({ turns: [attached], startedAtIso: null, endedAtIso: new Date().toISOString() });
    const { buildWindDownVoiceReport, isWindDownVoiceReport } = await import("../src/features/winddown/voice/report");
    const { createWindDownVoiceSessionProof } = await import("../src/features/winddown/server/voiceSessionProof");
    const { createWindDownLiveTalkDescriptor } = await import("../src/features/winddown/voice/product");
    const descriptor = createWindDownLiveTalkDescriptor("open-evening");
    const issuedAtMs = Date.now() - 1000;
    const proof = await createWindDownVoiceSessionProof({ ...binding, activity: "live-talk", descriptor, issuedAtMs });
    const report = buildWindDownVoiceReport({ schemaVersion: 1, productSessionId: binding.productSessionId, activity: "live-talk", descriptor, conversationIds: [binding.conversationId], sessionProofs: [proof], startedAtIso: new Date(issuedAtMs).toISOString(), stoppedAtIso: new Date().toISOString(), completionReason: "learner-stop", turns: [attached], metrics: {} });
    assert.ok(isWindDownVoiceReport(JSON.parse(JSON.stringify(report))), "signed feedback survives canonical report serialization");
    assert.ok(await verifyWindDownCoachFeedbacks(report));
    assert.equal(outcome.corrections.length, 1);
    const seeds = extractWindDownVoicePracticeSeeds({ productSessionId: binding.productSessionId, activity: "live-talk", report, journeyTargets: [] } as unknown as Parameters<typeof extractWindDownVoicePracticeSeeds>[0]);
    assert.equal(seeds.length, 1);
    assert.equal(seeds[0].modelCorrection, "I went home");
  });
  await check("roleplay vocabulary quotation is not an order; concise real orders count", async () => {
    const { getWindDownVoiceScenario, evaluateWindDownRoleplay } = await import("../src/features/winddown/voice/product");
    const scenario = getWindDownVoiceScenario("cafe-order");
    const turn = (userText: string) => ({ conversationId: "cafe-synthetic", turnSeq: 1, userText, modelText: "Okay.", finalized: true, interrupted: false, sttDrift: false });
    assert.equal(evaluateWindDownRoleplay(scenario, [turn("I'd like to know what 'with oat milk' means. Thanks.")]).completed, false);
    assert.ok(evaluateWindDownRoleplay(scenario, [turn("A coffee, please.")]).completedGoalIds.includes("order"));
    assert.ok(evaluateWindDownRoleplay(scenario, [turn("I'd like a latte with oat milk. That's all, thank you.")]).completed);
    assert.equal(evaluateWindDownRoleplay(scenario, [turn("I would not like a coffee with oat milk. Don't say thanks.")]).completed, false);
    assert.equal(evaluateWindDownRoleplay(scenario, [turn("I'd like")]).completedGoalIds.includes("order"), false);
  });
  await check("historical roleplay keeps its original policy and literal evidence", async () => {
    const { getWindDownVoiceScenario, evaluateWindDownRoleplay } = await import("../src/features/winddown/voice/product");
    const legacy = getWindDownVoiceScenario("cafe-order", 1);
    assert.ok(legacy);
    const old = evaluateWindDownRoleplay(legacy, [{ conversationId: "legacy-cafe", turnSeq: 1, userText: "I'd like a latte with oat milk. Thank you.", modelText: "Sure.", finalized: true, interrupted: false, sttDrift: false }]);
    assert.equal(old.completed, true);
    assert.equal(old.evidence.find(item => item.goalId === "order")?.matchedPhrase, "i'd like", "new semantics cannot invalidate a stored legacy report");
  });
  await check("speech budgets keep complete answers and distinguish pause/explanation", async () => {
    const { enforceWindDownSpeechBudget } = await import("../src/features/winddown/voice/speechBudget");
    const decision = { action: "answer" as const, spokenResponse: "Tea sounds nice. I like green tea. What about coffee? Let me explain more.", correction: null };
    assert.equal(enforceWindDownSpeechBudget(decision, "I like tea.")?.spokenResponse, "Tea sounds nice. I like green tea.");
    assert.equal(enforceWindDownSpeechBudget({ ...decision, action: "pause", spokenResponse: "알겠어. 무엇을 생각하고 있어?" }, "잠깐 기다려.")?.spokenResponse, "알겠어.");
    assert.equal(enforceWindDownSpeechBudget({ ...decision, spokenResponse: "Tea is a drink. It can be hot. It can be cold. Some people add milk." }, "자세히 설명해 줘.")?.spokenResponse, "Tea is a drink. It can be hot. It can be cold. Some people add milk.");
    assert.equal(enforceWindDownSpeechBudget({ ...decision, spokenResponse: "word ".repeat(130) + "." }, "Hi."), null);
    const corrected = enforceWindDownSpeechBudget({ ...decision, spokenResponse: "Tea sounds nice. I like green tea. Say I went home.", correction: { was: "I goed home", now: "I went home", why: "past tense" } }, "I goed home");
    assert.equal(corrected?.correction, null, "a removed correction cannot remain attached as spoken feedback");
  });
  await check("pattern attempts receive supported feedback or uncertainty, with retry", async () => {
    const { assessWindDownPatternAttempt } = await import("../src/features/winddown/drill/patternFeedback");
    const { createWindDownPracticeSession, applyWindDownPracticeAction } = await import("../src/features/winddown/drill/practice");
    const material = { id: "pattern-a", ko: "책을 읽곤 했어", en: "I used to read books.", acceptedVariants: [], practice: { pattern: "I used to + verb", theme: "daily", variationsEn: ["I used to walk to school."] } };
    assert.equal(assessWindDownPatternAttempt(material, "I used to walk to school.").verdict, "supported");
    assert.equal(assessWindDownPatternAttempt(material, "asdf qwer").verdict, "revise");
    assert.equal(assessWindDownPatternAttempt(material, "I used to collect old maps.").verdict, "uncertain");
    let state = createWindDownPracticeSession({ material, method: "pattern-transform", seed: "synthetic" });
    state = applyWindDownPracticeAction(state, { type: "submit-response", text: "asdf qwer" });
    assert.equal(state.attempt?.feedback?.verdict, "revise");
    state = applyWindDownPracticeAction(state, { type: "retry-response" });
    assert.equal(state.phase, "response");
    assert.equal(state.attempt, null);
    assert.equal(state.xp, 0);
  });
  await check("same unseen inventory adapts to different reviewed weak patterns", async () => {
    const { buildWindDownStudyBootstrap } = await import("../src/features/winddown/server/studyBootstrap");
    const entries = [
      { id: "old-past", en: "I used to work here.", ko: "전에 일했어", state: "prompt" as const },
      { id: "old-want", en: "I want to rest.", ko: "쉬고 싶어", state: "prompt" as const },
      { id: "new-past", en: "I used to walk here.", ko: "전에 걸었어", state: "prompt" as const },
      { id: "new-want", en: "I want to eat.", ko: "먹고 싶어", state: "prompt" as const },
    ];
    const practice = entries.map(e => ({ materialId: e.id, pattern: e.id.includes("past") ? "I used to + verb" : "I want to + verb", theme: e.id.includes("past") ? "past" : "plans", variationsEn: [] }));
    const args = { mode: "learn" as const, seed: "same-seed", entries, dueExpressionIds: ["old-past", "old-want"], deferredExpressionIds: [], count: 1, practice };
    const evidence = (id: string) => ({ records: { [id]: { expressionId: id, lastRating: "again", lastReviewedAt: "2026-09-12T00:00:00Z" } } });
    const past = buildWindDownStudyBootstrap({ ...args, learningProfile: evidence("old-past") });
    const want = buildWindDownStudyBootstrap({ ...args, learningProfile: evidence("old-want") });
    assert.equal(past.cards[0].id, "new-past");
    assert.equal(want.cards[0].id, "new-want");
    assert.deepEqual(buildWindDownStudyBootstrap({ ...args, learningProfile: evidence("old-past") }), past);
    const review = buildWindDownStudyBootstrap({ ...args, mode: "review", learningProfile: evidence("old-want") });
    assert.equal(review.cards[0].id, "old-past", "review due order stays authoritative");
    assert.deepEqual(buildWindDownStudyBootstrap(args), buildWindDownStudyBootstrap(args), "cold start stays deterministic");
  });
  assert.deepEqual(failures, [], "all five learning gaps must close");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
