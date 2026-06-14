export type MonaLearnerIntent =
  | "attempt"
  | "repeat_prompt"
  | "repeat_target"
  | "next_material"
  | "easier"
  | "harder"
  | "switch_theme"
  | "stop"
  | "frustration"
  | "meta_complaint"
  | "challenge"
  | "bring_own"
  | "garbled"
  | "off_topic"
  | "unknown";

export type AttemptEval = {
  verdict: "correct" | "near" | "wrong" | "unintelligible" | "different_intent";
  matchedAlternative: string | null;
  namedFeature: string | null;
  lexicalMismatch: string | null;
  mayPraise: boolean;
};

export type MonaCoachExpected = "attempt" | "shadow" | "repeat" | "choice" | "stop";

export type MonaCoachItem = {
  itemId: string;
  ko: string;
  enCanonical: string;
  acceptedAlternatives: string[];
  pattern: string | null;
  pronHint: string | null;
  difficulty: 1 | 2 | 3 | null;
  sibling: { ko: string; en: string } | null;
  variations: Array<{ kind: string; ko: string; en: string }>;
  source: "weak" | "best3" | "bank";
  srsBox?: number;
  due?: string | null;
};

export type MonaCoachState = {
  sessionId: string;
  studyDate: string;
  snapshotVersion: string;
  sessionOrdinalToday: number;
  sessionMode: "lesson" | "freetalk";
  current: MonaCoachItem | null;
  queues: {
    dueWeak: string[];
    dueBest3: string[];
    curriculumFocus: string[];
    newBank: string[];
    sameDayBuffer: string[];
  };
  history: {
    plannedKeys: string[];
    shownKeys: string[];
    attemptedKeys: string[];
    passedKeys: string[];
    weakKeys: string[];
    deferredKeys: string[];
  };
  turn: {
    promptId: string | null;
    turnSeq: number;
    expected: MonaCoachExpected;
    lastLearnerText: string | null;
    lastIntent: MonaLearnerIntent | null;
    lastEval: AttemptEval | null;
    mayPraise: boolean;
    consecutiveConfusion: number;
  };
};

export type MonaCoachSnapshot = {
  version: string;
  items: MonaCoachItem[];
};

export type MonaCoachToolCommand = {
  intent?: MonaLearnerIntent;
  type?: "next_material" | "repeat_prompt" | "repeat_target" | "stop";
};

export type MonaCoachCardCommand = {
  type: "showCard";
  itemId: string;
  state: "prompt" | "reveal" | "drill";
  ko: string;
  en?: string;
} | null;

export type MonaCoachSaveReviewDelta = {
  type: "none" | "attempt";
  itemId?: string;
  verdict?: AttemptEval["verdict"];
  learnerText?: string;
  passed?: boolean;
  weak?: boolean;
  matchedAlternative?: string | null;
  turnSeq?: number;
};

export type MonaCoachTurnInput = {
  snapshot?: MonaCoachSnapshot | null;
  state: MonaCoachState;
  learnerTranscript?: string | null;
  toolCmd?: MonaCoachToolCommand | null;
};

export type MonaCoachTurnDirective = {
  state: MonaCoachState;
  cardCommand: MonaCoachCardCommand;
  spokenGuidance: string;
  saveReviewDelta: MonaCoachSaveReviewDelta;
  nextExpectedState: MonaCoachExpected;
  mayPraise: boolean;
  intent: MonaLearnerIntent;
  attemptEval: AttemptEval | null;
  transition: {
    from: MonaCoachExpected;
    to: MonaCoachExpected;
  };
};

const EMPTY_EVAL: AttemptEval = {
  verdict: "different_intent",
  matchedAlternative: null,
  namedFeature: null,
  lexicalMismatch: null,
  mayPraise: false,
};

