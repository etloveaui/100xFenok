import { getTickerQuote } from "@/lib/server/ticker";
import { readPublicAssetText } from "@/lib/server/public-assets";
import {
  MONA_STUDY_TOOL_IDS,
  requestLessonMaterial,
} from "@/lib/server/mona-study-tools";
import {
  LIVE_SKILL_BRIDGE_TOKEN_ENV,
  LIVE_SKILL_BRIDGE_URL_ENV,
  callLiveSkillBridge,
  callMonaStudy,
  isLiveSkillBridgeConfigured,
} from "@/lib/server/admin-live-skill-bridge";
import type { LiveToolSessionContext } from "@/lib/server/admin-live-session-context";

export type LiveToolId =
  | "market-data"
  | "feno-data"
  | "feno-search"
  | "google-search"
  | "naver-search"
  | "kakao-search"
  | "camera"
  | "mona-save-session"
  | "mona-yesterday"
  | "mona-memory"
  | "mona-weekly-test"
  | "mona-lesson-material"
  | "mona-show-card";
export type LiveToolCategory = "data" | "search" | "vision" | "dialog-mode" | "study";
export type LiveToolStatus = "available" | "locked" | "soon";

type LiveToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type LiveToolDefinition = {
  id: LiveToolId;
  label: string;
  category: LiveToolCategory;
  status: LiveToolStatus;
  description: string;
  reason?: string;
  functionName?: string;
  instruction?: string;
  declaration?: LiveToolDeclaration;
};

export type LiveToolMetadata = Pick<
  LiveToolDefinition,
  "id" | "label" | "category" | "status" | "description" | "reason"
>;

const SYMBOL_PATTERN = /^[A-Z0-9.\-]{1,12}$/;
const FENO_SCOUTER_COMPANY_PATH = "/data/global-scouter/raw/companies_a_company.json";
const FENO_SCOUTER_ETF_PATH = "/data/global-scouter/raw/etfs_m_etfs.json";
const FENO_COMPUTED_SIGNALS_PATH = "/data/computed/signals.json";
const FENO_13F_BY_TICKER_PATH = "/data/sec-13f/by_ticker.json";
const FENO_13F_SUMMARY_PATH = "/data/sec-13f/summary.json";
const FENO_DETAIL_SECTIONS = [
  "overview",
  "valuation",
  "growth",
  "profitability",
  "cash_flow",
  "per_share",
  "holders",
  "signals",
] as const;
const SKILL_BRIDGE_CONFIGURED = isLiveSkillBridgeConfigured();
const SKILL_BRIDGE_STATUS: LiveToolStatus = SKILL_BRIDGE_CONFIGURED ? "available" : "soon";
const SKILL_BRIDGE_REASON = SKILL_BRIDGE_CONFIGURED
  ? undefined
  : `맥미니 skill bridge env 설정 필요: ${LIVE_SKILL_BRIDGE_URL_ENV}, ${LIVE_SKILL_BRIDGE_TOKEN_ENV}`;

export const LIVE_SEARCH_SELECTION_POLICY = "multi" as const;

