#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const TARGETS = [
  "src/app/explore",
  "src/app/market",
  "src/app/sectors",
  "src/app/etfs",
  "src/app/screener",
  "src/app/superinvestors",
  "src/app/portfolio",
  "src/app/stock",
  "src/components/Navbar.tsx",
  "src/components/AppEnhancements.tsx",
  "src/components/shell/AppShell.tsx",
  "public/admin/data-lab",
];

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".html"]);
const BLOCKED_COPY = [
  { pattern: "표면데이터", message: "Use '수집 데이터' or a concrete dataset name." },
  { pattern: "표면 데이터", message: "Use '수집 데이터' or a concrete dataset name." },
  { pattern: "운용사 표면", message: "Use '운용사 ETF 목록'." },
  { pattern: "바 표면", message: "Use a concrete chart/table name." },
  { pattern: "작업대", message: "Use '검색', '분석', or '대시보드'." },
  { pattern: "데이터 묶음 정리", message: "Use '수집 현황' or a concrete dataset name." },
  { pattern: "원본 묶음", message: "Use '원본 파일'." },
  { pattern: "제외 묶음", message: "Use '제외 파일'." },
  { pattern: "원재무 깊이", message: "Use '재무 데이터 상세'." },
  { pattern: "신규 ETF100", message: "Use '신규 상장 ETF'." },
  { pattern: "ETF100", message: "Use 'ETF 100개' or '신규 상장 ETF'." },
  { pattern: "Universe rows", message: "Use '전체 종목 수' or '전체 ETF 수'." },
  { pattern: "Source Parity", message: "Use '소스 일치'." },
  { pattern: "Top Stale", message: "Use '오래된 항목'." },
  { pattern: "Top Sign Divergence", message: "Use '부호 불일치 상위 항목'." },
  { pattern: "신규 상장 목록 기준", message: "Use a neutral product status instead of source-specific fallback language." },
  { pattern: "ETF 목록 기준", message: "Use a neutral product status instead of source-specific fallback language." },
  { pattern: "요약 우선", message: "Use '요약 제공' or a clearer status label." },
  { pattern: "상세 이동", message: "Use '상세 가능' or a clearer status label." },
  { pattern: "요약 정보 우선", message: "Use a natural sentence such as '요약 정보부터 확인할 수 있습니다'." },
  { pattern: "가격 정보 우선", message: "Use a natural sentence such as '가격 정보는 연결됐고...'." },
  { pattern: "보조 가격 원장", message: "Use a neutral product status instead of pipeline terminology." },
  { pattern: "· AUM ", message: "Use '운용자산' in public ETF surfaces." },
  { pattern: 'note: "Expense"', message: "Use '보수율' or '총보수'." },
  { pattern: 'note: "Yield"', message: "Use '배당률' or '분배금 기준'." },
  { pattern: 'note: "Trailing"', message: "Use '최근 실적 기준'." },
  { pattern: 'note: "52W High"', message: "Use '최근 52주 고점'." },
  { pattern: 'note: "52W Low"', message: "Use '최근 52주 저점'." },
  { pattern: "stocks_analyzer.json에 존재하지 않는 티커", message: "Do not expose internal file names to users." },
];

function hasAllowedExtension(path) {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && EXTENSIONS.has(path.slice(dot));
}

function walk(path) {
  const abs = join(ROOT, path);
  let stats;
  try {
    stats = statSync(abs);
  } catch {
    return [];
  }
  if (stats.isFile()) return hasAllowedExtension(abs) ? [abs] : [];
  if (!stats.isDirectory()) return [];
  return readdirSync(abs).flatMap((name) => walk(join(path, name)));
}

const files = TARGETS.flatMap(walk);
const failures = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (const rule of BLOCKED_COPY) {
    lines.forEach((line, index) => {
      if (line.includes(rule.pattern)) {
        failures.push({
          file: relative(ROOT, file),
          line: index + 1,
          pattern: rule.pattern,
          message: rule.message,
        });
      }
    });
  }
}

if (failures.length > 0) {
  console.error("public copy lint failed");
  for (const failure of failures) {
    console.error(`${failure.file}:${failure.line} '${failure.pattern}' - ${failure.message}`);
  }
  process.exit(1);
}

console.log(`public copy lint passed (${files.length} files)`);
