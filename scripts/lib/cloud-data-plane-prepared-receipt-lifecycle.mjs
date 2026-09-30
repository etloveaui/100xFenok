// A prepared publication protects its generation during the explicit resume
// window. Expiry adds no deletion authority; the retention reference scan and
// pointer/rollback protections still decide which objects may be removed.

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
  for (const receipt of receipts) {
    if (receipt?.state !== "prepared") continue;
    const generationId = receipt.generation_id;
    if (typeof generationId !== "string" || generationId.length === 0) {
      fail("a prepared receipt has no generation_id; refusing to classify an unattributable protection root");
    }
    const createdMs = instantMs(receipt.created_at, `receipt ${receipt.receipt_id ?? generationId} created_at`);
    const ageSeconds = (nowMs - createdMs) / 1000;
    // A future timestamp protects bytes; it cannot make a record expire early.
    if (ageSeconds <= resumeWindowSeconds) live.push(generationId);
  }

  return { live_generations: [...new Set(live)].sort() };
}
