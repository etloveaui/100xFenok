export type MonaVnextBaselineCommit = {
  hash: string;
  dateKst: string;
  subject: string;
  relevance: string;
};

export const MONA_VNEXT_BASELINE_LOG = {
  sessionId: "mona-mq6oxzi1",
  path: "data/voice-logs/2026-06-09_mona_live-mona-mq6oxzi1.json",
  dateKst: "2026-06-09",
  observedFacts: [
    "Post-turn study tools were enabled; the baseline was not tool-free.",
    "The model adapted after Mona complained it advanced too quickly.",
    "The session still had a pacing wobble, so this is a baseline to preserve and improve, not a flawless target.",
  ],
  measuredSettings: {
    lowVoice: true,
    voiceName: "Kore",
    responseStyle: "concise",
    vadPreset: "balanced",
    enabledToolIds: [
      "mona-save-session",
      "mona-yesterday",
      "mona-memory",
      "mona-weekly-test",
    ],
  },
  measuredMetrics: {
    firstResponseMs: 9285,
    turnCount: 11,
    interruptionCount: 6,
    sessionDurationSec: 329,
  },
} as const;

export type MonaVnextBaselineLog = typeof MONA_VNEXT_BASELINE_LOG;

export const MONA_VNEXT_BASELINE_COMMITS: MonaVnextBaselineCommit[] = [
  {
    hash: "f1787eef8",
    dateKst: "2026-06-06 02:13:55 +0900",
    subject: "feat: add mona wind-down live tools",
    relevance: "Introduces Mona wind-down live tools and the conversational Mona profile before coachTurn/FSM.",
  },
  {
    hash: "f4ab05969",
    dateKst: "2026-06-10 00:18:57 +0900",
    subject: "fix(mona): pacing rules SSOT - one Q per turn, no early close, VAD 1200ms",
    relevance: "Closest post-06-09 prompt boundary for pacing rules before later v2/v3 accretion.",
  },
  {
    hash: "582dc074c",
    dateKst: "2026-06-10 15:04:51 +0900",
    subject: "feat(mona): ppalmo expression bank injection + coach style constraints",
    relevance: "Adds expression-bank/style constraints without the later mandatory coachTurn gate.",
  },
  {
    hash: "fd9b55821",
    dateKst: "2026-06-10 23:11:33 +0900",
    subject: "feat(winddown): Mona bedtime coach v2 - spiral pedagogy, expression card, dedicated PWA entry",
    relevance: "Adds the dedicated Wind-Down UI route; useful UI baseline but no longer pure 06-09 behavior.",
  },
];

export const MONA_VNEXT_BASELINE_PROMPT_POLICY = {
  source: "derived from git show f1787eef8/f4ab05969/582dc074c/fd9b55821 plus 2026-06-09 log behavior",
  keep: [
    "Warm Korean 반말 wind-down coach persona.",
    "Actual spoken conversational adaptation to Mona's complaints.",
    "Post-turn save/memory tools are allowed.",
    "Short practical English correction with low-voice bedtime pacing.",
  ],
  reject: [
    "Mandatory pre-speech coachTurn on every learner utterance.",
    "Option C transcript patching.",
    "Card directive as a model/server/client shared truth source.",
    "Tool/control markers in spoken output or learner-facing transcript.",
  ],
} as const;

export type MonaVnextBaselinePromptPolicy = typeof MONA_VNEXT_BASELINE_PROMPT_POLICY;
