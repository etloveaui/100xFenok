export const WIND_DOWN_IDLE_ASSIST_DELAY_MS = 2_600;

type IdentifiedChoice = {
  id: string;
};

/**
 * Keep non-LLM hints deterministic: the same rendered choice order always
 * receives the same gentle elimination cue.
 */
export function firstWrongChoiceId(
  choices: readonly IdentifiedChoice[],
  correctChoiceId: string,
): string | null {
  return choices.find((choice) => choice.id !== correctChoiceId)?.id ?? null;
}

/**
 * A recall cue is intentionally smaller than the existing full-answer reveal.
 */
export function firstEnglishLetter(sentence: string): string | null {
  return sentence.match(/[A-Za-z]/)?.[0]?.toUpperCase() ?? null;
}
