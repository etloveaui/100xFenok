import { windDownRoleplayEvidenceText, supportedWindDownRoleplayTask } from "./roleplayEvidence";
import { attachWindDownCoachFeedback, parseWindDownCoachFeedback, normalizeCoachEvidence, type WindDownCoachFeedback } from "./coachFeedback";
import { containsMonaVnextControlLeakage } from "@/features/mona-vnext/logging/voiceLogSchema";

export const WIND_DOWN_VOICE_POLICY_VERSION = 2 as const;
export type WindDownVoicePolicyVersion = 1 | 2;
export function isWindDownVoicePolicyVersion(value: unknown): value is WindDownVoicePolicyVersion { return value === 1 || value === 2; }
export const WIND_DOWN_VOICE_CORRECTION_MAX_CHARS = 240;
/** @deprecated Prefer WIND_DOWN_VOICE_POLICY_VERSION in new transport code. */
export const WINDDOWN_VOICE_PRODUCT_VERSION = WIND_DOWN_VOICE_POLICY_VERSION;

export type WindDownVoiceActivity = "roleplay" | "live-talk";

export type WindDownVoiceScenarioGoal = {
  id: string;
  label: string;
  /**
   * These are stable, server-owned matching phrases, not prompt text supplied
   * by the browser. A learner needs one phrase from each goal in a clean,
   * finalized utterance for the app to count the goal.
   */
  matchAny: readonly string[];
};

export type WindDownVoiceScenario = {
  id: string;
  version: WindDownVoicePolicyVersion;
  title: string;
  eyebrow: string;
  scene: string;
  coachRole: string;
  openingLine: string;
  goals: readonly WindDownVoiceScenarioGoal[];
};

/**
 * The client sends only this identifier/version to the session transport.
 * The server must resolve the matching prompt and never accept client prompt
 * text as a system instruction.
 */
export type WindDownVoiceScenarioRequest = {
  scenarioId: string;
  policyVersion: WindDownVoicePolicyVersion;
};

export type WindDownVoiceFinalizedTurn = {
  conversationId: string;
  turnSeq: number;
  userText: string | null;
  modelText: string | null;
  /** A partial STT update is never eligible for scenario completion. */
  finalized: boolean;
  sttDrift: boolean;
  interrupted: boolean;
  /**
   * Optional provider/coach correction. It is retained only when it is a
   * literal excerpt of the finalized coach transcript for the same turn.
   */
  correctionText?: string | null;
  coachFeedback?: WindDownCoachFeedback;
};

export type WindDownVoiceGoalEvidence = {
  scenarioId: string;
  goalId: string;
  conversationId: string;
  turnSeq: number;
  learnerText: string;
  matchedPhrase: string;
};

export type WindDownVoiceCorrection = {
  conversationId: string;
  turnSeq: number;
  learnerText: string;
  correctionText: string;
  coachFeedback?: WindDownCoachFeedback;
};

export type WindDownVoiceCorrectionPresentation = {
  was: string;
  now: string;
  why: string;
  citation: {
    conversationId: string;
    turnSeq: number;
  };
};

/**
 * A resumed Live Talk chain can restart its numeric turn sequence. Keep the
 * conversation identity beside a highlight so the saved reference cannot
 * accidentally point at a similarly numbered turn in an older chain.
 */
export type WindDownVoiceHighlightTurn = {
  conversationId: string;
  turnSeq: number;
};

export type WindDownRoleplayProgress = {
  scenario: WindDownVoiceScenario;
  completedGoalIds: string[];
  evidence: WindDownVoiceGoalEvidence[];
  corrections: WindDownVoiceCorrection[];
  completed: boolean;
};

export type WindDownLiveTalkSummary = {
  activity: "live-talk";
  finalizedLearnerTurns: number;
  cleanLearnerTurns: number;
  /** Clean turns with both speaker transcripts, newest last. */
  highlightTurnSeqs: number[];
  highlightTurns: WindDownVoiceHighlightTurn[];
  interruptedTurnCount: number;
  durationSeconds: number | null;
  corrections: WindDownVoiceCorrection[];
};

