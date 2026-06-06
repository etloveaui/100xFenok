#!/usr/bin/env node

const DEFAULT_BRIDGE_ENDPOINT = "http://127.0.0.1:3577/live-search";
const REQUEST_TIMEOUT_MS = 12_000;

const args = new Set(process.argv.slice(2));
const live = args.has("--live") || process.env.FENO_SKILL_BRIDGE_PROBE_LIVE === "1";
const full = args.has("--full") || process.env.FENO_SKILL_BRIDGE_PROBE_FULL === "1";

function env(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function bridgeEndpoint() {
  return env("FENO_SKILL_BRIDGE_URL") || DEFAULT_BRIDGE_ENDPOINT;
}

function siblingUrl(endpoint, pathname) {
  const url = new URL(endpoint);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function buildSearchProbes() {
  const probes = [
    {
      name: "feno-search:auto",
      body: {
        tool: "feno-search",
        query: "NVDA latest market news",
        provider: "auto",
        maxResults: 1,
      },
    },
    {
      name: "naver-search:news",
      body: {
        tool: "naver-search",
        query: "엔비디아 최신 뉴스",
        type: "news",
        maxResults: 1,
      },
    },
    {
      name: "kakao-search:web",
      body: {
        tool: "kakao-search",
        query: "엔비디아 최신 뉴스",
        type: "web",
        maxResults: 1,
      },
    },
  ];

  if (!full) return probes;

  return [
    ...probes,
    {
      name: "feno-search:brave",
      body: {
        tool: "feno-search",
        query: "NVDA latest market news",
        provider: "brave",
        maxResults: 1,
      },
    },
    {
      name: "feno-search:tavily",
      body: {
        tool: "feno-search",
        query: "NVDA latest market news",
        provider: "tavily",
        maxResults: 1,
      },
    },
    {
      name: "naver-search:cafe",
      body: {
        tool: "naver-search",
        query: "엔비디아",
        type: "cafe",
        maxResults: 1,
      },
    },
    {
      name: "kakao-search:place",
      body: {
        tool: "kakao-search",
        query: "강남역 카페",
        type: "place",
        maxResults: 1,
      },
    },
    {
      name: "kakao-search:book",
      body: {
        tool: "kakao-search",
        query: "투자",
        type: "book",
        maxResults: 1,
      },
    },
  ];
}

async function readJson(response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
    const body = await readJson(response);
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function runProbe() {
  const endpoint = bridgeEndpoint();
  const token = env("FENO_SKILL_BRIDGE_TOKEN");
  const searchProbes = buildSearchProbes();
  const plan = {
    endpoint,
    healthz: siblingUrl(endpoint, "/healthz"),
    health: siblingUrl(endpoint, "/health"),
    liveSearch: endpoint,
    searchProbes: searchProbes.map((probe) => probe.name),
    full,
  };

  if (!live) {
    console.log(JSON.stringify({
      ok: false,
      mode: "dry-run",
      reason: "LIVE_PROVIDER_PROBE_NOT_CONFIRMED",
      run: "npm run probe:live-skill-bridge -- --live",
      fullRun: "npm run probe:live-skill-bridge -- --live --full",
      plan,
    }, null, 2));
    return;
  }

  if (!token) {
    console.error(JSON.stringify({
      ok: false,
      error: "FENO_SKILL_BRIDGE_TOKEN_REQUIRED",
      endpoint,
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const healthz = await fetchJson(plan.healthz);
  const health = await fetchJson(plan.health, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const results = [];

  for (const probe of searchProbes) {
    const response = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(probe.body),
    });
    results.push({
      name: probe.name,
      ok: response.ok && response.body?.ok === true,
      status: response.status,
      provider: response.body?.provider ?? null,
      resultCount: response.body?.resultCount ?? null,
      error: response.body?.error ?? null,
    });
  }

  const ok = healthz.ok && health.ok && results.every((result) => result.ok);
  console.log(JSON.stringify({
    ok,
    endpoint,
    healthz: {
      ok: healthz.ok,
      status: healthz.status,
    },
    health: {
      ok: health.ok,
      status: health.status,
      providers: health.body?.providers ?? null,
    },
    results,
  }, null, 2));

  if (!ok) process.exitCode = 1;
}

runProbe().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