const LIVE_TOOL_DEFINITIONS = [
  {
    id: "mona-save-session",
    label: "세션 저장",
    category: "study",
    status: "available",
    description: "Mona Wind-Down BEST3/weak-note checkpoint",
    functionName: "saveStudySession",
    instruction:
      "Tool: saveStudySession({best3, weakMisses, theme, summary, reviewResults}) stores Mona Wind-Down study checkpoints using the server-side Asia/Seoul studyDate. Call after today's expression block, after the variable corner, and at final BEST3. Do not invent file paths or dates. Keep the spoken acknowledgement to one soft sentence. For weakMisses: correct=the right English expression, tried=what Mona actually said (may be wrong), ko=Korean meaning. reviewResults: report EVERY warmup/review item Mona attempted this session with result correct|wrong (3-second rule).",
    declaration: {
      name: "saveStudySession",
      description:
        "Idempotently upsert today's Mona English study checkpoint. The server decides the canonical studyDate with Asia/Seoul 04:00 cutoff.",
      parameters: {
        type: "OBJECT",
        properties: {
          theme: { type: "STRING", description: "Optional short theme label." },
          summary: { type: "STRING", description: "Optional short session summary." },
          best3: {
            type: "ARRAY",
            description: "Up to three useful expressions from this checkpoint.",
            items: {
              type: "OBJECT",
              properties: {
                ko: { type: "STRING", description: "Korean prompt." },
                en: { type: "STRING", description: "Natural English expression." },
                note: { type: "STRING", description: "Optional pronunciation or usage note." },
              },
              required: ["ko", "en"],
            },
          },
          weakMisses: {
            type: "ARRAY",
            description: "Expressions Mona repeatedly missed.",
            items: {
              type: "OBJECT",
              properties: {
                ko: { type: "STRING", description: "Korean meaning." },
                tried: { type: "STRING", description: "What Mona actually said (may be wrong)." },
                correct: { type: "STRING", description: "Natural English answer." },
                note: { type: "STRING", description: "Optional short reason or pronunciation note." },
              },
              required: ["correct", "ko"],
            },
          },
          reviewResults: {
            type: "ARRAY",
            description: "Warmup/review items Mona attempted this session with correct|wrong result. Max 40.",
            items: {
              type: "OBJECT",
              properties: {
                en: { type: "STRING", description: "The English expression tested." },
                result: { type: "STRING", description: "correct or wrong.", enum: ["correct", "wrong"] },
              },
              required: ["en", "result"],
            },
          },
        },
      },
    },
  },
  {
    id: "mona-yesterday",
    label: "어제 세션",
    category: "study",
    status: "available",
    description: "Yesterday BEST3 and weak-note warmup",
    functionName: "getYesterdaySession",
    instruction:
      "Tool: getYesterdaySession() returns the latest previous Mona study session from the server snapshot. If empty, skip warmup and start today's expression block. Never ask the user which corner to run.",
    declaration: {
      name: "getYesterdaySession",
      description: "Read the latest previous Mona Wind-Down session for warmup.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
  },
  {
    id: "mona-memory",
    label: "표현집·약점",
    category: "study",
    status: "available",
    description: "Mona cumulative BEST3 and weak notes",
    functionName: "getStudyMemory",
    instruction:
      "Tool: getStudyMemory({scope, limit}) returns cached Mona BEST3 and weak notes. Use it only when extra reuse material is needed; do not stall the conversation.",
    declaration: {
      name: "getStudyMemory",
      description: "Read cached Mona study memory from setup snapshot.",
      parameters: {
        type: "OBJECT",
        properties: {
          scope: {
            type: "STRING",
            description: "all, best3, or weak.",
            enum: ["all", "best3", "weak"],
          },
          limit: {
            type: "NUMBER",
            description: "Maximum entries per list. Defaults to 12, capped at 30.",
          },
        },
      },
    },
  },
  {
    id: "mona-weekly-test",
    label: "주간 테스트",
    category: "study",
    status: "available",
    description: "Sunday random recall set from memory",
    functionName: "getWeeklyTestSet",
    instruction:
      "Tool: getWeeklyTestSet({count, weakBias}) returns a random weekly recall set from existing Mona memory. On Sunday, use the returned count as-is; if fewer than requested, do not invent new items.",
    declaration: {
      name: "getWeeklyTestSet",
      description: "Build a weekly recall set from saved Mona BEST3 and weak notes.",
      parameters: {
        type: "OBJECT",
        properties: {
          count: {
            type: "NUMBER",
            description: "Requested item count. Defaults to 30 and caps at 50.",
          },
          weakBias: {
            type: "BOOLEAN",
            description: "Prioritize weak-note items first. Defaults true.",
          },
        },
      },
    },
  },
  {
    id: "mona-lesson-material",
    label: "요청형 문장",
    category: "study",
    status: "available",
    description: "Buffer-first Mona material picker for new/easier/harder/again requests",
    functionName: "requestLessonMaterial",
    instruction:
      "Tool: requestLessonMaterial({intent, theme}) fetches lesson material only when the learner asks for new/more/next/different/too-hard/too-easy/again/switch topic and the setup nextMaterialBuffer cannot answer instantly. Prefer nextMaterialBuffer first for new/more/next; call this tool for empty buffer, easier/harder, again, switch_theme, or server-confirmed dedup. If it returns no items, use the buffer or simplify the current sentence once and continue without a long apology.",
    declaration: {
      name: "requestLessonMaterial",
      description:
        "Fetch Mona lesson material. Invoke UNMISTAKABLY whenever the learner asks for new, more, next, different, easier, harder, again, or a different topic (Korean examples: 새로운거, 더, 다음거, 쉬운거, 어려운거, 딴거). Prefer nextMaterialBuffer before calling for plain new/more/next.",
      parameters: {
        type: "OBJECT",
        properties: {
          intent: {
            type: "STRING",
            description: "Learner intent.",
            enum: ["new", "easier", "harder", "again", "switch_theme"],
          },
          theme: {
            type: "STRING",
            description: "Optional requested theme for switch_theme, e.g. work, family-friends, selftalk-emotion, out-shopping-dining, free.",
          },
        },
        required: ["intent"],
      },
    },
  },
  {
    id: "mona-show-card",
    label: "표현 카드",
    category: "study",
    status: "available",
    description: "Mona Wind-Down BEST3/weak-note checkpoint",
    functionName: "showCard",
    instruction:
      '화면 표현 카드는 반드시 실제 function call showCard({...})로만 제어한다. "showCard", "state=prompt/reveal/drill/clear", 호출 계획, 카드 상태 설명을 절대 말로 출력하지 마. 모나가 시도하기 전엔 state=prompt(ko 필수), 교정 뒤엔 state=reveal(ko+en 필수), 변형 드릴은 state=drill(ko 필수, drillHint 선택), 카드 치울 땐 state=clear. 인자가 부족하면 INVALID_CARD로 실패한다.',
    declaration: {
      name: "showCard",
      description: "Control the on-screen expression card for Mona Wind-Down practice.",
      parameters: {
        type: "OBJECT",
        properties: {
          state: {
            type: "STRING",
            description: "Card state: prompt (before attempt), reveal (after correction), drill (transform practice), clear (dismiss).",
            enum: ["prompt", "reveal", "drill", "clear"],
          },
          ko: {
            type: "STRING",
            description: "Korean sentence. Required unless state=clear.",
          },
          en: {
            type: "STRING",
            description: "English sentence. Required for reveal state.",
          },
          pron: {
            type: "STRING",
            description: "Korean-letter pronunciation hint. Optional.",
          },
          drillHint: {
            type: "STRING",
            description: "Short transform instruction, e.g. '과거형으로'. Optional, for drill state.",
          },
        },
        required: ["state"],
      },
    },
  },
  {
    id: "feno-data",
    label: "Feno Data",
    category: "data",
    status: "available",
    description: "Global Scouter, computed signals, SEC 13F local context",
    functionName: "getFenoTickerContext",
    instruction:
      "Tool: getFenoTickerContext({symbol, section}) reads local 100xFenok Global Scouter, computed signals, and SEC 13F data. Use it for ticker context, holders, and signal questions. It is not live web search; state source dates and missing coverage.",
    declaration: {
      name: "getFenoTickerContext",
      description:
        "Read compact local 100xFenok context for one ticker from Global Scouter, computed signals, and SEC 13F files.",
      parameters: {
        type: "OBJECT",
        properties: {
          symbol: {
            type: "STRING",
            description: "Ticker symbol such as AAPL, NVDA, SPY, or QQQ.",
          },
          section: {
            type: "STRING",
            description: "Optional focused section. Defaults to overview.",
            enum: FENO_DETAIL_SECTIONS,
          },
        },
        required: ["symbol"],
      },
    },
  },
  {
    id: "feno-search",
    label: "Feno Search",
    category: "search",
    status: SKILL_BRIDGE_STATUS,
    description: "Brave/Tavily search skill bridge",
    reason: SKILL_BRIDGE_REASON,
    functionName: "searchFenoWeb",
    instruction:
      "Tool: searchFenoWeb({query, provider, category, strategy, maxResults}) calls the Mac mini skill bridge for Brave/Tavily current web search. Use it only for facts that need live verification and cite returned sources; do not claim search ran if the tool returns an error.",
    declaration: {
      name: "searchFenoWeb",
      description: "Search current web information through the Mac mini feno-search bridge using Brave/Tavily.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Specific search query. Include entity, timeframe, and region when useful.",
          },
          provider: {
            type: "STRING",
            description: "Optional provider preference.",
            enum: ["auto", "brave", "tavily"],
          },
          category: {
            type: "STRING",
            description: "Optional category hint.",
            enum: ["market", "news", "weather", "economic_calendar", "general"],
          },
          strategy: {
            type: "STRING",
            description: "quality for user-facing answers; speed for quick checks.",
            enum: ["quality", "speed"],
          },
          maxResults: {
            type: "NUMBER",
            description: "Maximum results, 1 to 5. Defaults to 5.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    id: "google-search",
    label: "Google",
    category: "search",
    status: "locked",
    description: "Google/Gemini search path",
    reason: "Gemini Live grounding은 현재 보류",
  },
  {
    id: "naver-search",
    label: "Naver",
    category: "search",
    status: SKILL_BRIDGE_STATUS,
    description: "Naver search skill bridge",
    reason: SKILL_BRIDGE_REASON,
    functionName: "searchNaverWeb",
    instruction:
      "Tool: searchNaverWeb({query, type, strategy, maxResults}) calls the Mac mini Naver bridge. Prefer it for Korean web/news/blog/shop/image/local/book/kin/cafe/doc/encyc lookups. Cite returned sources and label weak or missing results.",
    declaration: {
      name: "searchNaverWeb",
      description: "Search Naver through the Mac mini bridge.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Korean or English Naver search query.",
          },
          type: {
            type: "STRING",
            description: "Naver vertical to search.",
            enum: ["web", "news", "blog", "shop", "image", "local", "book", "kin", "cafe", "doc", "encyc"],
          },
          strategy: {
            type: "STRING",
            description: "quality for user-facing answers; speed for quick checks.",
            enum: ["quality", "speed"],
          },
          maxResults: {
            type: "NUMBER",
            description: "Maximum results, 1 to 5. Defaults to 5.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    id: "kakao-search",
    label: "Kakao",
    category: "search",
    status: SKILL_BRIDGE_STATUS,
    description: "Kakao/Daum search skill bridge",
    reason: SKILL_BRIDGE_REASON,
    functionName: "searchKakaoWeb",
    instruction:
      "Tool: searchKakaoWeb({query, type, strategy, maxResults}) calls the Mac mini Kakao/Daum bridge. Prefer it for Korean web/blog/place/image/video/book/cafe lookups and place-style queries. Cite returned sources and label weak or missing results.",
    declaration: {
      name: "searchKakaoWeb",
      description: "Search Kakao/Daum through the Mac mini bridge.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Korean or English Kakao/Daum search query.",
          },
          type: {
            type: "STRING",
            description: "Kakao/Daum vertical to search.",
            enum: ["web", "blog", "place", "image", "vclip", "book", "cafe"],
          },
          strategy: {
            type: "STRING",
            description: "quality for user-facing answers; speed for quick checks.",
            enum: ["quality", "speed"],
          },
          maxResults: {
            type: "NUMBER",
            description: "Maximum results, 1 to 5. Defaults to 5.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    id: "camera",
    label: "카메라",
    category: "vision",
    status: "soon",
    description: "모바일 카메라/이미지 입력",
    reason: "Android/iOS capture flow 설계 후 활성화",
  },
] satisfies LiveToolDefinition[];

const TOOL_BY_ID = new Map<LiveToolId, LiveToolDefinition>(
  LIVE_TOOL_DEFINITIONS.map((tool) => [tool.id, tool]),
);
const TOOL_BY_FUNCTION_NAME = new Map<string, LiveToolDefinition>(
  LIVE_TOOL_DEFINITIONS
    .filter((tool) => tool.functionName)
    .map((tool) => [tool.functionName as string, tool]),
);

export const DEFAULT_LIVE_ENABLED_TOOL_IDS: LiveToolId[] = [];

export function getDefaultLiveEnabledToolIds(mode: string): LiveToolId[] {
  if (mode === "fenok") return ["feno-data"];
  return mode === "mona" ? [...MONA_STUDY_TOOL_IDS, "mona-show-card"] : [];
}

export function getLiveToolMetadata(): LiveToolMetadata[] {
  return LIVE_TOOL_DEFINITIONS.map(({ id, label, category, status, description, reason }) => ({
    id,
    label,
    category,
    status,
    description,
    reason,
  }));
}

export function normalizeLiveToolIds(value: unknown): LiveToolId[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<LiveToolId>();
  value.forEach((item) => {
    if (typeof item !== "string") return;
    const tool = TOOL_BY_ID.get(item as LiveToolId);
    if (!tool || tool.status !== "available") return;
    seen.add(tool.id);
  });

  return [...seen];
}

export function buildLiveToolInstructions(enabledToolIds: LiveToolId[]): string[] {
  return enabledToolIds
    .map((toolId) => {
      const tool = TOOL_BY_ID.get(toolId);
      return tool?.status === "available" ? tool.instruction : undefined;
    })
    .filter((instruction): instruction is string => Boolean(instruction));
}

export function buildLiveToolDeclarations(enabledToolIds: LiveToolId[]): LiveToolDeclaration[] {
  return enabledToolIds
    .map((toolId) => {
      const tool = TOOL_BY_ID.get(toolId);
      return tool?.status === "available" ? tool.declaration : undefined;
    })
    .filter((declaration): declaration is LiveToolDeclaration => Boolean(declaration));
}

function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

type FenoDetailSection = (typeof FENO_DETAIL_SECTIONS)[number];
type JsonRecord = Record<string, unknown>;
const PUBLIC_JSON_CACHE = new Map<string, Promise<unknown>>();

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readPublicJson(pathname: string): Promise<unknown> {
  const cached = PUBLIC_JSON_CACHE.get(pathname);
  if (cached) return cached;

  const promise = readPublicAssetText(pathname)
    .then((raw) => JSON.parse(raw) as unknown)
    .catch((error) => {
      PUBLIC_JSON_CACHE.delete(pathname);
      throw error;
    });
  PUBLIC_JSON_CACHE.set(pathname, promise);
  return promise;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pick(record: JsonRecord | null, key: string): unknown {
  return record ? record[key] : null;
}

function pickString(record: JsonRecord | null, key: string): string | null {
  return getString(pick(record, key));
}

function pickNumber(record: JsonRecord | null, key: string): number | null {
  return getNumber(pick(record, key));
}

function pickObject(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function pickArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function compactObject<T extends JsonRecord>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  ) as Partial<T>;
}

function normalizeFenoSection(value: unknown): FenoDetailSection {
  if (typeof value !== "string") return "overview";
  return FENO_DETAIL_SECTIONS.includes(value as FenoDetailSection)
    ? value as FenoDetailSection
    : "overview";
}

function findGlobalScouterCompany(raw: unknown, symbol: string) {
  if (!isRecord(raw)) return { meta: null, company: null };

  const columns = pickArray(raw.columns)
    .filter(isRecord)
    .map((column) => getString(column.key) ?? "");
  const tickerIndex = columns.indexOf("ticker");
  const records = pickArray(raw.records).filter(isRecord);
  const row = records.find((record) => {
    const key = getString(record.key)?.toUpperCase();
    if (key === symbol) return true;
    const values = pickArray(record.values);
    return getString(values[tickerIndex])?.toUpperCase() === symbol;
  });

  if (!row) {
    return {
      meta: compactObject({
        generatedAt: getString(raw.generated_at),
        sourceDate: getString(raw.source_date),
        recordCount: getNumber(raw.count),
      }),
      company: null,
    };
  }

  const values = pickArray(row.values);
  const company = columns.reduce<JsonRecord>((acc, key, index) => {
    if (!key || key.startsWith("col_")) return acc;
    acc[key] = values[index] ?? null;
    return acc;
  }, {});

  return {
    meta: compactObject({
      generatedAt: getString(raw.generated_at),
      sourceDate: getString(raw.source_date),
      recordCount: getNumber(raw.count),
    }),
    company,
  };
}

function findGlobalScouterEtf(raw: unknown, symbol: string) {
  if (!isRecord(raw)) return { meta: null, etf: null };

  const columns = pickArray(raw.columns)
    .filter(isRecord)
    .map((column) => getString(column.key) ?? "");
  const tickerIndex = columns.indexOf("ticker");
  const records = pickArray(raw.records).filter(isRecord);
  const row = records.find((record) => {
    const key = getString(record.key)?.toUpperCase();
    if (key === symbol) return true;
    const values = pickArray(record.values);
    return getString(values[tickerIndex])?.toUpperCase() === symbol;
  });

  if (!row) {
    return {
      meta: compactObject({
        generatedAt: getString(raw.generated_at),
        sourceDate: getString(raw.source_date),
        recordCount: getNumber(raw.count),
      }),
      etf: null,
    };
  }

  const values = pickArray(row.values);
  const etf = columns.reduce<JsonRecord>((acc, key, index) => {
    if (!key || key.startsWith("col_")) return acc;
    acc[key] = values[index] ?? null;
    return acc;
  }, {});

  return {
    meta: compactObject({
      generatedAt: getString(raw.generated_at),
      sourceDate: getString(raw.source_date),
      recordCount: getNumber(raw.count),
    }),
    etf,
  };
}

function pickEstimateBlock(detail: JsonRecord | null, key: string) {
  const value = pickObject(pick(detail, key));
  return value ? compactObject(value) : null;
}

function pickEstimateNumber(detail: JsonRecord | null, blockKey: string, metricKey: string, yearKey: string) {
  const block = pickObject(pick(detail, blockKey));
  const metric = pickObject(block?.[metricKey]);
  return getNumber(metric?.[yearKey]);
}

function buildScouterDetail(detailRaw: unknown, section: FenoDetailSection) {
  const detail = pickObject(detailRaw);
  if (!detail) return null;

  if (section === "overview") {
    return compactObject({
      years: pickArray(detail.years),
      forwardHighlights: compactObject({
        perFy1: pickEstimateNumber(detail, "valuation_estimates", "per", "fy1"),
        perFy2: pickEstimateNumber(detail, "valuation_estimates", "per", "fy2"),
        pbrFy1: pickEstimateNumber(detail, "valuation_estimates", "pbr", "fy1"),
        revenueGrowthFy1: pickEstimateNumber(detail, "growth_estimates", "revenue_growth", "fy1"),
        epsGrowthFy1: pickEstimateNumber(detail, "growth_estimates", "eps_growth", "fy1"),
        operatingMarginFy1: pickEstimateNumber(detail, "profitability_estimates", "operating_margin", "fy1"),
        roeFy1: pickEstimateNumber(detail, "profitability_estimates", "roe", "fy1"),
        epsFy1: pickEstimateNumber(detail, "per_share_estimates", "eps", "fy1"),
        epsFy2: pickEstimateNumber(detail, "per_share_estimates", "eps", "fy2"),
      }),
    });
  }

  if (section === "valuation") {
    return compactObject({
      years: pickArray(detail.years),
      valuation: pickEstimateBlock(detail, "valuation"),
      valuationEstimates: pickEstimateBlock(detail, "valuation_estimates"),
    });
  }

  if (section === "growth") {
    return compactObject({
      years: pickArray(detail.years),
      growth: pickEstimateBlock(detail, "growth"),
      growthEstimates: pickEstimateBlock(detail, "growth_estimates"),
    });
  }

  if (section === "profitability") {
    return compactObject({
      years: pickArray(detail.years),
      profitability: pickEstimateBlock(detail, "profitability"),
      profitabilityEstimates: pickEstimateBlock(detail, "profitability_estimates"),
    });
  }

  if (section === "cash_flow") {
    return compactObject({
      years: pickArray(detail.years),
      cashFlow: pickEstimateBlock(detail, "cash_flow"),
      cashFlowEstimates: pickEstimateBlock(detail, "cash_flow_estimates"),
    });
  }

  if (section === "per_share") {
    return compactObject({
      years: pickArray(detail.years),
      perShare: pickEstimateBlock(detail, "per_share"),
      perShareEstimates: pickEstimateBlock(detail, "per_share_estimates"),
    });
  }

  if (section === "holders" || section === "signals") {
    return null;
  }

  return compactObject({
    years: pickArray(detail.years),
  });
}

function buildCompanySummary(company: JsonRecord | null) {
  if (!company) return null;

  return compactObject({
    symbol: pickString(company, "ticker"),
    name: pickString(company, "corp"),
    exchange: pickString(company, "exchange"),
    sector: pickString(company, "wi26"),
    fiscalYearCurrent: pickNumber(company, "fy_0"),
    foundedYear: pickNumber(company, "설립"),
    price: pickNumber(company, "현재가"),
    dayChangeRatio: pickNumber(company, "전일대비"),
    weekChangeRatio: pickNumber(company, "전주대비"),
    marketCapUsdMn: pickNumber(company, "usd_mn"),
    roeFwd: pickNumber(company, "roe_fwd"),
    opmFwd: pickNumber(company, "opm_fwd"),
    cashConversionCycleFy0: pickNumber(company, "ccc_fy_0"),
    perFwd: pickNumber(company, "per_fwd"),
    perAvgPremiumRatio: pickNumber(company, "per_avg"),
    pbrFwd: pickNumber(company, "pbr_fwd"),
    pegFwd: pickNumber(company, "peg_fwd"),
    returnYRatio: pickNumber(company, "return_y"),
    dividendYieldFy1Ratio: pickNumber(company, "dy_fy_1"),
  });
}

function buildEtfSummary(etf: JsonRecord | null, sourceDate: string | null) {
  if (!etf) return null;

  return compactObject({
    symbol: pickString(etf, "ticker"),
    category: pickString(etf, "sector"),
    inception: pickNumber(etf, "inception"),
    marketCapUsdMn: pickNumber(etf, "maket_cap_usd_mn"),
    price: sourceDate ? pickNumber(etf, sourceDate) : null,
    beta: pickNumber(etf, "beta"),
    expenseRatio: pickNumber(etf, "expense"),
    fiftyTwoWeekHigh: pickNumber(etf, "52_high_2"),
    fiftyTwoWeekLow: pickNumber(etf, "52_low_2"),
    return1mRatio: pickNumber(etf, "1_m"),
    return3mRatio: pickNumber(etf, "3_m"),
    return6mRatio: pickNumber(etf, "6_m"),
    returnYtdRatio: pickNumber(etf, "ytd"),
    return1yRatio: pickNumber(etf, "1_year"),
    return3yRatio: pickNumber(etf, "3_year"),
    return5yRatio: pickNumber(etf, "5_year"),
    return10yRatio: pickNumber(etf, "10_year"),
    assetWeightRatio: pickNumber(etf, "assets"),
    roeFwd: pickNumber(etf, "roe_fwd"),
    opmFwd: pickNumber(etf, "opm_fwd"),
    perFwd: pickNumber(etf, "per_fwd"),
  });
}

function buildHolderSummary(
  byTickerRaw: unknown,
  summaryRaw: unknown,
  symbol: string,
  options: { includeMetadata: boolean; holderLimit: number },
) {
  const byTicker = pickObject(byTickerRaw);
  const ticker = pickObject(byTicker?.[symbol]);
  const details = pickArray(ticker?.holder_details).filter(isRecord);
  const aggregated = new Map<string, { investor: string; shares: number; weight: number | null }>();

  details.forEach((detail) => {
    const investor = pickString(detail, "investor");
    const shares = pickNumber(detail, "shares");
    if (!investor || shares === null) return;
    const current = aggregated.get(investor) ?? { investor, shares: 0, weight: null };
    current.shares += shares;
    const weight = pickNumber(detail, "weight");
    if (weight !== null) current.weight = (current.weight ?? 0) + weight;
    aggregated.set(investor, current);
  });

  const summary = pickObject(summaryRaw);
  const metadata = pickObject(summary?.metadata);

  return compactObject({
    metadata: options.includeMetadata
      ? compactObject({
          version: getString(metadata?.version),
          generatedAt: getString(metadata?.generated_at),
          quartersCovered: pickArray(metadata?.quarters_covered).slice(0, 6),
          investorCount: getNumber(metadata?.investor_count),
          dataLatencyNote: getString(metadata?.data_latency_note),
        })
      : compactObject({
          generatedAt: getString(metadata?.generated_at),
          dataLatencyNote: getString(metadata?.data_latency_note),
        }),
    ticker: ticker
      ? compactObject({
          totalShares: pickNumber(ticker, "total_shares"),
          holderRows: details.length,
          uniqueHolderCount: aggregated.size,
          topHolders: [...aggregated.values()]
            .sort((a, b) => b.shares - a.shares)
            .slice(0, options.holderLimit),
        })
      : null,
  });
}

function buildSignalsSummary(raw: unknown, includeMetrics: boolean) {
  const signalsRoot = pickObject(raw);
  const signals = pickObject(signalsRoot?.signals);

  function signal(name: string) {
    const item = pickObject(signals?.[name]);
    if (!item) return null;
    return compactObject({
      status: getString(item.overallStatus),
      metrics: includeMetrics ? pickObject(item.metrics) : null,
      buyActive: getNumber(item.buy_active),
      buyNear: getNumber(item.buy_near),
      warnActive: getNumber(item.warn_active),
      warnNear: getNumber(item.warn_near),
    });
  }

  return compactObject({
    generatedAt: getString(signalsRoot?.generated_at),
    asOf: getString(signalsRoot?.as_of),
    note: "computed signals are global/USD market context, not ticker-specific signals",
    signals: compactObject({
      liquidityFlow: signal("liquidity_flow"),
      liquidityStress: signal("liquidity_stress"),
      bankingHealth: signal("banking_health"),
      sentiment: signal("sentiment_signal"),
    }),
  });
}

async function getTickerSnapshot(args: Record<string, unknown>) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) {
    return { error: "INVALID_SYMBOL", allowedPattern: SYMBOL_PATTERN.source };
  }

  const payload = await getTickerQuote(symbol).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "TICKER_FETCH_FAILED";
    return { error: "TICKER_FETCH_FAILED", symbol, message };
  });

  if ("error" in payload) return payload;

  return {
    symbol,
    snapshot: {
      symbol: payload.symbol,
      price: payload.price,
      previousClose: payload.previousClose,
      change: payload.change,
      changePercent: payload.changePercent,
      marketState: payload.marketState,
      source: payload.source,
      fetchedAt: payload.fetchedAt,
    },
    note: "Same-origin ticker snapshot. Treat stale or missing fields as uncertainty.",
  };
}