const SCENARIOS = [
  {
    id: "cafe-order",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "카페에서 주문하기",
    eyebrow: "ROLEPLAY · 3 GOALS",
    scene: "루미는 바리스타예요. 음료를 주문하고, 취향을 말하고, 자연스럽게 마무리해봐요.",
    coachRole: "friendly cafe barista",
    openingLine: "Hi! What can I get for you tonight?",
    goals: [
      {
        id: "order",
        label: "음료를 주문했어",
        matchAny: ["i'd like", "i would like", "can i get", "could i get", "i'll have"],
      },
      {
        id: "preference",
        label: "내 취향을 말했어",
        matchAny: ["with oat milk", "with soy milk", "without ice", "less sweet", "decaf"],
      },
      {
        id: "close",
        label: "주문을 마무리했어",
        matchAny: ["that's all", "that will be all", "thank you", "thanks"],
      },
    ],
  },
  {
    id: "after-work-check-in",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "퇴근 후 안부",
    eyebrow: "ROLEPLAY · 3 GOALS",
    scene: "루미는 하루를 함께 정리하는 친구예요. 오늘의 기분과 이유, 내일의 작은 계획을 말해봐요.",
    coachRole: "warm after-work friend",
    openingLine: "How did your day go?",
    goals: [
      {
        id: "feeling",
        label: "오늘의 기분을 말했어",
        matchAny: ["i feel", "i felt", "i'm feeling", "i was"],
      },
      {
        id: "reason",
        label: "이유를 덧붙였어",
        matchAny: ["because", "since", "so", "it was"],
      },
      {
        id: "next-step",
        label: "내일의 작은 계획을 말했어",
        matchAny: ["tomorrow i'll", "tomorrow i will", "i'm going to", "i want to"],
      },
    ],
  },
  {
    id: "artist-audition",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "오디션 룸에서 첫 소개",
    eyebrow: "ROLEPLAY · EXPRESSION MARKERS · 3 GOALS",
    scene: "작은 오디션 룸에서 심사 코치에게 자신을 소개하고 긴장한 마음으로 첫 질문에 답해봐요.",
    coachRole: "patient singer audition coach",
    openingLine: "Welcome to the audition room. Please tell me about yourself.",
    goals: [
      {
        id: "introduction",
        label: "표현 힌트: 내 역할 소개하기",
        matchAny: [
          "i am a vocalist",
          "i sing with our group",
        ],
      },
      {
        id: "artist-goal",
        label: "표현 힌트: 음악으로 전하고 싶은 목표",
        matchAny: [
          "i want to inspire people",
          "i hope to connect through music",
        ],
      },
      {
        id: "repeat-question",
        label: "표현 힌트: 다시 말해 달라고 하기",
        matchAny: [
          "could you repeat that",
          "please say that again",
        ],
      },
    ],
  },
  {
    id: "team-rehearsal",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "팀 리허설 다시 맞추기",
    eyebrow: "ROLEPLAY · EXPRESSION MARKERS · 3 GOALS",
    scene: "늦은 밤 리허설실에서 후렴구의 타이밍을 맞추며 팀원과 다음 연습 순서를 정해봐요.",
    coachRole: "supportive bandmate and rehearsal partner",
    openingLine: "The rehearsal is running late. How should we plan the next take?",
    goals: [
      {
        id: "next-rehearsal",
        label: "표현 힌트: 다음 연습 제안하기",
        matchAny: [
          "rehearse the chorus again",
          "practice the bridge once more",
        ],
      },
      {
        id: "planning-reason",
        label: "표현 힌트: 제안한 이유 덧붙이기",
        matchAny: [
          "because timing needs work",
          "so we stay together",
        ],
      },
      {
        id: "teammate-response",
        label: "표현 힌트: 팀원 의견에 답하기",
        matchAny: [
          "that makes sense to me",
          "i can help with that",
        ],
      },
    ],
  },
  {
    id: "fan-meeting",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "첫 팬 미팅에서 인사하기",
    eyebrow: "ROLEPLAY · EXPRESSION MARKERS · 3 GOALS",
    scene: "첫 음악방송 우승 뒤 작은 팬 미팅 테이블에서 사인 앨범을 건네며 팬과 이야기해봐요.",
    coachRole: "warm fan meeting host",
    openingLine: "A fan is waiting by the signed album table. What would you say?",
    goals: [
      {
        id: "fan-greeting",
        label: "표현 힌트: 팬에게 인사하기",
        matchAny: [
          "nice to meet you",
          "thanks for coming tonight",
        ],
      },
      {
        id: "personal-detail",
        label: "표현 힌트: 노래 이야기 덧붙이기",
        matchAny: [
          "my favorite song is starlight",
          "i wrote this song",
        ],
      },
      {
        id: "fan-thanks",
        label: "표현 힌트: 응원에 고마움 전하기",
        matchAny: [
          "thanks for supporting us",
          "i am grateful you stayed",
        ],
      },
    ],
  },
  {
    id: "artist-interview",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "아티스트 인터뷰 이어가기",
    eyebrow: "ROLEPLAY · EXPRESSION MARKERS · 3 GOALS",
    scene: "다양한 인터뷰와 방송 현장에서 새 노래의 이야기를 전하고 진행자의 후속 질문에 답해봐요.",
    coachRole: "curious artist press interviewer",
    openingLine: "The interview is live. What would you like people to know?",
    goals: [
      {
        id: "interview-answer",
        label: "표현 힌트: 질문에 내 이야기로 답하기",
        matchAny: [
          "our new song tells a story",
          "we made this together",
        ],
      },
      {
        id: "interview-example",
        label: "표현 힌트: 구체적인 예 덧붙이기",
        matchAny: [
          "our chorus grew from rehearsal",
          "our practice shaped the song",
        ],
      },
      {
        id: "interview-clarification",
        label: "표현 힌트: 질문을 확인하기",
        matchAny: [
          "could you clarify that",
          "do you mean the writing process",
        ],
      },
    ],
  },
  {
    id: "creative-repair",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "의견 충돌 뒤 무대 고치기",
    eyebrow: "ROLEPLAY · EXPRESSION MARKERS · 3 GOALS",
    scene: "앙코르 편곡을 두고 의견이 갈린 공연장 백스테이지에서 서로의 생각을 듣고 다음 연습을 정해봐요.",
    coachRole: "direct but thoughtful creative partner",
    openingLine: "We disagree about the encore ending. How can we fix the plan together?",
    goals: [
      {
        id: "creative-preference",
        label: "표현 힌트: 내 무대 선호 말하기",
        matchAny: [
          "i prefer a quiet ending",
          "an acoustic ending fits",
        ],
      },
      {
        id: "creative-acknowledgement",
        label: "표현 힌트: 다른 의견 인정하기",
        matchAny: [
          "i understand your idea",
          "you are right about that",
        ],
      },
      {
        id: "creative-next-step",
        label: "표현 힌트: 함께 해볼 다음 단계",
        matchAny: [
          "let's test both endings",
          "we can try both ideas",
        ],
      },
    ],
  },
  {
    id: "acceptance-speech",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "시상식에서 성장 돌아보기",
    eyebrow: "ROLEPLAY · EXPRESSION MARKERS · 3 GOALS",
    scene: "시상식 무대에서 지금까지의 성장과 고마운 사람, 앞으로의 바람을 차분히 말해봐요.",
    coachRole: "steady award ceremony producer",
    openingLine: "The ceremony is quiet. Please share what this moment means.",
    goals: [
      {
        id: "achievement",
        label: "표현 힌트: 이 순간의 의미 말하기",
        matchAny: [
          "this award means a lot",
          "we grew together",
        ],
      },
      {
        id: "specific-thanks",
        label: "표현 힌트: 고마운 팀 언급하기",
        matchAny: [
          "i want to thank our team",
          "thank you for believing in us",
        ],
      },
      {
        id: "lesson-and-hope",
        label: "표현 힌트: 배운 점이나 바람 말하기",
        matchAny: [
          "practice taught me patience",
          "i hope we inspire others",
        ],
      },
    ],
  },
  {
    id: "tour-arrival",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "해외 공연장 길 묻기",
    eyebrow: "ROLEPLAY · EXPRESSION MARKERS · 3 GOALS",
    scene: "해외 투어 첫날 공연장 안내 데스크에서 콘서트홀 위치를 묻고 안내를 확인해봐요.",
    coachRole: "helpful venue assistant",
    openingLine: "Welcome to the venue. How can I help you find the concert hall?",
    goals: [
      {
        id: "concert-directions",
        label: "표현 힌트: 콘서트홀 위치 묻기",
        matchAny: [
          "where is the concert hall",
          "how do i reach the venue",
        ],
      },
      {
        id: "directions-clarification",
        label: "표현 힌트: 안내를 다시 확인하기",
        matchAny: [
          "could you repeat those directions",
          "do i turn left here",
        ],
      },
      {
        id: "venue-thanks",
        label: "표현 힌트: 도움에 고마움 전하기",
        matchAny: [
          "thank you for your help",
          "thanks for showing me",
        ],
      },
    ],
  },
  {
    id: "festival-audience",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "축제 무대에서 관객 맞이하기",
    eyebrow: "ROLEPLAY · EXPRESSION MARKERS · 3 GOALS",
    scene: "축제 무대 리허설 뒤 관객을 맞이하며 노래를 소개하고 함께 부를 순간을 만들어봐요.",
    coachRole: "energetic festival stage coach",
    openingLine: "The crowd is ready. How will you welcome them before the song?",
    goals: [
      {
        id: "crowd-greeting",
        label: "표현 힌트: 관객에게 인사하기",
        matchAny: [
          "welcome to our show",
          "we are glad you are here",
        ],
      },
      {
        id: "song-introduction",
        label: "표현 힌트: 노래 소개하기",
        matchAny: [
          "this song is about finding courage",
          "our next song tells a story",
        ],
      },
      {
        id: "sing-together",
        label: "표현 힌트: 함께 노래 부르기 권하기",
        matchAny: [
          "sing along with us",
          "let's sing this together",
        ],
      },
    ],
  },
  {
    id: "career-reflection",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "팀과 지나온 길 돌아보기",
    eyebrow: "ROLEPLAY · EXPRESSION MARKERS · 3 GOALS",
    scene: "공연이 끝난 뒤 팀 연습실에서 동료와 지나온 성장과 고마움, 다음 꿈을 조용히 돌아봐요.",
    coachRole: "thoughtful bandmate reflection partner",
    openingLine: "The show is over. What have you learned from this journey?",
    goals: [
      {
        id: "growth-reflection",
        label: "표현 힌트: 함께 이룬 성장 돌아보기",
        matchAny: [
          "we have grown so much",
          "i learned from mistakes",
        ],
      },
      {
        id: "teammate-thanks",
        label: "표현 힌트: 함께한 팀에 고마움 전하기",
        matchAny: [
          "thank you for standing by me",
          "i appreciate our team",
        ],
      },
      {
        id: "future-hope",
        label: "표현 힌트: 다음 바람 말하기",
        matchAny: [
          "i hope to keep learning",
          "we will try new things",
        ],
      },
    ],
  },
] as const satisfies readonly WindDownVoiceScenario[];

