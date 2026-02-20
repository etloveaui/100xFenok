/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3105";
const iterations = Number.parseInt(process.env.QA_LIGHTHOUSE_RUNS || "3", 10);
const routes = (process.env.QA_LIGHTHOUSE_ROUTES || "/,/tools/stock-analyzer/native")
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
      chromePath: path.join(playwrightCacheDir, entry.name, "chrome-linux", "chrome"),
    }))
    .filter((entry) => fs.existsSync(entry.chromePath))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));

  return candidates[0]?.chromePath ?? null;
}

const chromePath = process.env.CHROME_PATH || detectPlaywrightChrome();

function percentile50(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return sorted[middle];
}

function runLighthouse(url, outputPath, preset) {
  const lighthouseArgs = [
    url,
    "--output=json",
    `--output-path=${outputPath}`,
    "--only-categories=performance,accessibility,best-practices,seo",
    `--chrome-flags=--headless --no-sandbox --disable-gpu`,
    "--quiet",
  ];

  if (preset === "desktop") {
    lighthouseArgs.push("--preset=desktop");
  }

  execFileSync(
    "npx",
    ["lighthouse", ...lighthouseArgs],
    {
      stdio: "inherit",
      env: chromePath
        ? {
            ...process.env,
            CHROME_PATH: chromePath,
          }
        : process.env,
    },
  );
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
