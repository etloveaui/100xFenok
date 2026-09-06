import type {
  MonaVnextProfileCoordinatorCommand,
  WindDownVoiceReportReceipt,
} from "@/features/mona-vnext/memory/learningProfileCoordinator";
import { normalizeMonaVnextLearningProfile } from "@/features/mona-vnext/memory/fsrsLearningProfile";
import type {
  WindDownLearnAction,
  WindDownLearnCard,
} from "@/features/winddown/learn/engine";
import type {
  WindDownLearnSessionManifest,
} from "@/features/winddown/server/learnSessionProof";
import type {
  WindDownCeremonyMaterialContext,
  WindDownCeremonySelection,
} from "@/features/winddown/game/model/ceremony";

import { resolveWindDownStorageScope } from "@/features/mona-vnext/memory/windDownStorageScope";
import {
  recoveryCopyNameForSnapshot,
  validateWindDownRecoverySnapshot,
  type WindDownRecoverySnapshot,
} from "@/features/mona-vnext/memory/windDownRecovery";

const COORDINATOR_BINDING = "WINDDOWN_REVIEW_COORDINATOR";

export class MonaVnextProfileCoordinatorError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "MonaVnextProfileCoordinatorError";
  }
}

type DurableObjectStubLike = {
  fetch(request: Request): Promise<Response>;
};

type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
};

function isDurableObjectNamespace(
  value: unknown,
): value is DurableObjectNamespaceLike {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { idFromName?: unknown }).idFromName === "function" &&
    typeof (value as { get?: unknown }).get === "function"
  );
}

async function coordinatorNamespace() {
  const mod = await import("@opennextjs/cloudflare");
  const { env } = await mod.getCloudflareContext({ async: true });
  const namespace = (env as Record<string, unknown>)[COORDINATOR_BINDING];
  if (!isDurableObjectNamespace(namespace)) {
    throw new Error(`${COORDINATOR_BINDING}_BINDING_MISSING`);
  }
  const scope = resolveWindDownStorageScope(
    (env as Record<string, unknown>).WINDDOWN_DATA_WORKSPACE,
  );
  return { namespace, scope };
}

async function invokeCoordinatorStub(
  stub: DurableObjectStubLike,
  command: unknown,
  pathname = "/profile-coordinator",
) {
  const response = await stub.fetch(
    new Request(`https://winddown.internal${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    }),
  );
  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!response.ok || body?.ok !== true) {
    const code =
      typeof body?.error === "string"
        ? body.error
        : "PROFILE_COORDINATOR_FAILED";
    throw new MonaVnextProfileCoordinatorError(code, response.status);
  }
  return body;
}

export async function invokeMonaVnextProfileCoordinator(
  command: MonaVnextProfileCoordinatorCommand,
) {
  const { namespace, scope } = await coordinatorNamespace();
  return invokeCoordinatorStub(namespace.get(namespace.idFromName(scope.objectName)), command);
}

export async function exportWindDownRecordsThroughCoordinator() {
  const { namespace, scope } = await coordinatorNamespace();
  const body = await invokeCoordinatorStub(
    namespace.get(namespace.idFromName(scope.objectName)),
    { operation: "export-recovery-snapshot" },
  );
  if (!validateWindDownRecoverySnapshot(body.snapshot).ok) {
    throw new MonaVnextProfileCoordinatorError("WINDDOWN_RECOVERY_SNAPSHOT_INVALID", 503);
  }
  return body.snapshot as WindDownRecoverySnapshot;
}

export async function verifyWindDownRecoveryCopyThroughCoordinator(value: unknown) {
  if (!validateWindDownRecoverySnapshot(value).ok) {
    throw new MonaVnextProfileCoordinatorError("WINDDOWN_RECOVERY_SNAPSHOT_INVALID", 400);
  }
  const snapshot = value as WindDownRecoverySnapshot;
  const { namespace } = await coordinatorNamespace();
  const name = recoveryCopyNameForSnapshot(snapshot.snapshotDigest);
  const body = await invokeCoordinatorStub(
    namespace.get(namespace.idFromName(name)),
    { operation: "restore-recovery-copy", snapshot },
    `/recovery-copy/${snapshot.snapshotDigest}`,
  );
  if (
    body.snapshotDigest !== snapshot.snapshotDigest
    || body.recordCount !== snapshot.recordCount
    || body.legacyRecordCount !== snapshot.legacyKvRecords.length
  ) {
    throw new MonaVnextProfileCoordinatorError("WINDDOWN_RECOVERY_TARGET_CORRUPT", 409);
  }
  return {
    ok: true,
    recordCount: body.recordCount,
    legacyRecordCount: body.legacyRecordCount,
    duplicate: body.duplicate === true,
  };
}

export async function readMonaVnextLearningProfileThroughCoordinator() {
  const body = await invokeMonaVnextProfileCoordinator({
    operation: "read-learning-profile",
  });
  const profile = body.profile;
  if (
    !profile ||
    typeof profile !== "object" ||
    Array.isArray(profile) ||
    (profile as Record<string, unknown>).schemaVersion !== 1 ||
    (profile as Record<string, unknown>).source !== "mona-vnext-fsrs"
  ) {
    throw new Error("PROFILE_COORDINATOR_PROFILE_INVALID");
  }
  return normalizeMonaVnextLearningProfile(profile);
}

export async function commitWindDownVoiceReportThroughCoordinator(
  receipt: WindDownVoiceReportReceipt,
) {
  return invokeMonaVnextProfileCoordinator({
    operation: "commit-voice-report",
    receipt,
  });
}

export async function readWindDownHabitThroughCoordinator(
  now = new Date(),
  ceremonyMaterial: WindDownCeremonyMaterialContext | null = null,
) {
  return invokeMonaVnextProfileCoordinator({
    operation: "read-winddown-habit",
    nowIso: now.toISOString(),
    ceremonyMaterial,
  });
}

export async function commitWindDownCeremonyChoiceThroughCoordinator(
  args: {
    selection: WindDownCeremonySelection;
    ceremonyMaterial: WindDownCeremonyMaterialContext;
  },
) {
  return invokeMonaVnextProfileCoordinator({
    operation: "commit-winddown-ceremony-choice",
    slotId: args.selection.slotId,
    optionId: args.selection.optionId,
    ceremonyMaterial: args.ceremonyMaterial,
  });
}

export async function commitWindDownLearnAttemptThroughCoordinator(args: {
  manifest: WindDownLearnSessionManifest;
  cards: WindDownLearnCard[];
  attemptId: string;
  action: WindDownLearnAction;
  now: Date;
}) {
  return invokeMonaVnextProfileCoordinator({
    operation: "commit-learn-attempt",
    manifest: args.manifest,
    cards: args.cards,
    attemptId: args.attemptId,
    action: args.action,
    nowIso: args.now.toISOString(),
  });
}