export const WINDDOWN_VOICE_SCENARIOS = SCENARIOS;

export type WindDownVoiceScenarioId = (typeof SCENARIOS)[number]["id"];

export type WindDownVoiceTopic = {
  id: string;
  version: WindDownVoicePolicyVersion;
  title: string;
  eyebrow: string;
  scene: string;
  coachRole: string;
  openingLine: string;
};

/**
 * Live Talk has fixed conversation topics, not a free-form browser prompt.
 * There are deliberately no goal/card/reward fields here: its only completion
 * path is an explicit learner stop.
 */
const LIVE_TALK_TOPICS = [
  {
    id: "open-evening",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "오늘을 천천히 풀기",
    eyebrow: "LIVE TALK · OPEN CONVERSATION",
    scene: "오늘 있었던 일을 편안하게 이야기해요. 루미는 짧고 자연스럽게만 이어가요.",
    coachRole: "calm conversation partner",
    openingLine: "What would you like to talk about tonight?",
  },
  {
    id: "day-reflection",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "오늘의 한 장면",
    eyebrow: "LIVE TALK · OPEN CONVERSATION",
    scene: "오늘 마음에 남은 한 장면을 가볍게 이야기해요. 목표나 점수 없이 대화를 이어가요.",
    coachRole: "encouraging conversation partner",
    openingLine: "What is one moment from today that stayed with you?",
  },
] as const satisfies readonly WindDownVoiceTopic[];

