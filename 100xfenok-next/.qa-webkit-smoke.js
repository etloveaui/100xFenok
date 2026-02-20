/* eslint-disable @typescript-eslint/no-require-imports */
const { webkit } = require("playwright");

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3105";
const route = process.env.QA_WEBKIT_ROUTE || "/";
const timeoutMs = Number.parseInt(process.env.QA_WEBKIT_TIMEOUT_MS || "25000", 10);

function withTimeout(promise, stage, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${stage}:timeout:${ms}`)), ms),
    ),
  ]);
}

async function safeCloseBrowser(browser, ms = 3000) {
  if (!browser) {
    return;
  }

  try {
    await Promise.race([
      browser.close(),
      new Promise((resolve) => setTimeout(resolve, ms)),
    ]);
  } catch {
    // ignore cleanup error
  }
}

function classifyFailure(errorMessage) {
  const message = String(errorMessage || "");
  if (
    message.includes("newPage:timeout") ||
    message.includes("automation is not allowed in the context")
  ) {
    return {
      category: "automation-context-blocked",
      hint: "WSL/WebKit 컨텍스트에서 automation 허용이 차단됨. Chromium/Firefox + 실기기 Safari 대체 검증 필요.",
    };
  }

  if (message.includes("launch:timeout")) {
    return {
      category: "launch-timeout",
      hint: "WebKit 런타임 기동 지연 또는 display backend 충돌 가능성.",
    };
  }

  return {
    category: "unknown",
    hint: "로그 확인 필요",
  };
}

(async () => {
  const startedAt = new Date().toISOString();
  let stage = "launch";
  let browser = null;

  try {
    console.error(`[webkit-smoke] stage=${stage}`);
    browser = await withTimeout(
      webkit.launch({
        headless: true,
        args: ["--automation"],
      }),
      stage,
      timeoutMs,
    );

    stage = "newContext";
    console.error(`[webkit-smoke] stage=${stage}`);
    const context = await withTimeout(browser.newContext(), stage, timeoutMs);

    stage = "newPage";
    console.error(`[webkit-smoke] stage=${stage}`);
    const page = await withTimeout(context.newPage(), stage, timeoutMs);

    stage = "goto";
    console.error(`[webkit-smoke] stage=${stage}`);
    const response = await withTimeout(
      page.goto(`${baseUrl}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      }),
      stage,
      timeoutMs,
    );

    await safeCloseBrowser(browser);
    browser = null;

    console.log(
      JSON.stringify(
        {
          ok: true,
          startedAt,
          endedAt: new Date().toISOString(),
          stage: "done",
          baseUrl,
          route,
          status: response ? response.status() : null,
          message: "WebKit smoke passed",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (browser) {
      void safeCloseBrowser(browser, 1000);
    }

    const message = error instanceof Error ? error.message : String(error);
    const details = classifyFailure(message);

    console.error(
      JSON.stringify(
        {
          ok: false,
          startedAt,
          endedAt: new Date().toISOString(),
          stage,
          baseUrl,
          route,
          timeoutMs,
          error: message,
          category: details.category,
          hint: details.hint,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
})();
