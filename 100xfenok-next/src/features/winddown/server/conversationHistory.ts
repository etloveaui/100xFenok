import type { WindDownVoiceReportReceipt } from "@/features/mona-vnext/memory/learningProfileCoordinator";
import { getWindDownVoiceScenario, getWindDownLiveTalkTopic } from "@/features/winddown/voice/product";

export type WindDownConversationQuery = { cursor?: string; session?: string };
export type WindDownConversationSummary = {
  productSessionId: string;
  activity: "roleplay" | "live-talk";
  committedAtIso: string;
  scenarioTitle: string;
  correctionCount: number;
};
export type WindDownConversationPage = {
  ok: true;
  items: WindDownConversationSummary[];
  nextCursor: string | null;
};
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]{8,160}$/;

export function parseWindDownConversationQuery(value: unknown): WindDownConversationQuery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length > 1 || keys.some(key => key !== "cursor" && key !== "session")) return null;
  if (keys.length === 0) return {};
  const key = keys[0] as "cursor" | "session";
  const id = source[key];
  return typeof id === "string" && SAFE_SESSION_ID.test(id) ? { [key]: id } : null;
}

export function summarizeWindDownConversation(receipt: WindDownVoiceReportReceipt): WindDownConversationSummary {
  const descriptor = receipt.report.descriptor;
  const scenarioTitle = descriptor.activity === "roleplay"
    ? getWindDownVoiceScenario(descriptor.scenarioId)?.title ?? "장면 연습"
    : getWindDownLiveTalkTopic(descriptor.topicId)?.title ?? "자유 대화";
  return {
    productSessionId: receipt.productSessionId,
    activity: receipt.activity,
    committedAtIso: receipt.committedAtIso,
    scenarioTitle,
    correctionCount: receipt.report.outcome.corrections.length,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function executeWindDownConversationHistoryRequest(
  request: Request,
  deps: { authenticated(): Promise<boolean>; read(query: WindDownConversationQuery): Promise<unknown> },
): Promise<Response> {
  if (!(await deps.authenticated())) return json({ error: "ADMIN_SESSION_REQUIRED" }, 401);
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const params = new URL(request.url).searchParams;
  const queryValues: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (Object.hasOwn(queryValues, key)) return json({ error: "INVALID_CONVERSATION_QUERY" }, 400);
    queryValues[key] = value;
  }
  const query = parseWindDownConversationQuery(queryValues);
  if (!query) return json({ error: "INVALID_CONVERSATION_QUERY" }, 400);
  try {
    return json(await deps.read(query));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "WINDDOWN_CONVERSATION_NOT_FOUND") return json({ error: code }, 404);
    if (code === "INVALID_CONVERSATION_QUERY") return json({ error: code }, 400);
    return json({ error: "WINDDOWN_CONVERSATIONS_UNAVAILABLE" }, 503);
  }
}