export const WIND_DOWN_LIVE_TALK_TOPICS = LIVE_TALK_TOPICS;
/** @deprecated Prefer WIND_DOWN_LIVE_TALK_TOPICS in new transport code. */
export const WINDDOWN_LIVE_TALK_TOPICS = WIND_DOWN_LIVE_TALK_TOPICS;
export type WindDownVoiceTopicId = (typeof LIVE_TALK_TOPICS)[number]["id"];

/**
 * This descriptor is the complete client-to-server policy selection. It is
 * intentionally identifiers-only: the server resolves all role/prompt text
 * from the same catalog and rejects an unknown or mismatched version.
 */
export type WindDownVoiceDescriptor =
  | {
      activity: "roleplay";
      scenarioId: WindDownVoiceScenarioId;
      topicId?: never;
      policyVersion: WindDownVoicePolicyVersion;
    }
  | {
      activity: "live-talk";
      topicId: WindDownVoiceTopicId;
      scenarioId?: never;
      policyVersion: WindDownVoicePolicyVersion;
    };

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ");
}

function cleanText(value: string | null | undefined, limit = 280) {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, limit) : null;
}

const VOICE_SECRET_LEAKAGE_PATTERNS = [
  /\baccess_token\b/i,
  /\bx-goog-api-key\b/i,
  /\bauth_tokens\b/i,
  /\bGEMINI_API_KEY\b/i,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  /\bbearer\s+[A-Za-z0-9._~+\/-]{24,}\b/i,
  /\b(?:access[ _-]?token|api[ _-]?key|token)\s*[:=]\s*[A-Za-z0-9._~+\/-]{24,}\b/i,
];

