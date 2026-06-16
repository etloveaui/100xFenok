import {
  MONA_VNEXT_BASELINE_FIXTURES,
  MONA_VNEXT_FAILURE_FIXTURES,
  type MonaVnextFixture,
} from "../src/features/mona-vnext/gates/replayFixtures";

type CheckResult = {
  id: string;
  ok: boolean;
  detail: string;
};

function includesAll(text: string, needles: string[]) {
  return needles.every((needle) => text.includes(needle));
}

function countMatches(text: string, pattern: RegExp) {
  return Array.from(text.matchAll(pattern)).length;
}

function scoreBaseline(fixture: MonaVnextFixture, text: string): CheckResult {
  const ok = includesAll(text, [
    "\"mona-save-session\"",
    "\"mona-yesterday\"",
    "\"mona-memory\"",
    "\"mona-weekly-test\"",
    "도구 응답 전송: saveStudySession",
    "너무 서둘렀나 봐",
    "속도도 너한테 맞출게",
    "문장 다 완벽하게 기억했네",
  ]);
  return {
    id: fixture.id,
    ok,
    detail: ok ? "baseline evidence present" : "baseline evidence missing",
  };
}

function scoreFailure(fixture: MonaVnextFixture, text: string): CheckResult {
  if (fixture.id.includes("hope-repeat-loop")) {
    const count = countMatches(text, /coachTurn 카드 적용: id=hope that makes sense\. state=prompt/g);
    return { id: fixture.id, ok: count > 3, detail: `hope prompt repeats=${count}` };
  }

  if (fixture.id.includes("next-not-honored")) {
    const ok = includesAll(text, [
      "다음 문장 넘어가",
      "새로운 lesson 안 들어가",
      "coachTurn 카드 적용: id=it's still raining. state=prompt",
    ]);
    return { id: fixture.id, ok, detail: ok ? "next intent ignored evidence present" : "next intent evidence missing" };
  }

  if (fixture.id.includes("english-hidden")) {
    const ok = includesAll(text, [
      "영어로는 안 보여줘",
      "왜 또 영어는 밑에 안 보여줘",
    ]);
    return { id: fixture.id, ok, detail: ok ? "English visibility complaints present" : "English visibility evidence missing" };
  }

  if (fixture.id.includes("mqf246aw-stt-drift")) {
    const ok = includesAll(text, ["Hola.", "왜 열 번 내내"]);
    return { id: fixture.id, ok, detail: ok ? "Hola drift and repeat complaint present" : "STT drift evidence missing" };
  }

  if (fixture.id.includes("mqf24lcd-stt-and-repeat")) {
    const repeatCount = countMatches(text, /coachTurn 카드 적용: id=it's still raining\. state=prompt/g);
    const ok = repeatCount > 3 && text.includes("くさっ");
    return { id: fixture.id, ok, detail: `still-raining repeats=${repeatCount}, japanese=${text.includes("くさっ")}` };
  }

  if (fixture.id.includes("mqf25con-control-log-leakage")) {
    const ok = includesAll(text, ["RAW audioActivity", "RAW serverContent", "coachTurn arg keep", "control-intent-kept"]);
    return { id: fixture.id, ok, detail: ok ? "control/debug tokens present" : "control/debug token evidence missing" };
  }

  if (fixture.id.includes("mqdunt24-control-log-leakage")) {
    const repeatCount = countMatches(text, /coachTurn 카드 적용: id=i need at least 10\. state=prompt/g);
    const ok = repeatCount >= 4 && text.includes("영어 왜 안 보여주냐고");
    return { id: fixture.id, ok, detail: `i-need-at-least-10 repeats=${repeatCount}` };
  }

  return { id: fixture.id, ok: false, detail: "no scorer branch" };
}

const results = [
  ...MONA_VNEXT_BASELINE_FIXTURES.map((fixture) => scoreBaseline(fixture, fixture.replayText)),
  ...MONA_VNEXT_FAILURE_FIXTURES.map((fixture) => scoreFailure(fixture, fixture.replayText)),
];

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id} - ${result.detail}`);
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  process.exitCode = 1;
}
