import {
  callMonaStudy,
  isLiveSkillBridgeConfigured,
} from "@/lib/server/admin-live-skill-bridge";
import {
  executeMonaStudyToolFunction,
  prepareMonaStudySnapshot,
  requestLessonMaterial,
  type StudySnapshot,
} from "@/lib/server/mona-study-tools";

export const MONA_STUDY_REPOSITORY_TOOL_NAMES = [
  "prepareMonaStudySnapshot",
  "saveStudySession",
  "getYesterdaySession",
  "getStudyMemory",
  "getWeeklyTestSet",
  "requestLessonMaterial",
] as const;

export type MonaStudyRepositoryToolName = typeof MONA_STUDY_REPOSITORY_TOOL_NAMES[number];
export type MonaStudyRepositorySource = "bridge" | "local";

export type MonaStudyRepositoryContext = {
  sessionId?: string | null;
  mode?: "fenok" | "mona";
  coachConfig?: Record<string, unknown>;
  coachSessionState?: unknown;
  tester?: unknown;
  noPersist?: boolean;
};

export type MonaStudyRepository = {
  source: MonaStudyRepositorySource;
  prepareSnapshot(studyDate?: string): Promise<StudySnapshot | Record<string, unknown>>;
  executeTool(
    name: MonaStudyRepositoryToolName,
    args: Record<string, unknown>,
    context?: MonaStudyRepositoryContext | null,
  ): Promise<Record<string, unknown>>;
};

function isBridgeEnvelope(value: unknown): value is { payload?: unknown } {
  return value !== null && typeof value === "object" && "payload" in value;
}

function isRepositoryError(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && "error" in value;
}

function unwrapBridgePayload(value: unknown): unknown {
  if (isRepositoryError(value)) return value;
  if (isBridgeEnvelope(value)) return value.payload;
  return value;
}

const localMonaStudyRepository: MonaStudyRepository = {
  source: "local",
  async prepareSnapshot(studyDate) {
    return prepareMonaStudySnapshot(studyDate);
  },
  async executeTool(name, args, context) {
    if (name === "prepareMonaStudySnapshot") {
      const studyDate = typeof args.studyDate === "string" ? args.studyDate : undefined;
      return prepareMonaStudySnapshot(studyDate) as Promise<Record<string, unknown>>;
    }
    if (name === "requestLessonMaterial") {
      return requestLessonMaterial(args, context) as Promise<Record<string, unknown>>;
    }
    return executeMonaStudyToolFunction(name, args, context) as Promise<Record<string, unknown>>;
  },
};

const bridgeMonaStudyRepository: MonaStudyRepository = {
  source: "bridge",
  async prepareSnapshot(studyDate) {
    const result = await callMonaStudy(
      "prepareMonaStudySnapshot",
      studyDate ? { studyDate } : {},
    );
    return unwrapBridgePayload(result) as StudySnapshot | Record<string, unknown>;
  },
  async executeTool(name, args, context) {
    return unwrapBridgePayload(await callMonaStudy(name, args, context)) as Record<string, unknown>;
  },
};

export function getMonaStudyRepository(): MonaStudyRepository {
  return isLiveSkillBridgeConfigured()
    ? bridgeMonaStudyRepository
    : localMonaStudyRepository;
}

export async function prepareMonaStudySnapshotFromRepository(studyDate?: string) {
  const repository = getMonaStudyRepository();
  const result = await repository.prepareSnapshot(studyDate);
  return {
    source: repository.source,
    snapshot: isRepositoryError(result) ? null : result as StudySnapshot,
    error: isRepositoryError(result) ? result : null,
  };
}

export async function executeMonaStudyRepositoryTool(
  name: MonaStudyRepositoryToolName,
  args: Record<string, unknown>,
  context?: MonaStudyRepositoryContext | null,
) {
  if (context?.noPersist && name === "saveStudySession") {
    return {
      ok: true,
      skipped: true,
      noPersist: true,
      studyName: name,
      source: "no-persist-guard",
      note: "saveStudySession skipped by no-persist context.",
    };
  }
  return getMonaStudyRepository().executeTool(name, args, context);
}