export function containsWindDownVoiceSecretLeakage(value: string | null | undefined) {
  return VOICE_SECRET_LEAKAGE_PATTERNS.some((pattern) => pattern.test(value ?? ""));
}

/** Shared browser/server guard for transcript-derived product state. */
export function containsWindDownVoiceUnsafeText(value: string | null | undefined) {
  return containsMonaVnextControlLeakage(value) || containsWindDownVoiceSecretLeakage(value);
}

function isCleanLearnerTurn(turn: WindDownVoiceFinalizedTurn) {
  const learnerText = cleanText(turn.userText);
  const modelText = cleanText(turn.modelText);
  return turn.finalized === true
    && turn.sttDrift !== true
    && turn.interrupted !== true
    && typeof turn.conversationId === "string"
    && Boolean(turn.conversationId.trim())
    && Number.isInteger(turn.turnSeq)
    && turn.turnSeq > 0
    && Boolean(learnerText)
    && !containsWindDownVoiceUnsafeText(learnerText)
    && (!modelText || !containsWindDownVoiceUnsafeText(modelText));
}

function phraseMatches(text: string, phrase: string) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}(?=$|[^a-z])`, "i").test(text);
}

export function deriveWindDownVoiceCorrectionPresentation(
  correction: WindDownVoiceCorrection,
): WindDownVoiceCorrectionPresentation | null {
  const learnerText = cleanText(correction.learnerText, correction.coachFeedback ? 640 : 280);
  const correctionText = cleanText(
    correction.correctionText,
    (correction.coachFeedback ? 520 : WIND_DOWN_VOICE_CORRECTION_MAX_CHARS) + 1,
  );
  if (!learnerText || !correctionText) return null;
  if (
    typeof correction.conversationId !== "string"
    || !correction.conversationId.trim()
    || !Number.isInteger(correction.turnSeq)
    || correction.turnSeq < 1
    || correctionText.length > (correction.coachFeedback ? 520 : WIND_DOWN_VOICE_CORRECTION_MAX_CHARS)
  ) return null;
  if (
    containsWindDownVoiceUnsafeText(learnerText)
    || containsWindDownVoiceUnsafeText(correctionText)
  ) return null;
  if (correction.coachFeedback) {
    const feedback = parseWindDownCoachFeedback(correction.coachFeedback);
    if (!feedback || normalizeCoachEvidence(learnerText) !== normalizeCoachEvidence(feedback.learnerText)
      || normalizeCoachEvidence(correctionText) !== normalizeCoachEvidence(feedback.spokenResponse)) return null;
    return { was: feedback.was, now: feedback.now, why: feedback.why,
      citation: { conversationId: correction.conversationId, turnSeq: correction.turnSeq } };
  }
  const structured = correctionText.match(
    /^correction\s*(?:—|-|:)\s*was\s*:\s*([^|]{1,120}?)\s*\|\s*now\s*:\s*([^|]{1,120}?)\s*\|\s*why\s*:\s*(.{1,160})$/i,
  );
  if (!structured) return null;
  const was = cleanText(structured[1], 120);
  const now = cleanText(structured[2], 120);
  const why = cleanText(structured[3], 160);
  if (!was || !now || !why) return null;
  if (!normalizeText(learnerText).includes(normalizeText(was))) return null;
  return {
    was,
    now,
    why,
    citation: {
      conversationId: correction.conversationId.trim(),
      turnSeq: correction.turnSeq,
    },
  };
}

function correctionFromTurn(turn: WindDownVoiceFinalizedTurn): WindDownVoiceCorrection | null {
  if (!isCleanLearnerTurn(turn)) return null;
  const learnerText = cleanText(turn.userText, turn.coachFeedback ? 640 : 280);
  const modelText = cleanText(turn.modelText, 560);
  const correctionText = cleanText(
    turn.correctionText,
    (turn.coachFeedback ? 520 : WIND_DOWN_VOICE_CORRECTION_MAX_CHARS) + 1,
  );
  if (!learnerText || !modelText || !correctionText) return null;
  if (correctionText.length > (turn.coachFeedback ? 520 : WIND_DOWN_VOICE_CORRECTION_MAX_CHARS)) return null;
  if (!turn.coachFeedback && !normalizeText(modelText).includes(normalizeText(correctionText))) return null;
  const { coachFeedback: pendingFeedback, ...plainTurn } = turn;
  const feedback = pendingFeedback && attachWindDownCoachFeedback(plainTurn, pendingFeedback).coachFeedback;
  if (pendingFeedback && !feedback) return null;
  const correction = {
    ...(feedback ? { coachFeedback: feedback } : {}),
    conversationId: turn.conversationId.trim(),
    turnSeq: turn.turnSeq,
    learnerText,
    correctionText: feedback?.spokenResponse ?? correctionText,
  };
  const claimsStructuredEvidence = /^correction\s*(?:—|-|:)/i.test(
    correctionText,
  );
  if (
    claimsStructuredEvidence
    && !deriveWindDownVoiceCorrectionPresentation(correction)
  ) return null;
  return correction;
}

function dedupeCorrections(turns: readonly WindDownVoiceFinalizedTurn[]) {
  const seen = new Set<string>();
  return turns.flatMap((turn) => {
    const correction = correctionFromTurn(turn);
    if (!correction) return [];
    const key = `${correction.conversationId}:${correction.turnSeq}:${normalizeText(correction.correctionText)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [correction];
  });
}

