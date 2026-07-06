#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

const TARGET_FILES = [
  "src/app/screener/ScreenerClient.tsx",
  "src/app/screener/StockDetailPanel.tsx",
  "src/lib/screener/deterministicRules.ts",
];

const BANNED_MARKERS = [
  "위약",
  "우호",
  "하방안전",
  "숏안전",
  "역수",
  "오프거래소",
  "뉴스톤",
  "동등가중",
  "매수권유",
  "매수 권유 아님",
  "Feno 자동",
  "압박",
  "coverage=",
  "coverage 미확인",
  "as_of=",
  "upside/downside",
];

const UNGLOSSED_VENDOR_ACRONYMS = ["OHLCV", "OCC", "FINRA"];

function readLines(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), "utf8").split(/\r?\n/);
}

function addFinding(findings, file, line, message) {
  findings.push(`${file}:${line}: ${message}`);
}

function fiscalLabelIsGlossed(line, matchIndex, token) {
  const prefix = line.slice(Math.max(0, matchIndex - 12), matchIndex);
  if (token === "FY+1" && (prefix.endsWith("내년(") || prefix.endsWith("향후 3년(") || prefix.endsWith("내년~3년차("))) return true;
  if (token === "FY+2" && prefix.endsWith("2년차(")) return true;
  if (token === "FY+3" && (prefix.endsWith("3년차(") || prefix.endsWith("~"))) return true;
  return false;
}

const findings = [];

for (const file of TARGET_FILES) {
  const lines = readLines(file);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    for (const marker of BANNED_MARKERS) {
      if (line.includes(marker)) addFinding(findings, file, lineNumber, `banned user copy marker '${marker}'`);
    }
    for (const acronym of UNGLOSSED_VENDOR_ACRONYMS) {
      // Copy grammar H-3 allows the glossed parenthetical form: Korean
      // spelled-out name immediately followed by "(ACRONYM)".
      const glossed = new RegExp(`[가-힣]\\(${acronym}\\)`);
      if (line.includes(acronym) && !glossed.test(line)) {
        addFinding(findings, file, lineNumber, `unglossed vendor acronym '${acronym}'`);
      }
    }
    for (const match of line.matchAll(/FY\+[123]/g)) {
      if (!fiscalLabelIsGlossed(line, match.index ?? 0, match[0])) {
        addFinding(findings, file, lineNumber, `FY label must render with Korean gloss near '${match[0]}'`);
      }
    }
  });
}

if (findings.length > 0) {
  console.error("[screener-copy-grammar] failed");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("[screener-copy-grammar] ok");
