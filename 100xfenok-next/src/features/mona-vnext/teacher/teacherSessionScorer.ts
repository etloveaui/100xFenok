import { validateTeacherMaterial } from "./materialGate";
import type { TeacherEffectType } from "./teacherSession";

export type MonaTsmScoredSessionEvent =
  | {
    type: "manual-next";
    expressionId: string;
    nextExpressionId?: string;
  }
  | {
    type: "teacher_effect";
    effectType: TeacherEffectType;
    expressionId: string;
    priorTrigger?: string;
    praiseArmed?: boolean;
    effectOffset?: number;
  }
  | {
    type: "model_drift";
    expressionId: string;
    flagged: boolean;
  }
  | {
    type: "coach_line";
    expressionId: string;
    text: string;
  };

export type MonaTsmScoredSessionLog = {
  cardsServed: Array<{
    expressionId: string;
    ko: string;
    targetEn: string;
    difficulty: number;
  }>;
  events: MonaTsmScoredSessionEvent[];
};

export type MonaTsmGateResult = {
  gate: "G1" | "G2" | "G3" | "G4" | "G5" | "G7" | "G10";
  ok: boolean;
  detail: string;
};

export type MonaTsmScoreResult = {
  ok: boolean;
  results: MonaTsmGateResult[];
};

function gate(gateId: MonaTsmGateResult["gate"], ok: boolean, detail: string): MonaTsmGateResult {
  return { gate: gateId, ok, detail };
}

function countRepeatedCoachLines(events: MonaTsmScoredSessionEvent[]) {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "coach_line") continue;
    const normalized = event.text.trim().replace(/\s+/g, " ");
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

export function scoreMonaTsmSessionGates(log: MonaTsmScoredSessionLog): MonaTsmScoreResult {
  const manualNextEvents = log.events.filter((event): event is Extract<MonaTsmScoredSessionEvent, { type: "manual-next" }> => (
    event.type === "manual-next"
  ));
  const presentEffects = log.events.filter((event): event is Extract<MonaTsmScoredSessionEvent, { type: "teacher_effect" }> => (
    event.type === "teacher_effect" && event.effectType === "present_card"
  ));
  const revealEffects = log.events.filter((event): event is Extract<MonaTsmScoredSessionEvent, { type: "teacher_effect" }> => (
    event.type === "teacher_effect" && event.effectType === "reveal_target"
  ));
  const praiseEffects = log.events.filter((event): event is Extract<MonaTsmScoredSessionEvent, { type: "teacher_effect" }> => (
    event.type === "teacher_effect" && event.effectType === "praise"
  ));
  const unflaggedDrifts = log.events.filter((event) => event.type === "model_drift" && event.flagged === false);
  const material = validateTeacherMaterial(log.cardsServed.map((card) => ({
    ...card,
    acceptedVariants: [],
    grounded: true,
    verifiedInSource: true,
    tried: [],
  })));

  const results: MonaTsmGateResult[] = [
    gate(
      "G1",
      manualNextEvents.every((event) => Boolean(event.nextExpressionId) && event.nextExpressionId !== event.expressionId),
      `manual-next=${manualNextEvents.length}`,
    ),
    gate("G2", unflaggedDrifts.length === 0, `unflaggedDrifts=${unflaggedDrifts.length}`),
    gate(
      "G3",
      presentEffects.every((event) => (
        event.priorTrigger === "SESSION_READY"
          || event.priorTrigger === "LEARNER_NEXT"
          || event.priorTrigger === "EVAL_RESULT_CANONICAL"
          || event.priorTrigger === "EVAL_RESULT_VARIANT"
      )),
      `presentEffects=${presentEffects.length}`,
    ),
    gate(
      "G4",
      revealEffects.every((event) => (event.effectOffset ?? 0) <= 1),
      `revealEffects=${revealEffects.length}`,
    ),
    gate(
      "G5",
      praiseEffects.every((event) => event.praiseArmed === true),
      `praiseEffects=${praiseEffects.length}`,
    ),
    gate("G7", countRepeatedCoachLines(log.events) <= 2, `maxRepeat=${countRepeatedCoachLines(log.events)}`),
    gate("G10", material.quarantine.length === 0, `quarantine=${material.quarantine.length}`),
  ];

  return {
    ok: results.every((result) => result.ok),
    results,
  };
}
