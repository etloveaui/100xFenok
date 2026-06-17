export const MONA_VNEXT_GEMINI_MODELS = [
  {
    id: "gemini-3.1-flash-live-preview",
    label: "3 Flash Live",
    detail: "current default",
  },
] as const;

export type MonaVnextGeminiModel = typeof MONA_VNEXT_GEMINI_MODELS[number]["id"];

export const MONA_VNEXT_DEFAULT_GEMINI_MODEL: MonaVnextGeminiModel =
  "gemini-3.1-flash-live-preview";

export function normalizeMonaVnextGeminiModel(value: unknown): MonaVnextGeminiModel {
  return MONA_VNEXT_GEMINI_MODELS.some((model) => model.id === value)
    ? value as MonaVnextGeminiModel
    : MONA_VNEXT_DEFAULT_GEMINI_MODEL;
}
