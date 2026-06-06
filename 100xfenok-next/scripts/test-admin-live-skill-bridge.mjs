#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";

const TEST_TOKEN = "test-token";

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function startMockProvider() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "POST" && url.pathname === "/tavily") {
      sendJson(res, 200, {
        answer: "Tavily answer",
        results: [
          {
            title: "Tavily Result",
            url: "https://example.com/tavily",
            content: "Tavily snippet",
          },
        ],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/brave") {
      sendJson(res, 200, {
        web: {
          results: [
            {
              title: "Brave Result",
              url: "https://example.com/brave",
              description: "Brave snippet",
            },
          ],
        },
      });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/naver/")) {
      sendJson(res, 200, {
        items: [
          {
            title: "<b>Naver Result</b>",
            link: "https://example.com/naver",
            description: "<b>Naver snippet</b>",
          },
        ],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/kakao/web") {
      sendJson(res, 200, {
        documents: [
          {
            title: "Kakao Result",
            url: "https://example.com/kakao",
            contents: "Kakao snippet",
          },
        ],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/kakao/cafe") {
      sendJson(res, 200, {
        documents: [
          {
            title: "Kakao Cafe Result",
            url: "https://example.com/kakao-cafe",
            contents: "Kakao cafe snippet",
            cafename: "Cafe Board",
          },
        ],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/kakao/book") {
      sendJson(res, 200, {
        documents: [
          {
            title: "Kakao Book Result",
            url: "https://example.com/kakao-book",
            authors: ["Book Author"],
            publisher: "Book Publisher",
            isbn: "1234567890",
          },
        ],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/kakao-place") {
      sendJson(res, 200, {
        documents: [
          {
            place_name: "Kakao Place",
            place_url: "https://example.com/kakao-place",
            road_address_name: "Seoul",
          },
        ],
      });
      return;
    }

    sendJson(res, 404, { error: "MOCK_NOT_FOUND", path: url.pathname });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      resolve({ server, port: address.port });
    });
  });
}

async function getFreePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function startBridge({ bridgePort, mockPort }) {
  const child = spawn(process.execPath, [new URL("./admin-live-skill-bridge.mjs", import.meta.url).pathname], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      FENO_SKILL_BRIDGE_SKIP_ENV_FILES: "1",
      FENO_SKILL_BRIDGE_TOKEN: TEST_TOKEN,
      FENO_SKILL_BRIDGE_HOST: "127.0.0.1",
      FENO_SKILL_BRIDGE_PORT: String(bridgePort),
      FENO_SKILL_BRIDGE_TAVILY_URL: `http://127.0.0.1:${mockPort}/tavily`,
      FENO_SKILL_BRIDGE_BRAVE_URL: `http://127.0.0.1:${mockPort}/brave`,
      FENO_SKILL_BRIDGE_NAVER_BASE: `http://127.0.0.1:${mockPort}/naver`,
      FENO_SKILL_BRIDGE_KAKAO_SEARCH_BASE: `http://127.0.0.1:${mockPort}/kakao`,
      FENO_SKILL_BRIDGE_KAKAO_LOCAL_KEYWORD_URL: `http://127.0.0.1:${mockPort}/kakao-place`,
      FENO_SKILL_BRIDGE_KAKAO_BOOK_URL: `http://127.0.0.1:${mockPort}/kakao/book`,
      TAVILY_API_KEY: "dummy-tavily",
      BRAVE_SEARCH_API_KEY: "dummy-brave",
      NAVER_CLIENT_ID: "dummy-naver-id",
      NAVER_CLIENT_SECRET: "dummy-naver-secret",
      KAKAO_REST_API_KEY: "dummy-kakao",
    },
  });

  return child;
}

function waitForBridge(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("bridge did not start in time")), 5_000);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (text.includes('"listening"')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`bridge exited early with code ${String(code)}`));
    });
  });
}