export function runMonaCoachTurn(input: MonaCoachTurnInput): MonaCoachTurnDirective {
  const initialState = cloneState(input.state);
  const learnerText = String(input.learnerTranscript ?? "").trim();
  const commandIntent = normalizeToolIntent(input.toolCmd);
  const intent = commandIntent ?? classifyMonaLearnerIntent({
    attemptText: learnerText,
    rawUtterance: learnerText,
    expected: initialState.turn.expected,
    current: initialState.current,
  });

  if (initialState.sessionMode === "freetalk" && intent !== "stop") {
    // Friday free-talking: 1-minute monologue, no drilling. Model handles topic + end-feedback via FREETALK_MODE.
    const nextState = advanceTurn(initialState, learnerText, intent, null, "attempt", false);
    const guidance = initialState.turn.turnSeq === 0
      ? "FREETALK_MODE: 실생활 상황 하나 주고, 코치가 상대역이 되어 그 상황으로 영어 대화를 시작해."
      : "FREETALK_MODE: 그 상황 이어서 상대역으로 자연스럽게 대화해. 막히면 살짝 도와줘.";
    return directive(nextState, null, guidance, noneDelta(), "attempt", false, intent, null, initialState.turn.expected);
  }

  if (!initialState.current && intent !== "stop") {
    const nextItem = pickNextItem(input.snapshot, initialState);
    if (nextItem) {
      return activateItem(initialState, nextItem, intent, "이 문장으로 시작해보자.");
    }
  }

  if (intent === "stop") {
    const nextState = advanceTurn(initialState, learnerText, intent, null, "stop", false);
    return directive(nextState, null, "오늘은 여기까지 하자. 푹 쉬어.", noneDelta(), "stop", false, intent, null, initialState.turn.expected);
  }

  if (intent === "next_material" || intent === "easier" || intent === "harder" || intent === "switch_theme") {
    const nextItem = pickNextItem(input.snapshot, initialState);
    if (nextItem) {
      return activateItem(initialState, nextItem, intent, "알았어, 이 문장으로 가자.");
    }
    const nextState = advanceTurn(initialState, learnerText, intent, null, "attempt", false);
    return directive(nextState, currentPromptCard(initialState), "지금은 새 카드가 없어서 이 문장으로 한 번만 더 가자.", noneDelta(), "attempt", false, intent, null, initialState.turn.expected);
  }

  if (intent === "repeat_prompt" || intent === "garbled") {
    const nextState = advanceTurn(initialState, learnerText, intent, null, "attempt", false, true);
    const prompt = initialState.current?.ko ?? "지금 문장을 다시 들려줄게.";
    return directive(nextState, currentPromptCard(initialState), prompt, noneDelta(), "attempt", false, intent, null, initialState.turn.expected);
  }

  if (intent === "repeat_target") {
    const nextState = advanceTurn(initialState, learnerText, intent, null, "repeat", false);
    const target = initialState.current?.enCanonical ?? "";
    return directive(nextState, currentRevealCard(initialState), target, noneDelta(), "repeat", false, intent, null, initialState.turn.expected);
  }

  if (intent === "challenge" || intent === "frustration" || intent === "meta_complaint") {
    const nextState = advanceTurn(initialState, learnerText, intent, null, "attempt", false);
    const target = initialState.current?.enCanonical;
    const guidance = target
      ? `맞아, 헷갈리게 했어. 지금 이 카드 목표는 "${target}"로 잠글게.`
      : "맞아, 헷갈리게 했어. 바로 다음 문장으로 정리할게.";
    return directive(nextState, currentPromptCard(initialState), guidance, noneDelta(), "attempt", false, intent, null, initialState.turn.expected);
  }

  if (intent === "bring_own") {
    // Free mode: server cannot translate arbitrary Korean, so it delegates translation+drill to the model
    // for THIS turn only (Mona's explicit request). FREE_MODE marker is decoded by the prompt, never voiced.
    const nextState = advanceTurn(initialState, learnerText, intent, null, "attempt", false);
    return directive(nextState, null, `FREE_MODE: ${learnerText}`, noneDelta(), "attempt", false, intent, null, initialState.turn.expected);
  }

  const attemptEval = evaluateMonaAttempt(learnerText, initialState.current, intent);
  const nextExpected = attemptEval.verdict === "correct" ? "shadow" : "attempt";
  const nextState = advanceTurn(initialState, learnerText, intent, attemptEval, nextExpected, attemptEval.mayPraise);
  const saveReviewDelta = attemptEval.verdict === "correct" || attemptEval.verdict === "wrong"
    ? attemptDelta(nextState, learnerText, attemptEval)
    : noneDelta();

  return directive(
    nextState,
    attemptEval.verdict === "correct" ? currentRevealCard(nextState) : currentPromptCard(nextState),
    guidanceForAttempt(attemptEval, nextState.current),
    saveReviewDelta,
    nextExpected,
    attemptEval.mayPraise,
    intent,
    attemptEval,
    initialState.turn.expected,
  );
}

