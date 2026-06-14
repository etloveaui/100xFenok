#!/usr/bin/env node

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  executeMonaStudyToolFunction,
  prepareMonaStudySnapshot,
  requestLessonMaterial,
} from "../src/lib/server/mona-study-tools.ts";
import {
  appendAdminLiveConversationLog,
  saveAdminLiveConversationLog,
} from "../src/lib/server/admin-live-voice-logs.ts";

const SERVICE_NAME = "100x-admin-live-skill-bridge";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3577;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_QUERY_LENGTH = 500;
const DEFAULT_MAX_RESULTS = 5;
const REQUEST_TIMEOUT_MS = 8_000;

const DEFAULT_TAVILY_API_URL = "https://api.tavily.com/search";
const DEFAULT_BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_NAVER_API_BASE = "https://openapi.naver.com/v1/search";
const DEFAULT_KAKAO_SEARCH_BASE = "https://dapi.kakao.com/v2/search";
const DEFAULT_KAKAO_LOCAL_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const DEFAULT_KAKAO_BOOK_URL = "https://dapi.kakao.com/v3/search/book";

const VALID_TOOLS = new Set(["feno-search", "naver-search", "kakao-search"]);
const VALID_STUDY_NAMES = new Set([
  "prepareMonaStudySnapshot",
  "saveStudySession",
  "getYesterdaySession",
  "getStudyMemory",
  "getWeeklyTestSet",
  "requestLessonMaterial",
]);
const VALID_FENO_PROVIDERS = new Set(["auto", "tavily", "brave"]);
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
const startedAt = new Date();
const metrics = {
  totalRequests: 0,
  bridgeRequests: 0,
  searchRequests: 0,
  studyRequests: 0,
  logRequests: 0,
  errors: 0,
  byPath: {},
  byTool: {},
  byProvider: {},
  byStudyName: {},
  byLogMode: {},
  byStatus: {},
  lastRequestAt: null,
  lastError: null,
};

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;
  const key = match[1];
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

function loadEnvFile(pathname) {
  if (!pathname || !existsSync(pathname)) return false;
  const raw = readFileSync(pathname, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed) return;
    const [key, value] = parsed;
    if (process.env[key] === undefined) process.env[key] = value;
  });
  return true;
}

function loadEnvFiles() {
  if (process.env.FENO_SKILL_BRIDGE_SKIP_ENV_FILES === "1") return [];
  const explicit = process.env.FENO_SKILL_BRIDGE_ENV_FILE;
  return [
    explicit ? resolve(explicit) : null,
    resolve(".env.local"),
    resolve(".env"),
    join(homedir(), ".secrets", "mcp-keys.env"),
  ]
    .filter(Boolean)
    .map((pathname) => ({ pathname, loaded: loadEnvFile(pathname) }));
}

const loadedEnvFiles = loadEnvFiles();

function env(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function hasEnv(name) {
  return Boolean(env(name));
}

function bridgeToken() {
  return env("FENO_SKILL_BRIDGE_TOKEN");
}

function providerUrl(envName, defaultValue) {
  return env(envName) || defaultValue;
}

function normalizeQuery(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH);
}

function normalizeMaxResults(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_RESULTS;
  return Math.min(5, Math.max(1, Math.floor(value)));
}