async function bridgeRequest(bridgePort, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${bridgePort}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function main() {
  const { server: mockServer, port: mockPort } = await startMockProvider();
  const bridgePort = await getFreePort();
  const bridge = startBridge({ bridgePort, mockPort });

  try {
    await waitForBridge(bridge);

    const healthzQuery = await bridgeRequest(bridgePort, "/healthz?probe=1");
    assert.equal(healthzQuery.status, 200);
    assert.equal(healthzQuery.body.service, "100x-admin-live-skill-bridge");

    const unauthorized = await bridgeRequest(bridgePort, "/live-search", {
      method: "POST",
      body: { tool: "feno-search", query: "NVDA" },
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.error, "UNAUTHORIZED");

    const health = await bridgeRequest(bridgePort, "/health", { token: TEST_TOKEN });
    assert.equal(health.status, 200);
    assert.deepEqual(health.body.providers, {
      tavily: true,
      brave: true,
      naver: true,
      kakao: true,
    });
    assert.equal(typeof health.body.uptimeSec, "number");
    assert.equal(health.body.metrics.byPath["/healthz"], 1);
    assert.equal(health.body.metrics.byStatus["401"], 1);

    const invalidJson = await fetch(`http://127.0.0.1:${bridgePort}/live-search/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: "{",
    });
    assert.equal(invalidJson.status, 400);
    assert.equal((await invalidJson.json()).error, "INVALID_JSON_BODY");

    const tavily = await bridgeRequest(bridgePort, "/live-search", {
      method: "POST",
      token: TEST_TOKEN,
      body: { tool: "feno-search", query: "NVDA latest", provider: "tavily", maxResults: 1 },
    });
    assert.equal(tavily.status, 200);
    assert.equal(tavily.body.provider, "tavily");
    assert.equal(tavily.body.results[0].title, "Tavily Result");

    const brave = await bridgeRequest(bridgePort, "/live-search", {
      method: "POST",
      token: TEST_TOKEN,
      body: { tool: "feno-search", query: "NVDA latest", provider: "brave", maxResults: 1 },
    });
    assert.equal(brave.status, 200);
    assert.equal(brave.body.provider, "brave");
    assert.equal(brave.body.results[0].title, "Brave Result");

    const naver = await bridgeRequest(bridgePort, "/live-search", {
      method: "POST",
      token: TEST_TOKEN,
      body: { tool: "naver-search", query: "엔비디아", type: "news", maxResults: 1 },
    });
    assert.equal(naver.status, 200);
    assert.equal(naver.body.provider, "naver:news");
    assert.equal(naver.body.results[0].title, "Naver Result");

    const naverCafe = await bridgeRequest(bridgePort, "/live-search", {
      method: "POST",
      token: TEST_TOKEN,
      body: { tool: "naver-search", query: "엔비디아", type: "cafe", maxResults: 1 },
    });
    assert.equal(naverCafe.status, 200);
    assert.equal(naverCafe.body.provider, "naver:cafearticle");
    assert.equal(naverCafe.body.results[0].title, "Naver Result");

    const kakaoWeb = await bridgeRequest(bridgePort, "/live-search", {
      method: "POST",
      token: TEST_TOKEN,
      body: { tool: "kakao-search", query: "엔비디아", type: "web", maxResults: 1 },
    });
    assert.equal(kakaoWeb.status, 200);
    assert.equal(kakaoWeb.body.provider, "kakao:web");
    assert.equal(kakaoWeb.body.results[0].title, "Kakao Result");

    const kakaoPlace = await bridgeRequest(bridgePort, "/live-search", {
      method: "POST",
      token: TEST_TOKEN,
      body: { tool: "kakao-search", query: "카페", type: "place", maxResults: 1 },
    });
    assert.equal(kakaoPlace.status, 200);
    assert.equal(kakaoPlace.body.provider, "kakao:place");
    assert.equal(kakaoPlace.body.results[0].title, "Kakao Place");

    const kakaoCafe = await bridgeRequest(bridgePort, "/live-search", {
      method: "POST",
      token: TEST_TOKEN,
      body: { tool: "kakao-search", query: "카페", type: "cafe", maxResults: 1 },
    });
    assert.equal(kakaoCafe.status, 200);
    assert.equal(kakaoCafe.body.provider, "kakao:cafe");
    assert.equal(kakaoCafe.body.results[0].title, "Kakao Cafe Result");

    const kakaoBook = await bridgeRequest(bridgePort, "/live-search", {
      method: "POST",
      token: TEST_TOKEN,
      body: { tool: "kakao-search", query: "책", type: "book", maxResults: 1 },
    });
    assert.equal(kakaoBook.status, 200);
    assert.equal(kakaoBook.body.provider, "kakao:book");
    assert.equal(kakaoBook.body.results[0].title, "Kakao Book Result");

    const postSearchHealth = await bridgeRequest(bridgePort, "/health", { token: TEST_TOKEN });
    assert.equal(postSearchHealth.status, 200);
    assert.equal(postSearchHealth.body.metrics.byPath["/live-search"], 10);
    assert.equal(postSearchHealth.body.metrics.byTool["feno-search"], 2);
    assert.equal(postSearchHealth.body.metrics.byTool["naver-search"], 2);
    assert.equal(postSearchHealth.body.metrics.byTool["kakao-search"], 4);
    assert.equal(postSearchHealth.body.metrics.byProvider["kakao:book"], 1);
    assert.equal(postSearchHealth.body.metrics.byStatus["401"], 1);
    assert.equal(postSearchHealth.body.metrics.byStatus["400"], 1);

    console.log("admin-live-skill-bridge mock smoke PASS");
  } finally {
    bridge.kill("SIGTERM");
    await new Promise((resolve) => mockServer.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