export function classifyMonaLearnerIntent(input: {
  attemptText?: string | null;
  rawUtterance?: string | null;
  expected: MonaCoachExpected;
  current?: MonaCoachItem | null;
}): MonaLearnerIntent {
  const raw = String(input.rawUtterance ?? input.attemptText ?? "").trim();
  const text = normalizeText(raw);
  if (!text) return "garbled";

  const currentTarget = normalizeText(input.current?.enCanonical ?? "");
  if (currentTarget && currentTarget.includes(text) && text.length >= 6) {
    return input.expected === "repeat" || input.expected === "shadow" ? "repeat_target" : "attempt";
  }

  if (/(그만|끝|멈춰|종료|\bstop\b|\bdone\b|\bquit\b|\bfinish\b)/i.test(raw)) return "stop";
  if (/(뭐라고|질문이 뭐|안 들|못 들|다시 질문|repeat the question|what was the question)/i.test(raw)) return "repeat_prompt";
  if (/(다시 말|한 번 더|따라|repeat that|say it again)/i.test(raw)) return "repeat_target";
  if (
    input.current &&
    (
      /(영어|english).*(안\s*보|보여|문장|카드|정답|답|뭐|어떻게|어케)/i.test(raw) ||
      /(안\s*보|보여).*(영어|english|문장|카드|정답|답)/i.test(raw)
    )
  ) return "repeat_target";
  if (/(앞 문장 넘어가|다음 거|다음거|새로운|새 문장|딴 거|넘어가|next one|move on|another one)/i.test(raw)) return "next_material";
  if (/(쉬운|쉽게|너무 어려|easier|simpler|too hard)/i.test(raw)) return "easier";
  if (/(어려운|어렵게|너무 쉬|harder|more difficult|too easy)/i.test(raw)) return "harder";
  if (/(주제 바꿔|다른 주제|switch topic)/i.test(raw)) return "switch_theme";
  if (/(가르쳤잖아|쓰라며|왜 이제 와서|처음에|말했잖아|contradict|you taught)/i.test(raw)) return "challenge";
  // Mona free-input (project_instructions): she brings her own phrase/word to say.
  if (/(오늘.*(못 했|못했)|영어로 (뭐|어떻게|어케|어떡)|말해보카|빨모쌤|유튜브에서 (봤|본)|이거 영어로|이거 가져왔)/i.test(raw)) return "bring_own";
  if (/(업데이트가 안|왜 쉬|짜증|화나|멍충|바보|답답|그게 아니|not what)/i.test(raw)) return "frustration";
  if (/(카드|프롬프트|화면|저장|도구|showcard|control)/i.test(raw)) return "meta_complaint";
  if (/^[\s.,!?~…-]+$/.test(raw)) return "garbled";

  return input.expected === "choice" ? "unknown" : "attempt";
}