function stripHtml(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function compactText(parts) {
  return parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .map((part) => {
      if (typeof part === "number" && Number.isFinite(part)) return String(part);
      return stripHtml(part);
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceResult(source, item) {
  return {
    source,
    title: stripHtml(item.title),
    url: typeof item.url === "string" ? item.url : null,
    snippet: stripHtml(item.snippet).slice(0, 300),
  };
}

function incrementMetric(bucket, key) {
  const normalized = key || "unknown";
  bucket[normalized] = (bucket[normalized] ?? 0) + 1;
}

function recordMetric({ path, statusCode, tool, provider, studyName, logMode, error }) {
  metrics.totalRequests += 1;
  if (path !== "/healthz") metrics.bridgeRequests += 1;
  if (path === "/live-search") metrics.searchRequests += 1;
  if (path === "/live-study") metrics.studyRequests += 1;
  if (path === "/live-log") metrics.logRequests += 1;
  if (statusCode >= 400 || error) metrics.errors += 1;
  metrics.lastRequestAt = new Date().toISOString();
  if (error) metrics.lastError = String(error).slice(0, 200);
  incrementMetric(metrics.byPath, path);
  incrementMetric(metrics.byStatus, String(statusCode));
  if (tool) incrementMetric(metrics.byTool, tool);
  if (provider) incrementMetric(metrics.byProvider, provider);
  if (studyName) incrementMetric(metrics.byStudyName, studyName);
  if (logMode) incrementMetric(metrics.byLogMode, logMode);
}

function requestPath(req) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname.replace(/\/+$/, "");
  return pathname || "/";
}

async function fetchJson(url, init) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return data;
}

function buildSearchResponse({ tool, query, provider, results, warnings = [] }) {
  const trimmedResults = results.slice(0, DEFAULT_MAX_RESULTS);
  return {
    ok: true,
    tool,
    query,
    provider,
    fetchedAt: new Date().toISOString(),
    resultCount: trimmedResults.length,
    results: trimmedResults,
    content: trimmedResults
      .map((result, index) => `[${index + 1}] ${result.title}${result.snippet ? `: ${result.snippet}` : ""}`)
      .join("\n\n"),
    warnings,
  };
}

async function searchTavily(query, maxResults) {
  const apiKey = env("TAVILY_API_KEY");
  if (!apiKey) throw new Error("TAVILY_API_KEY not configured");

  const data = await fetchJson(providerUrl("FENO_SKILL_BRIDGE_TAVILY_URL", DEFAULT_TAVILY_API_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      include_answer: true,
      max_results: maxResults,
    }),
  });

  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) throw new Error("Tavily returned no results");
  return results.map((item) => sourceResult("tavily", {
    title: item.title,
    url: item.url,
    snippet: item.content,
  }));
}

