import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  compareWindDownSpeechTranscript,
  getWindDownSpeechRecognitionConstructor,
  getWindDownSpeechSupport,
  normalizeWindDownSpeechText,
  ownsWindDownSpeechOperation,
  shouldOfferWindDownLearnSpeech,
  windDownSpeechErrorMessage,
  type WindDownSpeechRecognition,
} from "../src/features/winddown/speech/deviceSpeech";

class FakeRecognition implements WindDownSpeechRecognition {
  lang = "";
  continuous = true;
  interimResults = true;
  maxAlternatives = 1;
  onaudiostart = null;
  onresult = null;
  onerror = null;
  onend = null;
  start() {}
  stop() {}
  abort() {}
}

assert.deepEqual(getWindDownSpeechSupport(null), {
  synthesis: false,
  recognition: false,
  processing: "browser-managed",
});
assert.deepEqual(
  getWindDownSpeechSupport({
    speechSynthesis: {},
    webkitSpeechRecognition: FakeRecognition,
  }),
  {
    synthesis: true,
    recognition: true,
    processing: "browser-managed",
  },
);
assert.equal(
  getWindDownSpeechRecognitionConstructor({
    webkitSpeechRecognition: FakeRecognition,
  }),
  FakeRecognition,
);
const recognitionA = {};
const recognitionB = {};
assert.equal(
  ownsWindDownSpeechOperation({
    active: recognitionA,
    candidate: recognitionA,
    operation: 1,
    currentOperation: 1,
    settled: false,
  }),
  true,
);
assert.equal(
  ownsWindDownSpeechOperation({
    active: recognitionB,
    candidate: recognitionA,
    operation: 1,
    currentOperation: 2,
    settled: false,
  }),
  false,
  "a late end from recognition A must never clear active recognition B",
);
assert.equal(
  shouldOfferWindDownLearnSpeech({
    exerciseKind: "sentence-builder",
    answerVisible: false,
  }),
  false,
  "a credit-eligible sentence builder must not reveal its answer through playback",
);
assert.equal(
  shouldOfferWindDownLearnSpeech({
    exerciseKind: "meaning-choice",
    answerVisible: false,
  }),
  true,
  "a visible English prompt may be played before a meaning choice",
);
assert.equal(
  shouldOfferWindDownLearnSpeech({
    exerciseKind: "sentence-builder",
    answerVisible: true,
  }),
  true,
  "the target may be played after the learner has submitted the builder",
);
assert.equal(
  normalizeWindDownSpeechText("  I’m READY!  "),
  "i'm ready",
);
assert.equal(
  compareWindDownSpeechTranscript("I am ready.", "I am ready"),
  "match",
);
assert.equal(
  compareWindDownSpeechTranscript(
    "Please wait a moment.",
    "Please wait one moment",
  ),
  "close",
);
assert.equal(
  compareWindDownSpeechTranscript("I am ready.", "See you tomorrow"),
  "different",
);
for (const code of [
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "network",
  "language-not-supported",
  "no-speech",
  "aborted",
  "unknown",
]) {
  assert.ok(windDownSpeechErrorMessage(code).length > 0);
}

const component = readFileSync(
  path.join(
    process.cwd(),
    "src/features/winddown/speech/WindDownDeviceSpeechPractice.tsx",
  ),
  "utf8",
);
const deviceSpeech = readFileSync(
  path.join(
    process.cwd(),
    "src/features/winddown/speech/deviceSpeech.ts",
  ),
  "utf8",
);
const hook = readFileSync(
  path.join(
    process.cwd(),
    "src/features/winddown/speech/useWindDownDeviceSpeech.ts",
  ),
  "utf8",
);
const learn = readFileSync(
  path.join(process.cwd(), "src/features/winddown/ui/WindDownLearnClient.tsx"),
  "utf8",
);
const review = readFileSync(
  path.join(process.cwd(), "src/features/winddown/ui/WindDownReviewClient.tsx"),
  "utf8",
);
const contract = readFileSync(
  path.join(process.cwd(), "src/features/winddown/model/productContract.ts"),
  "utf8",
);

assert.ok(
  hook.includes("window.speechSynthesis")
    && deviceSpeech.includes("webkitSpeechRecognition")
    && hook.includes('recognition.lang = "en-US"')
    && hook.includes("recognition.maxAlternatives = 3"),
  "device speech must feature-detect iPhone Safari and request bounded English alternatives",
);
assert.ok(
  hook.includes("pagehide")
    && hook.includes("visibilitychange")
    && hook.includes("recognition.abort()")
    && hook.includes("WIND_DOWN_SPEECH_WATCHDOG_MS"),
  "device speech must stop on navigation, backgrounding, unmount, and exposed-but-unresponsive APIs",
);
assert.ok(
  component.includes("발음 점수나 학습 보상으로 저장하지 않아")
    && component.includes("Safari/Siri 설정과 네트워크 상태"),
  "the UI must disclose browser-managed processing and non-credit semantics",
);
assert.ok(
  learn.includes("WindDownDeviceSpeechPractice")
    && learn.includes("shouldOfferWindDownLearnSpeech({")
    && learn.includes("exerciseKind: current.kind")
    && learn.includes("answerVisible: false")
    && learn.includes("key={`feedback:${feedback.card.id}`}")
    && learn.includes("targetText={current.card.en}"),
  "Learn may play a visible English prompt or a post-answer sentence, never a hidden builder answer",
);
assert.ok(
  review.includes('controls="speak-only"')
    && review.includes("showMatchFeedback={false}")
    && !review.includes("onTranscript={setAnswer}")
    && review.includes('controls="listen-and-speak"')
    && review.includes('session.inputMode === "typed"'),
  "Review speech must remain optional practice and never enter the chips-or-typed scored answer",
);
assert.ok(
  component.includes("복습 답과 점수에는 반영하지 않아"),
  "speech without a transcript callback must describe practice-only behavior",
);
assert.ok(
  contract.includes('microphonePolicy: "forbidden" | "optional-browser-managed" | "required"')
    && contract.match(/microphonePolicy: "optional-browser-managed"/g)?.length === 2,
  "Learn and Review must explicitly classify the microphone as an optional device helper",
);

for (const forbidden of [
  "fetch(",
  "new WebSocket",
  "getUserMedia",
  "useGeminiLiveSession",
  "/api/mona-vnext/session",
]) {
  assert.equal(
    `${component}\n${hook}`.includes(forbidden),
    false,
    `device speech helper reaches forbidden app network or Live dependency: ${forbidden}`,
  );
}

console.log(
  "PASS winddown-device-speech - browser-managed practice is optional, non-credit, and model-isolated",
);
