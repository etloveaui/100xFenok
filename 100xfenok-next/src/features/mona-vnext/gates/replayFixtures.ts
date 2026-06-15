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
  expectation: string;
  assertion: string;
};

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
    expectation: "vNext logs control/debug events separately from learner/model speech and keeps English display policy explicit.",
    assertion: "score as failure when control/tool text can be mistaken for learner-facing conversation or drives card UX confusion.",
  },
];

export const MONA_VNEXT_REPLAY_FIXTURES = [
  ...MONA_VNEXT_BASELINE_FIXTURES,
  ...MONA_VNEXT_FAILURE_FIXTURES,
] as const;