export function getWindDownVoiceScenario(id: string | null | undefined, version: WindDownVoicePolicyVersion = WIND_DOWN_VOICE_POLICY_VERSION): (WindDownVoiceScenario & { id: WindDownVoiceScenarioId }) | null {
  const scenario = WINDDOWN_VOICE_SCENARIOS.find((scenario) => scenario.id === id);
  return scenario ? { ...scenario, version } : null;
}

export function getWindDownLiveTalkTopic(id: string | null | undefined) {
  return WIND_DOWN_LIVE_TALK_TOPICS.find((topic) => topic.id === id) ?? null;
}

export function isWindDownVoiceScenarioId(value: unknown): value is WindDownVoiceScenarioId {
  return typeof value === "string" && getWindDownVoiceScenario(value) !== null;
}

export function isWindDownVoiceTopicId(value: unknown): value is WindDownVoiceTopicId {
  return typeof value === "string" && getWindDownLiveTalkTopic(value) !== null;
}

export function createWindDownRoleplayDescriptor(
  scenarioId: WindDownVoiceScenarioId,
): WindDownVoiceDescriptor {
  return {
    activity: "roleplay",
    scenarioId,
    policyVersion: WIND_DOWN_VOICE_POLICY_VERSION,
  };
}

export function createWindDownLiveTalkDescriptor(
  topicId: WindDownVoiceTopicId,
): WindDownVoiceDescriptor {
  return {
    activity: "live-talk",
    topicId,
    policyVersion: WIND_DOWN_VOICE_POLICY_VERSION,
  };
}

