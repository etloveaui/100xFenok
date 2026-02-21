/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3105";
const iterations = Number.parseInt(process.env.QA_LIGHTHOUSE_RUNS || "3", 10);
const routes = (process.env.QA_LIGHTHOUSE_ROUTES || "/,/tools/stock-analyzer/native/")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);
const presets = (process.env.QA_LIGHTHOUSE_PRESETS || "mobile,desktop")
  .split(",")
  .map((preset) => preset.trim().toLowerCase())
  .filter((preset) => preset === "mobile" || preset === "desktop");

function detectPlaywrightChrome() {
  const home = process.env.HOME || "";
  if (!home) {
    return null;
  }

  const playwrightCacheDir = path.join(home, ".cache", "ms-playwright");
  if (!fs.existsSync(playwrightCacheDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(playwrightCacheDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("chromium-"))
    .map((entry) => ({
      name: entry.name,
      chromePathCandidates: [
        path.join(playwrightCacheDir, entry.name, "chrome-linux", "chrome"),
        path.join(playwrightCacheDir, entry.name, "chrome-linux64", "chrome"),
      ],
    }))
    .map((entry) => ({
      name: entry.name,
      chromePath: entry.chromePathCandidates.find((candidate) => fs.existsSync(candidate)),
    }))
    .filter((entry) => Boolean(entry.chromePath))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));

  return candidates[0]?.chromePath ?? null;
}

function detectSystemChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const playwrightChromePath = detectPlaywrightChrome();
let chromePath = process.env.CHROME_PATH || detectSystemChrome() || playwrightChromePath;

function percentile50(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return sorted[middle];
}

function runLighthouse(url, outputPath, preset) {
  const baseArgs = [
    url,
    "--output=json",
    `--output-path=${outputPath}`,
    "--only-categories=performance,accessibility,best-practices,seo",
    `--chrome-flags=--headless --no-sandbox --disable-gpu`,
    "--quiet",
  ];

  if (preset === "desktop") {
    baseArgs.push("--preset=desktop");
  }

  const runWithChrome = (candidateChromePath) => {
    const args = [...baseArgs];
    if (candidateChromePath) {
      args.push(`--chrome-path=${candidateChromePath}`);
    }
    execFileSync("npx", ["lighthouse", ...args], {
      stdio: "inherit",
      env: candidateChromePath
        ? {
            ...process.env,
            CHROME_PATH: candidateChromePath,
          }
        : process.env,
    });
  };

  const isChromeConnectError = (message) =>
    /Unable to connect to Chrome|Could not find Chrome/i.test(message);

  try {
    runWithChrome(chromePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const canFallbackToPlaywright =
      playwrightChromePath &&
      playwrightChromePath !== chromePath;

    if (canFallbackToPlaywright) {
      console.error(
        `[qa:lighthouse] primary chrome failed (${chromePath}), retrying with Playwright Chromium (${playwrightChromePath})`,
      );
      try {
        runWithChrome(playwrightChromePath);
        chromePath = playwrightChromePath;
        return;
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        if (isChromeConnectError(fallbackMessage)) {
          throw new Error(
            `Both primary chrome (${chromePath}) and Playwright Chromium (${playwrightChromePath}) failed (${fallbackMessage})`,
          );
        }
        throw fallbackError;
      }
    }

    if (isChromeConnectError(message)) {
      const hint = chromePath
        ? `Configured CHROME_PATH is not usable: ${chromePath}`
        : "No Chrome binary detected. Install Chromium or set CHROME_PATH explicitly.";
      throw new Error(`${hint} (${message})`);
    }
    throw error;
  }
}

function readScores(filePath) {
  const report = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    performance: Math.round((report.categories.performance?.score ?? 0) * 100),
    accessibility: Math.round((report.categories.accessibility?.score ?? 0) * 100),
    bestPractices: Math.round((report.categories["best-practices"]?.score ?? 0) * 100),
    seo: Math.round((report.categories.seo?.score ?? 0) * 100),
  };
}

if (iterations < 1) {
  throw new Error("QA_LIGHTHOUSE_RUNS must be >= 1");
}

if (routes.length === 0) {
  throw new Error("No routes configured. Set QA_LIGHTHOUSE_ROUTES");
}

if (presets.length === 0) {
  throw new Error("No presets configured. Set QA_LIGHTHOUSE_PRESETS");
}

function summarize(values) {
  return {
    min: Math.min(...values),
    median: percentile50(values),
    max: Math.max(...values),
    values,
  };
}

const allResults = {};

for (const route of routes) {
  const fullUrl = `${baseUrl}${route}`;
  allResults[route] = {};

  for (const preset of presets) {
    const scores = {
      performance: [],
      accessibility: [],
      bestPractices: [],
      seo: [],
    };

    for (let i = 1; i <= iterations; i += 1) {
      const tempFile = path.join(
        os.tmpdir(),
        `lighthouse-${preset}-${route.replace(/\W+/g, "_")}-${Date.now()}-${i}.json`,
      );
      runLighthouse(fullUrl, tempFile, preset);
      const result = readScores(tempFile);
      fs.unlinkSync(tempFile);

      scores.performance.push(result.performance);
      scores.accessibility.push(result.accessibility);
      scores.bestPractices.push(result.bestPractices);
      scores.seo.push(result.seo);
    }

    allResults[route][preset] = {
      runs: iterations,
      performance: summarize(scores.performance),
      accessibility: summarize(scores.accessibility),
      bestPractices: summarize(scores.bestPractices),
      seo: summarize(scores.seo),
    };
  }
}

console.log(
  JSON.stringify(
    {
      baseUrl,
      iterations,
      presets,
      chromePath,
      allResults,
    },
    null,
    2,
  ),
);
