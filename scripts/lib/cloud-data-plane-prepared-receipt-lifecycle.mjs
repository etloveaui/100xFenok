/**
 * cloud-data-plane-prepared-receipt-lifecycle.mjs — bound how long a prepared
 * publication receipt may protect a generation from retention.
 *
 * Why this exists: retention keeps the three newest generations per family, plus
 * the pointer's active and previous, plus every generation named by a receipt
 * still in state "prepared". The first three are self-limiting — a generation
 * ages out. A prepared receipt is not: the schema has exactly two states,
 * "prepared" and "promoted", with no terminal state, so an attempt that dies
 * between prepare and promote leaves a receipt that protects its objects for as
 * long as the receipt exists. That is the difference between orphan bytes that
 * are bounded in lifetime and orphan bytes that are not, and it is not visible
 * from the retention rule alone.
 *
 * The bound is a resume window: a prepared attempt may be resumed for as long as
 * it is plausibly still in flight, and after that it stops being a protection
 * root and its unreferenced objects become ordinary sweep candidates. This adds
 * no deletion authority — the existing sweep remains the only deleter. It only
 * stops an indefinite protection.
 *
 * The window length is policy, not a default. It must exceed the longest
 * legitimate resume, because expiring a receipt that a real run would still have
 * resumed would let the sweep delete objects that attempt still needs. So there
 * is no fallback value here: an absent window fails closed rather than guessing
 * one, and every expired receipt is enumerated rather than silently dropped.
 */

export const PREPARED_RECEIPT_LIFECYCLE_SCHEMA = "cloud-data-plane-prepared-receipt-lifecycle/v1";

function fail(message) {
  throw new Error(`prepared receipt lifecycle: ${message}`);
}

function instantMs(value, context) {
  if (typeof value !== "string" || value.length === 0) fail(`${context} is required`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(`${context} is not a parsable instant: ${value}`);
  return parsed;
}

/**
 * Split prepared receipts into those still inside the resume window and those
 * past it.
 *
 * `receipts` is the coordinator inspection's receipt list, unfiltered — this
 * function owns the state filter as well, so a caller cannot accidentally apply
 * the window to promoted receipts or skip it for prepared ones.
 */
export function classifyPreparedReceipts({ receipts, now, resumeWindowSeconds } = {}) {
  if (!Array.isArray(receipts)) fail("receipts must be an array");
  if (!Number.isFinite(resumeWindowSeconds) || resumeWindowSeconds <= 0) {
    fail("resumeWindowSeconds is required and must be positive; refusing to guess a resume window");
  }
  const nowMs = instantMs(now, "now");

  const live = [];
  const expired = [];
  const clockAnomalies = [];
  for (const receipt of receipts) {
    if (receipt?.state !== "prepared") continue;
    const generationId = receipt.generation_id;
    if (typeof generationId !== "string" || generationId.length === 0) {
      fail("a prepared receipt has no generation_id; refusing to classify an unattributable protection root");
    }
    const createdMs = instantMs(receipt.created_at, `receipt ${receipt.receipt_id ?? generationId} created_at`);
    const ageSeconds = (nowMs - createdMs) / 1000;
    // A receipt created in the future is a clock fault, not an expiry. Treating
    // it as live is the safe direction: it protects bytes rather than exposing
    // them to deletion on a bad clock. But safe is not silent — an unreported
    // future timestamp is an indefinite protection root that nobody is looking
    // at, so the anomaly is surfaced even though the handling is permissive.
    if (ageSeconds < 0) {
      clockAnomalies.push({
        receipt_id: receipt.receipt_id ?? null,
        generation_id: generationId,
        created_at: receipt.created_at,
        ahead_seconds: Math.ceil(-ageSeconds),
        effect: "retained_as_live_despite_future_timestamp",
      });
    }
    if (ageSeconds > resumeWindowSeconds) {
      expired.push({
        receipt_id: receipt.receipt_id ?? null,
        generation_id: generationId,
        created_at: receipt.created_at,
        age_seconds: Math.floor(ageSeconds),
      });
    } else {
      live.push(generationId);
    }
  }

  const liveGenerations = [...new Set(live)].sort();
  expired.sort((left, right) => (left.generation_id < right.generation_id ? -1 : left.generation_id > right.generation_id ? 1 : 0));

  // An expired receipt whose generation is also protected by a live receipt is
  // not actually losing protection; reporting it as expired without that
  // distinction would overstate what the window released.
  const liveSet = new Set(liveGenerations);
  const releasedGenerations = [...new Set(expired.map((row) => row.generation_id).filter((id) => !liveSet.has(id)))].sort();

  clockAnomalies.sort((left, right) => (left.generation_id < right.generation_id ? -1 : left.generation_id > right.generation_id ? 1 : 0));

  return {
    schema_version: PREPARED_RECEIPT_LIFECYCLE_SCHEMA,
    resume_window_seconds: resumeWindowSeconds,
    now,
    live_generations: liveGenerations,
    expired_receipts: expired,
    released_generations: releasedGenerations,
    clock_anomalies: clockAnomalies,
  };
}