const ROLEPLAY_DESCRIPTOR_KEYS = new Set([
  "activity",
  "policyVersion",
  "scenarioId",
]);
const LIVE_TALK_DESCRIPTOR_KEYS = new Set([
  "activity",
  "policyVersion",
  "topicId",
]);

function hasExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
) {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

export function isWindDownVoiceDescriptor(value: unknown): value is WindDownVoiceDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const descriptor = value as Record<string, unknown>;
  if (!isWindDownVoicePolicyVersion(descriptor.policyVersion)) return false;
  if (descriptor.activity === "roleplay") {
    return hasExactKeys(descriptor, ROLEPLAY_DESCRIPTOR_KEYS)
      && isWindDownVoiceScenarioId(descriptor.scenarioId);
  }
  if (descriptor.activity === "live-talk") {
    return hasExactKeys(descriptor, LIVE_TALK_DESCRIPTOR_KEYS)
      && isWindDownVoiceTopicId(descriptor.topicId);
  }
  return false;
}

export function normalizeWindDownVoiceDescriptor(
  value: unknown,
): WindDownVoiceDescriptor | null {
  if (!isWindDownVoiceDescriptor(value)) return null;
  return value.activity === "roleplay"
    ? { activity: "roleplay", scenarioId: value.scenarioId, policyVersion: value.policyVersion }
    : { activity: "live-talk", topicId: value.topicId, policyVersion: value.policyVersion };
}

export function createWindDownVoiceScenarioRequest(
  scenario: WindDownVoiceScenario,
): WindDownVoiceScenarioRequest {
  return {
    scenarioId: scenario.id,
    policyVersion: scenario.version,
  };
}