export function evaluateMonaAttempt(
  learnerText: string,
  current: MonaCoachItem | null | undefined,
  intent: MonaLearnerIntent = "attempt",
): AttemptEval {
  if (!current) return { ...EMPTY_EVAL };
  if (intent === "garbled") {
    return { ...EMPTY_EVAL, verdict: "unintelligible", lexicalMismatch: "unintelligible speech" };
  }
  if (intent !== "attempt" && intent !== "repeat_target") {
    return { ...EMPTY_EVAL };
  }

  const attempt = normalizeEnglish(learnerText);
  const target = normalizeEnglish(current.enCanonical);
  if (!attempt) {
    return { ...EMPTY_EVAL, verdict: "unintelligible", lexicalMismatch: "empty attempt" };
  }
  if (attempt === target) {
    return {
      verdict: "correct",
      matchedAlternative: null,
      namedFeature: "target sentence",
      lexicalMismatch: null,
      mayPraise: true,
    };
  }

  const matchedAlternative = current.acceptedAlternatives.find((alternative) => normalizeEnglish(alternative) === attempt) ?? null;
  if (matchedAlternative) {
    return {
      verdict: "correct",
      matchedAlternative,
      namedFeature: "accepted alternative",
      lexicalMismatch: null,
      mayPraise: true,
    };
  }

  const lexicalMismatch = detectLexicalMismatch(attempt, target);
  return {
    verdict: lexicalMismatch ? "wrong" : "near",
    matchedAlternative: null,
    namedFeature: lexicalMismatch ? null : "some target words",
    lexicalMismatch,
    mayPraise: false,
  };
}

export function createMonaCoachState(input: {
  sessionId: string;
  studyDate: string;
  snapshotVersion: string;
  sessionOrdinalToday?: number;
  sessionMode?: "lesson" | "freetalk";
  current?: MonaCoachItem | null;
  queues?: Partial<MonaCoachState["queues"]>;
}): MonaCoachState {
  return {
    sessionId: input.sessionId,
    studyDate: input.studyDate,
    snapshotVersion: input.snapshotVersion,
    sessionOrdinalToday: input.sessionOrdinalToday ?? 1,
    sessionMode: input.sessionMode ?? "lesson",
    current: input.current ? cloneItem(input.current) : null,
    queues: {
      dueWeak: [...(input.queues?.dueWeak ?? [])],
      dueBest3: [...(input.queues?.dueBest3 ?? [])],
      curriculumFocus: [...(input.queues?.curriculumFocus ?? [])],
      newBank: [...(input.queues?.newBank ?? [])],
      sameDayBuffer: [...(input.queues?.sameDayBuffer ?? [])],
    },
    history: {
      plannedKeys: [],
      shownKeys: input.current ? [input.current.itemId] : [],
      attemptedKeys: [],
      passedKeys: [],
      weakKeys: [],
      deferredKeys: [],
    },
    turn: {
      promptId: input.current?.itemId ?? null,
      turnSeq: 0,
      expected: "attempt",
      lastLearnerText: null,
      lastIntent: null,
      lastEval: null,
      mayPraise: false,
      consecutiveConfusion: 0,
    },
  };
}

function activateItem(
  state: MonaCoachState,
  item: MonaCoachItem,
  intent: MonaLearnerIntent,
  spokenPrefix: string,
): MonaCoachTurnDirective {
  const nextState = cloneState(state);
  nextState.current = cloneItem(item);
  nextState.history.plannedKeys = appendUnique(nextState.history.plannedKeys, item.itemId);
  nextState.history.shownKeys = appendUnique(nextState.history.shownKeys, item.itemId);
  nextState.turn = {
    ...nextState.turn,
    promptId: item.itemId,
    turnSeq: nextState.turn.turnSeq + 1,
    expected: "attempt",
    lastIntent: intent,
    lastEval: null,
    mayPraise: false,
    consecutiveConfusion: 0,
  };

  return directive(
    nextState,
    { type: "showCard", itemId: item.itemId, state: "prompt", ko: item.ko },
    `${spokenPrefix} ${item.ko}`,
    noneDelta(),
    "attempt",
    false,
    intent,
    null,
    state.turn.expected,
  );
}

