import type {
  CardRef,
  StudyMode,
  TeacherEffect,
  TeacherEvent,
  TeacherExpectedModelAction,
  TeacherPhase,
  TeacherSession,
  TeacherSessionCard,
  TeacherTransitionResult,
  TeacherVerdict,
} from "./teacherSession";

function defaultEnglishVisibility(mode: StudyMode) {
  return mode === "free_talk" || mode === "review";
}

function effectiveStudyMode(mode: StudyMode): StudyMode {
  return mode === "winddown" ? "drill" : mode;
}

function normalizeCard(card: CardRef, exposureCount = card.exposureCount ?? 0): TeacherSessionCard {
  return {
    expressionId: card.expressionId,
    ko: card.ko,
    targetEn: card.targetEn,
    acceptedVariants: [...card.acceptedVariants],
    difficulty: card.difficulty,
    exposureCount,
  };
}

function currentQueuedCard(session: TeacherSession) {
  const card = session.queue.entries[session.queue.cursor];
  return card ? normalizeCard(card, (card.exposureCount ?? 0) + 1) : null;
}

function nextQueuedCard(session: TeacherSession) {
  if (session.queue.entries.length === 0) {
    return { cursor: session.queue.cursor, card: null };
  }
  const cursor = (session.queue.cursor + 1) % session.queue.entries.length;
  const card = session.queue.entries[cursor];
  return { cursor, card: card ? normalizeCard(card, (card.exposureCount ?? 0) + 1) : null };
}

function advanceState(session: TeacherSession, patch: Partial<TeacherSession>): TeacherSession {
  return {
    ...session,
    ...patch,
    stateSeq: session.stateSeq + 1,
  };
}

function cardExpressionId(session: TeacherSession) {
  return session.card?.expressionId ?? "__none__";
}

function effect(
  session: TeacherSession,
  type: TeacherEffect["type"],
  expectedModelAction: TeacherExpectedModelAction,
  overrides: Partial<Omit<TeacherEffect, "type" | "stateSeq" | "expressionId" | "expectedModelAction">> = {},
): TeacherEffect {
  return {
    type,
    stateSeq: session.stateSeq,
    expressionId: cardExpressionId(session),
    expectedModelAction,
    ...overrides,
  };
}

function pendingReconnectAction(session: TeacherSession): TeacherSession["lifecycle"]["pendingReconnectAction"] {
  if (session.phase === "digression") return "answer_question";
  if (session.phase === "evaluating") return "acknowledge_attempt";
  return null;
}

function reconnectEffects(session: TeacherSession, action: TeacherSession["lifecycle"]["pendingReconnectAction"]) {
  const effects: TeacherEffect[] = [];
  if (action === "answer_question") {
    effects.push(effect(session, "answer_question", "answer_question_then_return", {
      targetEn: session.card?.targetEn,
      text: session.attempt.lastText ?? undefined,
    }));
  } else if (action === "acknowledge_attempt") {
    effects.push(effect(session, "repair_attempt", "repair_no_praise", {
      targetEn: session.card?.targetEn,
      text: "방금 말한 건 끊겼어. 같은 문장으로 이어서 다시 잡아볼게.",
    }));
  }
  effects.push(effect(session, "resume_state", "resume_state", { targetEn: session.card?.targetEn }));
  return effects;
}

function illegalTransition(session: TeacherSession, event: TeacherEvent, reason: string): TeacherTransitionResult {
  const next = advanceState(session, {});
  return {
    session: next,
    effects: [
      effect(next, "illegal_transition", "log_only", {
        text: `Illegal ${event.type}: ${reason}`,
        phase: session.phase,
      }),
    ],
  };
}

function requireCard(session: TeacherSession, event: TeacherEvent) {
  if (session.card) return null;
  return illegalTransition(session, event, "missing active card");
}

function applyVerdict(session: TeacherSession, verdict: TeacherVerdict): TeacherTransitionResult {
  if (session.phase !== "evaluating") {
    return illegalTransition(session, { type: "EVAL_RESULT", verdict }, "verdict without evaluating phase");
  }

  if (!session.card) {
    return illegalTransition(session, { type: "EVAL_RESULT", verdict }, "verdict without active card");
  }

  const basePatch: Partial<TeacherSession> = {
    attempt: { ...session.attempt, verdict },
  };

  if (verdict === "garbage") {
    const next = advanceState(session, {
      ...basePatch,
      phase: "awaiting_attempt",
      praiseArmed: false,
    });
    return {
      session: next,
      effects: [
        effect(next, "repair_attempt", "repair_no_praise", {
          verdict,
          targetEn: next.card?.targetEn,
        }),
      ],
    };
  }

  if (verdict === "variant") {
    const next = advanceState(session, {
      ...basePatch,
      phase: "advance_pending",
      visibility: { english: true },
      praiseArmed: true,
    });
    return {
      session: next,
      effects: [
        effect(next, "acknowledge_variant", "acknowledge_variant", {
          verdict,
          targetEn: next.card?.targetEn,
        }),
      ],
    };
  }

  if (verdict === "canonical") {
    const next = advanceState(session, {
      ...basePatch,
      phase: "advance_pending",
      visibility: { english: true },
      praiseArmed: true,
    });
    return {
      session: next,
      effects: [
        effect(next, "praise", "praise_attempt", {
          verdict,
          text: "잘했어. 다음 갈까?",
          targetEn: next.card?.targetEn,
        }),
      ],
    };
  }

  if (verdict === "close") {
    const next = advanceState(session, {
      ...basePatch,
      phase: "feedback",
      visibility: { english: true },
      praiseArmed: true,
    });
    return {
      session: next,
      effects: [
        effect(next, "coach_close_attempt", "coach_close_attempt", {
          verdict,
          targetEn: next.card?.targetEn,
        }),
      ],
    };
  }

  const next = advanceState(session, {
    ...basePatch,
    phase: "feedback",
    visibility: { english: true },
    praiseArmed: false,
  });
  return {
    session: next,
    effects: [
      effect(next, "coach_miss", "coach_miss", {
        verdict,
        targetEn: next.card?.targetEn,
      }),
    ],
  };
}

