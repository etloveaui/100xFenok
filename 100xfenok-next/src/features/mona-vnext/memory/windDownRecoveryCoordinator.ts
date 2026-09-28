import type { WindDownReviewCoordinatorEnv, WindDownReviewCoordinatorState } from "./learningProfileCoordinator";
import { resolveWindDownStorageScope } from "./windDownStorageScope";
import {
  WINDDOWN_RECOVERY_SEAL_KEY,
  exportWindDownRecoverySnapshot,
  recoveryCopyNameForSnapshot,
  restoreWindDownRecoverySnapshot,
} from "./windDownRecovery";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
}

/** Called before ordinary profile initialization. The Worker checks copy identity. */
export async function handleWindDownRecoveryCoordinatorRequest(
  state: WindDownReviewCoordinatorState,
  env: WindDownReviewCoordinatorEnv,
  request: Request,
  body: Record<string, unknown>,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const copy = /^\/recovery-copy\/([a-f0-9]{64})$/.exec(pathname);
  if (body.operation === "restore-recovery-copy" && !copy) {
    return json({ error: "WINDDOWN_RECOVERY_TARGET_UNSAFE" }, 403);
  }
  if (pathname.startsWith("/recovery-copy/") && (!copy || body.operation !== "restore-recovery-copy")) {
    return json({ error: "WINDDOWN_RECOVERY_COPY_READ_ONLY" }, 403);
  }
  if (!copy && await state.storage.get(WINDDOWN_RECOVERY_SEAL_KEY)) {
    return json({ error: "WINDDOWN_RECOVERY_COPY_READ_ONLY" }, 403);
  }
  if (body.operation !== "export-recovery-snapshot" && body.operation !== "restore-recovery-copy") return null;
  type RecoveryStorage = Parameters<typeof exportWindDownRecoverySnapshot>[0]["storage"];
  const storage = state.storage as unknown as RecoveryStorage;
  if (typeof storage.list !== "function") return json({ error: "WINDDOWN_RECOVERY_UNAVAILABLE" }, 503);
  try {
    if (copy) {
      const restored = await restoreWindDownRecoverySnapshot({
        storage,
        snapshot: body.snapshot,
        targetName: recoveryCopyNameForSnapshot(copy[1]),
        maxBytes: 5 * 1024 * 1024,
      });
      return json(restored);
    }
    const scope = resolveWindDownStorageScope(env.WINDDOWN_DATA_WORKSPACE);
    const snapshot = await exportWindDownRecoverySnapshot({
      storage,
      ...(scope.allowLegacySeed ? {
        legacyKv: env.MONA_VNEXT_KV,
        legacyProfileKey: scope.profileMirrorKey,
      } : {}),
      maxBytes: 5 * 1024 * 1024,
    });
    return json({ ok: true, snapshot });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const status = code === "WINDDOWN_RECOVERY_TOO_LARGE" ? 413
      : code === "WINDDOWN_RECOVERY_TARGET_INVALID" ? 403
        : code === "WINDDOWN_RECOVERY_SNAPSHOT_INVALID" ? 400
        : code === "WINDDOWN_RECOVERY_TARGET_NOT_EMPTY" || code === "WINDDOWN_RECOVERY_TARGET_CORRUPT" ? 409 : 503;
    return json({ error: code.startsWith("WINDDOWN_RECOVERY_") ? code : "WINDDOWN_RECOVERY_UNAVAILABLE" }, status);
  }
}