function advanceTurn(
  state: MonaCoachState,
  learnerText: string,
  intent: MonaLearnerIntent,
  evalResult: AttemptEval | null,
  expected: MonaCoachExpected,
  mayPraise: boolean,
  confusion = false,
): MonaCoachState {
  const nextState = cloneState(state);
  const currentItemId = nextState.current?.itemId;
  nextState.turn = {
    ...nextState.turn,
    turnSeq: nextState.turn.turnSeq + 1,
    expected,
    lastLearnerText: learnerText || null,
    lastIntent: intent,
    lastEval: evalResult ? { ...evalResult } : null,
    mayPraise,
    consecutiveConfusion: confusion ? nextState.turn.consecutiveConfusion + 1 : 0,
  };
  if (currentItemId && intent === "attempt") {
    nextState.history.attemptedKeys = appendUnique(nextState.history.attemptedKeys, currentItemId);
    if (evalResult?.verdict === "correct") {
      nextState.history.passedKeys = appendUnique(nextState.history.passedKeys, currentItemId);
    }
    if (evalResult?.verdict === "wrong") {
      nextState.history.weakKeys = appendUnique(nextState.history.weakKeys, currentItemId);
    }
  }
  return nextState;
}

function directive(
  state: MonaCoachState,
  cardCommand: MonaCoachCardCommand,
  spokenGuidance: string,
  saveReviewDelta: MonaCoachSaveReviewDelta,
  nextExpectedState: MonaCoachExpected,
  mayPraise: boolean,
  intent: MonaLearnerIntent,
  attemptEval: AttemptEval | null,
  from: MonaCoachExpected,
): MonaCoachTurnDirective {
  return {
    state,
    cardCommand,
    spokenGuidance,
    saveReviewDelta,
    nextExpectedState,
    mayPraise,
    intent,
    attemptEval,
    transition: { from, to: nextExpectedState },
  };
}

function currentPromptCard(state: MonaCoachState): MonaCoachCardCommand {
  if (!state.current) return null;
  return { type: "showCard", itemId: state.current.itemId, state: "prompt", ko: state.current.ko };
}

function currentRevealCard(state: MonaCoachState): MonaCoachCardCommand {
  if (!state.current) return null;
  return { type: "showCard", itemId: state.current.itemId, state: "reveal", ko: state.current.ko, en: state.current.enCanonical };
}

// ppalmo style (CONTRACT section 9): one warm line, shadow with pron/stress hint when available,
// one-line gap correction, no empty praise. Kept deterministic so the model voices it verbatim.
function guidanceForAttempt(evalResult: AttemptEval, current: MonaCoachItem | null): string {
  const target = current?.enCanonical ?? "";
  const shadow = current?.pronHint
    ? `${current.pronHint}처럼 낮게 한 번 더 따라가자.`
    : `"${target}" 낮게 한 번만 더.`;
  if (evalResult.verdict === "correct") {
    const opener = evalResult.matchedAlternative ? "그 표현도 자연스러워" : "그렇지, 그거야";
    return `${opener}. ${shadow}`;
  }
  if (evalResult.verdict === "near") {
    return `거의 다 왔어. 목표는 "${target}"야. 한 번만 더.`;
  }
  if (evalResult.verdict === "unintelligible") {
    return current?.ko ? `잘 안 들렸어. "${current.ko}" 한 번만 천천히 다시.` : "잘 안 들렸어. 한 번만 다시 말해줘.";
  }
  if (evalResult.lexicalMismatch) {
    return `${evalResult.lexicalMismatch}. "${target}"로 가볍게 다시 해보자.`;
  }
  return `이번엔 "${target}"로 다시 해보자.`;
}

