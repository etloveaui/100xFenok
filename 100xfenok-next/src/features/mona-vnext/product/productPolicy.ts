import type { MonaVoiceCoachSurface } from "@/features/mona-vnext/featureGates";

/**
 * Presentation may differ between product and diagnostics, but lesson
 * authority never does: both surfaces use the app-owned Teacher State Machine.
 */
export function isMonaTeacherRuntimeActive(surface: MonaVoiceCoachSurface) {
  return surface === "winddown" || surface === "debug";
}
