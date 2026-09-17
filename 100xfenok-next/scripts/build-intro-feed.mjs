import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tsScript = path.join(__dirname, "build-intro-feed.ts");

const res = spawnSync("npx", ["tsx", tsScript], {
  stdio: "inherit",
  env: process.env,
});

process.exit(res.status ?? 0);
