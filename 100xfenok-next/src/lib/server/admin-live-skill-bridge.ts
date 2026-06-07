export const LIVE_SKILL_BRIDGE_URL_ENV = "FENO_SKILL_BRIDGE_URL";
export const LIVE_SKILL_BRIDGE_TOKEN_ENV = "FENO_SKILL_BRIDGE_TOKEN";

export type LiveSkillBridgeToolId = "feno-search" | "naver-search" | "kakao-search";

type LiveSkillBridgeConfig = {
  endpoint: string;
  token: string;
};

type BridgePayload = {
  tool: LiveSkillBridgeToolId;
  query: string;
  maxResults: number;
  strategy?: "quality" | "speed";
  provider?: "auto" | "brave" | "tavily";
  category?: "market" | "news" | "weather" | "economic_calendar" | "general";
  type?: string;
};

const MAX_QUERY_LENGTH = 500;
const DEFAULT_MAX_RESULTS = 5;
const LIVE_SKILL_BRIDGE_TIMEOUT_MS = 8_000;
const VALID_STRATEGIES = new Set(["quality", "speed"]);
const VALID_FENO_PROVIDERS = new Set(["auto", "brave", "tavily"]);
const VALID_CATEGORIES = new Set(["market", "news", "weather", "economic_calendar", "general"]);
const VALID_NAVER_TYPES = new Set([
  "web",
  "news",
  "blog",
  "shop",
  "image",
  "local",
  "book",
  "kin",
  "cafe",
  "doc",
  "encyc",
]);
const VALID_KAKAO_TYPES = new Set(["web", "blog", "place", "image", "vclip", "book", "cafe"]);

function readNonEmptyEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEndpoint(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function getLiveSkillBridgeConfig(): LiveSkillBridgeConfig | null {
  const endpoint = normalizeEndpoint(readNonEmptyEnv(LIVE_SKILL_BRIDGE_URL_ENV));
  const token = readNonEmptyEnv(LIVE_SKILL_BRIDGE_TOKEN_ENV);
  if (!endpoint || !token) return null;
  return { endpoint, token };
}

export function isLiveSkillBridgeConfigured(): boolean {
  return getLiveSkillBridgeConfig() !== null;
}

function normalizeQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const query = value.trim().replace(/\s+/g, " ");
  if (!query) return null;
  return query.slice(0, MAX_QUERY_LENGTH);
}

function normalizeMaxResults(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_RESULTS;
  return Math.min(5, Math.max(1, Math.floor(value)));
}

function pickEnum<T extends string>(value: unknown, allowed: Set<string>, fallback?: T): T | undefined {
  if (typeof value === "string" && allowed.has(value)) return value as T;
  return fallback;
}

function buildBridgePayload(tool: LiveSkillBridgeToolId, args: Record<string, unknown>): BridgePayload | { error: string } {
  const query = normalizeQuery(args.query);
  if (!query) return { error: "QUERY_REQUIRED" };

  const payload: BridgePayload = {
    tool,
    query,
    maxResults: normalizeMaxResults(args.maxResults),
  };
  const strategy = pickEnum<"quality" | "speed">(args.strategy, VALID_STRATEGIES);
  if (strategy) payload.strategy = strategy;

  if (tool === "feno-search") {
    payload.provider = pickEnum<"auto" | "brave" | "tavily">(args.provider, VALID_FENO_PROVIDERS, "auto");
    const category = pickEnum<BridgePayload["category"] & string>(args.category, VALID_CATEGORIES);
    if (category) payload.category = category;
  }

  if (tool === "naver-search") {
    payload.type = pickEnum(args.type, VALID_NAVER_TYPES, "web");
  }

  if (tool === "kakao-search") {
    payload.type = pickEnum(args.type, VALID_KAKAO_TYPES, "web");
  }

  return payload;
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function callLiveSkillBridge(tool: LiveSkillBridgeToolId, args: Record<string, unknown>) {
  const config = getLiveSkillBridgeConfig();
  if (!config) {
    return {
      error: "SKILL_BRIDGE_NOT_CONFIGURED",
      missingEnv: [LIVE_SKILL_BRIDGE_URL_ENV, LIVE_SKILL_BRIDGE_TOKEN_ENV],
    };
  }

  const payload = buildBridgePayload(tool, args);
  if ("error" in payload) return payload;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIVE_SKILL_BRIDGE_TIMEOUT_MS);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(payload),
    });

    const body = await readJsonOrText(response);
    if (!response.ok) {
      return {
        error: "SKILL_BRIDGE_HTTP_FAILED",
        status: response.status,
        body,
      };
    }

    return {
      bridge: "mac-mini",
      fetchedAt: new Date().toISOString(),
      payload: body,
    };
  } catch (error) {
    return {
      error: isAbortError(error)
        ? "SKILL_BRIDGE_TIMEOUT"
        : "SKILL_BRIDGE_REQUEST_FAILED",
      message: errorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

const VALID_MONA_STUDY_NAMES = new Set([
  "prepareMonaStudySnapshot",
  "saveStudySession",
  "getYesterdaySession",
  "getStudyMemory",
  "getWeeklyTestSet",
]);

export async function callMonaStudy(name: string, args: Record<string, unknown>) {
  const config = getLiveSkillBridgeConfig();
  if (!config) {
    return {
      error: "SKILL_BRIDGE_NOT_CONFIGURED",
      missingEnv: [LIVE_SKILL_BRIDGE_URL_ENV, LIVE_SKILL_BRIDGE_TOKEN_ENV],
    };
  }

  if (typeof name !== "string" || !VALID_MONA_STUDY_NAMES.has(name)) {
    return { error: "UNKNOWN_STUDY_NAME", name, valid: [...VALID_MONA_STUDY_NAMES] };
  }

  if (args !== null && typeof args !== "object") {
    return { error: "INVALID_ARGS" };
  }

  const studyUrl = new URL("/live-study", config.endpoint).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIVE_SKILL_BRIDGE_TIMEOUT_MS);
  try {
    const response = await fetch(studyUrl, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({ name, args }),
    });

    const body = await readJsonOrText(response);
    if (!response.ok) {
      return {
        error: "SKILL_BRIDGE_HTTP_FAILED",
        status: response.status,
        body,
      };
    }

    return {
      bridge: "mac-mini",
      studyName: name,
      fetchedAt: new Date().toISOString(),
      payload: body,
    };
  } catch (error) {
    return {
      error: isAbortError(error)
        ? "SKILL_BRIDGE_TIMEOUT"
        : "SKILL_BRIDGE_REQUEST_FAILED",
      message: errorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}
