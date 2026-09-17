import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const BASELINE_DIR = path.resolve(REPO_ROOT, "qa-baselines/visual/v6/desktop-1440");
const OUTPUT_DIR = path.resolve(REPO_ROOT, "public/intro/screens");
const INDEX_FILE = path.resolve(OUTPUT_DIR, "index.json");

const SCREENS = [
  { route: "home", label: "홈", href: "/", baseline: "home.png" },
  { route: "market-valuation", label: "시장", href: "/market-valuation", baseline: "market-valuation.png" },
  { route: "regime", label: "시황", href: "/regime", baseline: "regime.png" },
  { route: "sectors", label: "섹터", href: "/sectors", baseline: "sectors.png" },
  { route: "etfs", label: "ETF", href: "/etfs", baseline: "etfs.png" },
  { route: "screener", label: "스크리너", href: "/screener", baseline: "screener.png" },
  { route: "superinvestors", label: "투자자", href: "/superinvestors", baseline: "superinvestors.png" },
  { route: "macro-chart", label: "차트", href: "/macro-chart", baseline: "macro-chart.png" },
  { route: "stock-nvda", label: "종목 상세", href: "/stock/NVDA", baseline: "stock-nvda.png" },
  { route: "portfolio", label: "포트폴리오", href: "/portfolio", baseline: null },
  { route: "radar", label: "Market Radar", href: "/radar", baseline: null },
  { route: "ib", label: "무한매수", href: "/ib", baseline: null },
  { route: "research", label: "리서치", href: "/research", baseline: null },
  { route: "multi-chart", label: "시장 비교", href: "/multichart", baseline: null },
  { route: "market-wrap", label: "100x Daily Wrap", href: "/100x/daily-wrap", baseline: null },
];

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const indexEntries = [];
  let totalBytes = 0;

  for (const item of SCREENS) {
    let sourcePath = null;
    if (item.baseline) {
      const p = path.resolve(BASELINE_DIR, item.baseline);
      if (fs.existsSync(p)) {
        sourcePath = p;
      }
    } else {
      // Fallback: check if route.png or baseline exists in BASELINE_DIR
      const candidate = path.resolve(BASELINE_DIR, `${item.route}.png`);
      if (fs.existsSync(candidate)) {
        sourcePath = candidate;
      }
    }

    if (sourcePath) {
      const fileName = `${item.route}.webp`;
      const outPath = path.resolve(OUTPUT_DIR, fileName);

      const { data, info } = await sharp(sourcePath)
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });

      fs.writeFileSync(outPath, data);
      totalBytes += data.length;

      console.log(`[build-intro-screens] Generated ${fileName} (${info.width}x${info.height}, ${(data.length / 1024).toFixed(1)} KB)`);

      indexEntries.push({
        route: item.route,
        label: item.label,
        href: item.href,
        file: fileName,
        width: info.width,
        height: info.height,
      });
    } else {
      // No QA baseline for this route: keep a committed capture if one exists
      // (public/intro/screens/<route>.webp, produced by the lead from a live
      // capture), otherwise register an empty slot.
      const keptName = `${item.route}.webp`;
      const keptPath = path.resolve(OUTPUT_DIR, keptName);
      if (fs.existsSync(keptPath)) {
        const meta = await sharp(keptPath).metadata();
        totalBytes += fs.statSync(keptPath).size;
        indexEntries.push({
          route: item.route,
          label: item.label,
          href: item.href,
          file: keptName,
          width: meta.width ?? null,
          height: meta.height ?? null,
        });
        console.log(`[build-intro-screens] Slot ${item.route} kept committed capture ${keptName}`);
      } else {
        console.log(`[build-intro-screens] Slot ${item.route} has no baseline; registered with file: null`);
        indexEntries.push({ route: item.route, label: item.label, href: item.href, file: null, width: null, height: null });
      }
    }
  }

  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexEntries, null, 2) + "\n", "utf8");
  console.log(`[build-intro-screens] Wrote ${INDEX_FILE} (${indexEntries.length} entries)`);
  console.log(`[build-intro-screens] Total screen asset payload: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((err) => {
  console.error("[build-intro-screens] Error:", err);
  process.exit(1);
});
