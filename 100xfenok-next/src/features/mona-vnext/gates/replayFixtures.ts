export type MonaVnextFixtureKind =
  | "baseline"
  | "repeat-loop"
  | "english-visibility"
  | "next-material"
  | "stt-language-drift"
  | "control-log-leakage";

export type MonaVnextFixture = {
  id: string;
  kind: MonaVnextFixtureKind;
  logPath: string;
  evidence: string[];
  replayText: string;
  expectation: string;
  assertion: string;
};

function lines(values: string[]) {
  return values.join("\n");
}

function repeatLine(value: string, count: number) {
  return Array.from({ length: count }, () => value).join("\n");
}

export const MONA_VNEXT_BASELINE_FIXTURES: MonaVnextFixture[] = [
  {
    id: "baseline-20260609-mq6oxzi1-adaptive-pacing",
    kind: "baseline",
    logPath: "data/voice-logs/2026-06-09_mona_live-mona-mq6oxzi1.json",
    evidence: [
      "settings.enabledToolIds includes mona-save-session, mona-yesterday, mona-memory, mona-weekly-test",
      "logs:80-96 user complains the coach advanced too fast; model apologizes and slows down",
      "logs:100-116 user asks for quiz/checking flow; model adapts",
      "logs:120-156 user completes three answers; model closes naturally",
    ],
    replayText: lines([
      "\"mona-save-session\" \"mona-yesterday\" \"mona-memory\" \"mona-weekly-test\"",
      "도구 응답 전송: saveStudySession",
      "너무 서둘렀나 봐",
      "속도도 너한테 맞출게",
      "문장 다 완벽하게 기억했네",
    ]),
    expectation: "vNext preserves conversational self-correction and does not force a blocking pre-speech gate.",
    assertion: "baseline session may use post-turn save/memory tools, but must not require coachTurn before every spoken response.",
  },
];

export const MONA_VNEXT_FAILURE_FIXTURES: MonaVnextFixture[] = [
  {
    id: "failure-20260615-mqf25con-hope-repeat-loop",
    kind: "repeat-loop",
    logPath: "data/voice-logs/2026-06-15_mona_live-mona-mqf25con.json",
    evidence: [
      "logs:594,3051,3989,5333,5452,5823,7916,8126,8938,9232,9463,10716 repeat hope that makes sense prompt card",
      "metrics:12717 turnCount=32",
      "metrics:12718 interruptionCount=17",
    ],
    replayText: repeatLine("coachTurn 카드 적용: id=hope that makes sense. state=prompt", 12),
    expectation: "vNext must not present the same prompt card more than three times in one session.",
    assertion: "score as failure when one normalized prompt id appears more than three times without explicit learner request.",
  },
  {
    id: "failure-20260615-mqf25con-next-not-honored",
    kind: "next-material",
    logPath: "data/voice-logs/2026-06-15_mona_live-mona-mqf25con.json",
    evidence: [
      "logs:573 user asks not to review and requests new material",
      "logs:7069 user asks to move to next sentence",
      "logs:7104 same it's still raining prompt appears after next request",
      "logs:7552 user complains new lesson did not start",
      "logs:7573 same it's still raining prompt appears again",
    ],
    replayText: lines([
      "다음 문장 넘어가",
      "새로운 lesson 안 들어가",
      "coachTurn 카드 적용: id=it's still raining. state=prompt",
    ]),
    expectation: "vNext changes material within one turn after next/new/move-on intent.",
    assertion: "score as failure when the prompt id after a next-material utterance equals the prior prompt id.",
  },
  {
    id: "failure-20260615-mqf25con-english-hidden",
    kind: "english-visibility",
    logPath: "data/voice-logs/2026-06-15_mona_live-mona-mqf25con.json",
    evidence: [
      "logs:1952 user asks why English is not shown below",
      "logs:6432 user asks again why English is not shown",
    ],
    replayText: lines([
      "영어로는 안 보여줘",
      "왜 또 영어는 밑에 안 보여줘",
    ]),
    expectation: "vNext treats English visibility as UI/control intent, not as a lesson attempt.",
    assertion: "score as failure when an English visibility request is followed by an unchanged hidden-prompt card state.",
  },
  {
    id: "failure-20260615-mqf246aw-stt-drift",
    kind: "stt-language-drift",
    logPath: "data/voice-logs/2026-06-15_mona_live-mona-mqf246aw.json",
    evidence: [
      "logs:342 user transcript Hola.",
      "logs:543 user transcript Hola.",
      "logs:510/555 user asks why It's still raining repeated ten times",
    ],
    replayText: lines([
      "Hola.",
      "왜 열 번 내내",
    ]),
    expectation: "vNext measures STT language drift separately and does not assume architecture fixes it.",
    assertion: "score as warning when non-Korean/non-English transcript fragments appear in a ko-KR client session.",
  },
  {
    id: "failure-20260615-mqf24lcd-stt-and-repeat",
    kind: "stt-language-drift",
    logPath: "data/voice-logs/2026-06-15_mona_live-mona-mqf24lcd.json",
    evidence: [
      "logs:83,335,538,846,1140 repeat it's still raining prompt card",
      "logs:314/1192 user transcript くさっ",
      "metrics:1362 turnCount=6",
      "metrics:1363 interruptionCount=6",
    ],
    replayText: lines([
      repeatLine("coachTurn 카드 적용: id=it's still raining. state=prompt", 5),
      "くさっ",
    ]),
    expectation: "vNext reports language drift and repeated prompt pressure in the same session.",
    assertion: "score as failure for repeated prompt pressure and warning for non-ko/en transcript fragments.",
  },
  {
    id: "failure-20260615-mqf25con-control-log-leakage",
    kind: "control-log-leakage",
    logPath: "data/voice-logs/2026-06-15_mona_live-mona-mqf25con.json",
    evidence: [
      "logs:47-62 RAW audioActivity framesSent appears in saved log",
      "logs:89-111 coachTurn arg keep and RAW serverContent appear in saved log",
      "logs:236-244 coachTurn arg keep and card id/state appear in saved log",
      "logs:5325-5333 model-transcript-mismatch-kept and card id/state appear in saved log",
      "logs:7907-7916 control-intent-kept and repeated card id/state appear in saved log",
    ],
    replayText: lines([
      "RAW audioActivity",
      "RAW serverContent",
      "coachTurn arg keep",
      "control-intent-kept",
    ]),
    expectation: "vNext separates debug/control telemetry from learner-facing conversation export.",
    assertion: "score as failure when exported user/session logs include RAW, framesSent, serverContent, coachTurn arg keep, or control-intent tokens in the speech timeline.",
  },
  {
    id: "failure-20260614-owner-mqdunt24-control-log-leakage",
    kind: "control-log-leakage",
    logPath: "data/voice-logs/owner-test/2026-06-14_mona_live-mona-mqdunt24.json",
    evidence: [
      "logs:62,482,874,1301 record coachTurn card applied control logs",
      "logs:853 user asks why English is not shown",
      "logs:1287 user repeats English card visibility complaint",
    ],
    replayText: lines([
      repeatLine("coachTurn 카드 적용: id=i need at least 10. state=prompt", 4),
      "영어 왜 안 보여주냐고",
    ]),
    expectation: "vNext logs control/debug events separately from learner/model speech and keeps English display policy explicit.",
    assertion: "score as failure when control/tool text can be mistaken for learner-facing conversation or drives card UX confusion.",
  },
];

export const MONA_VNEXT_REPLAY_FIXTURES = [
  ...MONA_VNEXT_BASELINE_FIXTURES,
  ...MONA_VNEXT_FAILURE_FIXTURES,
] as const;