export function createTeacherSession(options: {
  mode?: StudyMode;
  cards: CardRef[];
  seed: string;
  phase?: TeacherPhase;
  resumeHandle?: string | null;
}): TeacherTransitionResult {
  const mode = effectiveStudyMode(options.mode ?? "drill");
  const entries = options.cards.map((card) => normalizeCard(card));
  return {
    session: {
      stateSeq: 0,
      mode,
      phase: options.phase ?? "idle",
      card: null,
      queue: { entries, cursor: 0, seed: options.seed },
      visibility: { english: defaultEnglishVisibility(mode) },
      attempt: { lastText: null, verdict: null },
      praiseArmed: false,
      digressionReturn: null,
      lifecycle: {
        goAwayCount: 0,
        resumeHandle: options.resumeHandle ?? null,
        resumePhase: null,
        pendingReconnectAction: null,
        lastEffectSeq: 0,
      },
    },
    effects: [],
  };
}

export function teacherTransition(session: TeacherSession, event: TeacherEvent): TeacherTransitionResult {
  switch (event.type) {
    case "SESSION_READY": {
      const card = currentQueuedCard(session);
      if (!card) return illegalTransition(session, event, "empty queue");
      const next = advanceState(session, {
        phase: "presenting",
        card,
        visibility: { english: defaultEnglishVisibility(session.mode) },
        attempt: { lastText: null, verdict: null },
        praiseArmed: false,
        digressionReturn: null,
        lifecycle: { ...session.lifecycle, lastEffectSeq: 0 },
      });
      return {
        session: next,
        effects: [
          effect(next, "present_card", "present_card", {
            targetEn: next.card?.targetEn,
          }),
        ],
      };
    }

    case "MODEL_TURN_COMPLETE": {
      if (session.phase === "presenting") {
        const next = advanceState(session, { phase: "awaiting_attempt" });
        return {
          session: next,
          effects: [effect(next, "wait_for_attempt", "wait_for_attempt")],
        };
      }

      if (session.phase === "digression") {
        const returnPhase = session.digressionReturn?.phase ?? "awaiting_attempt";
        const next = advanceState(session, {
          phase: returnPhase,
          digressionReturn: null,
        });
        return {
          session: next,
          effects: [
            effect(next, "reanchor_current_card", "reanchor_current_card", {
              targetEn: next.card?.targetEn,
            }),
          ],
        };
      }

      if (session.phase === "stopping") {
        const next = advanceState(session, { phase: "finalized" });
        return {
          session: next,
          effects: [effect(next, "finalize_session", "finalize_session")],
        };
      }

      const next = advanceState(session, {});
      return { session: next, effects: [] };
    }

    case "LEARNER_MODE_CHANGE": {
      if (session.phase === "finalized" || session.phase === "stopping") {
        return illegalTransition(session, event, "session is stopping or finalized");
      }
      const mode = effectiveStudyMode(event.mode);
      const next = advanceState(session, {
        mode,
        visibility: { english: defaultEnglishVisibility(mode) },
      });
      return {
        session: next,
        effects: [
          effect(next, "mode_changed", "set_study_mode", {
            text: mode,
            targetEn: next.card?.targetEn,
          }),
        ],
      };
    }

    case "LEARNER_NEXT": {
      if (session.phase === "finalized" || session.phase === "stopping") {
        return illegalTransition(session, event, "session is stopping or finalized");
      }
      const { cursor, card } = nextQueuedCard(session);
      if (!card) return illegalTransition(session, event, "empty queue");
      const next = advanceState(session, {
        phase: "presenting",
        card,
        queue: { ...session.queue, cursor },
        visibility: { english: defaultEnglishVisibility(session.mode) },
        attempt: { lastText: null, verdict: null },
        praiseArmed: false,
        digressionReturn: null,
        lifecycle: { ...session.lifecycle, lastEffectSeq: 0 },
      });
      return {
        session: next,
        effects: [
          effect(next, "present_card", "present_card", {
            targetEn: next.card?.targetEn,
          }),
        ],
      };
    }

    case "LEARNER_REVEAL": {
      const missing = requireCard(session, event);
      if (missing) return missing;
      const next = advanceState(session, {
        phase: "revealed",
        visibility: { english: true },
        praiseArmed: false,
      });
      return {
        session: next,
        effects: [
          effect(next, "reveal_target", "reveal_target", {
            targetEn: next.card?.targetEn,
          }),
        ],
      };
    }

    case "LEARNER_ATTEMPT": {
      const missing = requireCard(session, event);
      if (missing) return missing;
      if (session.phase === "finalized" || session.phase === "stopping") {
        return illegalTransition(session, event, "session is stopping or finalized");
      }
      if (session.mode === "free_talk") {
        const next = advanceState(session, {
          phase: "digression",
          attempt: { lastText: event.text.trim(), verdict: null },
          praiseArmed: false,
          digressionReturn: { phase: session.phase, stateSeq: session.stateSeq },
        });
        return {
          session: next,
          effects: [
            effect(next, "free_talk_correction", "suggest_correction", {
              targetEn: next.card?.targetEn,
              text: event.text.trim(),
            }),
          ],
        };
      }
      if (session.mode === "live_talk") {
        const next = advanceState(session, {
          phase: "digression",
          attempt: { lastText: event.text.trim(), verdict: null },
          praiseArmed: false,
          digressionReturn: { phase: session.phase, stateSeq: session.stateSeq },
        });
        return {
          session: next,
          effects: [
            effect(next, "live_talk_prompt", "guided_conversation", {
              targetEn: next.card?.targetEn,
              text: event.text.trim(),
            }),
          ],
        };
      }
      const next = advanceState(session, {
        phase: "evaluating",
        attempt: { lastText: event.text.trim(), verdict: null },
        praiseArmed: false,
      });
      return { session: next, effects: [] };
    }

    case "EVAL_RESULT":
      return applyVerdict(session, event.verdict);

    case "MODEL_DRIFT": {
      const missing = requireCard(session, event);
      if (missing) return missing;

      if (event.kind === "word_drop" && session.lifecycle.lastEffectSeq === 0) {
        const nextSeq = session.stateSeq + 1;
        const next = advanceState(session, {
          lifecycle: { ...session.lifecycle, lastEffectSeq: nextSeq },
        });
        return {
          session: next,
          effects: [
            effect(next, "corrective_respeak", "speak_target", {
              observedText: event.observedText,
              targetEn: next.card?.targetEn,
            }),
          ],
        };
      }

      const next = advanceState(session, {});
      return {
        session: next,
        effects: [
          effect(next, "model_drift_logged", "log_only", {
            observedText: event.observedText,
            targetEn: next.card?.targetEn,
            text: `Model drift logged: ${event.kind}`,
          }),
        ],
      };
    }

    case "LEARNER_QUESTION": {
      const missing = requireCard(session, event);
      if (missing) return missing;
      const next = advanceState(session, {
        phase: "digression",
        attempt: { lastText: event.text?.trim() || null, verdict: null },
        digressionReturn: { phase: session.phase, stateSeq: session.stateSeq },
      });
      return {
        session: next,
        effects: [
          effect(next, "answer_question", "answer_question_then_return", {
            targetEn: next.card?.targetEn,
            text: event.text,
          }),
        ],
      };
    }

    case "GO_AWAY": {
      const next = advanceState(session, {
        lifecycle: {
          ...session.lifecycle,
          goAwayCount: session.lifecycle.goAwayCount + 1,
          resumeHandle: event.resumeHandle ?? session.lifecycle.resumeHandle,
          pendingReconnectAction: session.lifecycle.pendingReconnectAction ?? pendingReconnectAction(session),
        },
      });
      return {
        session: next,
        effects: [effect(next, "resume_state", "resume_state", { targetEn: next.card?.targetEn })],
      };
    }

    case "RECONNECTED": {
      const next = advanceState(session, {
        phase: session.lifecycle.resumePhase ?? session.phase,
        lifecycle: {
          ...session.lifecycle,
          resumeHandle: event.resumeHandle ?? session.lifecycle.resumeHandle,
          resumePhase: null,
          pendingReconnectAction: null,
        },
      });
      return {
        session: next,
        effects: reconnectEffects(next, session.lifecycle.pendingReconnectAction),
      };
    }

    case "SOCKET_DEAD": {
      const next = advanceState(session, {
        phase: "stopping",
        lifecycle: {
          ...session.lifecycle,
          resumeHandle: event.resumeHandle ?? session.lifecycle.resumeHandle,
          resumePhase: session.phase,
          pendingReconnectAction: session.lifecycle.pendingReconnectAction ?? pendingReconnectAction(session),
        },
      });
      return {
        session: next,
        effects: [effect(next, "offer_resume", "offer_resume", { targetEn: next.card?.targetEn })],
      };
    }

    case "LEARNER_STOP": {
      const next = advanceState(session, { phase: "stopping" });
      return {
        session: next,
        effects: [effect(next, "stop_session", "stop_session", { targetEn: next.card?.targetEn })],
      };
    }
  }
}