async function getFenoTickerContext(args: Record<string, unknown>) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) {
    return { error: "INVALID_SYMBOL", allowedPattern: SYMBOL_PATTERN.source };
  }

  const section = normalizeFenoSection(args.section);
  const detailPath = `/data/global-scouter/stocks/detail/${symbol}.json`;
  const [companyRaw, etfRaw, detailRaw, byTickerRaw, summaryRaw, signalsRaw] = await Promise.all([
    readPublicJson(FENO_SCOUTER_COMPANY_PATH).catch((error: unknown) => ({ error })),
    readPublicJson(FENO_SCOUTER_ETF_PATH).catch(() => null),
    readPublicJson(detailPath).catch(() => null),
    readPublicJson(FENO_13F_BY_TICKER_PATH).catch(() => null),
    readPublicJson(FENO_13F_SUMMARY_PATH).catch(() => null),
    readPublicJson(FENO_COMPUTED_SIGNALS_PATH).catch(() => null),
  ]);

  if (isRecord(companyRaw) && "error" in companyRaw) {
    return {
      error: "FENO_DATA_READ_FAILED",
      symbol,
      message: companyRaw.error instanceof Error ? companyRaw.error.message : "companies_a_company.json unavailable",
    };
  }

  const scouterCompany = findGlobalScouterCompany(companyRaw, symbol);
  const scouterEtf = findGlobalScouterEtf(etfRaw, symbol);
  const company = buildCompanySummary(scouterCompany.company);
  const etf = buildEtfSummary(scouterEtf.etf, getString(scouterEtf.meta?.sourceDate));
  const coverageType = company ? "stock" : etf ? "etf_or_index" : "none";

  return {
    symbol,
    section,
    coverage: compactObject({
      type: coverageType,
      hasStockDetail: detailRaw !== null,
      note:
        coverageType === "etf_or_index"
          ? "ETF/index row found in Global Scouter ETF data; stock detail/fundamental sections may be unavailable."
          : coverageType === "none"
            ? "No Global Scouter stock or ETF/index row was found for this symbol."
            : null,
    }),
    available: {
      globalScouterCompany: company !== null,
      globalScouterEtf: etf !== null,
      globalScouterDetail: detailRaw !== null,
      sec13f: pickObject(byTickerRaw)?.[symbol] !== undefined,
      computedSignals: signalsRaw !== null,
    },
    globalScouter: compactObject({
      meta: company ? scouterCompany.meta : scouterEtf.meta,
      company,
      etf,
      detail: company ? buildScouterDetail(detailRaw, section) : null,
    }),
    sec13f: buildHolderSummary(byTickerRaw, summaryRaw, symbol, {
      includeMetadata: section === "holders",
      holderLimit: section === "holders" ? 10 : 5,
    }),
    computedSignals: buildSignalsSummary(signalsRaw, section === "signals"),
    sources: [
      FENO_SCOUTER_COMPANY_PATH,
      FENO_SCOUTER_ETF_PATH,
      detailPath,
      FENO_13F_BY_TICKER_PATH,
      FENO_13F_SUMMARY_PATH,
      FENO_COMPUTED_SIGNALS_PATH,
    ],
    note: "This is local 100xFenok feno-data. It is not web search. Overview is intentionally voice-compact; call again with a specific section for focused detail. Current price snapshots may differ from Scouter source dates.",
  };
}

