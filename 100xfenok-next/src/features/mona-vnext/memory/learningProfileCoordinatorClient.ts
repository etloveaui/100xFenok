import type {
  MonaVnextProfileCoordinatorCommand,
  WindDownVoiceReportReceipt,
} from "@/features/mona-vnext/memory/learningProfileCoordinator";
import { normalizeMonaVnextLearningProfile } from "@/features/mona-vnext/memory/fsrsLearningProfile";
import type { MonaVnextLearningEvent } from "@/features/mona-vnext/memory/srsBridge";

const COORDINATOR_BINDING = "WINDDOWN_REVIEW_COORDINATOR";
const COORDINATOR_OBJECT_NAME = "mona-vnext-learning-profile-v1";

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
  return namespace;
}

export async function invokeMonaVnextProfileCoordinator(
  command: MonaVnextProfileCoordinatorCommand,
) {
  const namespace = await coordinatorNamespace();
  const stub = namespace.get(namespace.idFromName(COORDINATOR_OBJECT_NAME));
  const response = await stub.fetch(
    new Request("https://winddown.internal/profile-coordinator", {
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

export async function appendMonaVnextLearningEventsThroughCoordinator(
  learningEvents: MonaVnextLearningEvent[],
) {
  return invokeMonaVnextProfileCoordinator({
    operation: "append-learning-events",
    learningEvents,
  });
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
