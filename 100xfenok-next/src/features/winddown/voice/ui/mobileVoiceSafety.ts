import {
  WIND_DOWN_VOICE_REPORT_KEEPALIVE_MAX_BYTES,
  WIND_DOWN_VOICE_REPORT_MAX_TURNS,
} from "@/features/winddown/voice/report";

/**
 * Browser-side limits used before a final voice report is dispatched.
 *
 * Pagehide keepalive payloads are strictly capped at 48 KiB due to browser
 * Beacon/keepalive constraints. Larger valid multibyte reports (up to 256 KiB)
 * stay in the persistent localStorage outbox and upload via normal foreground fetch.
 */
export const WIND_DOWN_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
export const WIND_DOWN_MAX_SESSION_MS = 10 * 60 * 1000;
export const WIND_DOWN_MAX_FINALIZED_TURNS = WIND_DOWN_VOICE_REPORT_MAX_TURNS;
export const WIND_DOWN_KEEPALIVE_MAX_BYTES =
  WIND_DOWN_VOICE_REPORT_KEEPALIVE_MAX_BYTES;

export function windDownVoiceTimeoutDelays(input: {
  nowMs: number;
  listeningStartedAtMs: number;
  lastMeaningfulInputAtMs: number;
}) {
  return {
    idleDelayMs: Math.max(0, input.lastMeaningfulInputAtMs + WIND_DOWN_IDLE_TIMEOUT_MS - input.nowMs),
    sessionLimitDelayMs: Math.max(0, input.listeningStartedAtMs + WIND_DOWN_MAX_SESSION_MS - input.nowMs),
  };
}

/** Only a provider-confirmed turnComplete may consume this session budget. */
export function hasReachedWindDownVoiceTurnLimit(finalizedTurnCount: number) {
  return finalizedTurnCount >= WIND_DOWN_MAX_FINALIZED_TURNS;
}

/** iOS can background a page without reliably delivering pagehide first. */
export function shouldFinalizeWindDownVoiceForVisibility(
  visibilityState: DocumentVisibilityState,
) {
  return visibilityState === "hidden";
}

/**
 * JSON is encoded once and then used as the fetch body. This makes the measured
 * byte count the actual pagehide payload rather than an estimate based on JS
 * string length (which undercounts Korean and emoji text).
 */
export function serializeWindDownVoiceKeepaliveBody(report: unknown) {
  const body = JSON.stringify(report);
  const byteLength = new TextEncoder().encode(body).byteLength;
  if (byteLength > WIND_DOWN_KEEPALIVE_MAX_BYTES) {
    throw new Error("winddown_voice_report_keepalive_too_large");
  }
  return { body, byteLength };
}
