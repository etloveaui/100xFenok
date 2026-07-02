import type { TeacherEffect } from "./teacherSession";

export type TeacherRealtimeTextInput = {
  realtimeInput: {
    text: string;
  };
};

type TeacherLiveEnvelope = {
  stateSeq: number;
  expressionId: string;
  expectedModelAction: TeacherEffect["expectedModelAction"];
  effectType: TeacherEffect["type"];
  targetEn?: string;
  message: string;
};

function buildTeacherEffectMessage(effect: TeacherEffect) {
  switch (effect.type) {
    case "mode_changed":
      return `Study mode changed to ${effect.text ?? "drill"}. Follow the app state; do not change the card unless instructed.`;
    case "present_card":
      return `Present the current Korean prompt and wait. Do not reveal or advance.`;
    case "wait_for_attempt":
      return `Wait for the learner attempt. Do not advance material.`;
    case "reveal_target":
      return `Reveal and speak the exact target once: ${effect.targetEn ?? ""}`;
    case "corrective_respeak":
      return `The previous target speech drifted. Re-speak exactly once: ${effect.targetEn ?? ""}`;
    case "repair_attempt":
      return `The learner audio was unclear. Repair without praise and ask for one more attempt.`;
    case "acknowledge_variant":
      return `Acknowledge this accepted variant as correct, then offer the canonical target as an alternative: ${effect.targetEn ?? ""}`;
    case "praise":
      return effect.text ?? `Praise briefly because a real evaluated attempt passed.`;
    case "offer_advance":
      return effect.text ?? `다음 갈까?`;
    case "coach_close_attempt":
      return `그 말도 통해. Acknowledge the close attempt first, then teach the canonical target as an alternative: ${effect.targetEn ?? ""}`;
    case "coach_miss":
      return `The attempt missed. Give a short correction without praise.`;
    case "answer_question":
      return `Answer the learner question briefly, then return to the held card.`;
    case "free_talk_correction":
      return `Suggest a gentle correction candidate for the learner sentence. Do not write it to SRS or advance the card.`;
    case "live_talk_prompt":
      return `Guide a natural conversation around the held target: ${effect.targetEn ?? ""}. Do not grade misses or advance material.`;
    case "reanchor_current_card":
      return `Return to the held card and re-anchor the learner on the same target.`;
    case "resume_state":
      return `Resume the same card and queue from the preserved teacher state.`;
    case "offer_resume":
      return `The socket died. Offer resume on the same card and queue.`;
    case "stop_session":
      return `Stop the live teaching session.`;
    case "finalize_session":
      return `Finalize only after session logging has been handled by the app.`;
    case "model_drift_logged":
    case "illegal_transition":
      return effect.text ?? `Log only. Do not teach, praise, reveal, or advance.`;
  }
}

export function serializeTeacherEffectForLive(effect: TeacherEffect) {
  const envelope: TeacherLiveEnvelope = {
    stateSeq: effect.stateSeq,
    expressionId: effect.expressionId,
    expectedModelAction: effect.expectedModelAction,
    effectType: effect.type,
    message: buildTeacherEffectMessage(effect),
  };

  if (effect.targetEn) {
    envelope.targetEn = effect.targetEn;
  }

  return JSON.stringify(envelope);
}

export function buildTeacherRealtimeTextInput(effect: TeacherEffect): TeacherRealtimeTextInput {
  return {
    realtimeInput: {
      text: serializeTeacherEffectForLive(effect),
    },
  };
}