function attemptDelta(state: MonaCoachState, learnerText: string, evalResult: AttemptEval): MonaCoachSaveReviewDelta {
  if (!state.current) return noneDelta();
  return {
    type: "attempt",
    itemId: state.current.itemId,
    verdict: evalResult.verdict,
    learnerText,
    passed: evalResult.verdict === "correct",
    weak: evalResult.verdict === "wrong",
    matchedAlternative: evalResult.matchedAlternative,
    turnSeq: state.turn.turnSeq,
  };
}

function noneDelta(): MonaCoachSaveReviewDelta {
  return { type: "none" };
}

function normalizeToolIntent(command: MonaCoachToolCommand | null | undefined): MonaLearnerIntent | null {
  if (!command) return null;
  if (command.intent) return command.intent;
  if (command.type === "next_material") return "next_material";
  if (command.type === "repeat_prompt") return "repeat_prompt";
  if (command.type === "repeat_target") return "repeat_target";
  if (command.type === "stop") return "stop";
  return null;
}

function pickNextItem(snapshot: MonaCoachSnapshot | null | undefined, state: MonaCoachState): MonaCoachItem | null {
  if (!snapshot?.items.length) return null;
  const itemsById = new Map(snapshot.items.map((item) => [item.itemId, item]));
  const priorityIds = [
    ...state.queues.dueWeak,
    ...state.queues.dueBest3,
    ...state.queues.curriculumFocus,
    ...state.queues.sameDayBuffer,
    ...state.queues.newBank,
  ];
  const blocked = new Set([state.current?.itemId, ...state.history.passedKeys].filter(Boolean));

  for (const itemId of priorityIds) {
    const item = itemsById.get(itemId);
    if (item && !blocked.has(item.itemId)) return item;
  }
  return snapshot.items.find((item) => !blocked.has(item.itemId)) ?? null;
}

function detectLexicalMismatch(attempt: string, target: string): string | null {
  if (/\blets?\b/.test(target) && /\b(like|likes|lacks|lack|laugh|laughs)\b/.test(attempt)) {
    return "`like/lacks`가 아니라 `let`이야";
  }
  if (/\brains?\b|\braining\b/.test(target) && /\bi was raining\b/.test(attempt)) {
    return "사람 주어가 아니라 날씨 주어 `it`이야";
  }
  if (/\bdoes\b/.test(target) && /\bis it work\b/.test(attempt)) {
    return "`is it`이 아니라 `does that`이야";
  }

  const targetWords = new Set(target.split(" ").filter((word) => word.length > 2));
  const attemptWords = attempt.split(" ").filter((word) => word.length > 2);
  const overlap = attemptWords.filter((word) => targetWords.has(word)).length;
  if (targetWords.size > 0 && overlap === 0) return "목표 단어가 거의 달라졌어";
  return null;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeEnglish(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cloneState(state: MonaCoachState): MonaCoachState {
  return {
    ...state,
    current: state.current ? cloneItem(state.current) : null,
    queues: {
      dueWeak: [...state.queues.dueWeak],
      dueBest3: [...state.queues.dueBest3],
      curriculumFocus: [...state.queues.curriculumFocus],
      newBank: [...state.queues.newBank],
      sameDayBuffer: [...state.queues.sameDayBuffer],
    },
    history: {
      plannedKeys: [...state.history.plannedKeys],
      shownKeys: [...state.history.shownKeys],
      attemptedKeys: [...state.history.attemptedKeys],
      passedKeys: [...state.history.passedKeys],
      weakKeys: [...state.history.weakKeys],
      deferredKeys: [...state.history.deferredKeys],
    },
    turn: {
      ...state.turn,
      lastEval: state.turn.lastEval ? { ...state.turn.lastEval } : null,
    },
  };
}

function cloneItem(item: MonaCoachItem): MonaCoachItem {
  return {
    ...item,
    acceptedAlternatives: [...item.acceptedAlternatives],
    sibling: item.sibling ? { ...item.sibling } : null,
    variations: item.variations.map((variation) => ({ ...variation })),
  };
}

function appendUnique(values: string[], value: string) {
  return values.includes(value) ? values : [...values, value];
}
