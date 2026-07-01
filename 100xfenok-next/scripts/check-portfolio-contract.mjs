import fs from "node:fs";

const failures = [];

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireIncludes(source, token, label) {
  if (!source.includes(token)) {
    failures.push(`${label}: missing ${token}`);
  }
}

const portfolioClient = read("src/app/portfolio/PortfolioClient.tsx");
const portfolioLib = read("src/lib/portfolio.ts");
const packageJson = JSON.parse(read("package.json"));

[
  ["data-portfolio-local-boundary", "local boundary strip"],
  ["data-portfolio-boundary-item={item.key}", "boundary item tokens"],
  ["data-portfolio-export-section", "export section"],
  ["data-portfolio-export-json-action", "export json action"],
  ["data-portfolio-import-section", "import section"],
  ["data-portfolio-import-json-input", "import json input"],
  ["data-portfolio-import-json-action", "import json action"],
  ["data-portfolio-connection-csv-action", "connection csv action"],
  ["data-portfolio-local-disclaimer", "local disclaimer"],
  ["브라우저에만", "visible local-storage copy"],
  ["서버 전송 없음", "visible no-server-transfer copy"],
  ["JSON", "visible JSON backup copy"],
  ["CSV", "visible CSV connection copy"],
].forEach(([token, label]) => requireIncludes(portfolioClient, token, label));

[
  ['const KEY = "fenok.portfolio.v1"', "localStorage key"],
  ["window.localStorage.getItem(KEY)", "localStorage read"],
  ["window.localStorage.setItem(KEY", "localStorage write"],
  ["useSyncExternalStore", "reactive local store"],
].forEach(([token, label]) => requireIncludes(portfolioLib, token, label));

if (/\bfetch\s*\(/.test(portfolioLib)) {
  failures.push("portfolio local store must not fetch or send user portfolio data");
}

if (packageJson.scripts?.["qa:portfolio-contract"] !== "node scripts/check-portfolio-contract.mjs") {
  failures.push("package.json missing qa:portfolio-contract script");
}

if (failures.length > 0) {
  console.error("[qa:portfolio-contract] failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("[qa:portfolio-contract] portfolio local boundary contract OK");
