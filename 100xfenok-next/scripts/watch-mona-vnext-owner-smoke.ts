import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type Candidate = {
  fullPath: string;
  relPath: string;
  mtimeMs: number;
};

const args = process.argv.slice(2);
const appRoot = process.cwd();
const defaultLogDir = path.join(appRoot, "data", "voice-logs-vnext", "owner-test");
const logDirArg = readArg("--dir");
const logDir = logDirArg ? path.resolve(appRoot, logDirArg) : defaultLogDir;
const wait = args.includes("--wait");
const includeExisting = args.includes("--include-existing") || !wait;
const timeoutMs = Number.parseInt(readArg("--timeout-ms") || "900000", 10);
const pollMs = Math.max(500, Number.parseInt(readArg("--poll-ms") || "3000", 10));
const startedAtMs = Date.now();

function readArg(name: string) {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1] ?? "";
  return "";
}

function findLatestCandidate(): Candidate | null {
  if (!existsSync(logDir)) return null;
  const candidates = readdirSync(logDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const fullPath = path.join(logDir, name);
      const stat = statSync(fullPath);
      return {
        fullPath,
        relPath: path.relative(appRoot, fullPath),
        mtimeMs: stat.mtimeMs,
      };
    })
    .filter((item) => includeExisting || item.mtimeMs >= startedAtMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] ?? null;
}

function score(candidate: Candidate) {
  console.log(`SCORING ${candidate.relPath}`);
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    command,
    ["run", "score:mona-vnext-session", "--", candidate.fullPath],
    {
      cwd: appRoot,
      stdio: "inherit",
      env: process.env,
    },
  );
  process.exitCode = result.status ?? 1;
}

async function main() {
  const deadline = startedAtMs + timeoutMs;
  while (true) {
    const candidate = findLatestCandidate();
    if (candidate) {
      score(candidate);
      return;
    }

    if (!wait || Date.now() >= deadline) {
      console.error(
        `NO_OWNER_LOG dir=${path.relative(appRoot, logDir) || logDir} wait=${wait} includeExisting=${includeExisting}`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(`WAIT owner log dir=${path.relative(appRoot, logDir)} timeoutMs=${timeoutMs}`);
    await new Promise((resolve) => {
      setTimeout(resolve, pollMs);
    });
  }
}

void main();