export async function executeLiveToolFunction(
  name: string,
  args: Record<string, unknown>,
  context?: LiveToolSessionContext,
) {
  const tool = TOOL_BY_FUNCTION_NAME.get(name);
  if (!tool || tool.status !== "available") {
    return { error: "UNKNOWN_TOOL" };
  }

  if (
    name === "saveStudySession" ||
    name === "getYesterdaySession" ||
    name === "getStudyMemory" ||
    name === "getWeeklyTestSet"
  ) {
    const bridgeResult = await callMonaStudy(name, args, context);
    if (bridgeResult && !("error" in bridgeResult)) {
      return bridgeResult.payload as Record<string, unknown>;
    }
    return bridgeResult;
  }

  if (name === "requestLessonMaterial") {
    return requestLessonMaterial(args, context);
  }

  if (name === "getTickerSnapshot") {
    return getTickerSnapshot(args);
  }

  if (name === "getFenoTickerContext") {
    return getFenoTickerContext(args);
  }

  if (name === "searchFenoWeb") {
    return callLiveSkillBridge("feno-search", args);
  }

  if (name === "searchNaverWeb") {
    return callLiveSkillBridge("naver-search", args);
  }

  if (name === "searchKakaoWeb") {
    return callLiveSkillBridge("kakao-search", args);
  }

  if (name === "showCard") {
    return { ok: true };
  }

  return { error: "TOOL_HANDLER_MISSING" };
}