/**
 * Only clean, finalized learner utterances may create evidence. This makes a
 * goal reproducible from the persisted transcript and prevents a partial,
 * interrupted, or known-drift STT fragment from completing a scenario.
 */
export function evaluateWindDownRoleplay(
  scenario: WindDownVoiceScenario,
  turns: readonly WindDownVoiceFinalizedTurn[],
): WindDownRoleplayProgress {
  const evidence: WindDownVoiceGoalEvidence[] = [];
  const completedGoalIds = new Set<string>();
  // Do not globally re-sort across resumed chains: the transport/report chain
  // already defines chronological order, while turn numbers may restart.
  const orderedTurns = [...turns];

  for (const turn of orderedTurns) {
    if (!isCleanLearnerTurn(turn)) continue;
    const learnerText = cleanText(turn.userText);
    if (!learnerText) continue;
    const normalizedLearnerText = scenario.version === 1 ? normalizeText(learnerText) : windDownRoleplayEvidenceText(learnerText);
    if (!normalizedLearnerText) continue;
    for (const goal of scenario.goals) {
      if (completedGoalIds.has(goal.id)) continue;
      const supportedTask = scenario.version === 1 ? undefined : supportedWindDownRoleplayTask(scenario.id, goal.id, normalizedLearnerText);
      const matchedPhrase = supportedTask === undefined
        ? goal.matchAny.find((phrase) => phraseMatches(normalizedLearnerText, phrase))
        : supportedTask;
      if (!matchedPhrase) continue;
      completedGoalIds.add(goal.id);
      evidence.push({
        scenarioId: scenario.id,
        goalId: goal.id,
        conversationId: turn.conversationId.trim(),
        turnSeq: turn.turnSeq,
        learnerText,
        matchedPhrase,
      });
    }
  }

  const completedGoalIdsInScenarioOrder = scenario.goals
    .map((goal) => goal.id)
    .filter((goalId) => completedGoalIds.has(goalId));

  return {
    scenario,
    completedGoalIds: completedGoalIdsInScenarioOrder,
    evidence,
    corrections: dedupeCorrections(orderedTurns),
    completed: completedGoalIdsInScenarioOrder.length === scenario.goals.length,
  };
}

export function summarizeWindDownLiveTalk(args: {
  turns: readonly WindDownVoiceFinalizedTurn[];
  startedAtIso?: string | null;
  endedAtIso?: string | null;
}): WindDownLiveTalkSummary {
  const finalizedLearnerTurns = args.turns.filter(
    (turn) => turn.finalized && Boolean(cleanText(turn.userText)) && !containsWindDownVoiceUnsafeText(cleanText(turn.userText)),
  ).length;
  const cleanLearnerTurns = args.turns.filter(isCleanLearnerTurn).length;
  const highlightTurns = args.turns
    .filter((turn) => isCleanLearnerTurn(turn) && Boolean(cleanText(turn.modelText)))
    .map((turn) => ({ conversationId: turn.conversationId, turnSeq: turn.turnSeq }));
  const interruptedTurnCount = args.turns.filter((turn) => turn.finalized && turn.interrupted === true).length;
  const startedAt = Date.parse(args.startedAtIso ?? "");
  const endedAt = Date.parse(args.endedAtIso ?? "");
  const durationSeconds = Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt
    ? Math.round((endedAt - startedAt) / 1000)
    : null;

  return {
    activity: "live-talk",
    finalizedLearnerTurns,
    cleanLearnerTurns,
    highlightTurnSeqs: highlightTurns.map((turn) => turn.turnSeq),
    highlightTurns,
    interruptedTurnCount,
    durationSeconds,
    corrections: dedupeCorrections(args.turns),
  };
}

export function isWindDownVoiceCleanFinalizedTurn(
  turn: WindDownVoiceFinalizedTurn,
) {
  return isCleanLearnerTurn(turn);
}