async function searchBrave(query, maxResults) {
  const apiKey = env("BRAVE_SEARCH_API_KEY");
  if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY not configured");

  const url = `${providerUrl("FENO_SKILL_BRIDGE_BRAVE_URL", DEFAULT_BRAVE_API_URL)}?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const data = await fetchJson(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  const results = Array.isArray(data?.web?.results) ? data.web.results : [];
  if (results.length === 0) throw new Error("Brave returned no results");
  return results.map((item) => sourceResult("brave", {
    title: item.title,
    url: item.url,
    snippet: item.description,
  }));
}

async function runFenoSearch(body) {
  const query = normalizeQuery(body.query);
  if (!query) return { error: "QUERY_REQUIRED" };
  const maxResults = normalizeMaxResults(body.maxResults);
  const provider = VALID_FENO_PROVIDERS.has(body.provider) ? body.provider : "auto";
  const attempts = [];

  const tryProvider = async (name, fn) => {
    try {
      const results = await fn(query, maxResults);
      return buildSearchResponse({ tool: "feno-search", query, provider: name, results, warnings: attempts });
    } catch (error) {
      attempts.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  if (provider === "tavily") return (await tryProvider("tavily", searchTavily)) ?? { error: "FENO_SEARCH_FAILED", attempts };
  if (provider === "brave") return (await tryProvider("brave", searchBrave)) ?? { error: "FENO_SEARCH_FAILED", attempts };

  return (
    (hasEnv("TAVILY_API_KEY") ? await tryProvider("tavily", searchTavily) : null) ??
    (hasEnv("BRAVE_SEARCH_API_KEY") ? await tryProvider("brave", searchBrave) : null) ??
    { error: "FENO_SEARCH_FAILED", attempts: attempts.length ? attempts : ["no feno-search provider keys configured"] }
  );
}

function naverType(type) {
  return ({
    web: "webkr",
    news: "news",
    blog: "blog",
    shop: "shop",
    image: "image",
    local: "local",
    book: "book",
    kin: "kin",
    cafe: "cafearticle",
    doc: "doc",
    encyc: "encyc",
  })[VALID_NAVER_TYPES.has(type) ? type : "web"];
}

async function runNaverSearch(body) {
  const query = normalizeQuery(body.query);
  if (!query) return { error: "QUERY_REQUIRED" };
  const clientId = env("NAVER_CLIENT_ID");
  const clientSecret = env("NAVER_CLIENT_SECRET");
  if (!clientId || !clientSecret) return { error: "NAVER_CREDENTIALS_NOT_CONFIGURED" };

  const type = naverType(body.type);
  const display = normalizeMaxResults(body.maxResults);
  const url = `${providerUrl("FENO_SKILL_BRIDGE_NAVER_BASE", DEFAULT_NAVER_API_BASE)}/${type}.json?query=${encodeURIComponent(query)}&display=${display}&sort=sim`;
  const data = await fetchJson(url, {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
  });

  const items = Array.isArray(data?.items) ? data.items : [];
  if (items.length === 0) return { error: "NAVER_NO_RESULTS" };
  const results = items.map((item) => sourceResult("naver", {
    title: item.title,
    url: item.link ?? item.originallink,
    snippet: compactText([
      item.description,
      item.address,
      item.roadAddress,
      item.category,
      item.bloggername,
      item.mallName,
      item.brand,
      item.lprice,
      item.hprice,
      item.author,
      item.publisher,
      item.isbn,
      item.cafename,
      item.sizewidth,
      item.sizeheight,
    ]),
  }));
  return buildSearchResponse({ tool: "naver-search", query, provider: `naver:${type}`, results });
}

function kakaoPath(type) {
  const normalized = VALID_KAKAO_TYPES.has(type) ? type : "web";
  if (normalized === "place") {
    return providerUrl("FENO_SKILL_BRIDGE_KAKAO_LOCAL_KEYWORD_URL", DEFAULT_KAKAO_LOCAL_KEYWORD_URL);
  }
  if (normalized === "book") {
    return providerUrl("FENO_SKILL_BRIDGE_KAKAO_BOOK_URL", DEFAULT_KAKAO_BOOK_URL);
  }
  return `${providerUrl("FENO_SKILL_BRIDGE_KAKAO_SEARCH_BASE", DEFAULT_KAKAO_SEARCH_BASE)}/${normalized}`;
}

async function runKakaoSearch(body) {
  const query = normalizeQuery(body.query);
  if (!query) return { error: "QUERY_REQUIRED" };
  const apiKey = env("KAKAO_REST_API_KEY");
  if (!apiKey) return { error: "KAKAO_REST_API_KEY_NOT_CONFIGURED" };

  const type = VALID_KAKAO_TYPES.has(body.type) ? body.type : "web";
  const size = normalizeMaxResults(body.maxResults);
  const separator = kakaoPath(type).includes("?") ? "&" : "?";
  const url = `${kakaoPath(type)}${separator}query=${encodeURIComponent(query)}&size=${size}`;
  const data = await fetchJson(url, {
    headers: {
      Authorization: `KakaoAK ${apiKey}`,
    },
  });

  const documents = Array.isArray(data?.documents) ? data.documents : [];
  if (documents.length === 0) return { error: "KAKAO_NO_RESULTS" };
  const results = documents.map((item) => sourceResult("kakao", {
    title: item.title ?? item.place_name ?? item.display_sitename,
    url: item.url ?? item.place_url ?? item.doc_url ?? item.image_url ?? item.thumbnail,
    snippet: compactText([
      item.contents,
      item.address_name,
      item.road_address_name,
      item.category_name,
      item.blogname,
      item.cafename,
      item.authors,
      item.publisher,
      item.isbn,
      item.price,
      item.sale_price,
      item.play_time,
      item.datetime,
    ]),
  }));
  return buildSearchResponse({ tool: "kakao-search", query, provider: `kakao:${type}`, results });
}

async function handleSearch(body) {
  if (!body || typeof body !== "object") return { error: "INVALID_JSON_BODY" };
  if (!VALID_TOOLS.has(body.tool)) return { error: "UNKNOWN_TOOL" };
  if (body.tool === "feno-search") return runFenoSearch(body);
  if (body.tool === "naver-search") return runNaverSearch(body);
  if (body.tool === "kakao-search") return runKakaoSearch(body);
  return { error: "TOOL_HANDLER_MISSING" };
}

async function handleStudy(body) {
  if (!body || typeof body !== "object") return { error: "INVALID_JSON_BODY" };
  const { name, args = {}, context = {} } = body;
  if (typeof name !== "string" || !VALID_STUDY_NAMES.has(name)) {
    return { error: "UNKNOWN_STUDY_NAME", name, valid: [...VALID_STUDY_NAMES] };
  }
  if (args !== null && typeof args !== "object") return { error: "INVALID_ARGS" };
  if (context !== null && typeof context !== "object") return { error: "INVALID_CONTEXT" };
  if (name === "prepareMonaStudySnapshot") {
    const studyDate = typeof args.studyDate === "string" ? args.studyDate : undefined;
    return prepareMonaStudySnapshot(studyDate);
  }
  if (name === "requestLessonMaterial") {
    return requestLessonMaterial(args, context ?? {});
  }
  return executeMonaStudyToolFunction(name, args, context ?? {});
}

async function handleLog(body) {
  if (!body || typeof body !== "object") return { error: "INVALID_JSON_BODY" };
  if (body.op === "append") return appendAdminLiveConversationLog(body);
  return saveAdminLiveConversationLog(body);
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error("REQUEST_BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolveBody(null);
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        rejectBody(new Error("INVALID_JSON_BODY"));
      }
    });
    req.on("error", rejectBody);
  });
}

function bearerToken(req) {
  const header = req.headers.authorization ?? "";
  const match = Array.isArray(header) ? header[0] : header;
  return match.startsWith("Bearer ") ? match.slice("Bearer ".length).trim() : "";
}

function isAuthorized(req) {
  const expected = bridgeToken();
  const actual = bearerToken(req);
  if (!expected || !actual) return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function bridgeHealth() {
  return {
    ok: Boolean(bridgeToken()),
    service: SERVICE_NAME,
    startedAt: startedAt.toISOString(),
    uptimeSec: Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)),
    loadedEnvFileCount: loadedEnvFiles.filter((item) => item.loaded).length,
    providers: {
      tavily: hasEnv("TAVILY_API_KEY"),
      brave: hasEnv("BRAVE_SEARCH_API_KEY"),
      naver: hasEnv("NAVER_CLIENT_ID") && hasEnv("NAVER_CLIENT_SECRET"),
      kakao: hasEnv("KAKAO_REST_API_KEY"),
    },
    metrics,
  };
}

const server = createServer(async (req, res) => {
  const path = requestPath(req);
  try {
    if (req.method === "GET" && path === "/healthz") {
      recordMetric({ path, statusCode: 200 });
      sendJson(res, 200, { ok: true, service: SERVICE_NAME });
      return;
    }

    if (!isAuthorized(req)) {
      recordMetric({ path, statusCode: 401, error: "UNAUTHORIZED" });
      sendJson(res, 401, { error: "UNAUTHORIZED" });
      return;
    }

    if (req.method === "GET" && path === "/health") {
      const statusCode = bridgeToken() ? 200 : 503;
      recordMetric({ path, statusCode });
      sendJson(res, statusCode, bridgeHealth());
      return;
    }

    if (req.method === "POST" && path === "/live-search") {
      const body = await readRequestBody(req);
      const result = await handleSearch(body);
      const statusCode = result && result.error ? 400 : 200;
      recordMetric({
        path,
        statusCode,
        tool: body?.tool,
        provider: result?.provider,
        error: result?.error,
      });
      sendJson(res, statusCode, result);
      return;
    }

    if (req.method === "POST" && path === "/live-study") {
      const body = await readRequestBody(req);
      const result = await handleStudy(body);
      const statusCode = result && result.error ? 400 : 200;
      recordMetric({
        path,
        statusCode,
        studyName: body?.name,
        error: result?.error,
      });
      sendJson(res, statusCode, result);
      return;
    }

    if (req.method === "POST" && path === "/live-log") {
      const body = await readRequestBody(req);
      const result = await handleLog(body);
      const statusCode = result && result.error ? 400 : 200;
      recordMetric({
        path,
        statusCode,
        logMode: body?.mode,
        error: result?.error,
      });
      sendJson(res, statusCode, result);
      return;
    }

    recordMetric({ path, statusCode: 404, error: "NOT_FOUND" });
    sendJson(res, 404, { error: "NOT_FOUND" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = message === "INVALID_JSON_BODY" ? 400 : message === "REQUEST_BODY_TOO_LARGE" ? 413 : 500;
    recordMetric({ path, statusCode, error: message });
    sendJson(res, statusCode, { error: message });
  }
});

const host = env("FENO_SKILL_BRIDGE_HOST") || DEFAULT_HOST;
const port = Number.parseInt(env("FENO_SKILL_BRIDGE_PORT"), 10) || DEFAULT_PORT;

server.listen(port, host, () => {
  const health = bridgeHealth();
  console.log(JSON.stringify({
    service: SERVICE_NAME,
    listening: `http://${host}:${port}`,
    tokenConfigured: Boolean(bridgeToken()),
    providers: health.providers,
  }));
});
